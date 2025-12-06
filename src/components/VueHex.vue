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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import type {
  VueHexAsciiRenderer,
  VueHexCellClassResolver,
  VueHexDataBinding,
  VueHexPrintableCheck,
} from "./vuehex-api";
import { DEFAULT_ASCII_RENDERER, DEFAULT_PRINTABLE_CHECK } from "./vuehex-api";
import { useChunkNavigator } from "./composables/useChunkNavigator";
import { useHoverLinking } from "./composables/useHoverLinking";
import { useHexWindow } from "./composables/useHexWindow";
import {
  buildHexTableMarkup,
  clampBytesPerRow,
  normalizeThemeKey,
} from "./vuehex-utils";

const DEFAULT_ROW_HEIGHT = 24;
const MAX_VIRTUAL_HEIGHT = 8_000_000;

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

const rowHeight = ref<number | null>(null);
const containerHeight = ref(0);

const bytesPerRow = computed(() => clampBytesPerRow(props.bytesPerRow));
const rowHeightValue = computed(() => rowHeight.value ?? DEFAULT_ROW_HEIGHT);

const viewportRows = computed(() => {
  if (containerHeight.value <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(containerHeight.value / rowHeightValue.value));
});

const overscanRows = computed(() => Math.max(0, Math.trunc(props.overscan)));

const themeKey = computed(() => normalizeThemeKey(props.theme));
const containerClass = computed(() => {
  const classes = ["vuehex"];
  if (themeKey.value) {
    classes.push(`vuehex-theme-${themeKey.value}`);
  }
  return classes;
});
const tableClass = computed(() => ["vuehex-table"]);

const {
  chunkStartRow,
  chunkRowCount,
  chunkHeight,
  chunkCount,
  activeChunkIndex,
  shouldShowChunkNavigator,
  rootClass,
  chunkNavigatorClass,
  viewerClass,
  chunkItems,
  chunkButtonClass,
  moveToChunk,
  ensureChunkForRow,
  clampChunkStartToBounds,
} = useChunkNavigator({
  props,
  totalBytes,
  bytesPerRow,
  rowHeightValue,
  containerEl,
  maxVirtualHeight: MAX_VIRTUAL_HEIGHT,
});

const { handlePointerOver, handlePointerOut, clearHoverState } =
  useHoverLinking({
    emit: (event, payload) => emit(event as never, payload as never),
    tbodyEl,
  });

const {
  markup,
  renderStartRow,
  scheduleWindowEvaluation,
  handleScroll,
  scrollToByte,
  queueScrollToOffset,
  updateFromBindingWindow,
  measureRowHeight,
} = useHexWindow({
  containerEl,
  tbodyEl,
  bytesPerRow,
  rowHeight,
  rowHeightValue,
  containerHeight,
  viewportRows,
  overscanRows,
  chunkStartRow,
  chunkRowCount,
  totalBytes,
  ensureChunkForRow,
  clampChunkStartToBounds,
  buildHexTableMarkup,
  getBindingWindow: () => bindingWindow.value,
  getUppercase: () => Boolean(props.uppercase),
  getPrintableChecker: () => props.isPrintable ?? DEFAULT_PRINTABLE_CHECK,
  getAsciiRenderer: () => props.renderAscii ?? DEFAULT_ASCII_RENDERER,
  getCellClassResolver: () => props.cellClassForByte,
  getNonPrintableChar: () => props.nonPrintableChar ?? ".",
  requestWindow: (request) => props.binding.requestWindow(request),
  clearHoverState,
});

const tableOffset = computed(() => {
  const offsetRows = renderStartRow.value - chunkStartRow.value;
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

function handleChunkSelect(index: number) {
  if (!Number.isFinite(index)) {
    return;
  }
  moveToChunk(index);
  scheduleWindowEvaluation();
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
    updateFromBindingWindow();
  },
  { immediate: true }
);

watch([totalBytes, bytesPerRow, viewportRows, overscanRows], () => {
  clampChunkStartToBounds();
  scheduleWindowEvaluation();
});

let resizeObserver: ResizeObserver | null = null;

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
      measureRowHeight();
    });
    resizeObserver.observe(container);
  }

  const tbody = tbodyEl.value;
  if (tbody) {
    tbody.addEventListener("pointerover", handlePointerOver);
    tbody.addEventListener("pointerout", handlePointerOut);
  }

  queueScrollToOffset(bindingWindow.value.offset);
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

defineExpose({ scrollToByte });
</script>
