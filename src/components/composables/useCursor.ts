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
	cursorLocation: Ref<number | null>;
	scrollToByte: (offset: number) => void;
}

export interface CursorResult {
	cursorLocation: ComputedRef<number | null>;
	setCursorLocation: (index: number | null) => void;
}

export function useCursor(options: CursorOptions): CursorResult {
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
		[normalizedCursorLocation, options.enabled],
		async () => {
			await nextTick();
			syncCursorHighlight();
		},
		{ flush: "post" },
	);

	watch(normalizedCursorLocation, (next, prev) => {
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

	return { cursorLocation: normalizedCursorLocation, setCursorLocation };
}
