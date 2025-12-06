import { computed, ref } from "vue";
import type { ComputedRef, Ref } from "vue";
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
  maxVirtualHeight: number;
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

export function useChunkNavigator(
  options: ChunkNavigatorOptions
): ChunkNavigatorResult {
  const chunkStartRow = ref(0);

  const totalRows = computed(() => {
    const total = options.totalBytes.value;
    if (total <= 0) {
      return 0;
    }

    return Math.ceil(total / options.bytesPerRow.value);
  });

  const fullContentHeight = computed(() => {
    if (totalRows.value <= 0) {
      return 0;
    }
    return totalRows.value * options.rowHeightValue.value;
  });

  const chunkRowCapacity = computed(() => {
    const rowHeight = options.rowHeightValue.value;
    if (rowHeight <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    const capacity = Math.floor(options.maxVirtualHeight / rowHeight);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    return capacity;
  });

  const chunkRowCount = computed(() => {
    if (!Number.isFinite(chunkRowCapacity.value)) {
      return totalRows.value;
    }

    const remainingRows = Math.max(totalRows.value - chunkStartRow.value, 0);
    return Math.min(remainingRows, chunkRowCapacity.value);
  });

  const chunkHeight = computed(() => {
    if (chunkRowCount.value <= 0) {
      return 0;
    }
    return chunkRowCount.value * options.rowHeightValue.value;
  });

  const isChunking = computed(
    () =>
      fullContentHeight.value > options.maxVirtualHeight &&
      Number.isFinite(chunkRowCapacity.value)
  );

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

  const isNavigatorVertical = computed(
    () =>
      navigatorPlacement.value === "top" ||
      navigatorPlacement.value === "bottom"
  );

  const shouldShowChunkNavigator = computed(
    () =>
      Boolean(options.props.showChunkNavigator) &&
      isChunking.value &&
      chunkCount.value > 1
  );

  const rootClass = computed(() => {
    const classes = ["vuehex-root"];
    if (shouldShowChunkNavigator.value) {
      classes.push(
        isNavigatorVertical.value
          ? "vuehex-root--vertical"
          : "vuehex-root--horizontal"
      );
      classes.push(`vuehex-root--nav-${navigatorPlacement.value}`);
    }
    return classes;
  });

  const chunkNavigatorClass = computed(() => {
    const classes = ["vuehex-chunk-nav"];
    if (shouldShowChunkNavigator.value) {
      classes.push(`vuehex-chunk-nav--${navigatorPlacement.value}`);
    }
    return classes;
  });

  const viewerClass = computed(() => {
    const classes = ["vuehex-viewer"];
    if (shouldShowChunkNavigator.value) {
      classes.push("vuehex-viewer--with-nav");
      classes.push(`vuehex-viewer--nav-${navigatorPlacement.value}`);
    }
    return classes;
  });

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
        Math.max(totalByteCount - startByte, 0)
      );
      const endByte = byteSpan > 0 ? startByte + byteSpan - 1 : startByte;

      const label = `Chunk ${index + 1}`;
      const range = `${formatOffsetPlain(
        startByte,
        uppercase
      )} – ${formatOffsetPlain(endByte, uppercase)}`;

      items.push({ index, startRow, startByte, endByte, label, range });
    }

    return items;
  });

  function chunkButtonClass(index: number): string[] {
    const classes = ["vuehex-chunk-item"];
    if (index === activeChunkIndex.value) {
      classes.push("vuehex-chunk-item--active");
    }
    return classes;
  }

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
      maxRowIndex
    );

    if (chunkStartRow.value !== alignedStart) {
      chunkStartRow.value = alignedStart;
    }
  }

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
