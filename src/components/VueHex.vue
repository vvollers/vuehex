<template>
  <div :class="rootClass">
    <nav
      v-if="shouldShowChunkNavigator"
      :class="chunkNavigatorClass"
      role="navigation"
      aria-label="Chunk navigator"
    >
      <header class="vuehex-chunk-nav__header">
        <span class="vuehex-chunk-nav__title">Chunks</span>
        <span class="vuehex-chunk-nav__summary">
          {{ chunkCount }} × {{ bytesPerRow }} bytes/row
        </span>
      </header>
      <div class="vuehex-chunk-list" role="listbox">
        <button
          v-for="chunk in chunkItems"
          :key="chunk.index"
          type="button"
          role="option"
          :aria-selected="chunk.index === activeChunkIndex"
          :class="chunkButtonClass(chunk.index)"
          @click="handleChunkSelect(chunk.index)"
        >
          <span class="vuehex-chunk-item__label">{{ chunk.label }}</span>
          <span class="vuehex-chunk-item__range">{{ chunk.range }}</span>
        </button>
      </div>
    </nav>
    <div :class="viewerClass">
      <div
        ref="containerEl"
        :class="containerClass"
        role="table"
        aria-label="Hex viewer"
        @scroll="handleScroll"
      >
        <div class="vuehex-inner" :style="innerStyle" role="presentation">
          <table :class="tableClass" :style="tableStyle" role="presentation">
            <tbody ref="tbodyEl" v-html="markup"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { CSSProperties } from "vue";
import type {
  VueHexAsciiRenderer,
  VueHexCellClassResolver,
  VueHexDataBinding,
  VueHexPrintableCheck,
  VueHexSource,
  VueHexWindowRequest,
} from "./vuehex-api";
import { DEFAULT_ASCII_RENDERER, DEFAULT_PRINTABLE_CHECK } from "./vuehex-api";

const DEFAULT_ROW_HEIGHT = 24;
const MAX_VIRTUAL_HEIGHT = 8_000_000;

const HEX_LOWER: readonly string[] = Array.from({ length: 256 }, (_, value) =>
  value.toString(16).padStart(2, "0")
);
const HEX_UPPER: readonly string[] = HEX_LOWER.map((value) =>
  value.toUpperCase()
);
const OFFSET_PAD = 8;
const PLACEHOLDER_HEX = "--";
const PLACEHOLDER_ASCII = "--";

const TEXT_ENCODER = new TextEncoder();

const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const props = withDefaults(
  defineProps<{
    binding: VueHexDataBinding;
    bytesPerRow?: number;
    uppercase?: boolean;
    nonPrintableChar?: string;
    overscan?: number;
    isPrintable?: VueHexPrintableCheck;
    renderAscii?: VueHexAsciiRenderer;
    theme?: string | null;
    cellClassForByte?: VueHexCellClassResolver;
    showChunkNavigator?: boolean;
    chunkNavigatorPlacement?: "left" | "right" | "top" | "bottom";
  }>(),
  {
    bytesPerRow: 16,
    uppercase: false,
    nonPrintableChar: ".",
    overscan: 2,
    isPrintable: DEFAULT_PRINTABLE_CHECK,
    renderAscii: DEFAULT_ASCII_RENDERER,
    theme: "default",
    showChunkNavigator: false,
    chunkNavigatorPlacement: "right",
  }
);

const emit = defineEmits<{
  (event: "row-hover-on", payload: { offset: number }): void;
  (event: "row-hover-off", payload: { offset: number }): void;
  (event: "hex-hover-on", payload: { index: number; byte: number }): void;
  (event: "hex-hover-off", payload: { index: number; byte: number }): void;
  (event: "ascii-hover-on", payload: { index: number; byte: number }): void;
  (event: "ascii-hover-off", payload: { index: number; byte: number }): void;
}>();

const bindingWindow = computed(() => props.binding.window);
const totalBytes = computed(() => props.binding.totalBytes);

const containerEl = ref<HTMLDivElement>();
const tbodyEl = ref<HTMLTableSectionElement>();

const markup = shallowRef("");
const normalizedBytes = shallowRef<Uint8Array<ArrayBufferLike>>(
  new Uint8Array(0)
);
const fallbackAsciiChar = shallowRef(".");
const renderStartRowRef = ref(0);
const chunkStartRowRef = ref(0);

const rowHeight = ref<number | null>(null);
const containerHeight = ref(0);
const pendingScrollByte = ref<number | null>(null);
const pendingScrollCheck = ref(false);

const bytesPerRow = computed(() => clampBytesPerRow(props.bytesPerRow));
const rowHeightValue = computed(() => rowHeight.value ?? DEFAULT_ROW_HEIGHT);

const themeKey = computed(() => normalizeThemeKey(props.theme));
const containerClass = computed(() => {
  const classes = ["vuehex"];
  if (themeKey.value) {
    classes.push(`vuehex-theme-${themeKey.value}`);
  }
  return classes;
});
const tableClass = computed(() => ["vuehex-table"]);

const totalRows = computed(() => {
  const total = totalBytes.value;
  if (total <= 0) {
    return 0;
  }

  return Math.ceil(total / bytesPerRow.value);
});

const startRow = computed(() =>
  Math.floor(bindingWindow.value.offset / bytesPerRow.value)
);

const renderedRows = computed(() => {
  if (normalizedBytes.value.length === 0) {
    return 0;
  }

  return Math.max(
    1,
    Math.ceil(normalizedBytes.value.length / bytesPerRow.value)
  );
});

const viewportRows = computed(() => {
  if (containerHeight.value <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(containerHeight.value / rowHeightValue.value));
});

const fullContentHeight = computed(() => {
  if (totalRows.value <= 0) {
    return 0;
  }
  return totalRows.value * rowHeightValue.value;
});

const chunkRowCapacity = computed(() => {
  const heightPerRow = rowHeightValue.value;
  if (heightPerRow <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const capacity = Math.floor(MAX_VIRTUAL_HEIGHT / heightPerRow);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return capacity;
});

const chunkRowCount = computed(() => {
  if (!Number.isFinite(chunkRowCapacity.value)) {
    return totalRows.value;
  }

  const remainingRows = Math.max(totalRows.value - chunkStartRowRef.value, 0);
  return Math.min(remainingRows, chunkRowCapacity.value);
});

const chunkHeight = computed(() => {
  if (chunkRowCount.value <= 0) {
    return 0;
  }
  return chunkRowCount.value * rowHeightValue.value;
});

const isChunking = computed(
  () =>
    fullContentHeight.value > MAX_VIRTUAL_HEIGHT &&
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

  const currentIndex = Math.floor(chunkStartRowRef.value / capacity);
  return clamp(currentIndex, 0, Math.max(chunkCount.value - 1, 0));
});

const navigatorPlacement = computed(() => {
  const placement = props.chunkNavigatorPlacement ?? "right";
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
    navigatorPlacement.value === "top" || navigatorPlacement.value === "bottom"
);

const shouldShowChunkNavigator = computed(
  () =>
    Boolean(props.showChunkNavigator) &&
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

const chunkItems = computed(() => {
  if (!shouldShowChunkNavigator.value) {
    return [] as Array<{
      index: number;
      startRow: number;
      startByte: number;
      endByte: number;
      label: string;
      range: string;
    }>;
  }

  const capacity = chunkRowCapacity.value;
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return [];
  }

  const total = totalRows.value;
  const totalByteCount = totalBytes.value;
  const bytesPer = bytesPerRow.value;
  const uppercase = Boolean(props.uppercase);
  const count = chunkCount.value;
  const items: Array<{
    index: number;
    startRow: number;
    startByte: number;
    endByte: number;
    label: string;
    range: string;
  }> = [];

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

const tableOffset = computed(() => {
  const offsetRows = renderStartRowRef.value - chunkStartRowRef.value;
  const offset = offsetRows * rowHeightValue.value;
  return Math.max(offset, 0);
});

const innerStyle = computed<CSSProperties>(() => ({
  position: "relative",
  width: "100%",
  height: `${Math.max(chunkHeight.value, 0)}px`,
}));

const tableStyle = computed<CSSProperties>(() => {
  const offset = tableOffset.value;
  const transformValue = Number.isFinite(offset)
    ? `translateY(${offset}px)`
    : "translateY(0px)";
  return {
    position: "absolute",
    top: "0px",
    left: "0px",
    right: "0px",
    width: "100%",
    transform: transformValue,
  };
});

function chunkButtonClass(index: number): string[] {
  const classes = ["vuehex-chunk-item"];
  if (index === activeChunkIndex.value) {
    classes.push("vuehex-chunk-item--active");
  }
  return classes;
}

function handleChunkSelect(index: number) {
  if (!Number.isFinite(index)) {
    return;
  }

  moveToChunk(index, undefined, true);
}

const overscanRows = computed(() => Math.max(0, Math.trunc(props.overscan)));

const lastRequested = shallowRef<VueHexWindowRequest | null>(null);

let resizeObserver: ResizeObserver | null = null;
let activeRowOffset: number | null = null;
let activeHex: { index: number; byte: number } | null = null;
let activeAscii: { index: number; byte: number } | null = null;

function clampChunkStartToBounds() {
  if (!isChunking.value) {
    if (chunkStartRowRef.value !== 0) {
      chunkStartRowRef.value = 0;
    }
    return;
  }

  const totalRowCount = totalRows.value;
  if (totalRowCount <= 0) {
    if (chunkStartRowRef.value !== 0) {
      chunkStartRowRef.value = 0;
    }
    return;
  }

  const capacity = chunkRowCapacity.value;
  const maxRowIndex = Math.max(totalRowCount - 1, 0);
  const clampedWithinData = clamp(chunkStartRowRef.value, 0, maxRowIndex);

  if (!Number.isFinite(capacity) || capacity <= 0) {
    if (chunkStartRowRef.value !== clampedWithinData) {
      chunkStartRowRef.value = clampedWithinData;
    }
    return;
  }

  const alignedStart = Math.min(
    Math.floor(clampedWithinData / capacity) * capacity,
    maxRowIndex
  );

  if (chunkStartRowRef.value !== alignedStart) {
    chunkStartRowRef.value = alignedStart;
  }
}

function moveToChunk(
  targetIndex: number,
  focusRow?: number,
  scheduleUpdate: boolean = false
) {
  clampChunkStartToBounds();

  if (!isChunking.value) {
    if (scheduleUpdate) {
      scheduleWindowEvaluation();
    }
    return;
  }

  const capacity = chunkRowCapacity.value;
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return;
  }

  const totalRowCount = totalRows.value;
  const maxIndex = Math.max(Math.ceil(totalRowCount / capacity) - 1, 0);
  const clampedIndex = clamp(Math.round(targetIndex), 0, maxIndex);
  const maxRowIndex = Math.max(totalRowCount - 1, 0);
  const desiredStartCandidate = clampedIndex * capacity;
  const desiredStart = clamp(desiredStartCandidate, 0, maxRowIndex);

  const previousStart = chunkStartRowRef.value;
  if (previousStart !== desiredStart) {
    chunkStartRowRef.value = desiredStart;
  }

  const container = containerEl.value;
  const rowHeightPx = rowHeightValue.value;
  if (container && rowHeightPx > 0) {
    const focus = focusRow ?? desiredStart;
    const relativeRow = Math.max(focus - desiredStart, 0);
    container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
  }

  if (scheduleUpdate) {
    scheduleWindowEvaluation();
  }
}

function ensureChunkForRow(row: number, options: { schedule?: boolean } = {}) {
  if (!Number.isFinite(row)) {
    row = 0;
  }

  clampChunkStartToBounds();

  if (!isChunking.value) {
    return;
  }

  const capacity = chunkRowCapacity.value;
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return;
  }

  const totalRowCount = totalRows.value;
  if (totalRowCount <= 0) {
    return;
  }

  const maxRowIndex = Math.max(totalRowCount - 1, 0);
  const normalizedRow = clamp(Math.floor(row), 0, maxRowIndex);
  const chunkIndex = Math.floor(normalizedRow / capacity);
  moveToChunk(chunkIndex, normalizedRow, options.schedule ?? false);
}

watch(
  () => ({
    data: bindingWindow.value.data,
    offset: bindingWindow.value.offset,
    bytesPerRow: bytesPerRow.value,
    uppercase: props.uppercase,
    nonPrintableChar: props.nonPrintableChar,
    isPrintable: props.isPrintable,
    renderAscii: props.renderAscii,
    cellClassForByte: props.cellClassForByte,
  }),
  () => {
    clampChunkStartToBounds();
    const activeWindow = bindingWindow.value;
    const normalized = normalizeSource(activeWindow.data);
    normalizedBytes.value = normalized;

    const fallbackAscii = resolveFallbackChar(props.nonPrintableChar);
    fallbackAsciiChar.value = fallbackAscii;

    updateRenderedSlice();

    lastRequested.value = {
      offset: activeWindow.offset,
      length: normalized.length,
    };

    nextTick(() => {
      measureRowHeight();
      scheduleWindowEvaluation();
    });
  },
  { immediate: true }
);

watch(
  () => totalBytes.value,
  () => {
    clampChunkStartToBounds();
    scheduleWindowEvaluation();
  }
);
watch(bytesPerRow, () => {
  clampChunkStartToBounds();
  scheduleWindowEvaluation();
});
watch(viewportRows, () => {
  clampChunkStartToBounds();
  scheduleWindowEvaluation();
});

onMounted(() => {
  const container = containerEl.value;
  if (container) {
    containerHeight.value = container.clientHeight;
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      containerHeight.value = entry.contentRect.height;
      scheduleWindowEvaluation();
    });
    resizeObserver.observe(container);
  }

  const tbody = tbodyEl.value;
  if (tbody) {
    tbody.addEventListener("pointerover", handlePointerOver);
    tbody.addEventListener("pointerout", handlePointerOut);
  }

  pendingScrollByte.value = props.binding.window.offset;
  scheduleWindowEvaluation();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;

  const tbody = tbodyEl.value;
  if (tbody) {
    tbody.removeEventListener("pointerover", handlePointerOver);
    tbody.removeEventListener("pointerout", handlePointerOut);
  }

  clearHoverState();
});

function handleScroll() {
  scheduleWindowEvaluation();
}

function handlePointerOver(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  applyRowEnter(target);
  applyHexEnter(target);
  applyAsciiEnter(target);
}

function handlePointerOut(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const related = event.relatedTarget;
  applyRowLeave(target, related);
  applyHexLeave(target, related);
  applyAsciiLeave(target, related);

  const currentTarget = event.currentTarget;
  if (
    currentTarget instanceof HTMLElement &&
    (!(related instanceof HTMLElement) || !currentTarget.contains(related))
  ) {
    clearHoverState();
  }
}

function applyRowEnter(element: HTMLElement) {
  const rowEl = element.closest<HTMLElement>("tr[data-row-offset]");
  if (!rowEl?.dataset.rowOffset) {
    return;
  }

  const offset = Number.parseInt(rowEl.dataset.rowOffset, 10);
  if (!Number.isFinite(offset)) {
    return;
  }

  if (activeRowOffset != null && activeRowOffset !== offset) {
    emit("row-hover-off", { offset: activeRowOffset });
    activeRowOffset = null;
  }

  if (activeRowOffset === offset) {
    return;
  }

  activeRowOffset = offset;
  emit("row-hover-on", { offset });
}

function applyRowLeave(element: HTMLElement, related: EventTarget | null) {
  if (activeRowOffset == null) {
    return;
  }

  const rowEl = element.closest<HTMLElement>("tr[data-row-offset]");
  if (!rowEl?.dataset.rowOffset) {
    return;
  }

  const offset = Number.parseInt(rowEl.dataset.rowOffset, 10);
  if (!Number.isFinite(offset) || offset !== activeRowOffset) {
    return;
  }

  if (related instanceof HTMLElement && rowEl.contains(related)) {
    return;
  }

  emit("row-hover-off", { offset });
  activeRowOffset = null;
}

function applyHexEnter(element: HTMLElement) {
  const hexEl = element.closest<HTMLElement>("span[data-hex-index]");
  if (!hexEl?.dataset.hexIndex || !hexEl.dataset.byteValue) {
    return;
  }

  const index = Number.parseInt(hexEl.dataset.hexIndex, 10);
  const byte = Number.parseInt(hexEl.dataset.byteValue, 10);
  if (!Number.isFinite(index) || !Number.isFinite(byte)) {
    return;
  }

  if (activeHex) {
    if (activeHex.index === index && activeHex.byte === byte) {
      return;
    }
    emit("hex-hover-off", activeHex);
    activeHex = null;
  }

  activeHex = { index, byte };
  emit("hex-hover-on", activeHex);
}

function applyHexLeave(element: HTMLElement, related: EventTarget | null) {
  if (!activeHex) {
    return;
  }

  const hexEl = element.closest<HTMLElement>("span[data-hex-index]");
  if (!hexEl?.dataset.hexIndex) {
    return;
  }

  const index = Number.parseInt(hexEl.dataset.hexIndex, 10);
  if (!Number.isFinite(index) || index !== activeHex.index) {
    return;
  }

  if (related instanceof HTMLElement && hexEl.contains(related)) {
    return;
  }

  emit("hex-hover-off", activeHex);
  activeHex = null;
}

function applyAsciiEnter(element: HTMLElement) {
  const asciiEl = element.closest<HTMLElement>("span[data-ascii-index]");
  if (!asciiEl?.dataset.asciiIndex || !asciiEl.dataset.byteValue) {
    return;
  }

  const index = Number.parseInt(asciiEl.dataset.asciiIndex, 10);
  const byte = Number.parseInt(asciiEl.dataset.byteValue, 10);
  if (!Number.isFinite(index) || !Number.isFinite(byte)) {
    return;
  }

  if (activeAscii) {
    if (activeAscii.index === index && activeAscii.byte === byte) {
      return;
    }
    emit("ascii-hover-off", activeAscii);
    activeAscii = null;
  }

  activeAscii = { index, byte };
  emit("ascii-hover-on", activeAscii);
}

function applyAsciiLeave(element: HTMLElement, related: EventTarget | null) {
  if (!activeAscii) {
    return;
  }

  const asciiEl = element.closest<HTMLElement>("span[data-ascii-index]");
  if (!asciiEl?.dataset.asciiIndex) {
    return;
  }

  const index = Number.parseInt(asciiEl.dataset.asciiIndex, 10);
  if (!Number.isFinite(index) || index !== activeAscii.index) {
    return;
  }

  if (related instanceof HTMLElement && asciiEl.contains(related)) {
    return;
  }

  emit("ascii-hover-off", activeAscii);
  activeAscii = null;
}

function clearHoverState() {
  if (activeHex) {
    emit("hex-hover-off", activeHex);
    activeHex = null;
  }
  if (activeAscii) {
    emit("ascii-hover-off", activeAscii);
    activeAscii = null;
  }
  if (activeRowOffset != null) {
    emit("row-hover-off", { offset: activeRowOffset });
    activeRowOffset = null;
  }
}

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

function evaluateWindowRequest() {
  if (viewportRows.value === 0) {
    return;
  }

  const container = containerEl.value;
  if (!container) {
    return;
  }

  const rowHeightPx = rowHeightValue.value;
  const bytesPerRowValue = bytesPerRow.value;
  if (rowHeightPx <= 0 || bytesPerRowValue <= 0) {
    return;
  }

  const chunkRows = chunkRowCount.value;
  if (chunkRows <= 0) {
    return;
  }

  const chunkStartRow = chunkStartRowRef.value;
  const chunkEndRow = chunkStartRow + chunkRows;

  const overscan = overscanRows.value;

  const scrollTop = container.scrollTop;
  const visibleStartRow = chunkStartRow + Math.floor(scrollTop / rowHeightPx);
  const clampedVisibleStartRow = clamp(
    visibleStartRow,
    chunkStartRow,
    Math.max(chunkEndRow - 1, chunkStartRow)
  );

  const desiredStartRowUnclamped = clampedVisibleStartRow - overscan;
  const desiredStartRow = clamp(
    desiredStartRowUnclamped,
    chunkStartRow,
    Math.max(chunkEndRow - 1, chunkStartRow)
  );

  const desiredRows = Math.max(viewportRows.value + overscan * 2, 1);
  const availableRowsInChunk = Math.max(chunkEndRow - desiredStartRow, 0);
  const rowsToRequest = Math.min(availableRowsInChunk, desiredRows);

  if (rowsToRequest <= 0) {
    return;
  }

  const desiredOffset = desiredStartRow * bytesPerRowValue;
  const maxPossibleBytes = Math.max(
    props.binding.totalBytes - desiredOffset,
    0
  );
  const desiredLength = Math.min(
    maxPossibleBytes,
    rowsToRequest * bytesPerRowValue
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
  props.binding.requestWindow(lastRequested.value);
}

function measureRowHeight() {
  const tbody = tbodyEl.value;
  if (!tbody) {
    return;
  }

  const firstRow = tbody.querySelector("tr");
  if (!firstRow) {
    return;
  }

  const height = firstRow.getBoundingClientRect().height;
  if (height > 0 && height !== rowHeight.value) {
    rowHeight.value = height;
    clampChunkStartToBounds();
    updateRenderedSlice();
  }
}

function applyPendingScroll() {
  if (pendingScrollByte.value == null) {
    return;
  }

  const container = containerEl.value;
  if (!container) {
    return;
  }

  const targetRow = Math.floor(pendingScrollByte.value / bytesPerRow.value);
  ensureChunkForRow(targetRow);

  const relativeRow = targetRow - chunkStartRowRef.value;
  const rowHeightPx = rowHeightValue.value;
  if (rowHeightPx > 0) {
    container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
  }
  pendingScrollByte.value = null;
}

function scrollToByte(offset: number) {
  if (!Number.isFinite(offset)) {
    return;
  }

  const normalized = Math.max(0, Math.trunc(offset));

  const container = containerEl.value;
  if (!container) {
    pendingScrollByte.value = normalized;
    scheduleWindowEvaluation();
    return;
  }

  const targetRow = Math.floor(normalized / bytesPerRow.value);
  ensureChunkForRow(targetRow);

  const relativeRow = targetRow - chunkStartRowRef.value;
  const rowHeightPx = rowHeightValue.value;
  if (rowHeightPx > 0) {
    container.scrollTop = Math.max(relativeRow * rowHeightPx, 0);
  }
  pendingScrollByte.value = null;
  scheduleWindowEvaluation();
}

defineExpose({ scrollToByte });

function updateRenderedSlice() {
  const data = normalizedBytes.value;
  const rawBytesPerRow = bytesPerRow.value;
  const bytesPerRowValue = rawBytesPerRow > 0 ? rawBytesPerRow : 1;
  const windowStart = props.binding.window.offset;

  if (data.length === 0) {
    markup.value = "";
    renderStartRowRef.value = Math.floor(windowStart / bytesPerRowValue);
    chunkStartRowRef.value = 0;
    clearHoverState();
    return;
  }

  const windowEnd = windowStart + data.length;

  let renderStart = windowStart;
  let renderEnd = windowEnd;

  const container = containerEl.value;
  const viewportRowCount = viewportRows.value;
  const overscanCount = overscanRows.value;

  if (
    container &&
    viewportRowCount > 0 &&
    rowHeightValue.value > 0 &&
    bytesPerRowValue > 0
  ) {
    const scrollTop = container.scrollTop;
    const topRowWithinChunk = Math.floor(scrollTop / rowHeightValue.value);
    const topRow = chunkStartRowRef.value + topRowWithinChunk;
    const desiredStartByte = topRow * bytesPerRowValue;
    const overscanBytes = overscanCount * bytesPerRowValue;

    renderStart = clamp(
      desiredStartByte - overscanBytes,
      windowStart,
      windowEnd
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
      Math.max(windowEnd - 1, windowStart)
    );

    const totalRowsNeeded = Math.max(viewportRowCount + overscanCount * 2, 1);
    const requiredLength = totalRowsNeeded * bytesPerRowValue;
    renderEnd = Math.min(windowEnd, renderStart + requiredLength);
  }

  if (renderEnd <= renderStart) {
    markup.value = "";
    renderStartRowRef.value = Math.floor(renderStart / bytesPerRowValue);
    clearHoverState();
    return;
  }

  const relativeStart = renderStart - windowStart;
  const relativeEnd = Math.min(
    data.length,
    relativeStart + (renderEnd - renderStart)
  );

  const slice = data.subarray(relativeStart, relativeEnd);
  renderStartRowRef.value = Math.floor(renderStart / bytesPerRowValue);

  const printableCheck = props.isPrintable ?? DEFAULT_PRINTABLE_CHECK;
  const asciiRenderer = props.renderAscii ?? DEFAULT_ASCII_RENDERER;

  const nextMarkup = buildHexTableMarkup(
    slice,
    bytesPerRowValue,
    Boolean(props.uppercase),
    fallbackAsciiChar.value,
    renderStart,
    printableCheck,
    asciiRenderer,
    props.cellClassForByte
  );

  if (markup.value !== nextMarkup) {
    clearHoverState();
    markup.value = nextMarkup;
  }
}

function normalizeSource(source: VueHexSource): Uint8Array {
  if (source instanceof Uint8Array) {
    return source;
  }

  if (Array.isArray(source)) {
    return Uint8Array.from(source, (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }

      const clamped = Math.min(255, Math.max(0, Math.trunc(numeric)));
      return clamped;
    });
  }

  return TEXT_ENCODER.encode(source);
}

function clampBytesPerRow(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 16;
  }

  const floored = Math.trunc(value);
  return Math.max(1, floored);
}

function resolveFallbackChar(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    const candidate = value.slice(0, 1);
    return escapeHtml(candidate);
  }

  return ".";
}

function escapeAsciiChar(value: string): string {
  return escapeHtml(value);
}

function escapeHtml(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    result += HTML_ESCAPE_LOOKUP[char] ?? char;
  }
  return result;
}

function formatOffsetPlain(value: number, uppercase: boolean): string {
  const raw = value.toString(16).padStart(OFFSET_PAD, "0");
  return uppercase ? raw.toUpperCase() : raw;
}

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

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeThemeKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}

function normalizeClassTokens(
  value: string | string[] | null | undefined
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

function buildHexTableMarkup(
  bytes: Uint8Array,
  bytesPerRow: number,
  uppercase: boolean,
  fallbackAscii: string,
  baseOffset: number,
  isPrintable: VueHexPrintableCheck,
  renderAscii: VueHexAsciiRenderer,
  resolveCellClass?: VueHexCellClassResolver
): string {
  if (bytes.length === 0) {
    return "";
  }

  const hexLookup = uppercase ? HEX_UPPER : HEX_LOWER;
  const asciiFallbackEscaped = fallbackAscii;
  const tableMarkup: string[] = [];
  const useColumnSplit = bytesPerRow % 2 === 0;
  const columnBreakIndex = useColumnSplit ? bytesPerRow / 2 : -1;

  const buildClassList = (
    base: string,
    columnIndex: number,
    payload: {
      kind: "hex" | "ascii";
      absoluteIndex: number;
      byteValue: number;
      isPlaceholder?: boolean;
      isNonPrintable?: boolean;
      resolver?: VueHexCellClassResolver;
    }
  ): string => {
    const classes: string[] = [base];
    if (useColumnSplit && columnIndex >= columnBreakIndex) {
      classes.push(`${base}--second-column`);
      if (columnIndex === columnBreakIndex) {
        classes.push(`${base}--column-start`);
      }
    }

    if (!payload.isPlaceholder) {
      classes.push(`${base}--value-${payload.byteValue}`);
    }

    if (payload.isPlaceholder) {
      classes.push(`${base}--placeholder`);
    }

    if (payload.kind === "ascii") {
      if (!payload.isPlaceholder) {
        if (payload.isNonPrintable) {
          classes.push("vuehex-ascii-char--non-printable");
        } else {
          classes.push("vuehex-ascii-char--printable");
        }
      }
    }

    if (payload.resolver && !payload.isPlaceholder) {
      const resolved = payload.resolver({
        kind: payload.kind,
        index: payload.absoluteIndex,
        byte: payload.byteValue,
      });
      if (resolved != null) {
        classes.push(...normalizeClassTokens(resolved));
      }
    }

    return escapeClassAttribute(classes);
  };

  for (let offset = 0; offset < bytes.length; offset += bytesPerRow) {
    const remaining = Math.min(bytesPerRow, bytes.length - offset);
    const rowOffset = baseOffset + offset;

    tableMarkup.push(
      `<tr role="row" data-row-offset="${rowOffset}"><th scope="row" class="vuehex-offset" role="rowheader">${formatOffset(
        rowOffset,
        uppercase
      )}</th><td class="vuehex-bytes" role="cell">`
    );

    for (let index = 0; index < remaining; index += 1) {
      const value = bytes[offset + index] ?? 0;
      const absoluteIndex = rowOffset + index;
      const className = buildClassList("vuehex-byte", index, {
        kind: "hex",
        absoluteIndex,
        byteValue: value,
        resolver: resolveCellClass,
      });
      tableMarkup.push(
        `<span class="${className}" data-hex-index="${absoluteIndex}" data-byte-value="${value}">${hexLookup[value]}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      const columnIndex = pad;
      const className = buildClassList("vuehex-byte", columnIndex, {
        kind: "hex",
        absoluteIndex: rowOffset + columnIndex,
        byteValue: 0,
        isPlaceholder: true,
      });
      tableMarkup.push(
        `<span class="${className}" aria-hidden="true">${PLACEHOLDER_HEX}</span>`
      );
    }

    tableMarkup.push('</td><td class="vuehex-ascii" role="cell">');

    for (let index = 0; index < remaining; index += 1) {
      const value = bytes[offset + index] ?? 0;
      const absoluteIndex = rowOffset + index;
      let asciiContent = asciiFallbackEscaped;
      let isNonPrintable = true;
      if (isPrintable(value)) {
        const rendered = renderAscii(value);
        const renderedString = rendered != null ? String(rendered) : "";
        if (renderedString.length > 0) {
          asciiContent = escapeAsciiChar(renderedString);
          isNonPrintable = false;
        }
      }
      const className = buildClassList("vuehex-ascii-char", index, {
        kind: "ascii",
        absoluteIndex,
        byteValue: value,
        isNonPrintable,
        resolver: resolveCellClass,
      });
      tableMarkup.push(
        `<span class="${className}" data-ascii-index="${absoluteIndex}" data-byte-value="${value}">${asciiContent}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      const columnIndex = pad;
      const className = buildClassList("vuehex-ascii-char", columnIndex, {
        kind: "ascii",
        absoluteIndex: rowOffset + columnIndex,
        byteValue: 0,
        isPlaceholder: true,
      });
      tableMarkup.push(
        `<span class="${className}" aria-hidden="true">${PLACEHOLDER_ASCII}</span>`
      );
    }

    tableMarkup.push("</td></tr>");
  }

  return tableMarkup.join("");
}
</script>
