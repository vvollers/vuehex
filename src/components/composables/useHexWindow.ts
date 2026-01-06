import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, nextTick, ref, shallowRef } from "vue";
import type {
	VueHexAsciiRenderer,
	VueHexCellClassResolver,
	VueHexPrintableCheck,
	VueHexWindow,
	VueHexWindowRequest,
} from "../vuehex-api";
import type { BuildHexTableMarkupFn } from "../vuehex-utils";
import { normalizeSource, resolveFallbackChar } from "../vuehex-utils";

export interface HexWindowOptions {
	containerEl: Ref<HTMLDivElement | undefined>;
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	bytesPerRow: ComputedRef<number>;
	rowHeight: Ref<number | null>;
	rowHeightValue: ComputedRef<number>;
	containerHeight: Ref<number>;
	viewportRows: ComputedRef<number>;
	overscanRows: ComputedRef<number>;
	chunkStartRow: Ref<number>;
	chunkRowCount: ComputedRef<number>;
	totalBytes: ComputedRef<number>;
	ensureChunkForRow: (row: number) => boolean;
	clampChunkStartToBounds: () => void;
	buildHexTableMarkup: BuildHexTableMarkupFn;
	getWindowState: () => VueHexWindow;
	getUppercase: () => boolean;
	getPrintableChecker: () => VueHexPrintableCheck;
	getAsciiRenderer: () => VueHexAsciiRenderer;
	getCellClassResolver: () => VueHexCellClassResolver | undefined;
	getNonPrintableChar: () => string;
	requestWindow: (request: VueHexWindowRequest) => void;
	clearHoverState: () => void;
}

export interface HexWindowResult {
	markup: ShallowRef<string>;
	normalizedBytes: ShallowRef<Uint8Array<ArrayBufferLike>>;
	fallbackAsciiChar: ShallowRef<string>;
	renderStartRow: Ref<number>;
	renderedRows: ComputedRef<number>;
	startRow: ComputedRef<number>;
	scheduleWindowEvaluation: () => void;
	handleScroll: () => void;
	scrollToByte: (offset: number) => void;
	queueScrollToOffset: (offset: number) => void;
	updateFromWindowState: () => void;
	measureRowHeight: () => void;
}

export function useHexWindow(options: HexWindowOptions): HexWindowResult {
	/**
	 * HTML markup for the visible table slice, consumed by the component via v-html.
	 */
	const markup = shallowRef("");
	/**
	 * Normalized byte buffer backing the current window; updates trigger re-render calculations.
	 */
	const normalizedBytes = shallowRef<Uint8Array<ArrayBufferLike>>(
		new Uint8Array(0),
	);
	/**
	 * HTML-safe fallback character used for bytes that cannot be rendered as printable ASCII.
	 */
	const fallbackAsciiChar = shallowRef(".");
	/**
	 * Row index where the current markup slice begins, informing table translation offsets.
	 */
	const renderStartRow = ref(0);

	const pendingScrollByte = ref<number | null>(null);
	const pendingScrollCheck = ref(false);
	const lastRequested = shallowRef<VueHexWindowRequest | null>(null);

	/**
	 * Row index of the data window provided by the host, used to detect coverage gaps.
	 */
	const startRow = computed(() => {
		const windowData = options.getWindowState();
		return Math.floor(
			windowData.offset / Math.max(options.bytesPerRow.value, 1),
		);
	});

	/**
	 * Number of rows currently rendered from the normalized byte buffer.
	 */
	const renderedRows = computed(() => {
		const bytes = normalizedBytes.value.length;
		if (bytes === 0) {
			return 0;
		}
		return Math.max(
			1,
			Math.ceil(bytes / Math.max(options.bytesPerRow.value, 1)),
		);
	});

	/**
	 * Refreshes local window state from the external data source and schedules downstream updates.
	 */
	function updateFromWindowState() {
		options.clampChunkStartToBounds();

		const windowData = options.getWindowState();
		const normalized = normalizeSource(windowData.data);
		normalizedBytes.value = normalized;

		const fallbackAscii = resolveFallbackChar(options.getNonPrintableChar());
		fallbackAsciiChar.value = fallbackAscii;

		lastRequested.value = {
			offset: windowData.offset,
			length: normalized.length,
		};

		updateRenderedSlice();

		nextTick(() => {
			measureRowHeight();
			scheduleWindowEvaluation();
		});
	}

	/**
	 * Defers expensive recalculations until the next animation frame, coalescing scroll events.
	 */
	function scheduleWindowEvaluation() {
		if (pendingScrollCheck.value) {
			return;
		}

		pendingScrollCheck.value = true;
		requestAnimationFrame(() => {
			pendingScrollCheck.value = false;
			applyPendingScroll();
			updateRenderedSlice();
			evaluateWindowRequest();
		});
	}

	/**
	 * Handles scroll events from the container by scheduling a window evaluation.
	 */
	function handleScroll() {
		scheduleWindowEvaluation();
	}

	/**
	 * Queues a scroll request to a specific byte offset, applying it once measurement is ready.
	 */
	function queueScrollToOffset(offset: number) {
		pendingScrollByte.value = Math.max(0, Math.trunc(offset));
		scheduleWindowEvaluation();
	}

	/**
	 * Scrolls to the requested byte immediately when possible, falling back to queueing otherwise.
	 */
	function scrollToByte(offset: number) {
		if (!Number.isFinite(offset)) {
			return;
		}

		const normalized = Math.max(0, Math.trunc(offset));

		const container = options.containerEl.value;
		if (!container) {
			queueScrollToOffset(normalized);
			return;
		}

		const targetRow = Math.floor(
			normalized / Math.max(options.bytesPerRow.value, 1),
		);
		options.ensureChunkForRow(targetRow);

		const relativeRow = targetRow - options.chunkStartRow.value;
		const rowHeightPx = options.rowHeightValue.value;
		if (rowHeightPx > 0) {
			container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
		}

		pendingScrollByte.value = null;
		scheduleWindowEvaluation();
	}

	/**
	 * Applies any pending scroll that was deferred due to missing measurements or container refs.
	 */
	function applyPendingScroll() {
		if (pendingScrollByte.value == null) {
			return;
		}

		const container = options.containerEl.value;
		if (!container) {
			return;
		}

		const targetRow = Math.floor(
			pendingScrollByte.value / Math.max(options.bytesPerRow.value, 1),
		);
		options.ensureChunkForRow(targetRow);

		const relativeRow = targetRow - options.chunkStartRow.value;
		const rowHeightPx = options.rowHeightValue.value;
		if (rowHeightPx > 0) {
			container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
		}
		pendingScrollByte.value = null;
	}

	/**
	 * Measures the rendered row height to keep virtualization calculations accurate.
	 */
	function measureRowHeight() {
		const tbody = options.tbodyEl.value;
		if (!tbody) {
			return;
		}

		const firstRow = tbody.querySelector("tr");
		if (!firstRow) {
			return;
		}

		const height = firstRow.getBoundingClientRect().height;
		if (height > 0 && height !== options.rowHeight.value) {
			options.rowHeight.value = height;
		}
	}

	/**
	 * Recomputes the visible markup slice based on scroll position, overscan, and window bounds.
	 */
	function updateRenderedSlice() {
		const data = normalizedBytes.value;
		const bytesPerRowValue = Math.max(options.bytesPerRow.value, 1);
		const windowStart = options.getWindowState().offset;

		if (data.length === 0) {
			markup.value = "";
			renderStartRow.value = Math.floor(windowStart / bytesPerRowValue);
			options.clearHoverState();
			return;
		}

		const windowEnd = windowStart + data.length;

		let renderStart = windowStart;
		let renderEnd = windowEnd;

		const container = options.containerEl.value;
		const viewportRowCount = options.viewportRows.value;
		const overscanCount = options.overscanRows.value;

		if (
			container &&
			viewportRowCount > 0 &&
			options.rowHeightValue.value > 0 &&
			bytesPerRowValue > 0
		) {
			const scrollTop = container.scrollTop;
			const topRowWithinChunk = Math.floor(
				scrollTop / options.rowHeightValue.value,
			);
			const topRow = options.chunkStartRow.value + topRowWithinChunk;
			const desiredStartByte = topRow * bytesPerRowValue;
			const overscanBytes = overscanCount * bytesPerRowValue;

			renderStart = clampWithin(
				desiredStartByte - overscanBytes,
				windowStart,
				windowEnd,
			);

			if (renderStart >= windowEnd) {
				renderStart = Math.max(windowEnd - bytesPerRowValue, windowStart);
			}

			const relativeStart = renderStart - windowStart;
			const alignedRelative =
				Math.floor(relativeStart / bytesPerRowValue) * bytesPerRowValue;
			renderStart = clampWithin(
				windowStart + alignedRelative,
				windowStart,
				Math.max(windowEnd - 1, windowStart),
			);

			const totalRowsNeeded = Math.max(viewportRowCount + overscanCount * 2, 1);
			const requiredLength = totalRowsNeeded * bytesPerRowValue;
			renderEnd = Math.min(windowEnd, renderStart + requiredLength);
		}

		if (renderEnd <= renderStart) {
			markup.value = "";
			renderStartRow.value = Math.floor(renderStart / bytesPerRowValue);
			options.clearHoverState();
			return;
		}

		const relativeStart = renderStart - windowStart;
		const relativeEnd = Math.min(
			data.length,
			relativeStart + (renderEnd - renderStart),
		);

		const slice = data.subarray(relativeStart, relativeEnd);
		renderStartRow.value = Math.floor(renderStart / bytesPerRowValue);

		const printableCheck = options.getPrintableChecker();
		const asciiRenderer = options.getAsciiRenderer();

		const nextMarkup = options.buildHexTableMarkup(
			slice,
			bytesPerRowValue,
			options.getUppercase(),
			fallbackAsciiChar.value,
			renderStart,
			printableCheck,
			asciiRenderer,
			options.getCellClassResolver(),
		);

		if (markup.value !== nextMarkup) {
			options.clearHoverState();
			markup.value = nextMarkup;
		}
	}

	/**
	 * Determines whether a new data window should be requested from the host application.
	 */
	function evaluateWindowRequest() {
		if (options.viewportRows.value === 0) {
			return;
		}

		const container = options.containerEl.value;
		if (!container) {
			return;
		}

		const rowHeightPx = options.rowHeightValue.value;
		const bytesPerRowValue = options.bytesPerRow.value;
		if (rowHeightPx <= 0 || bytesPerRowValue <= 0) {
			return;
		}

		const chunkRows = options.chunkRowCount.value;
		if (chunkRows <= 0) {
			return;
		}

		const chunkStartRowValue = options.chunkStartRow.value;
		const chunkEndRow = chunkStartRowValue + chunkRows;

		const overscan = options.overscanRows.value;

		const scrollTop = container.scrollTop;
		const visibleStartRow =
			chunkStartRowValue + Math.floor(scrollTop / rowHeightPx);
		const clampedVisibleStartRow = clampWithin(
			visibleStartRow,
			chunkStartRowValue,
			Math.max(chunkEndRow - 1, chunkStartRowValue),
		);

		const desiredStartRow = clampWithin(
			clampedVisibleStartRow - overscan,
			chunkStartRowValue,
			Math.max(chunkEndRow - 1, chunkStartRowValue),
		);

		const desiredRows = Math.max(options.viewportRows.value + overscan * 2, 1);
		const availableRowsInChunk = Math.max(chunkEndRow - desiredStartRow, 0);
		const rowsToRequest = Math.min(availableRowsInChunk, desiredRows);

		if (rowsToRequest <= 0) {
			return;
		}

		const desiredOffset = desiredStartRow * bytesPerRowValue;
		const maxPossibleBytes = Math.max(
			options.totalBytes.value - desiredOffset,
			0,
		);
		const desiredLength = Math.min(
			maxPossibleBytes,
			rowsToRequest * bytesPerRowValue,
		);

		if (desiredLength <= 0) {
			return;
		}

		const desiredEndRow =
			desiredStartRow + Math.ceil(desiredLength / bytesPerRowValue);

		const windowStartRow = startRow.value;
		const windowEndRow = windowStartRow + renderedRows.value;

		if (windowStartRow <= desiredStartRow && windowEndRow >= desiredEndRow) {
			return;
		}

		if (
			lastRequested.value &&
			lastRequested.value.offset === desiredOffset &&
			lastRequested.value.length === desiredLength
		) {
			return;
		}

		lastRequested.value = { offset: desiredOffset, length: desiredLength };
		options.requestWindow(lastRequested.value);
	}

	function clampWithin(value: number, min: number, max: number): number {
		if (value < min) {
			return min;
		}
		if (value > max) {
			return max;
		}
		return value;
	}

	return {
		markup,
		normalizedBytes,
		fallbackAsciiChar,
		renderStartRow,
		renderedRows,
		startRow,
		scheduleWindowEvaluation,
		handleScroll,
		scrollToByte,
		queueScrollToOffset,
		updateFromWindowState,
		measureRowHeight,
	};
}
