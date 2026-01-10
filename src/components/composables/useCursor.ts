import type { ComputedRef, Ref, ShallowRef } from "vue";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import { clamp, readByteIndexFromElement } from "../vuehex-utils";

/**
 * CSS class applied to the currently active byte cell (hex + ASCII).
 *
 * Why it exists: avoids coupling styling to selection/hover classes.
 */
const CURSOR_CLASS = "vuehex-cursor";

export interface CursorOptions {
	/** Master enable toggle for cursor behaviors and DOM highlighting. */
	enabled: ComputedRef<boolean>;
	/** When true, scrolling/virtualization is disabled so cursor scrolling is skipped. */
	isExpandToContent: ComputedRef<boolean>;
	/** Scroll container element (focus + scrollTop updates). */
	containerEl: Ref<HTMLDivElement | undefined>;
	/** Table body element containing the rendered cells (for class toggling). */
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	/** Current rendered markup (used to know when to re-apply cursor highlights). */
	markup: ShallowRef<string>;
	/** Total bytes in the backing data source (for clamping). */
	totalBytes: ComputedRef<number>;
	/** Bytes per row (for row math during navigation). */
	bytesPerRow: ComputedRef<number>;
	/** Row height in pixels (for scroll math). */
	rowHeightValue: ComputedRef<number>;
	/** Visible rows in the viewport (used to keep cursor in view). */
	viewportRows: ComputedRef<number>;
	/** Current chunk start row (for relative scroll math within a chunk). */
	chunkStartRow: Ref<number>;
	/** Ensures the chunk containing a row is active; returns true if it changed. */
	ensureChunkForRow: (row: number) => boolean;
	/** Schedules a re-evaluation of the rendered window after scroll/chunk changes. */
	scheduleWindowEvaluation: () => void;
	/** External cursor location model (0-based byte index), or null. */
	cursorLocation: Ref<number | null>;
	/** Requests scrolling such that an absolute byte offset is visible. */
	scrollToByte: (offset: number) => void;
}

export interface CursorResult {
	/**
	 * Normalized cursor location (byte index) or null when cursor is disabled/unset.
	 */
	cursorLocation: ComputedRef<number | null>;
	/**
	 * Updates the cursor location (clamped to the valid byte range).
	 */
	setCursorLocation: (index: number | null) => void;
}

/**
 * Manages the interactive cursor for VueHex.
 *
 * Why it exists:
 * - Centralizes keyboard + pointer navigation for the "active byte".
 * - Applies/removes cursor highlight classes to both hex and ASCII cells.
 * - Ensures the active byte stays visible within the current scroll window.
 *
 * How it is used:
 * - VueHex wires table/container refs + event handlers into this composable.
 * - When the cursor changes, it updates the `cursorLocation` model value and
 *   mutates DOM classes inside the rendered `tbody` markup.
 * - For large datasets, it works with chunking/window virtualization via
 *   `ensureChunkForRow` and `scheduleWindowEvaluation`.
 */
export function useCursor(options: CursorOptions): CursorResult {
	/**
	 * Cursor location normalized to a valid byte index.
	 *
	 * Why it exists: cursorLocation is an external model value; normalization
	 * keeps all downstream code working with a safe, finite, in-range index.
	 */
	const normalizedCursorLocation = computed<number | null>(() => {
		if (!options.enabled.value) {
			return null;
		}

		const total = options.totalBytes.value;
		const source = options.cursorLocation.value;

		if (source === null) {
			return null;
		}

		const index = Number(source);
		if (!Number.isFinite(index) || total <= 0) {
			return null;
		}

		return total > 0 ? clamp(Math.trunc(index), 0, total - 1) : 0;
	});

	/**
	 * Ensures the cursor's byte index is visible in the scroll container.
	 *
	 * Why it exists: keyboard navigation should keep the active byte in view,
	 * even when chunking/virtualization changes the active slice.
	 */
	function ensureCursorVisible(index: number) {
		// ---- Preconditions ----------------------------------------------------------
		if (!options.enabled.value) {
			return;
		}
		if (options.isExpandToContent.value) {
			return;
		}

		const total = options.totalBytes.value;
		if (total <= 0) {
			return;
		}

		const container = options.containerEl.value;
		if (!container) {
			// Without a container, delegate to the higher-level scroll helper.
			options.scrollToByte(index);
			return;
		}

		const bytesPerRowValue = Math.max(1, Math.trunc(options.bytesPerRow.value));
		const rowHeightPx = options.rowHeightValue.value;
		const viewportRowCount = options.viewportRows.value;

		if (rowHeightPx <= 0 || viewportRowCount <= 0) {
			// Missing measurement; best-effort scroll.
			options.scrollToByte(index);
			return;
		}

		// ---- Convert byte index to row and keep it visible -------------------------
		const cursorRow = Math.floor(index / bytesPerRowValue);
		const chunkChanged = options.ensureChunkForRow(cursorRow);
		const chunkStart = options.chunkStartRow.value;

		if (chunkChanged) {
			// Jump within the new chunk and trigger window evaluation.
			container.scrollTop = Math.max(0, (cursorRow - chunkStart) * rowHeightPx);
			options.scheduleWindowEvaluation();
			return;
		}

		const scrollTop = container.scrollTop;
		const topRowWithinChunk = Math.floor(scrollTop / rowHeightPx);
		const visibleStartRow = chunkStart + topRowWithinChunk;
		const visibleEndRow = visibleStartRow + viewportRowCount - 1;

		if (cursorRow < visibleStartRow) {
			container.scrollTop = Math.max(0, (cursorRow - chunkStart) * rowHeightPx);
			options.scheduleWindowEvaluation();
			return;
		}

		if (cursorRow > visibleEndRow) {
			const nextTopRow = cursorRow - (viewportRowCount - 1);
			container.scrollTop = Math.max(
				0,
				(nextTopRow - chunkStart) * rowHeightPx,
			);
			options.scheduleWindowEvaluation();
		}
	}

	/**
	 * Sets the external cursor model value after clamping to the valid range.
	 */
	function setCursorLocation(index: number | null) {
		if (!options.enabled.value) {
			return;
		}

		const total = options.totalBytes.value;
		if (total <= 0) {
			options.cursorLocation.value = null;
			return;
		}

		let next: number | null = null;
		if (index !== null) {
			const numeric = Number(index);
			if (Number.isFinite(numeric)) {
				next = total > 0 ? clamp(Math.trunc(numeric), 0, total - 1) : 0;
			}
		}

		options.cursorLocation.value = next;
	}

	/**
	 * Tracks the most recent index for which DOM classes were applied.
	 *
	 * Why it exists: allows incremental updates (remove old, apply new) rather
	 * than scanning and clearing the entire table each time.
	 */
	const lastAppliedIndex = ref<number | null>(null);

	/**
	 * Removes cursor CSS classes for a specific absolute byte index.
	 */
	function removeCursorFromIndex(tbody: HTMLElement, index: number) {
		const hex = tbody.querySelector<HTMLElement>(`[data-hex-index="${index}"]`);
		const ascii = tbody.querySelector<HTMLElement>(
			`[data-ascii-index="${index}"]`,
		);
		hex?.classList.remove(CURSOR_CLASS);
		ascii?.classList.remove(CURSOR_CLASS);
	}

	/**
	 * Applies cursor CSS classes to the hex and/or ASCII cell for an index.
	 * Returns true if a visible element was found and updated.
	 */
	function addCursorToIndex(tbody: HTMLElement, index: number): boolean {
		const hex = tbody.querySelector<HTMLElement>(`[data-hex-index="${index}"]`);
		const ascii = tbody.querySelector<HTMLElement>(
			`[data-ascii-index="${index}"]`,
		);
		let applied = false;
		if (hex && hex.getAttribute("aria-hidden") !== "true") {
			hex.classList.add(CURSOR_CLASS);
			applied = true;
		}
		if (ascii && ascii.getAttribute("aria-hidden") !== "true") {
			ascii.classList.add(CURSOR_CLASS);
			applied = true;
		}
		return applied;
	}

	/**
	 * Synchronizes DOM highlight state with `normalizedCursorLocation`.
	 *
	 * Why it exists: markup is regenerated via `v-html`, so we must re-apply
	 * classes after each markup update.
	 */
	function syncCursorHighlight() {
		const tbody = options.tbodyEl.value;
		if (!tbody) {
			return;
		}

		const nextIndex = normalizedCursorLocation.value;
		const prevIndex = lastAppliedIndex.value;

		if (prevIndex !== null && prevIndex !== nextIndex) {
			removeCursorFromIndex(tbody, prevIndex);
		}

		if (nextIndex === null) {
			lastAppliedIndex.value = null;
			return;
		}

		const applied = addCursorToIndex(tbody, nextIndex);
		lastAppliedIndex.value = applied ? nextIndex : null;
	}

	/**
	 * Pointer handler: clicking a cell sets the cursor to that byte index.
	 */
	function handlePointerDown(event: PointerEvent) {
		if (!options.enabled.value) {
			return;
		}
		if (event.button !== 0) {
			return;
		}

		const index = readByteIndexFromElement(event.target as Element | null);
		if (index === null) {
			return;
		}

		options.containerEl.value?.focus();
		setCursorLocation(index);
	}

	/**
	 * Keyboard handler: arrow keys move the cursor by 1 byte or 1 row.
	 */
	function handleKeydown(event: KeyboardEvent) {
		if (!options.enabled.value) {
			return;
		}

		const total = options.totalBytes.value;
		if (total <= 0) {
			return;
		}

		const rowStride = Math.max(1, Math.trunc(options.bytesPerRow.value || 1));
		let delta: number | null = null;

		switch (event.key) {
			case "ArrowLeft":
				delta = -1;
				break;
			case "ArrowRight":
				delta = 1;
				break;
			case "ArrowUp":
				delta = -rowStride;
				break;
			case "ArrowDown":
				delta = rowStride;
				break;
			default:
				return;
		}

		event.preventDefault();

		const current = normalizedCursorLocation.value ?? 0;
		setCursorLocation(current + (delta ?? 0));
	}

	/**
	 * When markup changes, all DOM references are replaced; re-apply highlight.
	 */
	watch(
		options.markup,
		async () => {
			lastAppliedIndex.value = null;
			await nextTick();
			syncCursorHighlight();
		},
		{ flush: "post" },
	);

	/**
	 * When the cursor changes, update the DOM highlight (post-render).
	 */
	watch(
		[normalizedCursorLocation, options.enabled],
		async () => {
			await nextTick();
			syncCursorHighlight();
		},
		{ flush: "post" },
	);

	/**
	 * When the cursor changes, ensure it is visible.
	 */
	watch(normalizedCursorLocation, (next, prev) => {
		if (!options.enabled.value) {
			return;
		}
		if (next === null || next === prev) {
			return;
		}
		ensureCursorVisible(next);
	});

	/**
	 * Event wiring: listeners are attached directly to the scroll container.
	 */
	onMounted(() => {
		const container = options.containerEl.value;
		if (container) {
			container.addEventListener("keydown", handleKeydown);
			container.addEventListener("pointerdown", handlePointerDown);
		}
	});

	/**
	 * Cleanup: remove listeners and any cursor classes we applied.
	 */
	onBeforeUnmount(() => {
		const container = options.containerEl.value;
		if (container) {
			container.removeEventListener("keydown", handleKeydown);
			container.removeEventListener("pointerdown", handlePointerDown);
		}

		const tbody = options.tbodyEl.value;
		const prevIndex = lastAppliedIndex.value;
		if (tbody && prevIndex !== null) {
			removeCursorFromIndex(tbody, prevIndex);
		}
		lastAppliedIndex.value = null;
	});

	return { cursorLocation: normalizedCursorLocation, setCursorLocation };
}
