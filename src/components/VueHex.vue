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
		<template #chunk-navigator-header="headerProps">
			<slot name="chunk-navigator-header" v-bind="headerProps" />
		</template>
		<template #chunk-navigator-item="itemProps">
			<slot name="chunk-navigator-item" v-bind="itemProps" />
		</template>
		<VueHexSearchBar
			ref="searchBarRef"
			:open="searchApi.open.value"
			:replace-open="searchApi.replaceOpen.value"
			:expanded="searchApi.expanded.value"
			:mode="searchApi.mode.value"
			:replacement-mode="searchApi.replacementMode.value"
			:query="searchApi.query.value"
			:replacement="searchApi.replacement.value"
			:result-text="searchApi.resultText.value"
			:pending="searchApi.pending.value"
			:disabled="searchApi.searchDisabled.value"
			:can-replace="searchApi.canReplace.value"
			:replace-help="searchApi.replaceHelp.value"
			:message="searchApi.message.value"
			:error="searchApi.error.value"
			@update:mode="searchApi.mode.value = $event"
			@update:replacement-mode="searchApi.replacementMode.value = $event"
			@update:query="searchApi.query.value = $event"
			@update:replacement="searchApi.replacement.value = $event"
			@next="void searchApi.find('next')"
			@previous="void searchApi.find('previous')"
			@toggle-replace="searchApi.replaceOpen.value = !searchApi.replaceOpen.value"
			@toggle-expanded="searchApi.expanded.value = !searchApi.expanded.value"
			@replace-one="void searchApi.replace('one')"
			@replace-all="void searchApi.replace('all')"
			@close="closeSearch"
		/>
			<VueHexStatusBar
				v-if="showStatusBar"
				ref="statusBarRef"
				:placement="statusBarPlacement ?? 'bottom'"
				:layout="props.statusbarLayout"
				:uppercase="props.uppercase"
				:is-printable="props.isPrintable"
				:render-ascii="props.renderAscii"
				:non-printable-char="props.nonPrintableChar"
				:selection-range="selectionRange"
				:selection-count="selectionCount"
				:editable="isEditable"
				:editor-mode="editorMode"
				:editor-column="editorActiveColumn"
				:total-bytes="dataTotalBytes"
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
				:class="finalContainerClass"
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
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	toRef,
	watch,
} from "vue";
import { useChunking } from "./composables/useChunking";
import { useCursor } from "./composables/useCursor";
import { useDataMode } from "./composables/useDataMode";
import { useEditing } from "./composables/useEditing";
import { useHexWindow } from "./composables/useHexWindow";
import { useHoverLinking } from "./composables/useHoverLinking";
import { useSearch } from "./composables/useSearch";
import { useSelection } from "./composables/useSelection";
import { useVueHexTheme } from "./composables/useVueHexTheme";
import VueHexChunkNavigator from "./VueHexChunkNavigator.vue";
import VueHexSearchBar from "./VueHexSearchBar.vue";
import VueHexStatusBar from "./VueHexStatusBar.vue";
import type {
	VueHexAsciiRenderer,
	VueHexCellClassResolverInput,
	VueHexEditIntent,
	VueHexPrintableCheck,
	VueHexReplaceProvider,
	VueHexReplaceResponse,
	VueHexSearchProvider,
	VueHexStatusBarLayout,
	VueHexWindowRequest,
} from "./vuehex-api";
import { DEFAULT_ASCII_RENDERER, DEFAULT_PRINTABLE_CHECK } from "./vuehex-api";
import { normalizeCellClassForByteResolver } from "./vuehex-resolvers";
import { clampBytesPerRow } from "./vuehex-utils";

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
	/** When true, enables editor mode (typing emits edit intents). */
	editable?: boolean;
	/** Enables the optional find/replace overlay and its keyboard shortcuts. */
	search?: boolean;
	/** Whether VueHex captures the find/replace keyboard shortcuts when search is enabled. */
	captureSearchKeybindings?: boolean;
	/** Complete-source search callback required when dataMode is windowed. */
	searchProvider?: VueHexSearchProvider;
	/** Complete-source mutation callback required to replace windowed data. */
	replaceProvider?: VueHexReplaceProvider;
	/**
	 * Configures which items appear in the status bar and where they render.
	 *
	 * The status bar is split into three sections: left, middle, right.
	 */
	statusbarLayout?: VueHexStatusBarLayout | null;
}

const windowOffset = defineModel<number>("windowOffset", { default: 0 });
const modelValue = defineModel<Uint8Array>({
	default: () => new Uint8Array(0),
});
const cursorLocation = defineModel<number | null>("cursorLocation", {
	default: null,
});
/** Temporary length supplied by a successful windowed replacement response. */
const replacementTotalSize = ref<number | null>(null);

const props = withDefaults(defineProps<VueHexProps>(), {
	dataMode: "auto",
	expandToContent: false,
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
	editable: false,
	search: false,
	captureSearchKeybindings: true,
	statusbarLayout: null,
});

const isEditable = computed(() => Boolean(props.editable));

const emit = defineEmits<{
	(event: "updateVirtualData", payload: VueHexWindowRequest): void;
	(event: "edit", payload: VueHexEditIntent): void;
	(event: "search-replace", payload: VueHexReplaceResponse): void;
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
	return Math.max(0, Math.trunc(windowOffset.value ?? 0));
});

/** Current length of the model value, used for mode detection. */
const backingDataLength = computed(() => modelValue.value?.length ?? 0);

const { isWindowed, isSelfManaged } = useDataMode({
	dataMode: toRef(props, "dataMode"),
	isExpandToContent,
	windowOffset: normalizedWindowOffset,
	totalSize: toRef(props, "totalSize"),
	dataLength: backingDataLength,
});

/** Provides easy access to the currently supplied window data. */
const currentWindow = computed(() => ({
	/**
	 * In self-managed (buffer) mode, we treat the provided data as starting at offset 0,
	 * regardless of the current scroll position (windowOffset).
	 * In windowed mode, windowOffset represents the requested start of the data slice.
	 */
	offset: isSelfManaged.value ? 0 : normalizedWindowOffset.value,
	data: modelValue.value,
}));

/** Total bytes in the backing data; feeds navigation decisions. */
const dataTotalBytes = computed(() => {
	if (isExpandToContent.value) {
		return currentWindow.value.data.length;
	}
	const provided = replacementTotalSize.value ?? props.totalSize;
	if (typeof provided === "number" && Number.isFinite(provided)) {
		return Math.max(0, Math.trunc(provided));
	}
	return currentWindow.value.data.length;
});

/**
 * Visual total bytes used for rendering/cursor navigation.
 *
 * In editable mode we add a single EOF "ghost" byte so users can append.
 */
const visualTotalBytes = computed(() =>
	isEditable.value ? dataTotalBytes.value + 1 : dataTotalBytes.value,
);

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
	totalBytes: visualTotalBytes,
	bytesPerRow,
	rowHeightValue,
	maxVirtualHeight: effectiveMaxVirtualHeight,
	uppercase,
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

const cellClassResolver = computed(() =>
	normalizeCellClassForByteResolver(props.cellClassForByte),
);

const searchHitStateResolver = ref<
	(index: number) => "active" | "match" | null
>(() => null);

/**
 * Remembers the most recent window start offset requested by VueHex.
 *
 * Why it exists:
 * - In windowed mode, VueHex requests a window that typically starts *before* the
 *   top visible row (overscan).
 * - We still update `v-model:windowOffset` so the host can load the correct slice,
 *   but we must NOT treat that update as a command to scroll the container to the
 *   window start, otherwise scrolling appears to "snap back".
 */
const lastRequestedWindowOffset = ref<number | null>(null);

/** Virtual window utilities that coordinate data requests and markup rendering. */
const {
	markup,
	renderStartRow,
	scheduleWindowEvaluation,
	handleScroll: handleVirtualScroll,
	scrollToByte,
	queueScrollToOffset,
	updateFromWindowState,
	updateRenderedSlice,
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
	totalBytes: visualTotalBytes,
	requestTotalBytes: dataTotalBytes,
	includeGhostEnd: isEditable,
	isSelfManagedData: isSelfManaged,
	windowOffset,
	ensureChunkForRow,
	clampChunkStartToBounds,
	getWindowState: () => currentWindow.value,
	getUppercase: () => uppercase.value,
	getPrintableChecker: () => printableCheck.value,
	getAsciiRenderer: () => asciiRenderer.value,
	getCellClassResolver: () => cellClassResolver.value,
	getNonPrintableChar: () => nonPrintableChar.value,
	getSelectionRange: () => selectionRange.value,
	getSearchHitState: (index) => searchHitStateResolver.value(index),
	requestWindow: (request) => {
		if (!shouldRequestVirtualData.value) {
			return;
		}
		lastRequestedWindowOffset.value = request.offset;
		windowOffset.value = request.offset;
		emit("updateVirtualData", request);
	},
	clearHoverState,
});

const {
	selectionEnabled,
	selectionRange,
	selectionCount,
	clearSelection,
	setSelection,
	copySelectionToClipboard,
} = useSelection({
	containerEl,
	tbodyEl,
	markup,
	getSelectionDataProp: () => props.getSelectionData,
	isSelfManagedData: isSelfManaged,
	requireShiftToSelect: computed(() => cursorEnabled.value || isEditable.value),
	cursorIndex: computed(() => cursorLocation.value ?? null),
	totalBytes: dataTotalBytes,
	getSelfManagedBytes: () => currentWindow.value.data,
	getUppercase: () => uppercase.value,
	getPrintableChecker: () => printableCheck.value,
	getAsciiRenderer: () => asciiRenderer.value,
	getNonPrintableChar: () => nonPrintableChar.value,
	updateRenderedSlice,
	emitByteClick: (payload) => emit("byte-click", payload),
	emitSelectionChange: (payload) => emit("selection-change", payload),
});

const {
	containerClass,
	rootClassExtra,
	showStatusBar,
	statusBarPlacement,
	viewerClassExtra,
} = useVueHexTheme({
	theme: toRef(props, "theme"),
	isExpandToContent,
	selectionEnabled,
	statusbar: toRef(props, "statusbar"),
});

const cursorEnabled = computed(() => Boolean(props.cursor) || isEditable.value);

const editorModeClass = ref<string | null>(null);
const editorActiveColumnClass = ref<string | null>(null);

const finalContainerClass = computed(() => {
	const classes = [...containerClass.value];
	if (isEditable.value) {
		classes.push("vuehex-editor");
		if (editorModeClass.value) {
			classes.push(editorModeClass.value);
		}
		if (editorActiveColumnClass.value) {
			classes.push(editorActiveColumnClass.value);
		}
	}
	return classes;
});

const cursorApi = useCursor({
	enabled: cursorEnabled,
	isExpandToContent,
	containerEl,
	tbodyEl,
	markup,
	totalBytes: visualTotalBytes,
	bytesPerRow,
	rowHeightValue,
	viewportRows,
	chunkStartRow,
	ensureChunkForRow,
	scheduleWindowEvaluation,
	cursorLocation,
	scrollToByte,
});

const isInteractive = computed(
	() => selectionEnabled.value || cursorEnabled.value || Boolean(props.search),
);

const {
	activeColumn: editorActiveColumn,
	editorMode,
	replaceRanges,
} = useEditing({
	enabled: isEditable,
	containerEl,
	tbodyEl,
	markup,
	uppercase,
	cursorIndex: cursorApi.cursorLocation,
	setCursorIndex: cursorApi.setCursorLocation,
	selectionRange,
	clearSelection,
	copySelectionToClipboard,
	totalBytes: dataTotalBytes,
	isSelfManagedData: isSelfManaged,
	getSelfManagedBytes: () => currentWindow.value.data,
	setSelfManagedBytes: (bytes) => {
		modelValue.value = bytes;
	},
	emitEdit: (intent) => emit("edit", intent),
});

const searchBarRef = ref<InstanceType<typeof VueHexSearchBar> | null>(null);
const searchApi = useSearch({
	enabled: computed(() => Boolean(props.search)),
	isWindowed,
	isEditable,
	getBytes: () => currentWindow.value.data,
	replaceLocal: (ranges, values) => replaceRanges(ranges, values),
	getInitialOffset: () =>
		cursorApi.cursorLocation.value ??
		selectionRange.value?.start ??
		currentWindow.value.offset,
	searchProvider: () => props.searchProvider,
	replaceProvider: () => props.replaceProvider,
	applyWindow: (window) => {
		windowOffset.value = window.offset;
		modelValue.value = window.data;
	},
	onReplaceResult: (response) => {
		if (
			typeof response.totalSize === "number" &&
			Number.isFinite(response.totalSize)
		) {
			replacementTotalSize.value = Math.max(0, Math.trunc(response.totalSize));
		}
		emit("search-replace", response);
	},
	navigateTo: (hit) => {
		clearSelection();
		setSelection(hit.start, hit.end);
		cursorApi.setCursorLocation(hit.start);
		scrollToByte(hit.start);
	},
});

searchHitStateResolver.value = searchApi.getHighlightState;

watch(
	[
		() => searchApi.activeHit.value,
		() => searchApi.query.value,
		() => searchApi.open.value,
	],
	() => updateRenderedSlice(),
);

watch(
	[isEditable, editorActiveColumn, editorMode],
	() => {
		if (!isEditable.value) {
			editorModeClass.value = null;
			editorActiveColumnClass.value = null;
			return;
		}
		editorModeClass.value =
			editorMode.value === "insert"
				? "vuehex-editor--insert"
				: "vuehex-editor--overwrite";
		editorActiveColumnClass.value =
			editorActiveColumn.value === "ascii"
				? "vuehex-editor--active-ascii"
				: "vuehex-editor--active-hex";
	},
	{ immediate: true },
);

function handleScroll() {
	if (isExpandToContent.value) {
		return;
	}
	handleVirtualScroll();
}

function isSearchField(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function isSearchOverlayTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement && Boolean(target.closest(".vuehex-search"))
	);
}

function openSearch(options?: { replace?: boolean; selectQuery?: boolean }) {
	searchApi.openSearch(options);
	void nextTick(() => {
		if (options?.replace) {
			void searchBarRef.value?.focusReplacement();
			return;
		}
		void searchBarRef.value?.focusQuery(options?.selectQuery !== false);
	});
}

function closeSearch() {
	searchApi.closeSearch();
	void nextTick(() => containerEl.value?.focus());
}

function toggleSearch(options?: { replace?: boolean; selectQuery?: boolean }) {
	if (searchApi.open.value) {
		closeSearch();
		return;
	}
	openSearch(options);
}

function handleSearchKeydown(event: KeyboardEvent) {
	if (!props.search || !props.captureSearchKeybindings) {
		return;
	}
	const key = event.key.toLowerCase();
	const hasModifier = event.ctrlKey || event.metaKey;
	if (hasModifier && key === "f") {
		event.preventDefault();
		event.stopImmediatePropagation();
		openSearch({ selectQuery: true });
		return;
	}
	if (hasModifier && key === "h") {
		event.preventDefault();
		event.stopImmediatePropagation();
		openSearch({ replace: true, selectQuery: true });
		return;
	}
	if (isSearchField(event.target) && !isSearchOverlayTarget(event.target)) {
		return;
	}
	if (!searchApi.open.value) {
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopImmediatePropagation();
		closeSearch();
		return;
	}
	if (event.key === "F3") {
		event.preventDefault();
		event.stopImmediatePropagation();
		void searchApi.find(event.shiftKey ? "previous" : "next");
	}
}

/** Pixel offset applied to translate the table to the rendered slice. */
const tableOffset = computed(() => {
	if (isExpandToContent.value) {
		return 0;
	}
	const offsetRows = renderStartRow.value - chunkStartRow.value;
	return offsetRows * rowHeightValue.value;
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

	if (isSelfManaged.value) {
		windowOffset.value = chunkStartRow.value * bytesPerRow.value;
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

// Watch for external windowOffset changes to scroll to that position
watch(
	() => windowOffset.value,
	(newOffset, oldOffset) => {
		if (newOffset === oldOffset) {
			return;
		}
		if (isSelfManaged.value) {
			return;
		}
		if (
			lastRequestedWindowOffset.value != null &&
			newOffset === lastRequestedWindowOffset.value
		) {
			return;
		}
		if (newOffset != null && Number.isFinite(newOffset) && newOffset >= 0) {
			queueScrollToOffset(newOffset);
		}
	},
);

watch(
	() => props.totalSize,
	(nextTotalSize) => {
		if (
			typeof nextTotalSize === "number" &&
			Number.isFinite(nextTotalSize) &&
			replacementTotalSize.value !== Math.max(0, Math.trunc(nextTotalSize))
		) {
			replacementTotalSize.value = null;
		}
	},
);

watch(
	[
		visualTotalBytes,
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
		container.addEventListener("keydown", handleSearchKeydown, true);
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

	containerEl.value?.removeEventListener("keydown", handleSearchKeydown, true);

	clearHoverState();
});

defineExpose({
	scrollToByte,
	selectChunk,
	openSearch,
	closeSearch,
	toggleSearch,
});
</script>
