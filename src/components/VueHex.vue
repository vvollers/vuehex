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

export type VueHexSource = Uint8Array | number[] | string;

export interface VueHexWindow {
  offset: number;
  data: VueHexSource;
}

export interface VueHexWindowRequest {
  offset: number;
  length: number;
}

export interface VueHexDataBinding {
  window: VueHexWindow;
  totalBytes: number;
  requestWindow: (payload: VueHexWindowRequest) => void | Promise<void>;
}

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
  }>(),
  {
    bytesPerRow: 16,
    uppercase: false,
    nonPrintableChar: ".",
    overscan: 2,
  }
);

const emit = defineEmits<{
  (event: "row-hover", payload: { offset: number }): void;
  (event: "hex-hover", payload: { index: number; byte: number }): void;
  (event: "ascii-hover", payload: { index: number; byte: number }): void;
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
let lastRowHoverOffset: number | null = null;

watch(
  () => ({
    data: bindingWindow.value.data,
    offset: bindingWindow.value.offset,
    bytesPerRow: bytesPerRow.value,
    uppercase: props.uppercase,
    nonPrintableChar: props.nonPrintableChar,
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
});

function handleScroll() {
  scheduleWindowEvaluation();
}

function handlePointerOver(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const rowEl = target.closest<HTMLElement>("tr[data-row-offset]");
  if (rowEl?.dataset.rowOffset) {
    const offset = Number.parseInt(rowEl.dataset.rowOffset, 10);
    if (Number.isFinite(offset) && offset !== lastRowHoverOffset) {
      lastRowHoverOffset = offset;
      emit("row-hover", { offset });
    }
  }

  const hexEl = target.closest<HTMLElement>("span[data-hex-index]");
  if (hexEl?.dataset.hexIndex && hexEl.dataset.byteValue) {
    const index = Number.parseInt(hexEl.dataset.hexIndex, 10);
    const byte = Number.parseInt(hexEl.dataset.byteValue, 10);
    if (Number.isFinite(index) && Number.isFinite(byte)) {
      emit("hex-hover", { index, byte });
    }
  }

  const asciiEl = target.closest<HTMLElement>("span[data-ascii-index]");
  if (asciiEl?.dataset.asciiIndex && asciiEl.dataset.byteValue) {
    const index = Number.parseInt(asciiEl.dataset.asciiIndex, 10);
    const byte = Number.parseInt(asciiEl.dataset.byteValue, 10);
    if (Number.isFinite(index) && Number.isFinite(byte)) {
      emit("ascii-hover", { index, byte });
    }
  }
}

function handlePointerOut(event: PointerEvent) {
  const currentTarget = event.currentTarget;
  if (!(currentTarget instanceof HTMLElement)) {
    return;
  }

  const nextTarget = event.relatedTarget;
  if (
    !(nextTarget instanceof HTMLElement) ||
    !currentTarget.contains(nextTarget)
  ) {
    lastRowHoverOffset = null;
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

  markup.value = buildHexTableMarkup(
    slice,
    bytesPerRowValue,
    Boolean(props.uppercase),
    fallbackAsciiChar.value,
    renderStart
  );
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
    return HTML_ESCAPE_LOOKUP[candidate] ?? candidate;
  }

  return ".";
}

function escapeAsciiChar(value: string): string {
  return HTML_ESCAPE_LOOKUP[value] ?? value;
}

function formatOffset(value: number, uppercase: boolean): string {
  const raw = value.toString(16).padStart(OFFSET_PAD, "0");
  return uppercase ? raw.toUpperCase() : raw;
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
  baseOffset: number
): string {
  if (bytes.length === 0) {
    return "";
  }

  const hexLookup = uppercase ? HEX_UPPER : HEX_LOWER;
  const asciiFallbackEscaped = escapeAsciiChar(fallbackAscii);
  const tableMarkup: string[] = [];

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
      tableMarkup.push(
        `<span class="vuehex-byte" data-hex-index="${absoluteIndex}" data-byte-value="${value}">${hexLookup[value]}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      tableMarkup.push(
        `<span class="vuehex-byte vuehex-byte--placeholder" aria-hidden="true">${PLACEHOLDER_HEX}</span>`
      );
    }

    tableMarkup.push('</td><td class="vuehex-ascii" role="cell">');

    for (let index = 0; index < remaining; index += 1) {
      const value = bytes[offset + index] ?? 0;
      const absoluteIndex = rowOffset + index;
      const char =
        value >= 0x20 && value <= 0x7e
          ? escapeAsciiChar(String.fromCharCode(value))
          : asciiFallbackEscaped;
      tableMarkup.push(
        `<span class="vuehex-ascii-char" data-ascii-index="${absoluteIndex}" data-byte-value="${value}">${char}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      tableMarkup.push(
        `<span class="vuehex-ascii-char vuehex-byte--placeholder" aria-hidden="true">${PLACEHOLDER_ASCII}</span>`
      );
    }

    tableMarkup.push("</td></tr>");
  }

  return tableMarkup.join("");
}
</script>
