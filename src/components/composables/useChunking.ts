import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";
import { clamp, formatOffsetPlain } from "../vuehex-utils";

/**
 * A UI-facing description of a single chunk in the chunk navigator.
 */
export interface VueHexChunkDescriptor {
	index: number;
	label: string;
	range: string;
}

/**
 * Inputs required to compute chunk boundaries and navigator metadata.
 */
interface UseChunkingOptions {
	/** Whether the chunk navigator UI is enabled/visible. */
	showNavigator: ComputedRef<boolean>;
	/** Total bytes in the backing data source. */
	totalBytes: ComputedRef<number>;
	/** Bytes per rendered row (used to convert between bytes and rows). */
	bytesPerRow: ComputedRef<number>;
	/** Measured row height in pixels (used to cap the virtual scroll height). */
	rowHeightValue: ComputedRef<number>;
	/** Max virtual height in pixels allowed before chunking is enabled. */
	maxVirtualHeight: ComputedRef<number>;
	/** Casing preference used for chunk range labels. */
	uppercase: ComputedRef<boolean>;
}

export interface UseChunkingResult {
	/** Absolute start row (0-based) of the active chunk. */
	chunkStartRow: Ref<number>;
	/** Total number of rows required to render `totalBytes` at `bytesPerRow`. */
	totalRows: ComputedRef<number>;
	/** Maximum rows per chunk derived from `maxVirtualHeight / rowHeight`. */
	chunkRowCapacity: ComputedRef<number>;
	/** True when chunking is active (total rows exceed capacity). */
	isChunking: ComputedRef<boolean>;
	/** Total number of chunks available for the current dataset. */
	chunkCount: ComputedRef<number>;
	/** 0-based chunk index that contains `chunkStartRow`. */
	activeChunkIndex: ComputedRef<number>;
	/** Number of rows available within the active chunk. */
	chunkRowCount: ComputedRef<number>;
	/** Pixel height of the active chunk (`chunkRowCount * rowHeightValue`). */
	chunkHeight: ComputedRef<number>;
	/** Items suitable for a chunk navigator UI (empty when disabled). */
	chunkItems: ComputedRef<VueHexChunkDescriptor[]>;
	/** Normalizes `chunkStartRow` to valid bounds and chunk boundaries. */
	clampChunkStartToBounds: () => void;
	/** Ensures the chunk containing `row` is active; returns true if it changed. */
	ensureChunkForRow: (row: number) => boolean;
	/** Selects the chunk by 0-based index; returns true if it changed. */
	selectChunk: (index: number) => boolean;
}

/**
 * Provides chunking state + helpers for very large virtualized hex views.
 *
 * Chunking is used to cap the maximum virtual scroll height: the full data is
 * split into fixed-size row ranges (chunks), and the UI renders/scrolls within
 * the currently active chunk.
 *
 * Used by VueHex to keep scroll containers manageable for extremely large inputs,
 * and to power the optional chunk navigator UI.
 */
export function useChunking(options: UseChunkingOptions): UseChunkingResult {
	/**
	 * Absolute start row (0-based) for the currently active chunk.
	 *
	 * Why it exists: chunking keeps the virtual scroll height bounded by only
	 * rendering/scrolling within a subset of rows at a time.
	 */
	const chunkStartRow = ref(0);

	/**
	 * Returns a valid finite chunk capacity (in rows) when chunking can be used,
	 * otherwise returns null.
	 */
	function getFiniteCapacity(): number | null {
		const capacity = chunkRowCapacity.value;
		return Number.isFinite(capacity) && capacity > 0 ? capacity : null;
	}

	/**
	 * Returns the maximum valid row index (0-based) for the current data set.
	 * Returns 0 when there are no rows.
	 */
	function getMaxRowIndex(rows: number): number {
		return Math.max(rows - 1, 0);
	}

	/**
	 * Total number of rows needed to represent `totalBytes` at `bytesPerRow`.
	 */
	const totalRows = computed(() => {
		const total = options.totalBytes.value;
		if (total <= 0) {
			return 0;
		}
		return Math.ceil(total / Math.max(options.bytesPerRow.value, 1));
	});

	/**
	 * Max number of rows allowed per chunk.
	 *
	 * Why it exists: browsers can struggle with extremely large scroll heights;
	 * this caps the virtual height using `maxVirtualHeight / rowHeight`.
	 */
	const chunkRowCapacity = computed(() => {
		const maxHeight = options.maxVirtualHeight.value;
		if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
			return Number.POSITIVE_INFINITY;
		}
		const rowHeightPx = options.rowHeightValue.value;
		if (!Number.isFinite(rowHeightPx) || rowHeightPx <= 0) {
			return Number.POSITIVE_INFINITY;
		}
		const capacity = Math.floor(maxHeight / rowHeightPx);
		return capacity > 0 ? capacity : Number.POSITIVE_INFINITY;
	});

	/**
	 * Whether chunking is currently required.
	 */
	const isChunking = computed(() => {
		const capacity = getFiniteCapacity();
		return capacity !== null && totalRows.value > capacity;
	});

	/**
	 * Total number of chunks needed to cover all rows.
	 */
	const chunkCount = computed(() => {
		if (!isChunking.value) {
			return 1;
		}
		const capacity = getFiniteCapacity();
		return capacity ? Math.max(1, Math.ceil(totalRows.value / capacity)) : 1;
	});

	/**
	 * 0-based index of the currently active chunk.
	 *
	 * Why it exists: the navigator UI and scroll logic need a stable chunk index
	 * even when `chunkStartRow` is mutated.
	 */
	const activeChunkIndex = computed(() => {
		if (!isChunking.value) {
			return 0;
		}
		const capacity = getFiniteCapacity();
		if (!capacity) {
			return 0;
		}
		return clamp(
			Math.floor(Math.max(0, chunkStartRow.value) / capacity),
			0,
			Math.max(chunkCount.value - 1, 0),
		);
	});

	/**
	 * Number of rows available within the current chunk.
	 *
	 * Why it exists: the final chunk may contain fewer than `chunkRowCapacity` rows.
	 */
	const chunkRowCount = computed(() => {
		const rows = totalRows.value;
		if (rows <= 0) {
			return 0;
		}
		if (!isChunking.value) {
			return rows;
		}
		const capacity = getFiniteCapacity();
		if (!capacity) {
			return rows;
		}
		const remaining = Math.max(rows - Math.max(0, chunkStartRow.value), 0);
		return Math.min(remaining, capacity);
	});

	/**
	 * Pixel height of the current chunk.
	 */
	const chunkHeight = computed(() => {
		const count = chunkRowCount.value;
		if (count <= 0) {
			return 0;
		}
		return count * options.rowHeightValue.value;
	});

	/**
	 * Chunk descriptors for the optional chunk navigator.
	 */
	const chunkItems = computed<VueHexChunkDescriptor[]>(() => {
		if (!options.showNavigator.value || !isChunking.value) {
			return [];
		}
		const rows = totalRows.value;
		const capacity = getFiniteCapacity();
		if (rows <= 0 || !capacity) {
			return [];
		}
		const bytesPer = Math.max(options.bytesPerRow.value, 1);
		const totalByteCount = options.totalBytes.value;
		const uppercase = Boolean(options.uppercase.value);
		const items: VueHexChunkDescriptor[] = [];
		// Each chunk is defined by a contiguous row range. Convert that to an
		// inclusive byte range for display.
		for (let index = 0; index < chunkCount.value; index += 1) {
			const startRow = index * capacity;
			if (startRow >= rows) {
				break;
			}
			const rowSpan = Math.min(capacity, rows - startRow);
			const startByte = startRow * bytesPer;
			const byteSpan = Math.min(
				rowSpan * bytesPer,
				Math.max(totalByteCount - startByte, 0),
			);
			const endByte = byteSpan > 0 ? startByte + byteSpan - 1 : startByte;
			items.push({
				index,
				label: `Chunk ${index + 1}`,
				range: `${formatOffsetPlain(
					startByte,
					uppercase,
				)} - ${formatOffsetPlain(endByte, uppercase)}`,
			});
		}
		return items;
	});

	/**
	 * Ensures `chunkStartRow` is valid for the current `totalRows`.
	 *
	 * - When not chunking (or empty), the start row is always 0.
	 * - When chunking, the start row is snapped to the beginning of a chunk.
	 */
	function clampChunkStartToBounds() {
		const rows = totalRows.value;
		if (rows <= 0) {
			chunkStartRow.value = 0;
			return;
		}
		if (!isChunking.value) {
			chunkStartRow.value = 0;
			return;
		}
		const capacity = getFiniteCapacity();
		const maxRowIndex = getMaxRowIndex(rows);
		const within = clamp(
			Math.max(0, Math.trunc(chunkStartRow.value)),
			0,
			maxRowIndex,
		);
		if (!capacity) {
			chunkStartRow.value = within;
			return;
		}
		chunkStartRow.value = clamp(
			Math.floor(within / capacity) * capacity,
			0,
			maxRowIndex,
		);
	}

	/**
	 * Switches the active chunk so that the provided absolute row index is
	 * contained within the active chunk.
	 *
	 * Returns true if the chunk start changed (meaning the UI should re-evaluate
	 * its rendered window), otherwise false.
	 */
	function ensureChunkForRow(row: number): boolean {
		if (!Number.isFinite(row)) {
			row = 0;
		}
		clampChunkStartToBounds();
		if (!isChunking.value) {
			return false;
		}
		const capacity = getFiniteCapacity();
		if (!capacity) {
			return false;
		}
		const rows = totalRows.value;
		if (rows <= 0) {
			return false;
		}
		const maxRowIndex = getMaxRowIndex(rows);
		const normalizedRow = clamp(Math.floor(row), 0, maxRowIndex);
		const desiredStart = clamp(
			Math.floor(normalizedRow / capacity) * capacity,
			0,
			maxRowIndex,
		);
		if (desiredStart === chunkStartRow.value) {
			return false;
		}
		chunkStartRow.value = desiredStart;
		return true;
	}

	/**
	 * Selects a chunk by its 0-based index.
	 *
	 * Returns true if the chunk start changed, otherwise false.
	 */
	function selectChunk(index: number): boolean {
		if (!Number.isFinite(index)) {
			return false;
		}
		if (!isChunking.value) {
			return false;
		}
		const capacity = getFiniteCapacity();
		if (!capacity) {
			return false;
		}
		const rows = totalRows.value;
		if (rows <= 0) {
			return false;
		}
		const maxRowIndex = getMaxRowIndex(rows);
		const maxChunkIndex = Math.max(chunkCount.value - 1, 0);
		const nextIndex = clamp(Math.floor(index), 0, maxChunkIndex);
		const nextStart = clamp(nextIndex * capacity, 0, maxRowIndex);
		if (nextStart === chunkStartRow.value) {
			return false;
		}
		chunkStartRow.value = nextStart;
		return true;
	}

	return {
		chunkStartRow,
		totalRows,
		chunkRowCapacity,
		isChunking,
		chunkCount,
		activeChunkIndex,
		chunkRowCount,
		chunkHeight,
		chunkItems,
		clampChunkStartToBounds,
		ensureChunkForRow,
		selectChunk,
	};
}

export type UseChunkingReturn = ReturnType<typeof useChunking>;
export type ChunkStartRowRef = Ref<number>;
