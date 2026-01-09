import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";
import { clamp, formatOffsetPlain } from "../vuehex-utils";

export interface VueHexChunkDescriptor {
	index: number;
	label: string;
	range: string;
}

interface UseChunkingOptions {
	showNavigator: ComputedRef<boolean>;
	totalBytes: ComputedRef<number>;
	bytesPerRow: ComputedRef<number>;
	rowHeightValue: ComputedRef<number>;
	maxVirtualHeight: ComputedRef<number>;
	uppercase: ComputedRef<boolean>;
}

export function useChunking(options: UseChunkingOptions) {
	const chunkStartRow = ref(0);

	const totalRows = computed(() => {
		const total = options.totalBytes.value;
		if (total <= 0) {
			return 0;
		}
		return Math.ceil(total / Math.max(options.bytesPerRow.value, 1));
	});

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

	const isChunking = computed(() => {
		const capacity = chunkRowCapacity.value;
		return (
			Number.isFinite(capacity) && capacity > 0 && totalRows.value > capacity
		);
	});

	const chunkCount = computed(() => {
		if (!isChunking.value) {
			return 1;
		}
		return Math.max(1, Math.ceil(totalRows.value / chunkRowCapacity.value));
	});

	const activeChunkIndex = computed(() => {
		if (!isChunking.value) {
			return 0;
		}
		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return 0;
		}
		return clamp(
			Math.floor(Math.max(0, chunkStartRow.value) / capacity),
			0,
			Math.max(chunkCount.value - 1, 0),
		);
	});

	const chunkRowCount = computed(() => {
		const rows = totalRows.value;
		if (rows <= 0) {
			return 0;
		}
		if (!isChunking.value) {
			return rows;
		}
		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return rows;
		}
		const remaining = Math.max(rows - Math.max(0, chunkStartRow.value), 0);
		return Math.min(remaining, capacity);
	});

	const chunkHeight = computed(() => {
		const count = chunkRowCount.value;
		if (count <= 0) {
			return 0;
		}
		return count * options.rowHeightValue.value;
	});

	const chunkItems = computed<VueHexChunkDescriptor[]>(() => {
		if (!options.showNavigator.value || !isChunking.value) {
			return [];
		}
		const rows = totalRows.value;
		const capacity = chunkRowCapacity.value;
		if (rows <= 0 || !Number.isFinite(capacity) || capacity <= 0) {
			return [];
		}
		const bytesPer = Math.max(options.bytesPerRow.value, 1);
		const totalByteCount = options.totalBytes.value;
		const uppercase = Boolean(options.uppercase.value);
		const items: VueHexChunkDescriptor[] = [];
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
		const capacity = chunkRowCapacity.value;
		const maxRowIndex = Math.max(rows - 1, 0);
		const within = clamp(
			Math.max(0, Math.trunc(chunkStartRow.value)),
			0,
			maxRowIndex,
		);
		if (!Number.isFinite(capacity) || capacity <= 0) {
			chunkStartRow.value = within;
			return;
		}
		chunkStartRow.value = clamp(
			Math.floor(within / capacity) * capacity,
			0,
			maxRowIndex,
		);
	}

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
		const rows = totalRows.value;
		if (rows <= 0) {
			return false;
		}
		const maxRowIndex = Math.max(rows - 1, 0);
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

	function selectChunk(index: number): boolean {
		if (!Number.isFinite(index)) {
			return false;
		}
		if (!isChunking.value) {
			return false;
		}
		const capacity = chunkRowCapacity.value;
		if (!Number.isFinite(capacity) || capacity <= 0) {
			return false;
		}
		const rows = totalRows.value;
		if (rows <= 0) {
			return false;
		}
		const maxRowIndex = Math.max(rows - 1, 0);
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
