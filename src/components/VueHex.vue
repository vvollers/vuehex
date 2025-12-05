<template>
  <div
    ref="containerEl"
    class="vuehex"
    role="table"
    aria-label="Hex viewer"
    @scroll="handleScroll"
  >
    <div
      class="vuehex-spacer"
      role="presentation"
      aria-hidden="true"
      :style="beforeSpacerStyle"
    ></div>
    <table class="vuehex-table" role="presentation">
      <tbody ref="tbodyEl" v-html="markup"></tbody>
    </table>
    <div
      class="vuehex-spacer"
      role="presentation"
      aria-hidden="true"
      :style="afterSpacerStyle"
    ></div>
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
import type {
  VueHexAsciiRenderer,
  VueHexDataBinding,
  VueHexPrintableCheck,
  VueHexSource,
  VueHexWindowRequest,
} from "./vuehex-api";
import { DEFAULT_ASCII_RENDERER, DEFAULT_PRINTABLE_CHECK } from "./vuehex-api";

const DEFAULT_ROW_HEIGHT = 24;

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
  }>(),
  {
    bytesPerRow: 16,
    uppercase: false,
    nonPrintableChar: ".",
    overscan: 2,
    isPrintable: DEFAULT_PRINTABLE_CHECK,
    renderAscii: DEFAULT_ASCII_RENDERER,
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
const renderedSliceRows = ref(0);

const rowHeight = ref<number | null>(null);
const containerHeight = ref(0);
const pendingScrollByte = ref<number | null>(null);
const pendingScrollCheck = ref(false);

const bytesPerRow = computed(() => clampBytesPerRow(props.bytesPerRow));
const rowHeightValue = computed(() => rowHeight.value ?? DEFAULT_ROW_HEIGHT);

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

const beforeHeight = computed(
  () => renderStartRowRef.value * rowHeightValue.value
);

const afterHeight = computed(() => {
  const remainingRows = Math.max(
    totalRows.value - (renderStartRowRef.value + renderedSliceRows.value),
    0
  );
  return remainingRows * rowHeightValue.value;
});

const viewportRows = computed(() => {
  if (containerHeight.value <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(containerHeight.value / rowHeightValue.value));
});

const beforeSpacerStyle = computed(() => ({
  height: `${beforeHeight.value}px`,
}));
const afterSpacerStyle = computed(() => ({ height: `${afterHeight.value}px` }));

const overscanRows = computed(() => Math.max(0, Math.trunc(props.overscan)));

const lastRequested = shallowRef<VueHexWindowRequest | null>(null);

let resizeObserver: ResizeObserver | null = null;
let activeRowOffset: number | null = null;
let activeHex: { index: number; byte: number } | null = null;
let activeAscii: { index: number; byte: number } | null = null;

watch(
  () => ({
    data: bindingWindow.value.data,
    offset: bindingWindow.value.offset,
    bytesPerRow: bytesPerRow.value,
    uppercase: props.uppercase,
    nonPrintableChar: props.nonPrintableChar,
    isPrintable: props.isPrintable,
    renderAscii: props.renderAscii,
  }),
  () => {
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
  () => scheduleWindowEvaluation()
);
watch(bytesPerRow, () => scheduleWindowEvaluation());
watch(viewportRows, () => scheduleWindowEvaluation());

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

  const overscan = overscanRows.value;

  const scrollTop = container.scrollTop;
  const visibleStartRow = Math.floor(scrollTop / rowHeightValue.value);
  const visibleEndRow = visibleStartRow + viewportRows.value;

  const windowStart = startRow.value;
  const windowEnd = windowStart + renderedRows.value;

  const needsBefore = visibleStartRow < windowStart + overscan;
  const needsAfter = visibleEndRow > windowEnd - overscan;

  if (!needsBefore && !needsAfter) {
    return;
  }

  const desiredStartRow = Math.max(0, visibleStartRow - overscan);
  const desiredOffset = desiredStartRow * bytesPerRow.value;

  const desiredRows = Math.max(
    viewportRows.value + overscan * 2,
    renderedRows.value || 1
  );
  const maxPossible = Math.max(props.binding.totalBytes - desiredOffset, 0);
  const desiredLength = Math.min(maxPossible, desiredRows * bytesPerRow.value);

  if (desiredLength <= 0) {
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
  container.scrollTop = targetRow * rowHeightValue.value;
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
  container.scrollTop = targetRow * rowHeightValue.value;
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
    renderedSliceRows.value = 0;
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
    const topRow = Math.floor(scrollTop / rowHeightValue.value);
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
    renderedSliceRows.value = 0;
    clearHoverState();
    return;
  }

  const relativeStart = renderStart - windowStart;
  const relativeEnd = Math.min(
    data.length,
    relativeStart + (renderEnd - renderStart)
  );

  const slice = data.subarray(relativeStart, relativeEnd);
  const renderedLength = relativeEnd - relativeStart;
  const sliceRowCount = Math.max(
    1,
    Math.ceil(renderedLength / bytesPerRowValue)
  );
  renderStartRowRef.value = Math.floor(renderStart / bytesPerRowValue);
  renderedSliceRows.value = sliceRowCount;

  const printableCheck = props.isPrintable ?? DEFAULT_PRINTABLE_CHECK;
  const asciiRenderer = props.renderAscii ?? DEFAULT_ASCII_RENDERER;

  const nextMarkup = buildHexTableMarkup(
    slice,
    bytesPerRowValue,
    Boolean(props.uppercase),
    fallbackAsciiChar.value,
    renderStart,
    printableCheck,
    asciiRenderer
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

function buildHexTableMarkup(
  bytes: Uint8Array,
  bytesPerRow: number,
  uppercase: boolean,
  fallbackAscii: string,
  baseOffset: number,
  isPrintable: VueHexPrintableCheck,
  renderAscii: VueHexAsciiRenderer
): string {
  if (bytes.length === 0) {
    return "";
  }

  const hexLookup = uppercase ? HEX_UPPER : HEX_LOWER;
  const asciiFallbackEscaped = fallbackAscii;
  const tableMarkup: string[] = [];
  const useColumnSplit = bytesPerRow % 2 === 0;
  const columnBreakIndex = useColumnSplit ? bytesPerRow / 2 : -1;

  const composeCellClass = (
    base: string,
    columnIndex: number,
    extra: string[] = []
  ) => {
    const classes = [base, ...extra];
    if (useColumnSplit && columnIndex >= columnBreakIndex) {
      classes.push(`${base}--second-column`);
      if (columnIndex === columnBreakIndex) {
        classes.push(`${base}--column-start`);
      }
    }
    return classes.join(" ");
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
      const className = composeCellClass("vuehex-byte", index);
      tableMarkup.push(
        `<span class="${className}" data-hex-index="${absoluteIndex}" data-byte-value="${value}">${hexLookup[value]}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      const columnIndex = pad;
      const className = composeCellClass("vuehex-byte", columnIndex, [
        "vuehex-byte--placeholder",
      ]);
      tableMarkup.push(
        `<span class="${className}" aria-hidden="true">${PLACEHOLDER_HEX}</span>`
      );
    }

    tableMarkup.push('</td><td class="vuehex-ascii" role="cell">');

    for (let index = 0; index < remaining; index += 1) {
      const value = bytes[offset + index] ?? 0;
      const absoluteIndex = rowOffset + index;
      let asciiContent = asciiFallbackEscaped;
      if (isPrintable(value)) {
        const rendered = renderAscii(value);
        const renderedString = rendered != null ? String(rendered) : "";
        if (renderedString.length > 0) {
          asciiContent = escapeAsciiChar(renderedString);
        }
      }
      const className = composeCellClass("vuehex-ascii-char", index);
      tableMarkup.push(
        `<span class="${className}" data-ascii-index="${absoluteIndex}" data-byte-value="${value}">${asciiContent}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      const columnIndex = pad;
      const className = composeCellClass("vuehex-ascii-char", columnIndex, [
        "vuehex-byte--placeholder",
      ]);
      tableMarkup.push(
        `<span class="${className}" aria-hidden="true">${PLACEHOLDER_ASCII}</span>`
      );
    }

    tableMarkup.push("</td></tr>");
  }

  return tableMarkup.join("");
}
</script>
