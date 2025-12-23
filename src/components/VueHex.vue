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
import type { CSSProperties } from "vue";
import {
	computed,
	getCurrentInstance,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import { useChunkNavigator } from "./composables/useChunkNavigator";
import { useHexWindow } from "./composables/useHexWindow";
import { useHoverLinking } from "./composables/useHoverLinking";
import type {
	VueHexAsciiRenderer,
	VueHexCellClassResolver,
	VueHexPrintableCheck,
	VueHexWindowRequest,
} from "./vuehex-api";
import { DEFAULT_ASCII_RENDERER, DEFAULT_PRINTABLE_CHECK } from "./vuehex-api";
import {
	buildHexTableMarkup,
	clampBytesPerRow,
	normalizeThemeKey,
} from "./vuehex-utils";

/** Fallback row height used until the DOM is measured. */
const DEFAULT_ROW_HEIGHT = 24;
/** Maximum height allowed before chunking kicks in to avoid huge scroll containers. */
const MAX_VIRTUAL_HEIGHT = 8_000_000;

interface VueHexProps {
	/** v-model binding containing the currently visible window bytes. */
	modelValue: Uint8Array;
	/** Absolute offset that the provided window data represents. */
	windowOffset?: number;
	/** Total bytes available in the backing source; defaults to modelValue length. */
	totalSize?: number;
	/** Controls how many bytes render per table row; consumers tune readability. */
	bytesPerRow?: number;
	/** When true, renders hexadecimal digits in uppercase for stylistic preference. */
	uppercase?: boolean;
	/** Substitute character used for non-printable bytes in the ASCII pane. */
	nonPrintableChar?: string;
	/** Number of rows to pre-render above/below the viewport to reduce flicker. */
	overscan?: number;
	/** Optional custom printable check letting consumers broaden the ASCII range. */
	isPrintable?: VueHexPrintableCheck;
	/** Optional renderer for printable ASCII cells so callers can supply glyphs. */
	renderAscii?: VueHexAsciiRenderer;
	/** Theme token appended to classes, enabling consumer-provided styling. */
	theme?: string | null;
	/** Hook for assigning classes per cell, useful for highlighting bytes of interest. */
	cellClassForByte?: VueHexCellClassResolver;
	/** Toggles the chunk navigator UI, allowing quick jumps through large files. */
	showChunkNavigator?: boolean;
	/** Places the chunk navigator around the viewer to fit various layouts. */
	chunkNavigatorPlacement?: "left" | "right" | "top" | "bottom";
}

const props = withDefaults(defineProps<VueHexProps>(), {
	modelValue: () => new Uint8Array(0),
	windowOffset: 0,
	bytesPerRow: 16,
	uppercase: false,
	nonPrintableChar: ".",
	overscan: 2,
	isPrintable: DEFAULT_PRINTABLE_CHECK,
	renderAscii: DEFAULT_ASCII_RENDERER,
	theme: "default",
	showChunkNavigator: false,
	chunkNavigatorPlacement: "right",
});

const emit = defineEmits<{
	(event: "update:modelValue", value: Uint8Array): void;
	(event: "updateVirtualData", payload: VueHexWindowRequest): void;
	(event: "row-hover-on", payload: { offset: number }): void;
	(event: "row-hover-off", payload: { offset: number }): void;
	(event: "hex-hover-on", payload: { index: number; byte: number }): void;
	(event: "hex-hover-off", payload: { index: number; byte: number }): void;
	(event: "ascii-hover-on", payload: { index: number; byte: number }): void;
	(event: "ascii-hover-off", payload: { index: number; byte: number }): void;
}>();

/** Normalized window offset used for table alignment. */
const normalizedWindowOffset = computed(() =>
	Math.max(0, Math.trunc(props.windowOffset ?? 0)),
);
/** Provides easy access to the currently supplied window data. */
const bindingWindow = computed(() => ({
	offset: normalizedWindowOffset.value,
	data: props.modelValue ?? new Uint8Array(0),
}));
/** Total bytes in the backing data; feeds navigation decisions. */
const totalBytes = computed(() => {
	const provided = props.totalSize;
	if (typeof provided === "number" && Number.isFinite(provided)) {
		return Math.max(0, Math.trunc(provided));
	}
	return bindingWindow.value.data.length;
});

const instance = getCurrentInstance();
const hasUpdateVirtualDataListener = computed(() => {
	const vnodeProps = instance?.vnode.props as
		| Record<string, unknown>
		| undefined;
	const handler = vnodeProps?.["onUpdateVirtualData"];
	if (Array.isArray(handler)) {
		return handler.length > 0;
	}
	return Boolean(handler);
});

const expectsExternalData = computed(() => {
	const windowInfo = bindingWindow.value;
	if (windowInfo.offset > 0) {
		return true;
	}
	const providedTotal = props.totalSize;
	if (
		typeof providedTotal === "number" &&
		Number.isFinite(providedTotal) &&
		providedTotal > windowInfo.data.length
	) {
		return true;
	}
	return hasUpdateVirtualDataListener.value;
});

const isSelfManagedData = computed(() => !expectsExternalData.value);
const shouldRequestVirtualData = computed(() => !isSelfManagedData.value);
const effectiveMaxVirtualHeight = computed(() =>
	isSelfManagedData.value ? Number.POSITIVE_INFINITY : MAX_VIRTUAL_HEIGHT,
);

/** Scroll container ref for virtualization math. */
const containerEl = ref<HTMLDivElement>();
/** Table body ref so hover logic can traverse DOM nodes. */
const tbodyEl = ref<HTMLTableSectionElement>();

/** Measured row height in pixels; set once rows render. */
const rowHeight = ref<number | null>(null);
/** Current viewport height of the container, updated on resize. */
const containerHeight = ref(0);

/** Normalized bytes-per-row value to keep layout stable. */
const bytesPerRow = computed(() => clampBytesPerRow(props.bytesPerRow));
/** Row height fallback that always returns a number. */
const rowHeightValue = computed(() => rowHeight.value ?? DEFAULT_ROW_HEIGHT);

/** Number of rows visible in the viewport, guiding overscan math. */
const viewportRows = computed(() => {
	if (containerHeight.value <= 0) {
		return 0;
	}
	return Math.max(1, Math.ceil(containerHeight.value / rowHeightValue.value));
});

/** Amount of overscan rows to render, sanitized for downstream calculations. */
const overscanRows = computed(() => Math.max(0, Math.trunc(props.overscan)));

/** Normalized theme key derived from the consumer-specified string. */
const themeKey = computed(() => normalizeThemeKey(props.theme));
/** Classes applied to the scroll container, including theme modifiers. */
const containerClass = computed(() => {
	const classes = ["vuehex"];
	if (themeKey.value) {
		classes.push(`vuehex-theme-${themeKey.value}`);
	}
	return classes;
});
/** Static class list for the table element. */
const tableClass = computed(() => ["vuehex-table"]);

/** Chunk navigation helpers that keep oversized datasets scrollable. */
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
	maxVirtualHeight: effectiveMaxVirtualHeight,
});

/** Hover coordination utilities that emit events and apply linked highlights. */
const { handlePointerOver, handlePointerOut, clearHoverState } =
	useHoverLinking({
		emit: (event, payload) => emit(event as never, payload as never),
		tbodyEl,
	});

/** Virtual window utilities that coordinate data requests and markup rendering. */
const {
	markup,
	renderStartRow,
	scheduleWindowEvaluation,
	handleScroll,
	scrollToByte,
	queueScrollToOffset,
	updateFromWindowState,
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
	getWindowState: () => bindingWindow.value,
	getUppercase: () => Boolean(props.uppercase),
	getPrintableChecker: () => props.isPrintable ?? DEFAULT_PRINTABLE_CHECK,
	getAsciiRenderer: () => props.renderAscii ?? DEFAULT_ASCII_RENDERER,
	getCellClassResolver: () => props.cellClassForByte,
	getNonPrintableChar: () => props.nonPrintableChar ?? ".",
	requestWindow: (request) => {
		if (!shouldRequestVirtualData.value) {
			return;
		}
		emit("updateVirtualData", request);
	},
	clearHoverState,
});

/** Pixel offset applied to translate the table to the rendered slice. */
const tableOffset = computed(() => {
	const offsetRows = renderStartRow.value - chunkStartRow.value;
	const offset = offsetRows * rowHeightValue.value;
	return Math.max(offset, 0);
});

/** Inline styles for the inner wrapper sizing the virtualized content area. */
const innerStyle = computed<CSSProperties>(() => ({
	position: "relative",
	width: "100%",
	height: `${Math.max(chunkHeight.value, 0)}px`,
}));

/** Table styles that apply translation and positioning within the inner wrapper. */
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

/** Responds to navigator button clicks by moving to the chosen chunk. */
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
		updateFromWindowState();
	},
	{ immediate: true },
);

watch([totalBytes, bytesPerRow, viewportRows, overscanRows], () => {
	clampChunkStartToBounds();
	scheduleWindowEvaluation();
});

watch(
	() => effectiveMaxVirtualHeight.value,
	() => {
		clampChunkStartToBounds();
		scheduleWindowEvaluation();
	},
);

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
