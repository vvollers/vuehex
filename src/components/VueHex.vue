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
		:aria-disabled="selectionEnabled ? undefined : 'true'"
		:tabindex="selectionEnabled ? 0 : undefined"
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
	VueHexSelectionDataProvider,
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

const CATEGORY_DIGIT_CLASS = "vuehex-category-digit";
const CATEGORY_UPPERCASE_CLASS = "vuehex-category-uppercase";
const CATEGORY_LOWERCASE_CLASS = "vuehex-category-lowercase";
const CATEGORY_NULL_CLASS = "vuehex-category-null";

const defaultAsciiCategoryResolver: VueHexCellClassResolver = ({ byte }) => {
	if (byte >= 0x30 && byte <= 0x39) {
		return CATEGORY_DIGIT_CLASS;
	}
	if (byte >= 0x41 && byte <= 0x5a) {
		return CATEGORY_UPPERCASE_CLASS;
	}
	if (byte >= 0x61 && byte <= 0x7a) {
		return CATEGORY_LOWERCASE_CLASS;
	}
	if (byte === 0x00) {
		return CATEGORY_NULL_CLASS;
	}
	return undefined;
};

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
	cellClassForByte?: VueHexCellClassResolver | null;
	/**
	 * Optional selection provider used for clipboard copy.
	 * Should return the raw bytes between selectionStart and selectionEnd (inclusive).
	 */
	getSelectionData?: VueHexSelectionDataProvider;
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
	const handler = vnodeProps?.onUpdateVirtualData;
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

const selectionDataProvider = computed<VueHexSelectionDataProvider | null>(
	() => {
		if (props.getSelectionData) {
			return props.getSelectionData;
		}
		if (!isSelfManagedData.value) {
			return null;
		}
		return (selectionStart, selectionEnd) => {
			const total = totalBytes.value;
			if (total <= 0) {
				return new Uint8Array(0);
			}
			const start = Math.max(
				0,
				Math.min(Math.trunc(selectionStart), total - 1),
			);
			const end = Math.max(0, Math.min(Math.trunc(selectionEnd), total - 1));
			const from = Math.min(start, end);
			const to = Math.max(start, end);
			return bindingWindow.value.data.slice(from, to + 1);
		};
	},
);

const selectionEnabled = computed(() => selectionDataProvider.value !== null);

/** Scroll container ref for virtualization math. */
const containerEl = ref<HTMLDivElement>();
/** Table body ref so hover logic can traverse DOM nodes. */
const tbodyEl = ref<HTMLTableSectionElement>();

interface SelectionState {
	mode: "hex" | "ascii";
	anchor: number;
	focus: number;
}

const selectionState = ref<SelectionState | null>(null);
const isPointerSelecting = ref(false);
const activePointerId = ref<number | null>(null);
let selectionSyncHandle: number | null = null;
const SELECTED_CLASS = "vuehex-selected";
const SELECTED_ASCII_CLASS = "vuehex-selected--ascii";

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
/** Classes applied to the scroll container, including theme modifiers. */
const containerClass = computed(() => {
	const classes = ["vuehex"];
	const normalized = themeKey.value;
	if (!normalized || normalized === "auto") {
		classes.push("vuehex-theme-auto");
	} else {
		classes.push(`vuehex-theme-${normalized}`);
	}
	if (!selectionEnabled.value) {
		classes.push("vuehex-selection-disabled");
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

const effectiveCellClassResolver = computed<
	VueHexCellClassResolver | undefined
>(() => {
	if (props.cellClassForByte !== undefined) {
		return props.cellClassForByte ?? undefined;
	}
	return defaultAsciiCategoryResolver;
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

function scheduleSelectionSync() {
	if (typeof window === "undefined") {
		return;
	}
	if (selectionSyncHandle !== null) {
		cancelAnimationFrame(selectionSyncHandle);
	}
	selectionSyncHandle = requestAnimationFrame(() => {
		selectionSyncHandle = null;
		applySelectionHighlight();
	});
}

function applySelectionHighlight() {
	const tbody = tbodyEl.value;
	if (!tbody) {
		return;
	}
	const allNodes = tbody.querySelectorAll<HTMLElement>(
		"[data-hex-index], [data-ascii-index]",
	);
	allNodes.forEach((node) => {
		node.classList.remove(SELECTED_CLASS, SELECTED_ASCII_CLASS);
	});

	const state = selectionState.value;
	if (!state || !selectionEnabled.value) {
		if (state) {
			selectionState.value = null;
		}
		return;
	}
	const start = Math.min(state.anchor, state.focus);
	const end = Math.max(state.anchor, state.focus);
	const selector =
		state.mode === "hex" ? "[data-hex-index]" : "[data-ascii-index]";
	const classNames =
		state.mode === "hex"
			? [SELECTED_CLASS]
			: [SELECTED_CLASS, SELECTED_ASCII_CLASS];
	const nodes = tbody.querySelectorAll<HTMLElement>(selector);
	nodes.forEach((node) => {
		if (node.getAttribute("aria-hidden") === "true") {
			return;
		}
		const attr =
			state.mode === "hex"
				? node.getAttribute("data-hex-index")
				: node.getAttribute("data-ascii-index");
		if (!attr) {
			return;
		}
		const index = Number.parseInt(attr, 10);
		if (!Number.isFinite(index)) {
			return;
		}
		if (index < start || index > end) {
			return;
		}
		for (const className of classNames) {
			node.classList.add(className);
		}
	});
}

function getSelectionPayloadFromElement(
	element: Element | null,
): { mode: "hex" | "ascii"; index: number } | null {
	if (!(element instanceof HTMLElement)) {
		return null;
	}
	const cell = element.closest<HTMLElement>(
		"[data-hex-index], [data-ascii-index]",
	);
	if (!cell || cell.getAttribute("aria-hidden") === "true") {
		return null;
	}
	if (cell.hasAttribute("data-hex-index")) {
		const attr = cell.getAttribute("data-hex-index");
		const index = attr ? Number.parseInt(attr, 10) : NaN;
		return Number.isFinite(index) ? { mode: "hex", index } : null;
	}
	if (cell.hasAttribute("data-ascii-index")) {
		const attr = cell.getAttribute("data-ascii-index");
		const index = attr ? Number.parseInt(attr, 10) : NaN;
		return Number.isFinite(index) ? { mode: "ascii", index } : null;
	}
	return null;
}

function beginManualSelection(
	mode: "hex" | "ascii",
	index: number,
	pointerId: number,
) {
	selectionState.value = { mode, anchor: index, focus: index };
	isPointerSelecting.value = true;
	activePointerId.value = pointerId;
	scheduleSelectionSync();
}

function updateManualSelection(index: number) {
	if (!selectionState.value) {
		return;
	}
	if (selectionState.value.focus === index) {
		return;
	}
	selectionState.value = {
		...selectionState.value,
		focus: index,
	};
	scheduleSelectionSync();
}

function finishPointerSelection() {
	isPointerSelecting.value = false;
	activePointerId.value = null;
}

function clearSelection() {
	if (!selectionState.value) {
		return;
	}
	selectionState.value = null;
	scheduleSelectionSync();
}

function handlePointerDown(event: PointerEvent) {
	if (!selectionEnabled.value) {
		return;
	}
	if (event.button !== 0) {
		return;
	}
	const payload = getSelectionPayloadFromElement(
		event.target as Element | null,
	);
	const existing = selectionState.value;
	if (!payload) {
		if (!event.shiftKey) {
			clearSelection();
		}
		finishPointerSelection();
		return;
	}
	event.preventDefault();
	containerEl.value?.focus();
	if (event.shiftKey && existing && existing.mode === payload.mode) {
		selectionState.value = {
			mode: existing.mode,
			anchor: existing.anchor,
			focus: payload.index,
		};
		isPointerSelecting.value = false;
		activePointerId.value = null;
		scheduleSelectionSync();
		return;
	}
	beginManualSelection(payload.mode, payload.index, event.pointerId);
}

function resolveSelectionPayloadFromEvent(event: PointerEvent) {
	const direct = getSelectionPayloadFromElement(event.target as Element | null);
	if (direct) {
		return direct;
	}
	const fallback = document.elementFromPoint(event.clientX, event.clientY);
	return getSelectionPayloadFromElement(fallback);
}

function handlePointerMove(event: PointerEvent) {
	if (!selectionEnabled.value) {
		return;
	}
	if (!isPointerSelecting.value) {
		return;
	}
	if (
		activePointerId.value !== null &&
		activePointerId.value !== event.pointerId
	) {
		return;
	}
	const payload = resolveSelectionPayloadFromEvent(event);
	if (!payload) {
		return;
	}
	const state = selectionState.value;
	if (!state || payload.mode !== state.mode) {
		return;
	}
	updateManualSelection(payload.index);
}

function handlePointerUp(event: PointerEvent) {
	if (!selectionEnabled.value) {
		return;
	}
	if (
		activePointerId.value !== null &&
		activePointerId.value !== event.pointerId
	) {
		return;
	}
	finishPointerSelection();
}

function buildSelectionText(state: SelectionState): string | null {
	const provider = selectionDataProvider.value;
	if (!provider) {
		return null;
	}
	const start = Math.min(state.anchor, state.focus);
	const end = Math.max(state.anchor, state.focus);
	const bytes = provider(start, end);
	if (!bytes.length) {
		return null;
	}

	if (state.mode === "ascii") {
		const isPrintable = props.isPrintable ?? DEFAULT_PRINTABLE_CHECK;
		const renderAscii = props.renderAscii ?? DEFAULT_ASCII_RENDERER;
		const fallback = props.nonPrintableChar ?? ".";
		return Array.from(bytes, (byte) =>
			isPrintable(byte) ? renderAscii(byte) : fallback,
		).join("");
	}

	const upper = Boolean(props.uppercase);
	return Array.from(bytes, (byte) => {
		const hex = byte.toString(16).padStart(2, "0");
		return upper ? hex.toUpperCase() : hex;
	}).join(" ");
}

function handleKeydown(event: KeyboardEvent) {
	if (!selectionEnabled.value) {
		return;
	}
	const key = event.key.toLowerCase();
	const isCopy = (event.ctrlKey || event.metaKey) && key === "c";
	if (isCopy) {
		const state = selectionState.value;
		if (!state) {
			return;
		}
		const text = buildSelectionText(state);
		if (!text) {
			return;
		}
		event.preventDefault();
		writeTextToClipboard(text);
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		clearSelection();
	}
}

function writeTextToClipboard(text: string) {
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		navigator.clipboard.writeText(text).catch(() => {
			console.error("Failed to write text to clipboard.");
		});
		return;
	}
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

watch(
	() => effectiveMaxVirtualHeight.value,
	() => {
		clampChunkStartToBounds();
		scheduleWindowEvaluation();
	},
);

watch(markup, () => {
	scheduleSelectionSync();
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
		container.addEventListener("keydown", handleKeydown);
		container.addEventListener("pointerdown", handlePointerDown);
	}

	const tbody = tbodyEl.value;
	if (tbody) {
		tbody.addEventListener("pointerover", handlePointerOver);
		tbody.addEventListener("pointerout", handlePointerOut);
	}

	if (typeof window !== "undefined") {
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
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
		container.removeEventListener("keydown", handleKeydown);
		container.removeEventListener("pointerdown", handlePointerDown);
	}

	if (typeof window !== "undefined") {
		window.removeEventListener("pointermove", handlePointerMove);
		window.removeEventListener("pointerup", handlePointerUp);
		window.removeEventListener("pointercancel", handlePointerUp);
	}

	if (selectionSyncHandle !== null) {
		cancelAnimationFrame(selectionSyncHandle);
		selectionSyncHandle = null;
	}

	clearHoverState();
});

defineExpose({ scrollToByte });
</script>
