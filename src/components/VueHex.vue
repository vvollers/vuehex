<template>
	<VueHexChunkNavigator
		:show="props.showChunkNavigator"
		:placement="props.chunkNavigatorPlacement"
		:chunks="chunkItems"
		:active-index="activeChunkIndex"
		:root-class-extra="rootClassExtra"
		:viewer-class-extra="viewerClassExtra"
		:expand-to-content="isExpandToContent"
		@select="handleChunkSelect"
	>
			<VueHexStatusBar
				v-if="showStatusBar"
				ref="statusBarRef"
				:placement="statusBarPlacement"
				:layout="props.statusbarLayout"
				:uppercase="props.uppercase"
				:is-printable="props.isPrintable"
				:render-ascii="props.renderAscii"
				:non-printable-char="props.nonPrintableChar"
				:selection-range="selectionRange"
				:selection-count="selectionCount"
			>
				<template #statusbar-left>
					<slot name="statusbar-left" />
				</template>
				<template #statusbar-middle>
					<slot name="statusbar-middle" />
				</template>
				<template #statusbar-right>
					<slot name="statusbar-right" />
				</template>
			</VueHexStatusBar>
      <div
        ref="containerEl"
        :class="containerClass"
        role="table"
        aria-label="Hex viewer"
		:aria-disabled="isInteractive ? undefined : 'true'"
		:tabindex="isInteractive ? 0 : undefined"
        @scroll="handleScroll"
      >
        <div class="vuehex-inner" :style="innerStyle" role="presentation">
          <table :class="tableClass" :style="tableStyle" role="presentation">
            <tbody ref="tbodyEl" v-html="markup"></tbody>
          </table>
        </div>
      </div>
	</VueHexChunkNavigator>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useChunking } from "./composables/useChunking";
import { useCursor } from "./composables/useCursor";
import { useDataMode } from "./composables/useDataMode";
import { useHexWindow } from "./composables/useHexWindow";
import { useHoverLinking } from "./composables/useHoverLinking";
import { useSelection } from "./composables/useSelection";
import VueHexChunkNavigator from "./VueHexChunkNavigator.vue";
import VueHexStatusBar from "./VueHexStatusBar.vue";
import type {
	VueHexAsciiRenderer,
	VueHexCellClassResolver,
	VueHexCellClassResolverInput,
	VueHexPrintableCheck,
	VueHexStatusBarLayout,
	VueHexWindowRequest,
} from "./vuehex-api";
import {
	DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER,
	DEFAULT_ASCII_RENDERER,
	DEFAULT_PRINTABLE_CHECK,
} from "./vuehex-api";
import {
	buildHexTableMarkup,
	clampBytesPerRow,
	normalizeThemeKey,
} from "./vuehex-utils";

/** Fallback row height used until the DOM is measured. */
const DEFAULT_ROW_HEIGHT = 24;
/** Maximum height allowed before chunking kicks in to avoid huge scroll containers. */
const MAX_VIRTUAL_HEIGHT = 8_000_000;

/**
 * VueHex - A performant, virtualized hex editor component for Vue 3.
 *
 * Supports three data modes:
 * - `buffer`: Full dataset in `v-model` (no windowing)
 * - `window`: Partial dataset in `v-model`, emits `updateVirtualData` for more
 * - `auto`: Infers mode from `windowOffset` and `totalSize` props
 *
 * @example
 * ```vue
 * <VueHex
 *   v-model="bytes"
 *   :total-size="fileSize"
 *   data-mode="window"
 *   @update-virtual-data="loadWindow"
 * />
 * ```
 */
interface VueHexProps {
	/** v-model binding containing the currently visible window bytes. */
	modelValue: Uint8Array;
	/**
	 * Controls whether VueHex treats `v-model` as the full buffer or as a virtual window.
	 *
	 * - `auto` (default): infer based on `windowOffset` / `totalSize` vs `modelValue.length`.
	 * - `buffer`: `v-model` is the entire dataset (no window requests).
	 * - `window`: `v-model` is a slice; VueHex may emit `updateVirtualData`.
	 */
	dataMode?: "auto" | "buffer" | "window";
	/**
	 * When true, disables internal scrolling/virtualization and expands the component height
	 * to fit the entire dataset.
	 *
	 * In this mode, VueHex expects the full data buffer in `v-model` (windowing is not used).
	 */
	expandToContent?: boolean;
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
	/**
	 * Hook for assigning classes per cell, useful for highlighting bytes of interest.
	 *
	 * Pass an array to layer multiple resolvers; results are merged in order.
	 *
	 * When omitted/undefined, VueHex applies the built-in ASCII category highlighting.
	 * To disable all highlighting, pass null.
	 */
	cellClassForByte?: VueHexCellClassResolverInput | null;
	/**
	 * Optional selection provider used for clipboard copy.
	 * Should return the raw bytes between selectionStart and selectionEnd (inclusive).
	 */
	getSelectionData?: import("./vuehex-api").VueHexSelectionDataProvider;
	/** Toggles the chunk navigator UI, allowing quick jumps through large files. */
	showChunkNavigator?: boolean;
	/** Places the chunk navigator around the viewer to fit various layouts. */
	chunkNavigatorPlacement?: "left" | "right" | "top" | "bottom";
	/**
	 * Optional status bar placement.
	 *
	 * When set to "top" or "bottom", the status bar is shown.
	 * When omitted/null, the status bar is hidden.
	 */
	statusbar?: "top" | "bottom" | null;
	/** When true, enables keyboard/click cursor navigation and rendering. */
	cursor?: boolean;
	/** Optional controlled cursor location (absolute byte index). */
	cursorLocation?: number | null;
	/**
	 * Configures which items appear in the status bar and where they render.
	 *
	 * The status bar is split into three sections: left, middle, right.
	 */
	statusbarLayout?: VueHexStatusBarLayout | null;
}

const props = withDefaults(defineProps<VueHexProps>(), {
	modelValue: () => new Uint8Array(0),
	dataMode: "auto",
	expandToContent: false,
	windowOffset: 0,
	bytesPerRow: 16,
	uppercase: false,
	nonPrintableChar: ".",
	overscan: 2,
	isPrintable: DEFAULT_PRINTABLE_CHECK,
	renderAscii: DEFAULT_ASCII_RENDERER,
	showChunkNavigator: false,
	chunkNavigatorPlacement: "right",
	statusbar: null,
	cursor: false,
	statusbarLayout: null,
});

const emit = defineEmits<{
	(event: "update:modelValue", value: Uint8Array): void;
	(event: "updateVirtualData", payload: VueHexWindowRequest): void;
	(event: "update:cursorLocation", value: number | null): void;
	(event: "cursor-change", payload: { index: number | null }): void;
	(
		event: "byte-click",
		payload: { index: number; byte: number; kind: "hex" | "ascii" },
	): void;
	(
		event: "selection-change",
		payload: { start: number | null; end: number | null; length: number },
	): void;
	(event: "row-hover-on", payload: { offset: number }): void;
	(event: "row-hover-off", payload: { offset: number }): void;
	(event: "hex-hover-on", payload: { index: number; byte: number }): void;
	(event: "hex-hover-off", payload: { index: number; byte: number }): void;
	(event: "ascii-hover-on", payload: { index: number; byte: number }): void;
	(event: "ascii-hover-off", payload: { index: number; byte: number }): void;
}>();

const isExpandToContent = computed(() => Boolean(props.expandToContent));

/** Normalized window offset used for table alignment. */
const normalizedWindowOffset = computed(() => {
	if (isExpandToContent.value) {
		return 0;
	}
	return Math.max(0, Math.trunc(props.windowOffset ?? 0));
});
/** Provides easy access to the currently supplied window data. */
const currentWindow = computed(() => ({
	offset: normalizedWindowOffset.value,
	data: props.modelValue ?? new Uint8Array(0),
}));
/** Total bytes in the backing data; feeds navigation decisions. */
const totalBytes = computed(() => {
	if (isExpandToContent.value) {
		return currentWindow.value.data.length;
	}
	const provided = props.totalSize;
	if (typeof provided === "number" && Number.isFinite(provided)) {
		return Math.max(0, Math.trunc(provided));
	}
	return currentWindow.value.data.length;
});

const { isWindowed, isSelfManaged } = useDataMode({
	dataMode: toRef(props, "dataMode"),
	isExpandToContent,
	windowOffset: normalizedWindowOffset,
	totalSize: toRef(props, "totalSize"),
	dataLength: computed(() => currentWindow.value.data.length),
});

const shouldRequestVirtualData = computed(() => isWindowed.value);

const uppercase = computed(() => Boolean(props.uppercase));
const printableCheck = computed(
	() => props.isPrintable ?? DEFAULT_PRINTABLE_CHECK,
);
const asciiRenderer = computed(
	() => props.renderAscii ?? DEFAULT_ASCII_RENDERER,
);
const nonPrintableChar = computed(() => props.nonPrintableChar ?? ".");

const effectiveMaxVirtualHeight = computed(() => {
	if (isExpandToContent.value) {
		return Number.POSITIVE_INFINITY;
	}
	return MAX_VIRTUAL_HEIGHT;
});

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
	if (isExpandToContent.value) {
		return 0;
	}
	if (containerHeight.value <= 0) {
		return 0;
	}
	return Math.max(1, Math.ceil(containerHeight.value / rowHeightValue.value));
});

/** Amount of overscan rows to render, sanitized for downstream calculations. */
const overscanRows = computed(() => Math.max(0, Math.trunc(props.overscan)));

/** Normalized theme key derived from the consumer-specified string. */
const themeKey = computed(() => {
	const normalized = normalizeThemeKey(props.theme);
	if (!normalized) {
		return null;
	}

	if (
		[
			"default",
			"deep-space",
			"deep_space",
			"deepspace",
			"dark-mode",
			"darkmode",
		].includes(normalized)
	) {
		return "dark";
	}

	if (["light", "daylight", "light-mode", "lightmode"].includes(normalized)) {
		return "light";
	}

	return normalized;
});

const themeClass = computed(() => {
	const normalized = themeKey.value;
	if (!normalized || normalized === "auto") {
		return ["vuehex-theme-auto"];
	}
	return [`vuehex-theme-${normalized}`];
});
/** Classes applied to the scroll container, including theme modifiers. */
const containerClass = computed(() => {
	const classes = ["vuehex"];
	classes.push(...themeClass.value);
	if (isExpandToContent.value) {
		classes.push("vuehex--expand-to-content");
	}
	if (!selectionEnabled.value) {
		classes.push("vuehex-selection-disabled");
	}
	return classes;
});
/** Static class list for the table element. */
const tableClass = computed(() => ["vuehex-table"]);

const {
	chunkStartRow,
	activeChunkIndex,
	chunkRowCount,
	chunkHeight,
	chunkItems,
	clampChunkStartToBounds,
	ensureChunkForRow,
	selectChunk,
} = useChunking({
	showNavigator: computed(() => Boolean(props.showChunkNavigator)),
	totalBytes,
	bytesPerRow,
	rowHeightValue,
	maxVirtualHeight: effectiveMaxVirtualHeight,
	uppercase,
});

const rootClassExtra = computed(() => [...themeClass.value]);

const showStatusBar = computed(
	() => props.statusbar === "top" || props.statusbar === "bottom",
);

const statusBarPlacement = computed(() =>
	props.statusbar === "top" ? "top" : "bottom",
);

const viewerClassExtra = computed(() => {
	const classes: string[] = [];
	if (showStatusBar.value) {
		classes.push("vuehex-viewer--with-statusbar");
		classes.push(
			statusBarPlacement.value === "top"
				? "vuehex-viewer--statusbar-top"
				: "vuehex-viewer--statusbar-bottom",
		);
	}
	return classes;
});

type VueHexStatusBarHandle = {
	handleHoverEvent: (event: string, payload: unknown) => void;
};

const statusBarRef = ref<VueHexStatusBarHandle | null>(null);

const { handlePointerOver, handlePointerOut, clearHoverState } =
	useHoverLinking({
		emit: (event, payload) => {
			statusBarRef.value?.handleHoverEvent(event, payload);
			emit(event as never, payload as never);
		},
		tbodyEl,
	});

const cellClassResolver = computed<VueHexCellClassResolver | undefined>(() => {
	const input = props.cellClassForByte;
	if (input === undefined) {
		return DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER;
	}
	if (input === null) {
		return undefined;
	}
	if (typeof input === "function") {
		return input;
	}
	if (Array.isArray(input)) {
		const resolvers = input.filter(
			(resolver): resolver is VueHexCellClassResolver =>
				typeof resolver === "function",
		);
		if (resolvers.length === 0) {
			return undefined;
		}
		return (payload) => {
			const merged: Array<string | string[]> = [];
			for (const resolver of resolvers) {
				const resolved = resolver(payload);
				if (resolved == null) {
					continue;
				}
				merged.push(resolved);
			}
			if (merged.length === 0) {
				return undefined;
			}
			return merged.flat();
		};
	}

	return undefined;
});

/** Virtual window utilities that coordinate data requests and markup rendering. */
const {
	markup,
	renderStartRow,
	scheduleWindowEvaluation,
	handleScroll: handleVirtualScroll,
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
	viewportRows,
	overscanRows,
	chunkStartRow,
	chunkRowCount,
	totalBytes,
	ensureChunkForRow,
	clampChunkStartToBounds,
	buildHexTableMarkup,
	getWindowState: () => currentWindow.value,
	getUppercase: () => uppercase.value,
	getPrintableChecker: () => printableCheck.value,
	getAsciiRenderer: () => asciiRenderer.value,
	getCellClassResolver: () => cellClassResolver.value,
	getNonPrintableChar: () => nonPrintableChar.value,
	requestWindow: (request) => {
		if (!shouldRequestVirtualData.value) {
			return;
		}
		emit("updateVirtualData", request);
	},
	clearHoverState,
});

const { selectionEnabled, selectionRange, selectionCount } = useSelection({
	containerEl,
	tbodyEl,
	markup,
	getSelectionDataProp: () => props.getSelectionData,
	isSelfManagedData: isSelfManaged,
	totalBytes,
	getSelfManagedBytes: () => currentWindow.value.data,
	getUppercase: () => uppercase.value,
	getPrintableChecker: () => printableCheck.value,
	getAsciiRenderer: () => asciiRenderer.value,
	getNonPrintableChar: () => nonPrintableChar.value,
	emitByteClick: (payload) => emit("byte-click", payload),
	emitSelectionChange: (payload) => emit("selection-change", payload),
});

const cursorEnabled = computed(() => Boolean(props.cursor));

useCursor({
	enabled: cursorEnabled,
	isExpandToContent,
	containerEl,
	tbodyEl,
	markup,
	totalBytes,
	bytesPerRow,
	rowHeightValue,
	viewportRows,
	chunkStartRow,
	ensureChunkForRow,
	scheduleWindowEvaluation,
	getCursorLocationProp: () => props.cursorLocation,
	emitCursorLocationUpdate: (value) => emit("update:cursorLocation", value),
	emitCursorChange: (payload) => emit("cursor-change", payload),
	scrollToByte,
});

const isInteractive = computed(
	() => selectionEnabled.value || cursorEnabled.value,
);

function handleScroll() {
	if (isExpandToContent.value) {
		return;
	}
	handleVirtualScroll();
}

/** Pixel offset applied to translate the table to the rendered slice. */
const tableOffset = computed(() => {
	if (isExpandToContent.value) {
		return 0;
	}
	const offsetRows = renderStartRow.value - chunkStartRow.value;
	const offset = offsetRows * rowHeightValue.value;
	return Math.max(offset, 0);
});

/** Inline styles for the inner wrapper sizing the virtualized content area. */
const innerStyle = computed<CSSProperties>(() => ({
	position: "relative",
	width: "100%",
	...(isExpandToContent.value
		? {}
		: { height: `${Math.max(chunkHeight.value, 0)}px` }),
}));

/** Table styles that apply translation and positioning within the inner wrapper. */
const tableStyle = computed<CSSProperties>(() => {
	if (isExpandToContent.value) {
		return {
			position: "static",
			width: "100%",
			transform: "none",
		};
	}
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
	if (!selectChunk(index)) {
		return;
	}
	const container = containerEl.value;
	if (container) {
		container.scrollTop = 0;
	}
	scheduleWindowEvaluation();
}

watch(
	() => ({
		data: currentWindow.value.data,
		offset: currentWindow.value.offset,
		bytesPerRow: bytesPerRow.value,
		uppercase: props.uppercase,
		nonPrintableChar: props.nonPrintableChar,
		isPrintable: props.isPrintable,
		renderAscii: props.renderAscii,
		cellClassForByte: cellClassResolver.value,
	}),
	() => {
		updateFromWindowState();
	},
	{ immediate: true },
);

watch(
	[
		totalBytes,
		bytesPerRow,
		viewportRows,
		overscanRows,
		effectiveMaxVirtualHeight,
		chunkStartRow,
	],
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

	queueScrollToOffset(currentWindow.value.offset);
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

defineExpose({
	scrollToByte,
	selectChunk,
});
</script>
