import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, nextTick, ref, shallowRef } from "vue";
import type {
	VueHexAsciiRenderer,
	VueHexCellClassResolver,
	VueHexPrintableCheck,
	VueHexWindow,
	VueHexWindowRequest,
} from "../vuehex-api";
import {
	clamp,
	escapeHtml,
	normalizeSource,
	OFFSET_PAD,
	resolveFallbackChar,
} from "../vuehex-utils";

// Private constants for markup generation
const HEX_LOWER: readonly string[] = Array.from({ length: 256 }, (_, value) =>
	value.toString(16).padStart(2, "0"),
);
const HEX_UPPER: readonly string[] = HEX_LOWER.map((value) =>
	value.toUpperCase(),
);
const PLACEHOLDER_HEX = "--";
const PLACEHOLDER_ASCII = "--";

/**
 * Escapes a provided ASCII representation so it can be safely interpolated into HTML.
 */
function escapeAsciiChar(value: string): string {
	return escapeHtml(value);
}

/**
 * Formats a byte offset for the table header, decorating leading zeros with markup for
 * visual differentiation while honoring casing preferences.
 */
function formatOffset(value: number, uppercase: boolean): string {
	const raw = value.toString(16).padStart(OFFSET_PAD, "0");
	const normalized = uppercase ? raw.toUpperCase() : raw;
	const trimmed = normalized.replace(/^0+/, "");
	const leadingCount = normalized.length - trimmed.length;

	if (leadingCount <= 0) {
		return normalized;
	}

	const leading = normalized.slice(0, leadingCount);
	const significant = normalized.slice(leadingCount);

	return `<span class="vuehex-offset-leading">${leading}</span>${significant}`;
}

/**
 * Flattens and cleans arbitrary class token inputs so renderer utilities can safely append them.
 */
function normalizeClassTokens(
	value: string | string[] | null | undefined,
): string[] {
	if (value == null) {
		return [];
	}

	if (Array.isArray(value)) {
		const flattened: string[] = [];
		for (const entry of value) {
			flattened.push(...normalizeClassTokens(entry));
		}
		return flattened;
	}

	if (typeof value !== "string") {
		return [];
	}

	return value
		.split(/\s+/g)
		.map((token) => token.trim())
		.filter(Boolean);
}

/**
 * Escapes a list of class names for inclusion in an attribute, deduplicating tokens on the way.
 */
function escapeClassAttribute(classes: string[]): string {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const token of classes) {
		const trimmed = token.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		normalized.push(escapeHtml(trimmed));
	}
	return normalized.join(" ");
}

export interface HexWindowOptions {
	containerEl: Ref<HTMLDivElement | undefined>;
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	bytesPerRow: ComputedRef<number>;
	rowHeight: Ref<number | null>;
	rowHeightValue: ComputedRef<number>;
	viewportRows: ComputedRef<number>;
	overscanRows: ComputedRef<number>;
	chunkStartRow: Ref<number>;
	chunkRowCount: ComputedRef<number>;
	totalBytes: ComputedRef<number>;
	ensureChunkForRow: (row: number) => boolean;
	clampChunkStartToBounds: () => void;
	getWindowState: () => VueHexWindow;
	getUppercase: () => boolean;
	getPrintableChecker: () => VueHexPrintableCheck;
	getAsciiRenderer: () => VueHexAsciiRenderer;
	getCellClassResolver: () => VueHexCellClassResolver | undefined;
	getNonPrintableChar: () => string;
	getSelectionRange: () => { start: number; end: number } | null;
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
	updateRenderedSlice: () => void;
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
	 * Applies scrollTop to bring an absolute byte offset into view.
	 * Returns false when prerequisites are missing (e.g. container ref).
	 */
	function scrollContainerToByte(offset: number): boolean {
		const container = options.containerEl.value;
		if (!container) {
			return false;
		}

		const bytesPerRowValue = Math.max(options.bytesPerRow.value, 1);
		const targetRow = Math.floor(offset / bytesPerRowValue);
		options.ensureChunkForRow(targetRow);

		const relativeRow = targetRow - options.chunkStartRow.value;
		const rowHeightPx = options.rowHeightValue.value;
		if (rowHeightPx > 0) {
			container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
		}

		return true;
	}

	/**
	 * Defers expensive recalculations until the next animation frame, coalescing scroll events.
	 */
	function scheduleWindowEvaluation() {
		if (pendingScrollCheck.value) {
			return;
		}

		pendingScrollCheck.value = true;
		const hasRaf =
			typeof window !== "undefined" &&
			typeof window.requestAnimationFrame === "function";

		const run = () => {
			pendingScrollCheck.value = false;
			applyPendingScroll();
			updateRenderedSlice();
			evaluateWindowRequest();
		};

		if (hasRaf) {
			window.requestAnimationFrame(run);
		} else {
			nextTick(run);
		}
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
		const applied = scrollContainerToByte(normalized);
		if (!applied) {
			queueScrollToOffset(normalized);
			return;
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
		const pending = pendingScrollByte.value;
		if (!scrollContainerToByte(pending)) {
			return;
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

			renderStart = clamp(
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
			renderStart = clamp(
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
		const selectionRange = options.getSelectionRange();

		const nextMarkup = buildHexTableMarkup(
			slice,
			bytesPerRowValue,
			options.getUppercase(),
			fallbackAsciiChar.value,
			renderStart,
			printableCheck,
			asciiRenderer,
			selectionRange,
			options.getCellClassResolver(),
		);

		if (markup.value !== nextMarkup) {
			options.clearHoverState();
			markup.value = nextMarkup;
		}
	}

	/**
	 * Builds the inner HTML for the hex table body, returning a string that can be assigned via
	 * v-html while taking care of alignment, placeholders, and optional cell class resolution.
	 */
	function buildHexTableMarkup(
		bytes: Uint8Array,
		bytesPerRow: number,
		uppercase: boolean,
		fallbackAscii: string,
		baseOffset: number,
		isPrintable: VueHexPrintableCheck,
		renderAscii: VueHexAsciiRenderer,
		selectionRange: { start: number; end: number } | null,
		resolveCellClass?: VueHexCellClassResolver,
	): string {
		if (bytes.length === 0) {
			return "";
		}

		const hexLookup = uppercase ? HEX_UPPER : HEX_LOWER;
		const useColumnSplit = bytesPerRow % 2 === 0;
		const columnBreakIndex = useColumnSplit ? bytesPerRow / 2 : -1;

		// Pre-compute column-based static strings to avoid repeated logic in the hot loop
		const colData = new Array(bytesPerRow);
		for (let i = 0; i < bytesPerRow; i++) {
			const isSecond = useColumnSplit && i >= columnBreakIndex;
			const isStart = useColumnSplit && i === columnBreakIndex;

			// Static classes
			let hexStatic = "vuehex-byte";
			let asciiStatic = "vuehex-ascii-char";

			if (isSecond) {
				const suffix = isStart ? " vuehex-byte--column-start" : "";
				hexStatic += ` vuehex-byte--second-column${suffix}`;

				const asciiSuffix = isStart ? " vuehex-ascii-char--column-start" : "";
				asciiStatic += ` vuehex-ascii-char--second-column${asciiSuffix}`;
			}

			// Pre-built placeholders and class variants
			const hexPhClass = `${hexStatic} vuehex-byte--placeholder`;
			const asciiPhClass = `${asciiStatic} vuehex-ascii-char--placeholder`;
			const asciiPrintable = `${asciiStatic} vuehex-ascii-char--printable`;
			const asciiNonPrintable = `${asciiStatic} vuehex-ascii-char--non-printable`;

			colData[i] = {
				hexStatic,
				asciiPrintable,
				asciiNonPrintable,
				hexPlaceholder: `<span class="${hexPhClass}" aria-hidden="true">${PLACEHOLDER_HEX}</span>`,
				asciiPlaceholder: `<span class="${asciiPhClass}" aria-hidden="true">${PLACEHOLDER_ASCII}</span>`,
			};
		}

		// Pre-compute static HTML fragments
		const rowOpenPrefix = '<tr role="row" data-row-offset="';
		const rowOpenSuffix =
			'"><th scope="row" class="vuehex-offset" role="rowheader">';
		const hexCellOpen = '</th><td class="vuehex-bytes" role="cell">';
		const asciiCellOpen = '</td><td class="vuehex-ascii" role="cell">';
		const rowClose = "</td></tr>";
		const spanClassOpen = '<span class="';
		const hexIndexAttr = '" data-hex-index="';
		const asciiIndexAttr = '" data-ascii-index="';
		const byteValueAttr = '" data-byte-value="';
		const spanContentOpen = '">';
		const spanClose = "</span>";

		// Pre-allocate array with accurate size estimation
		const estimatedRows = Math.ceil(bytes.length / bytesPerRow);
		// Each row emits ~2*bytesPerRow cells + a small fixed overhead.
		const estimatedSize = estimatedRows * (2 * bytesPerRow + 20);
		const markup: string[] = new Array(estimatedSize);
		let markupIndex = 0;

		for (let offset = 0; offset < bytes.length; offset += bytesPerRow) {
			const remaining = Math.min(bytesPerRow, bytes.length - offset);
			const rowOffset = baseOffset + offset;

			// Row opening
			markup[markupIndex++] =
				rowOpenPrefix +
				rowOffset +
				rowOpenSuffix +
				formatOffset(rowOffset, uppercase) +
				hexCellOpen;

			// Hex bytes
			for (let index = 0; index < remaining; index += 1) {
				const value = bytes[offset + index] as number;
				const absoluteIndex = rowOffset + index;
				const col = colData[index];

				// Fast path for classes: standard classes + value class
				let classString = `${col.hexStatic} vuehex-byte--value-${value}`;

				// Add selection class if in range
				if (
					selectionRange &&
					absoluteIndex >= selectionRange.start &&
					absoluteIndex <= selectionRange.end
				) {
					classString += " vuehex-selected";
				}

				if (resolveCellClass) {
					const resolved = resolveCellClass({
						kind: "hex",
						index: absoluteIndex,
						byte: value,
					});
					if (resolved != null) {
						const extras = normalizeClassTokens(resolved);
						if (extras.length > 0) {
							classString += ` ${escapeClassAttribute(extras)}`;
						}
					}
				}

				markup[markupIndex++] =
					spanClassOpen +
					classString +
					hexIndexAttr +
					absoluteIndex +
					byteValueAttr +
					value +
					spanContentOpen +
					hexLookup[value] +
					spanClose;
			}

			// Hex placeholders (Pre-computed)
			for (let pad = remaining; pad < bytesPerRow; pad += 1) {
				markup[markupIndex++] = colData[pad].hexPlaceholder;
			}

			markup[markupIndex++] = asciiCellOpen;

			// ASCII characters
			for (let index = 0; index < remaining; index += 1) {
				const value = bytes[offset + index] as number;
				const absoluteIndex = rowOffset + index;
				const col = colData[index];

				let asciiContent = fallbackAscii;
				let classString: string;

				if (isPrintable(value)) {
					const rendered = renderAscii(value);
					if (rendered != null) {
						const renderedString = String(rendered);
						if (renderedString.length > 0) {
							asciiContent = escapeAsciiChar(renderedString);
							classString = `${col.asciiPrintable} vuehex-ascii-char--value-${value}`;
						} else {
							classString = `${col.asciiNonPrintable} vuehex-ascii-char--value-${value}`;
						}
					} else {
						classString = `${col.asciiNonPrintable} vuehex-ascii-char--value-${value}`;
					}
				} else {
					classString = `${col.asciiNonPrintable} vuehex-ascii-char--value-${value}`;
				}

				// Add selection classes if in range
				if (
					selectionRange &&
					absoluteIndex >= selectionRange.start &&
					absoluteIndex <= selectionRange.end
				) {
					classString += " vuehex-selected vuehex-selected--ascii";
				}

				if (resolveCellClass) {
					const resolved = resolveCellClass({
						kind: "ascii",
						index: absoluteIndex,
						byte: value,
					});
					if (resolved != null) {
						const extras = normalizeClassTokens(resolved);
						if (extras.length > 0) {
							classString += ` ${escapeClassAttribute(extras)}`;
						}
					}
				}

				markup[markupIndex++] =
					spanClassOpen +
					classString +
					asciiIndexAttr +
					absoluteIndex +
					byteValueAttr +
					value +
					spanContentOpen +
					asciiContent +
					spanClose;
			}

			// ASCII placeholders (Pre-computed)
			for (let pad = remaining; pad < bytesPerRow; pad += 1) {
				markup[markupIndex++] = colData[pad].asciiPlaceholder;
			}

			markup[markupIndex++] = rowClose;
		}

		// Trim to actual size and join
		markup.length = markupIndex;
		return markup.join("");
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
		const clampedVisibleStartRow = clamp(
			visibleStartRow,
			chunkStartRowValue,
			Math.max(chunkEndRow - 1, chunkStartRowValue),
		);

		const desiredStartRow = clamp(
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
		updateRenderedSlice,
		measureRowHeight,
	};
}
