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
import {
	computed,
	getCurrentInstance,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import { useCursor } from "./composables/useCursor";
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
	clamp,
	clampBytesPerRow,
	formatOffsetPlain,
	normalizeThemeKey,
} from "./vuehex-utils";

/** Fallback row height used until the DOM is measured. */
const DEFAULT_ROW_HEIGHT = 24;
/** Maximum height allowed before chunking kicks in to avoid huge scroll containers. */
const MAX_VIRTUAL_HEIGHT = 8_000_000;

interface VueHexProps {
	/** v-model binding containing the currently visible window bytes. */
	modelValue: Uint8Array;
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
const bindingWindow = computed(() => ({
	offset: normalizedWindowOffset.value,
	data: props.modelValue ?? new Uint8Array(0),
}));
/** Total bytes in the backing data; feeds navigation decisions. */
const totalBytes = computed(() => {
	if (isExpandToContent.value) {
		return bindingWindow.value.data.length;
	}
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
	const handler = vnodeProps?.onUpdateVirtualData;
	if (Array.isArray(handler)) {
		return handler.length > 0;
	}
	return Boolean(handler);
});

const expectsExternalData = computed(() => {
	if (isExpandToContent.value) {
		return false;
	}
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
const effectiveMaxVirtualHeight = computed(() => {
	if (isExpandToContent.value) {
		return Number.POSITIVE_INFINITY;
	}
	return isSelfManagedData.value
		? Number.POSITIVE_INFINITY
		: MAX_VIRTUAL_HEIGHT;
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

/** Chunking state is owned by VueHex (navigator is UI-only). */
const chunkStartRow = ref(0);

const totalRows = computed(() => {
	const total = totalBytes.value;
	if (total <= 0) {
		return 0;
	}
	return Math.ceil(total / Math.max(bytesPerRow.value, 1));
});

const chunkRowCapacity = computed(() => {
	const maxHeight = effectiveMaxVirtualHeight.value;
	if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	const rowHeightPx = rowHeightValue.value;
	if (!Number.isFinite(rowHeightPx) || rowHeightPx <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	const capacity = Math.floor(maxHeight / rowHeightPx);
	return capacity > 0 ? capacity : Number.POSITIVE_INFINITY;
});

const isChunking = computed(() => {
	const capacity = chunkRowCapacity.value;
	return (
		Number.isFinite(capacity) &&
		capacity > 0 &&
		totalRows.value > capacity
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
	return count * rowHeightValue.value;
});

const chunkItems = computed(() => {
	if (!props.showChunkNavigator || !isChunking.value) {
		return [];
	}
	const rows = totalRows.value;
	const capacity = chunkRowCapacity.value;
	if (rows <= 0 || !Number.isFinite(capacity) || capacity <= 0) {
		return [];
	}
	const bytesPer = Math.max(bytesPerRow.value, 1);
	const totalByteCount = totalBytes.value;
	const uppercase = Boolean(props.uppercase);
	const items: Array<{ index: number; label: string; range: string }> = [];
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
			)} – ${formatOffsetPlain(endByte, uppercase)}`,
		});
	}
	return items;
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

const effectiveCellClassResolver = computed<
	VueHexCellClassResolver | undefined
>(() => {
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
	getCellClassResolver: () => effectiveCellClassResolver.value,
	getNonPrintableChar: () => props.nonPrintableChar ?? ".",
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
	isSelfManagedData,
	totalBytes,
	getSelfManagedBytes: () => bindingWindow.value.data,
	getUppercase: () => Boolean(props.uppercase),
	getPrintableChecker: () => props.isPrintable ?? DEFAULT_PRINTABLE_CHECK,
	getAsciiRenderer: () => props.renderAscii ?? DEFAULT_ASCII_RENDERER,
	getNonPrintableChar: () => props.nonPrintableChar ?? ".",
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
	if (!Number.isFinite(index)) {
		return;
	}
	if (!isChunking.value) {
		return;
	}
	const capacity = chunkRowCapacity.value;
	if (!Number.isFinite(capacity) || capacity <= 0) {
		return;
	}
	const rows = totalRows.value;
	if (rows <= 0) {
		return;
	}
	const maxRowIndex = Math.max(rows - 1, 0);
	const maxChunkIndex = Math.max(chunkCount.value - 1, 0);
	const nextIndex = clamp(Math.floor(index), 0, maxChunkIndex);
	chunkStartRow.value = clamp(nextIndex * capacity, 0, maxRowIndex);
	const container = containerEl.value;
	if (container) {
		container.scrollTop = 0;
	}
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
		cellClassForByte: effectiveCellClassResolver.value,
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

watch(chunkStartRow, () => {
	scheduleWindowEvaluation();
});

watch(chunkRowCount, () => {
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
	const container = containerEl.value;
	if (container) {
	}

	clearHoverState();
});

defineExpose({ scrollToByte });
</script>
