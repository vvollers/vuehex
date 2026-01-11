import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
	VueHexAsciiRenderer,
	VueHexPrintableCheck,
	VueHexSelectionDataProvider,
} from "../vuehex-api";
import { clamp, parseIndexAttribute } from "../vuehex-utils";

export interface SelectionOptions {
	/** Scroll container element (focus + pointer event wiring). */
	containerEl: Ref<HTMLDivElement | undefined>;
	/** Table body element containing rendered cells (used for event delegation). */
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	/** Current rendered markup; changes trigger re-sync of selection classes. */
	markup: ShallowRef<string>;

	/** Optional user-provided selection data provider (used for copy). */
	getSelectionDataProp: () => VueHexSelectionDataProvider | undefined;
	/** True when VueHex owns the full data buffer locally. */
	isSelfManagedData: ComputedRef<boolean>;
	/** Total bytes in the backing data source (for clamping). */
	totalBytes: ComputedRef<number>;
	/** Returns the locally-managed bytes when in self-managed mode. */
	getSelfManagedBytes: () => Uint8Array;

	/** Casing preference used by renderer helpers. */
	getUppercase: () => boolean;
	/** Determines whether bytes are printable for ASCII rendering. */
	getPrintableChecker: () => VueHexPrintableCheck;
	/** Converts a byte into an ASCII glyph (when printable). */
	getAsciiRenderer: () => VueHexAsciiRenderer;
	/** Replacement character for non-printable bytes. */
	getNonPrintableChar: () => string;

	/** Forces markup regeneration so selection CSS classes are embedded. */
	updateRenderedSlice: () => void;

	/**
	 * When true, selection can only be started/updated via Shift+click.
	 *
	 * Why it exists: in cursor/editable modes, normal clicks should move the cursor
	 * without implicitly selecting a single byte.
	 */
	requireShiftToSelect?: ComputedRef<boolean>;
	/**
	 * Optional cursor index used as the anchor when shift-clicking with no existing selection.
	 *
	 * Why it exists: supports common UX where click moves cursor, then shift-click
	 * selects the range from the cursor to the clicked byte.
	 */
	cursorIndex?: ComputedRef<number | null>;

	/** Optional emitter for click events on individual bytes. */
	emitByteClick?: (payload: {
		index: number;
		byte: number;
		kind: "hex" | "ascii";
	}) => void;
	/** Optional emitter for selection range changes. */
	emitSelectionChange?: (payload: {
		start: number | null;
		end: number | null;
		length: number;
	}) => void;
}

export interface SelectionResult {
	/**
	 * Function used to retrieve selected bytes for copy/consumer APIs.
	 * Null when selection is disabled.
	 */
	selectionDataProvider: ComputedRef<VueHexSelectionDataProvider | null>;
	/** True when selection is active/enabled. */
	selectionEnabled: ComputedRef<boolean>;
	/** Ordered selection range (inclusive), or null when there is no selection. */
	selectionRange: ComputedRef<{ start: number; end: number } | null>;
	/** Number of selected bytes. */
	selectionCount: ComputedRef<number>;
	/** Clears any active selection (no-op if none). */
	clearSelection: () => void;
	/** Copies the current selection to the clipboard (no-op if none). */
	copySelectionToClipboard: () => Promise<boolean>;
}

interface SelectionState {
	/** Which column initiated the selection (hex vs ascii). */
	mode: "hex" | "ascii";
	/** Anchor index where the selection started. */
	anchor: number;
	/** Current focus index (moves as the user drags). */
	focus: number;
}

/**
 * Provides mouse/pointer-driven selection for VueHex.
 *
 * Why it exists:
 * - Tracks anchor/focus to form a stable selection range across interactions.
 * - Supports selection in either the hex or ASCII column while keeping indices aligned.
 * - Emits selection/click events and triggers markup regeneration so selection CSS
 *   classes are embedded in the rendered HTML.
 *
 * How it is used:
 * - VueHex passes DOM refs (`containerEl`, `tbodyEl`) and the current markup ref.
 * - The composable attaches pointer listeners and updates selection state.
 * - When selection changes, it requests a re-render via `updateRenderedSlice`.
 * - For clipboard/copy workflows, it exposes a `selectionDataProvider` that is
 *   either user-supplied (`getSelectionDataProp`) or derived from self-managed data.
 */
export function useSelection(options: SelectionOptions): SelectionResult {
	/**
	 * Calculate ordered start and end from anchor and focus.
	 *
	 * Why it exists: selection is stored as (anchor, focus) to preserve the
	 * direction of interaction, but most downstream consumers want an ordered
	 * inclusive range.
	 */
	function getOrderedRange(
		anchor: number,
		focus: number,
	): { start: number; end: number } {
		return {
			start: Math.min(anchor, focus),
			end: Math.max(anchor, focus),
		};
	}

	/**
	 * Selection data provider for copy operations.
	 *
	 * Why it exists: consumers can provide their own provider (e.g. windowed
	 * mode fetching), while buffer mode can derive it from local bytes.
	 */
	const selectionDataProvider = computed<VueHexSelectionDataProvider | null>(
		() => {
			const provided = options.getSelectionDataProp();
			if (provided) {
				return provided;
			}

			if (!options.isSelfManagedData.value) {
				return null;
			}

			return (selectionStart, selectionEnd) => {
				const total = options.totalBytes.value;
				if (total <= 0) {
					return new Uint8Array(0);
				}
				const start = clamp(Math.trunc(selectionStart), 0, total - 1);
				const end = clamp(Math.trunc(selectionEnd), 0, total - 1);
				const { start: from, end: to } = getOrderedRange(start, end);
				return options.getSelfManagedBytes().slice(from, to + 1);
			};
		},
	);

	/** Whether selection is enabled (provider is available). */
	const selectionEnabled = computed(() => selectionDataProvider.value !== null);

	/**
	 * Ordered selection range (inclusive) derived from the selection state.
	 */
	const selectionRange = computed<{ start: number; end: number } | null>(() => {
		if (!selectionEnabled.value) {
			return null;
		}
		const state = selectionState.value;
		if (!state) {
			return null;
		}
		const total = options.totalBytes.value;
		if (total <= 0) {
			return null;
		}
		const anchor = clamp(Math.trunc(state.anchor), 0, total - 1);
		const focus = clamp(Math.trunc(state.focus), 0, total - 1);
		return getOrderedRange(anchor, focus);
	});

	/** Number of selected bytes. */
	const selectionCount = computed(() => {
		const range = selectionRange.value;
		if (!range) {
			return 0;
		}
		return Math.max(0, range.end - range.start + 1);
	});

	/** Current selection interaction state, or null when nothing is selected. */
	const selectionState = ref<SelectionState | null>(null);
	/** True while the user is actively dragging to select. */
	const isPointerSelecting = ref(false);
	/** Pointer ID for the active drag gesture (prevents multi-pointer confusion). */
	const activePointerId = ref<number | null>(null);
	/**
	 * Remembers the last non-shift click index when Shift is required to select.
	 *
	 * Why it exists: cursor and selection both listen to pointerdown; depending on
	 * listener order, the cursor location may update before selection logic runs.
	 * This cached index ensures click → Shift+click reliably selects a range.
	 */
	const lastNonShiftClickIndex = ref<number | null>(null);
	let selectionSyncHandle: number | null = null;

	/**
	 * Emit selection-change events whenever the ordered range changes.
	 */
	watch(selectionRange, (newRange) => {
		if (options.emitSelectionChange) {
			options.emitSelectionChange({
				start: newRange?.start ?? null,
				end: newRange?.end ?? null,
				length: selectionCount.value,
			});
		}
	});

	/**
	 * Schedules a markup refresh so selection classes are embedded.
	 *
	 * Why it exists: the table body is rendered via `v-html`, so selection styling
	 * must be encoded in the generated markup rather than via reactive templates.
	 */
	function scheduleSelectionSync() {
		if (typeof window === "undefined") {
			return;
		}
		if (selectionSyncHandle !== null) {
			cancelAnimationFrame(selectionSyncHandle);
		}
		selectionSyncHandle = requestAnimationFrame(() => {
			selectionSyncHandle = null;
			// Trigger markup regeneration which will embed selection classes
			options.updateRenderedSlice();
		});
	}

	/**
	 * Extracts selection metadata from a DOM element using `data-*` attributes.
	 */
	function getSelectionPayloadFromElement(
		element: Element | null,
	): { mode: "hex" | "ascii"; index: number } | null {
		if (!(element instanceof HTMLElement)) {
			return null;
		}
		const cell = element.closest<HTMLElement>(
			"[data-hex-index], [data-ascii-index]",
		);
		if (!cell || cell.getAttribute("aria-hidden") === "true") {
			return null;
		}
		if (cell.hasAttribute("data-hex-index")) {
			const index = parseIndexAttribute(cell, "data-hex-index");
			if (index === null) {
				return null;
			}
			// Do not allow selection to include the EOF "ghost" byte.
			if (index < 0 || index >= options.totalBytes.value) {
				return null;
			}
			return { mode: "hex", index };
		}
		if (cell.hasAttribute("data-ascii-index")) {
			const index = parseIndexAttribute(cell, "data-ascii-index");
			if (index === null) {
				return null;
			}
			// Do not allow selection to include the EOF "ghost" byte.
			if (index < 0 || index >= options.totalBytes.value) {
				return null;
			}
			return { mode: "ascii", index };
		}
		return null;
	}

	/**
	 * Starts a new drag selection gesture.
	 */
	function beginManualSelection(
		mode: "hex" | "ascii",
		index: number,
		pointerId: number,
	) {
		selectionState.value = { mode, anchor: index, focus: index };
		isPointerSelecting.value = true;
		activePointerId.value = pointerId;
		scheduleSelectionSync();
	}

	/**
	 * Updates the selection focus during a drag gesture.
	 */
	function updateManualSelection(index: number) {
		if (!selectionState.value) {
			return;
		}
		if (selectionState.value.focus === index) {
			return;
		}
		selectionState.value = {
			...selectionState.value,
			focus: index,
		};
		scheduleSelectionSync();
	}

	/** Ends the active drag gesture (selection remains). */
	function finishPointerSelection() {
		isPointerSelecting.value = false;
		activePointerId.value = null;
	}

	/** Clears selection state and schedules a markup refresh. */
	function clearSelection() {
		if (!selectionState.value) {
			return;
		}
		selectionState.value = null;
		scheduleSelectionSync();
	}

	/**
	 * Pointer handler: starts selection, extends selection with Shift, and emits
	 * byte-click events.
	 */
	function handlePointerDown(event: PointerEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		if (event.button !== 0) {
			return;
		}
		const shiftToSelect = options.requireShiftToSelect?.value ?? false;
		const payload = getSelectionPayloadFromElement(
			event.target as Element | null,
		);

		// ---- Emit click events (independent of selection logic) --------------------
		if (payload && options.emitByteClick) {
			const data = options.getSelfManagedBytes();
			if (payload.index < data.length) {
				const byte = data[payload.index];
				if (byte !== undefined) {
					options.emitByteClick({
						index: payload.index,
						byte,
						kind: payload.mode,
					});
				}
			}
		}

		// ---- Selection behavior ----------------------------------------------------
		const existing = selectionState.value;
		if (!payload) {
			if (!event.shiftKey) {
				clearSelection();
			}
			finishPointerSelection();
			return;
		}

		// In cursor/editable mode, normal clicks should not start a selection.
		if (shiftToSelect && !event.shiftKey) {
			lastNonShiftClickIndex.value = payload.index;
			clearSelection();
			finishPointerSelection();
			return;
		}

		event.preventDefault();
		options.containerEl.value?.focus();

		if (shiftToSelect && event.shiftKey && !existing) {
			const cursorAnchor =
				lastNonShiftClickIndex.value ?? options.cursorIndex?.value;
			if (cursorAnchor != null && Number.isFinite(cursorAnchor)) {
				selectionState.value = {
					mode: payload.mode,
					anchor: cursorAnchor,
					focus: payload.index,
				};
				isPointerSelecting.value = false;
				activePointerId.value = null;
				scheduleSelectionSync();
				return;
			}
		}

		if (event.shiftKey && existing && existing.mode === payload.mode) {
			selectionState.value = {
				mode: existing.mode,
				anchor: existing.anchor,
				focus: payload.index,
			};
			isPointerSelecting.value = false;
			activePointerId.value = null;
			scheduleSelectionSync();
			return;
		}
		beginManualSelection(payload.mode, payload.index, event.pointerId);
	}

	/**
	 * Resolves the selection payload even if the pointer target isn't a cell
	 * (e.g. due to fast movement), by falling back to elementFromPoint.
	 */
	function resolveSelectionPayloadFromEvent(event: PointerEvent) {
		const direct = getSelectionPayloadFromElement(
			event.target as Element | null,
		);
		if (direct) {
			return direct;
		}
		const fallback = document.elementFromPoint(event.clientX, event.clientY);
		return getSelectionPayloadFromElement(fallback);
	}

	/**
	 * Pointer handler: updates selection focus during dragging.
	 */
	function handlePointerMove(event: PointerEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		if (!isPointerSelecting.value) {
			return;
		}
		if (
			activePointerId.value !== null &&
			activePointerId.value !== event.pointerId
		) {
			return;
		}
		const payload = resolveSelectionPayloadFromEvent(event);
		if (!payload) {
			return;
		}
		const state = selectionState.value;
		if (!state || payload.mode !== state.mode) {
			return;
		}
		updateManualSelection(payload.index);
	}

	/**
	 * Pointer handler: finishes a selection drag gesture.
	 */
	function handlePointerUp(event: PointerEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		if (
			activePointerId.value !== null &&
			activePointerId.value !== event.pointerId
		) {
			return;
		}
		finishPointerSelection();
	}

	/**
	 * Builds a textual representation of the current selection.
	 *
	 * Why it exists: supports copy-to-clipboard both for ASCII selections and
	 * for hex selections (space-separated bytes).
	 */
	function buildSelectionText(state: SelectionState): string | null {
		const provider = selectionDataProvider.value;
		if (!provider) {
			return null;
		}
		const { start, end } = getOrderedRange(state.anchor, state.focus);
		const bytes = provider(start, end);
		if (!bytes.length) {
			return null;
		}

		if (state.mode === "ascii") {
			const isPrintable = options.getPrintableChecker();
			const renderAscii = options.getAsciiRenderer();
			const fallback = options.getNonPrintableChar();
			return Array.from(bytes, (byte) =>
				isPrintable(byte) ? renderAscii(byte) : fallback,
			).join("");
		}

		const upper = options.getUppercase();
		return Array.from(bytes, (byte) => {
			const hex = byte.toString(16).padStart(2, "0");
			return upper ? hex.toUpperCase() : hex;
		}).join(" ");
	}

	/**
	 * Writes text to the clipboard using the async Clipboard API when available.
	 */
	async function writeTextToClipboard(text: string): Promise<boolean> {
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
			return false;
		}
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			console.error("Failed to write text to clipboard.");
			return false;
		}
	}

	async function copySelectionToClipboard(): Promise<boolean> {
		if (!selectionEnabled.value) {
			return false;
		}
		const state = selectionState.value;
		if (!state) {
			return false;
		}
		const text = buildSelectionText(state);
		if (!text) {
			return false;
		}
		return writeTextToClipboard(text);
	}

	/**
	 * Keyboard handler:
	 * - Ctrl/Cmd+C copies the current selection.
	 * - Escape clears selection.
	 */
	function handleKeydown(event: KeyboardEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		const key = event.key.toLowerCase();
		const hasModifier = event.ctrlKey || event.metaKey;
		const isSelectAll = hasModifier && key === "a";
		if (isSelectAll) {
			event.preventDefault();
			const total = options.totalBytes.value;
			if (total <= 0) {
				clearSelection();
				return;
			}
			const mode = selectionState.value?.mode ?? "hex";
			selectionState.value = { mode, anchor: 0, focus: total - 1 };
			finishPointerSelection();
			scheduleSelectionSync();
			return;
		}
		const isCopy = hasModifier && key === "c";
		if (isCopy) {
			event.preventDefault();
			void copySelectionToClipboard();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			clearSelection();
		}
	}

	/** Re-embed selection classes whenever markup is regenerated. */
	watch(options.markup, () => {
		scheduleSelectionSync();
	});

	/** If selection becomes enabled/disabled, refresh markup. */
	watch(selectionEnabled, () => {
		scheduleSelectionSync();
	});

	/**
	 * Event wiring: selection is managed via delegated pointer handlers.
	 */
	onMounted(() => {
		const container = options.containerEl.value;
		if (container) {
			container.addEventListener("keydown", handleKeydown);
			container.addEventListener("pointerdown", handlePointerDown);
		}

		if (typeof window !== "undefined") {
			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
			window.addEventListener("pointercancel", handlePointerUp);
		}
	});

	/** Cleanup: remove listeners and cancel pending RAF work. */
	onBeforeUnmount(() => {
		const container = options.containerEl.value;
		if (container) {
			container.removeEventListener("keydown", handleKeydown);
			container.removeEventListener("pointerdown", handlePointerDown);
		}

		if (typeof window !== "undefined") {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		}

		if (selectionSyncHandle !== null) {
			cancelAnimationFrame(selectionSyncHandle);
			selectionSyncHandle = null;
		}
	});

	return {
		selectionDataProvider,
		selectionEnabled,
		selectionRange,
		selectionCount,
		clearSelection,
		copySelectionToClipboard,
	};
}
