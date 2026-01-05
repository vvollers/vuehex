import type { ComputedRef, Ref, ShallowRef } from "vue";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";

const CURSOR_CLASS = "vuehex-cursor";

export interface CursorOptions {
	enabled: ComputedRef<boolean>;
	isExpandToContent: ComputedRef<boolean>;
	containerEl: Ref<HTMLDivElement | undefined>;
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	markup: ShallowRef<string>;
	totalBytes: ComputedRef<number>;
	bytesPerRow: ComputedRef<number>;
	rowHeightValue: ComputedRef<number>;
	viewportRows: ComputedRef<number>;
	chunkStartRow: Ref<number>;
	ensureChunkForRow: (row: number) => boolean;
	scheduleWindowEvaluation: () => void;
	getCursorLocationProp: () => number | null | undefined;
	emitCursorLocationUpdate: (value: number | null) => void;
	emitCursorChange: (payload: { index: number | null }) => void;
	scrollToByte: (offset: number) => void;
}

export interface CursorResult {
	cursorLocation: ComputedRef<number | null>;
	setCursorLocation: (index: number | null) => void;
}

function clampIndex(index: number, total: number): number {
	if (total <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(Math.trunc(index), Math.max(0, total - 1)));
}

function readIndexFromElement(element: Element | null): number | null {
	if (!(element instanceof HTMLElement)) {
		return null;
	}
	const cell = element.closest<HTMLElement>(
		"[data-hex-index], [data-ascii-index]",
	);
	if (!cell || cell.getAttribute("aria-hidden") === "true") {
		return null;
	}
	const attr = cell.hasAttribute("data-hex-index")
		? cell.getAttribute("data-hex-index")
		: cell.getAttribute("data-ascii-index");
	if (!attr) {
		return null;
	}
	const parsed = Number.parseInt(attr, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

export function useCursor(options: CursorOptions): CursorResult {
	const internalCursor = ref<number | null>(null);

	const isControlled = computed(
		() => options.getCursorLocationProp() !== undefined,
	);

	const cursorLocation = computed<number | null>(() => {
		if (!options.enabled.value) {
			return null;
		}

		const total = options.totalBytes.value;
		const provided = options.getCursorLocationProp();
		const source = provided !== undefined ? provided : internalCursor.value;

		if (source === null) {
			return null;
		}

		const index = Number(source);
		if (!Number.isFinite(index) || total <= 0) {
			return null;
		}

		return clampIndex(index, total);
	});

	function emitIfChanged(next: number | null) {
		const prev = cursorLocation.value;
		if (prev === next) {
			return;
		}
		options.emitCursorLocationUpdate(next);
		options.emitCursorChange({ index: next });
	}

	function ensureCursorVisible(index: number) {
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
			options.scrollToByte(index);
			return;
		}

		const bytesPerRowValue = Math.max(1, Math.trunc(options.bytesPerRow.value));
		const rowHeightPx = options.rowHeightValue.value;
		const viewportRowCount = options.viewportRows.value;

		if (rowHeightPx <= 0 || viewportRowCount <= 0) {
			options.scrollToByte(index);
			return;
		}

		const cursorRow = Math.floor(index / bytesPerRowValue);
		const chunkChanged = options.ensureChunkForRow(cursorRow);
		const chunkStart = options.chunkStartRow.value;

		if (chunkChanged) {
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

	function setCursorLocation(index: number | null) {
		if (!options.enabled.value) {
			return;
		}

		const total = options.totalBytes.value;
		if (total <= 0) {
			if (!isControlled.value) {
				internalCursor.value = null;
			}
			emitIfChanged(null);
			return;
		}

		let next: number | null = null;
		if (index !== null) {
			const numeric = Number(index);
			if (Number.isFinite(numeric)) {
				next = clampIndex(numeric, total);
			}
		}

		if (!isControlled.value) {
			internalCursor.value = next;
		}

		emitIfChanged(next);
	}

	const lastAppliedIndex = ref<number | null>(null);

	function removeCursorFromIndex(tbody: HTMLElement, index: number) {
		const hex = tbody.querySelector<HTMLElement>(`[data-hex-index="${index}"]`);
		const ascii = tbody.querySelector<HTMLElement>(
			`[data-ascii-index="${index}"]`,
		);
		hex?.classList.remove(CURSOR_CLASS);
		ascii?.classList.remove(CURSOR_CLASS);
	}

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

	function syncCursorHighlight() {
		const tbody = options.tbodyEl.value;
		if (!tbody) {
			return;
		}

		const nextIndex = cursorLocation.value;
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

	function handlePointerDown(event: PointerEvent) {
		if (!options.enabled.value) {
			return;
		}
		if (event.button !== 0) {
			return;
		}

		const index = readIndexFromElement(event.target as Element | null);
		if (index === null) {
			return;
		}

		options.containerEl.value?.focus();
		setCursorLocation(index);
	}

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

		const current = cursorLocation.value ?? 0;
		setCursorLocation(current + (delta ?? 0));
	}

	watch(
		options.markup,
		async () => {
			lastAppliedIndex.value = null;
			await nextTick();
			syncCursorHighlight();
		},
		{ flush: "post" },
	);

	watch(
		[cursorLocation, options.enabled],
		async () => {
			await nextTick();
			syncCursorHighlight();
		},
		{ flush: "post" },
	);

	watch(cursorLocation, (next, prev) => {
		if (!options.enabled.value) {
			return;
		}
		if (next === null || next === prev) {
			return;
		}
		ensureCursorVisible(next);
	});

	onMounted(() => {
		const container = options.containerEl.value;
		if (container) {
			container.addEventListener("keydown", handleKeydown);
			container.addEventListener("pointerdown", handlePointerDown);
		}
	});

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

	return { cursorLocation, setCursorLocation };
}
