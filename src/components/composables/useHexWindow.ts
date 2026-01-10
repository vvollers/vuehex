import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
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

/**
 * Precomputed lower-case hex strings for 0..255.
 *
 * Why it exists: table rendering is a hot path; avoiding `toString(16)` in the
 * inner loop reduces GC pressure and keeps scrolling smooth.
 */
const HEX_LOWER: readonly string[] = Array.from({ length: 256 }, (_, value) =>
	value.toString(16).padStart(2, "0"),
);

/**
 * Upper-case version of `HEX_LOWER`.
 *
 * Why it exists: allows switching casing without branching per-cell.
 */
const HEX_UPPER: readonly string[] = HEX_LOWER.map((value) =>
	value.toUpperCase(),
);

/**
 * Placeholder tokens used for short final rows so the grid remains aligned.
 */
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
	/** Scroll container element (scrollTop source of truth). */
	containerEl: Ref<HTMLDivElement | undefined>;
	/** Table body element where HTML markup is injected. */
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	/** Bytes per row (affects layout + offset-to-row conversions). */
	bytesPerRow: ComputedRef<number>;
	/** Measured row height (null until measured). */
	rowHeight: Ref<number | null>;
	/** Row height value used for calculations (fallback when not measured). */
	rowHeightValue: ComputedRef<number>;
	/** Number of visible rows in the viewport. */
	viewportRows: ComputedRef<number>;
	/** Rows to render above/below viewport to reduce flicker. */
	overscanRows: ComputedRef<number>;
	/** Active chunk start row (0-based). */
	chunkStartRow: Ref<number>;
	/** Total rows available within the active chunk. */
	chunkRowCount: ComputedRef<number>;
	/** Total bytes in the backing data source. */
	totalBytes: ComputedRef<number>;
	/** True when VueHex treats the provided data as the full buffer (no windowing). */
	isSelfManagedData: ComputedRef<boolean>;
	/** Two-way model tracking the current absolute offset (used for buffer mode scroll sync). */
	windowOffset: Ref<number>;
	/** Ensures the chunk containing a row is active; returns true if it changed. */
	ensureChunkForRow: (row: number) => boolean;
	/** Normalizes `chunkStartRow` to valid bounds/chunk boundaries. */
	clampChunkStartToBounds: () => void;
	/** Reads the latest window state (offset + data) from the host/component. */
	getWindowState: () => VueHexWindow;
	/** Casing preference for hex rendering. */
	getUppercase: () => boolean;
	/** Determines whether bytes are printable for ASCII rendering. */
	getPrintableChecker: () => VueHexPrintableCheck;
	/** Converts a byte into an ASCII glyph (when printable). */
	getAsciiRenderer: () => VueHexAsciiRenderer;
	/** Optional class resolver for per-cell highlighting. */
	getCellClassResolver: () => VueHexCellClassResolver | undefined;
	/** Replacement character for non-printable bytes. */
	getNonPrintableChar: () => string;
	/** Current selection range (inclusive) for embedding selection classes. */
	getSelectionRange: () => { start: number; end: number } | null;
	/** Issues a window request to the host (used only in windowed mode). */
	requestWindow: (request: VueHexWindowRequest) => void;
	/** Clears hover state when markup changes. */
	clearHoverState: () => void;
}

export interface HexWindowResult {
	/** Rendered HTML for the visible table slice (consumed via `v-html`). */
	markup: ShallowRef<string>;
	/** Normalized bytes backing the current rendered/windowed slice. */
	normalizedBytes: ShallowRef<Uint8Array<ArrayBufferLike>>;
	/** HTML-safe replacement for non-printable ASCII characters. */
	fallbackAsciiChar: ShallowRef<string>;
	/** Absolute start row of the currently rendered markup slice. */
	renderStartRow: Ref<number>;
	/** Count of rows currently rendered from `normalizedBytes`. */
	renderedRows: ComputedRef<number>;
	/** Absolute start row of the current externally-provided window (`windowOffset`). */
	startRow: ComputedRef<number>;
	/** Schedules a recalculation of visible rows and window requests. */
	scheduleWindowEvaluation: () => void;
	/** Scroll handler for the container; coalesces work via RAF. */
	handleScroll: () => void;
	/** Immediately scrolls to ensure an absolute byte offset is visible. */
	scrollToByte: (offset: number) => void;
	/** Queues a scroll-to-offset to be applied on the next evaluation tick. */
	queueScrollToOffset: (offset: number) => void;
	/** Syncs internal buffers from the current external window state. */
	updateFromWindowState: () => void;
	/** Regenerates markup for the current visible slice. */
	updateRenderedSlice: () => void;
	/** Measures row height from the DOM when possible (used for scroll math). */
	measureRowHeight: () => void;
}

/**
 * Owns the virtualized "rendered window" for VueHex.
 *
 * Why it exists:
 * - Generates the table body's HTML markup (via `v-html`) for only the rows that
 *   should be visible (plus overscan), rather than rendering the full dataset.
 * - Keeps scrolling smooth by translating scrollTop into a rendered row slice.
 * - Coordinates external window requests for huge datasets ("windowed mode")
 *   while also supporting "buffer mode" where all bytes are locally available.
 *
 * How it is used:
 * - VueHex provides refs to the scroll container and `tbody`, plus rendering
 *   preferences (bytesPerRow, casing, ASCII rendering, class resolvers).
 * - `handleScroll` and `scheduleWindowEvaluation` are called on scroll to update
 *   markup and to request more data when needed.
 * - Works in tandem with chunking (`chunkStartRow`, `chunkRowCount`) to keep the
 *   virtual scroll height bounded for very large inputs.
 */
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

	/**
	 * When set, the next evaluation tick will attempt to scroll to this absolute
	 * byte offset.
	 *
	 * Why it exists: some scroll requests arrive before the container exists or
	 * before row height has been measured.
	 */
	const pendingScrollByte = ref<number | null>(null);
	/**
	 * Guards scheduling so multiple scroll events collapse into a single update.
	 */
	const pendingScrollCheck = ref(false);
	/**
	 * Remembers the last requested window from the host so we can avoid emitting
	 * duplicate requests during rapid scrolling.
	 */
	const lastRequested = shallowRef<VueHexWindowRequest | null>(null);
	/**
	 * Tracks the last offset value derived from scrollTop (buffer mode).
	 * Used to suppress feedback loops when syncing `windowOffset`.
	 */
	const lastSelfManagedScrollOffset = ref<number | null>(null);

	/**
	 * Row index of the data window provided by the host, used to detect coverage gaps.
	 */
	const startRow = computed(() => {
		// Why: used to translate between host-provided `windowOffset` and row indices.
		const windowData = options.getWindowState();
		return Math.floor(
			windowData.offset / Math.max(options.bytesPerRow.value, 1),
		);
	});

	/**
	 * Number of rows currently rendered from the normalized byte buffer.
	 */
	const renderedRows = computed(() => {
		// Why: used to determine whether the current window already covers what we
		// need, and to size subsequent window requests.
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
		// Step 1: ensure chunk bounds are consistent with current sizing.
		options.clampChunkStartToBounds();

		// Step 2: normalize the host-provided data into a consistent Uint8Array.
		const windowData = options.getWindowState();
		const normalized = normalizeSource(windowData.data);
		normalizedBytes.value = normalized;

		// Step 3: resolve the fallback ASCII char to a safe single glyph.
		const fallbackAscii = resolveFallbackChar(options.getNonPrintableChar());
		fallbackAsciiChar.value = fallbackAscii;

		// Step 4: record what we have so we can skip redundant future requests.
		lastRequested.value = {
			offset: windowData.offset,
			length: normalized.length,
		};

		// Step 5: rebuild the visible slice immediately.
		updateRenderedSlice();

		// Step 6: after DOM updates, measure row height and re-evaluate windowing.
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

		// Why: requestAnimationFrame collapses frequent scroll events.
		pendingScrollCheck.value = true;
		const hasRaf =
			typeof window !== "undefined" &&
			typeof window.requestAnimationFrame === "function";

		const run = () => {
			pendingScrollCheck.value = false;
			applyPendingScroll();
			updateSelfManagedWindowOffsetFromScroll();
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
	 * Syncs the buffer-mode `windowOffset` model based on the current scroll position.
	 *
	 * Why it exists: in buffer mode the host often treats `windowOffset` as the current
	 * scroll position (top visible byte), so we update it from scrollTop.
	 */
	function updateSelfManagedWindowOffsetFromScroll() {
		if (!options.isSelfManagedData.value) {
			return;
		}
		const container = options.containerEl.value;
		if (!container) {
			return;
		}
		const rowHeightPx = options.rowHeightValue.value;
		if (!(rowHeightPx > 0)) {
			return;
		}
		const bytesPerRowValue = Math.max(options.bytesPerRow.value, 1);
		const scrollTop = container.scrollTop;
		const visibleRow = Math.floor(scrollTop / rowHeightPx);
		const absoluteRow = options.chunkStartRow.value + visibleRow;
		const nextOffset = Math.max(0, absoluteRow * bytesPerRowValue);

		if (nextOffset === options.windowOffset.value) {
			return;
		}

		lastSelfManagedScrollOffset.value = nextOffset;
		options.windowOffset.value = nextOffset;
	}

	watch(
		() => options.windowOffset.value,
		(newOffset, oldOffset) => {
			if (!options.isSelfManagedData.value) {
				return;
			}
			if (newOffset === oldOffset) {
				return;
			}
			if (newOffset === lastSelfManagedScrollOffset.value) {
				return;
			}
			if (newOffset != null && Number.isFinite(newOffset) && newOffset >= 0) {
				queueScrollToOffset(newOffset);
			}
		},
	);

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
		// ---- Inputs and early exits -------------------------------------------------
		const data = normalizedBytes.value;
		const bytesPerRowValue = Math.max(options.bytesPerRow.value, 1);
		const windowStart = options.getWindowState().offset;

		if (data.length === 0) {
			// No data available: clear markup and keep offsets consistent.
			markup.value = "";
			renderStartRow.value = Math.floor(windowStart / bytesPerRowValue);
			options.clearHoverState();
			return;
		}

		// Window bounds (in bytes) for the currently available data slice.
		const windowEnd = windowStart + data.length;

		// ---- Determine render bounds (in bytes) ------------------------------------
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
			// Translate scrollTop into an absolute row, then convert to a byte offset.
			const scrollTop = container.scrollTop;
			const topRowWithinChunk = Math.floor(
				scrollTop / options.rowHeightValue.value,
			);
			const topRow = options.chunkStartRow.value + topRowWithinChunk;
			const desiredStartByte = topRow * bytesPerRowValue;
			const overscanBytes = overscanCount * bytesPerRowValue;
			const chunkStartByte = options.chunkStartRow.value * bytesPerRowValue;

			renderStart = clamp(
				desiredStartByte - overscanBytes,
				Math.max(windowStart, chunkStartByte),
				windowEnd,
			);

			if (renderStart >= windowEnd) {
				// If we overshot, back up to at least one row of data.
				renderStart = Math.max(windowEnd - bytesPerRowValue, windowStart);
			}

			// Snap start to a row boundary relative to the window start.
			const relativeStart = renderStart - windowStart;
			const alignedRelative =
				Math.floor(relativeStart / bytesPerRowValue) * bytesPerRowValue;
			renderStart = clamp(
				windowStart + alignedRelative,
				windowStart,
				Math.max(windowEnd - 1, windowStart),
			);

			// Request enough bytes for (viewport + overscan above/below).
			const totalRowsNeeded = Math.max(viewportRowCount + overscanCount * 2, 1);
			const requiredLength = totalRowsNeeded * bytesPerRowValue;
			renderEnd = Math.min(windowEnd, renderStart + requiredLength);
		}

		if (renderEnd <= renderStart) {
			// Defensive: invalid bounds; clear markup.
			markup.value = "";
			renderStartRow.value = Math.floor(renderStart / bytesPerRowValue);
			options.clearHoverState();
			return;
		}

		// ---- Slice data and render -------------------------------------------------
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
			// Any markup change invalidates hover targets; clear linked hover state.
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

		// Lookup tables and layout helpers.
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
			// Each outer loop iteration renders one <tr> (row).
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

				// Selection: embed classes into markup so CSS can style selected cells.
				if (
					selectionRange &&
					absoluteIndex >= selectionRange.start &&
					absoluteIndex <= selectionRange.end
				) {
					classString += " vuehex-selected";
				}

				// Optional per-cell class resolver provided by consumers.
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

				// Selection: ASCII gets an additional marker for styling differences.
				if (
					selectionRange &&
					absoluteIndex >= selectionRange.start &&
					absoluteIndex <= selectionRange.end
				) {
					classString += " vuehex-selected vuehex-selected--ascii";
				}

				// Optional per-cell class resolver provided by consumers.
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
		// ---- Preconditions ----------------------------------------------------------
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

		// ---- Compute request window (rows -> bytes) --------------------------------

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
			// Current window already covers what the viewport needs.
			return;
		}

		if (
			lastRequested.value &&
			lastRequested.value.offset === desiredOffset &&
			lastRequested.value.length === desiredLength
		) {
			// Avoid spamming identical requests.
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
