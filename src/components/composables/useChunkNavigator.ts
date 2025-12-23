import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";
import { clamp, formatOffsetPlain } from "../vuehex-utils";

type ChunkNavigatorPlacement = "left" | "right" | "top" | "bottom";

export interface ChunkNavigatorProps {
	showChunkNavigator?: boolean;
	chunkNavigatorPlacement?: ChunkNavigatorPlacement;
	uppercase?: boolean;
}

export interface ChunkNavigatorOptions {
	props: ChunkNavigatorProps;
	totalBytes: ComputedRef<number>;
	bytesPerRow: ComputedRef<number>;
	rowHeightValue: ComputedRef<number>;
	containerEl: Ref<HTMLDivElement | undefined>;
	maxVirtualHeight: ComputedRef<number>;
}

export interface ChunkNavigatorResult {
	chunkStartRow: Ref<number>;
	totalRows: ComputedRef<number>;
	fullContentHeight: ComputedRef<number>;
	chunkRowCapacity: ComputedRef<number>;
	chunkRowCount: ComputedRef<number>;
	chunkHeight: ComputedRef<number>;
	isChunking: ComputedRef<boolean>;
	chunkCount: ComputedRef<number>;
	activeChunkIndex: ComputedRef<number>;
	navigatorPlacement: ComputedRef<ChunkNavigatorPlacement>;
	isNavigatorVertical: ComputedRef<boolean>;
	shouldShowChunkNavigator: ComputedRef<boolean>;
	rootClass: ComputedRef<string[]>;
	chunkNavigatorClass: ComputedRef<string[]>;
	viewerClass: ComputedRef<string[]>;
	chunkItems: ComputedRef<ChunkDescriptor[]>;
	chunkButtonClass: (index: number) => string[];
	moveToChunk: (targetIndex: number, focusRow?: number) => boolean;
	ensureChunkForRow: (row: number) => boolean;
	clampChunkStartToBounds: () => void;
}

export interface ChunkDescriptor {
	index: number;
	startRow: number;
	startByte: number;
	endByte: number;
	label: string;
	range: string;
}

/**
 * Provides chunk-aware scrolling state for the hex viewer so UIs can render navigation controls
 * and request chunk transitions while keeping virtualized content aligned.
 */
export function useChunkNavigator(
	options: ChunkNavigatorOptions,
): ChunkNavigatorResult {
	/**
	 * Tracks the first row within the currently mounted chunk so other computed values stay aligned.
	 */
	const chunkStartRow = ref(0);

	/**
	 * Total number of logical rows based on the byte count, regardless of chunking.
	 */
	const totalRows = computed(() => {
		const total = options.totalBytes.value;
		if (total <= 0) {
			return 0;
		}

		return Math.ceil(total / options.bytesPerRow.value);
	});

	/**
	 * Overall visual height if all rows were rendered, used to decide when to chunk.
	 */
	const fullContentHeight = computed(() => {
		if (totalRows.value <= 0) {
			return 0;
		}
		return totalRows.value * options.rowHeightValue.value;
	});

	/**
	 * Maximum number of rows that can fit into a single chunk before exceeding the virtual height.
	 */
	const chunkRowCapacity = computed(() => {
		const rowHeight = options.rowHeightValue.value;
		if (rowHeight <= 0) {
			return Number.POSITIVE_INFINITY;
		}

		const capacity = Math.floor(options.maxVirtualHeight.value / rowHeight);
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return Number.POSITIVE_INFINITY;
		}

		return capacity;
	});

	/**
	 * Number of rows currently represented by the active chunk, respecting remaining data.
	 */
	const chunkRowCount = computed(() => {
		if (!Number.isFinite(chunkRowCapacity.value)) {
			return totalRows.value;
		}

		const remainingRows = Math.max(totalRows.value - chunkStartRow.value, 0);
		return Math.min(remainingRows, chunkRowCapacity.value);
	});

	/**
	 * Pixel height of the active chunk, informing container styling.
	 */
	const chunkHeight = computed(() => {
		if (chunkRowCount.value <= 0) {
			return 0;
		}
		return chunkRowCount.value * options.rowHeightValue.value;
	});

	/**
	 * Indicates whether the total content exceeds the maximum virtual height and needs chunking.
	 */
	const isChunking = computed(
		() =>
			fullContentHeight.value > options.maxVirtualHeight.value &&
			Number.isFinite(chunkRowCapacity.value),
	);

	/**
	 * Number of chunks required to represent the entire dataset when chunking is enabled.
	 */
	const chunkCount = computed(() => {
		if (!isChunking.value) {
			return 1;
		}

		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return 1;
		}

		return Math.max(1, Math.ceil(totalRows.value / capacity));
	});

	/**
	 * Index of the chunk that is currently mounted within the viewport container.
	 */
	const activeChunkIndex = computed(() => {
		if (!isChunking.value) {
			return 0;
		}

		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return 0;
		}

		const currentIndex = Math.floor(chunkStartRow.value / capacity);
		return clamp(currentIndex, 0, Math.max(chunkCount.value - 1, 0));
	});

	/**
	 * Normalized placement for the chunk navigator UI, honoring supported positions.
	 */
	const navigatorPlacement = computed<ChunkNavigatorPlacement>(() => {
		const placement = options.props.chunkNavigatorPlacement ?? "right";
		switch (placement) {
			case "left":
			case "top":
			case "bottom":
			case "right":
				return placement;
			default:
				return "right";
		}
	});

	/**
	 * Flags whether the navigator should be laid out vertically (top/bottom) or horizontally.
	 */
	const isNavigatorVertical = computed(
		() =>
			navigatorPlacement.value === "top" ||
			navigatorPlacement.value === "bottom",
	);

	/**
	 * Determines when the chunk navigator control should be displayed.
	 */
	const shouldShowChunkNavigator = computed(
		() =>
			Boolean(options.props.showChunkNavigator) &&
			isChunking.value &&
			chunkCount.value > 1,
	);

	/**
	 * Class list for the root container, adding layout modifiers when the navigator is visible.
	 */
	const rootClass = computed(() => {
		const classes = ["vuehex-root"];
		if (shouldShowChunkNavigator.value) {
			classes.push(
				isNavigatorVertical.value
					? "vuehex-root--vertical"
					: "vuehex-root--horizontal",
			);
			classes.push(`vuehex-root--nav-${navigatorPlacement.value}`);
		}
		return classes;
	});

	/**
	 * Class list for the navigator container, allowing placement-specific styling.
	 */
	const chunkNavigatorClass = computed(() => {
		const classes = ["vuehex-chunk-nav"];
		if (shouldShowChunkNavigator.value) {
			classes.push(`vuehex-chunk-nav--${navigatorPlacement.value}`);
		}
		return classes;
	});

	/**
	 * Class list for the viewer portion, attaching modifiers that account for navigator presence.
	 */
	const viewerClass = computed(() => {
		const classes = ["vuehex-viewer"];
		if (shouldShowChunkNavigator.value) {
			classes.push("vuehex-viewer--with-nav");
			classes.push(`vuehex-viewer--nav-${navigatorPlacement.value}`);
		}
		return classes;
	});

	/**
	 * Collection of chunk descriptors used to render the navigator button list.
	 */
	const chunkItems = computed<ChunkDescriptor[]>(() => {
		if (!shouldShowChunkNavigator.value) {
			return [];
		}

		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return [];
		}

		const total = totalRows.value;
		const totalByteCount = options.totalBytes.value;
		const bytesPer = options.bytesPerRow.value;
		const uppercase = Boolean(options.props.uppercase);
		const count = chunkCount.value;
		const items: ChunkDescriptor[] = [];

		for (let index = 0; index < count; index += 1) {
			const startRow = index * capacity;
			if (startRow >= total) {
				break;
			}

			const rowSpan = Math.min(capacity, total - startRow);
			const startByte = startRow * bytesPer;
			const byteSpan = Math.min(
				rowSpan * bytesPer,
				Math.max(totalByteCount - startByte, 0),
			);
			const endByte = byteSpan > 0 ? startByte + byteSpan - 1 : startByte;

			const label = `Chunk ${index + 1}`;
			const range = `${formatOffsetPlain(
				startByte,
				uppercase,
			)} – ${formatOffsetPlain(endByte, uppercase)}`;

			items.push({ index, startRow, startByte, endByte, label, range });
		}

		return items;
	});

	/**
	 * Builds the class list for a chunk button, allowing callers to highlight the active chunk.
	 */
	function chunkButtonClass(index: number): string[] {
		const classes = ["vuehex-chunk-item"];
		if (index === activeChunkIndex.value) {
			classes.push("vuehex-chunk-item--active");
		}
		return classes;
	}

	/**
	 * Aligns the chunk start row with valid data bounds, keeping the active chunk index coherent.
	 */
	function clampChunkStartToBounds() {
		if (!isChunking.value) {
			if (chunkStartRow.value !== 0) {
				chunkStartRow.value = 0;
			}
			return;
		}

		const totalRowCount = totalRows.value;
		if (totalRowCount <= 0) {
			if (chunkStartRow.value !== 0) {
				chunkStartRow.value = 0;
			}
			return;
		}

		const capacity = chunkRowCapacity.value;
		const maxRowIndex = Math.max(totalRowCount - 1, 0);
		const clampedWithinData = clamp(chunkStartRow.value, 0, maxRowIndex);

		if (!Number.isFinite(capacity) || capacity <= 0) {
			if (chunkStartRow.value !== clampedWithinData) {
				chunkStartRow.value = clampedWithinData;
			}
			return;
		}

		const alignedStart = Math.min(
			Math.floor(clampedWithinData / capacity) * capacity,
			maxRowIndex,
		);

		if (chunkStartRow.value !== alignedStart) {
			chunkStartRow.value = alignedStart;
		}
	}

	/**
	 * Activates the target chunk index and optionally centers a row, returning whether it moved.
	 */
	function moveToChunk(targetIndex: number, focusRow?: number): boolean {
		clampChunkStartToBounds();

		if (!isChunking.value) {
			return false;
		}

		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return false;
		}

		const totalRowCount = totalRows.value;
		const maxIndex = Math.max(Math.ceil(totalRowCount / capacity) - 1, 0);
		const clampedIndex = clamp(Math.round(targetIndex), 0, maxIndex);
		const maxRowIndex = Math.max(totalRowCount - 1, 0);
		const desiredStartCandidate = clampedIndex * capacity;
		const desiredStart = clamp(desiredStartCandidate, 0, maxRowIndex);

		const previousStart = chunkStartRow.value;
		if (previousStart !== desiredStart) {
			chunkStartRow.value = desiredStart;
		}

		const container = options.containerEl.value;
		const rowHeightPx = options.rowHeightValue.value;
		if (container && rowHeightPx > 0) {
			const focus = focusRow ?? desiredStart;
			const relativeRow = Math.max(focus - desiredStart, 0);
			container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
		}

		return previousStart !== desiredStart;
	}

	/**
	 * Ensures the chunk that contains the given row is active, useful before scrolling to a byte.
	 */
	function ensureChunkForRow(row: number): boolean {
		if (!Number.isFinite(row)) {
			row = 0;
		}

		clampChunkStartToBounds();

		if (!isChunking.value) {
			return false;
		}

		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return false;
		}

		const totalRowCount = totalRows.value;
		if (totalRowCount <= 0) {
			return false;
		}

		const maxRowIndex = Math.max(totalRowCount - 1, 0);
		const normalizedRow = clamp(Math.floor(row), 0, maxRowIndex);
		const chunkIndex = Math.floor(normalizedRow / capacity);
		return moveToChunk(chunkIndex, normalizedRow);
	}

	return {
		chunkStartRow,
		totalRows,
		fullContentHeight,
		chunkRowCapacity,
		chunkRowCount,
		chunkHeight,
		isChunking,
		chunkCount,
		activeChunkIndex,
		navigatorPlacement,
		isNavigatorVertical,
		shouldShowChunkNavigator,
		rootClass,
		chunkNavigatorClass,
		viewerClass,
		chunkItems,
		chunkButtonClass,
		moveToChunk,
		ensureChunkForRow,
		clampChunkStartToBounds,
	};
}
