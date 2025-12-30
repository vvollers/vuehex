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
				v-if="showStatusBar && statusBarPlacement === 'top'"
				:class="statusBarClass"
				role="status"
				aria-live="polite"
			>
				<div class="vuehex-statusbar__section vuehex-statusbar__section--left">
					<span
						v-for="item in statusBarItems.left"
						:key="item.key"
						v-show="item.visible"
						class="vuehex-statusbar__item"
					>
						<template v-if="item.kind === 'slot'">
							<slot :name="item.slotName" />
						</template>
						<template v-else>
							<span class="vuehex-statusbar__label">{{ item.label }}</span>
							<span class="vuehex-statusbar__value" :style="item.valueStyle">{{ item.value }}</span>
						</template>
					</span>
				</div>
				<div class="vuehex-statusbar__section vuehex-statusbar__section--middle">
					<span
						v-for="item in statusBarItems.middle"
						:key="item.key"
						v-show="item.visible"
						class="vuehex-statusbar__item"
					>
						<template v-if="item.kind === 'slot'">
							<slot :name="item.slotName" />
						</template>
						<template v-else>
							<span class="vuehex-statusbar__label">{{ item.label }}</span>
							<span class="vuehex-statusbar__value" :style="item.valueStyle">{{ item.value }}</span>
						</template>
					</span>
				</div>
				<div class="vuehex-statusbar__section vuehex-statusbar__section--right">
					<span
						v-for="item in statusBarItems.right"
						:key="item.key"
						v-show="item.visible"
						class="vuehex-statusbar__item"
					>
						<template v-if="item.kind === 'slot'">
							<slot :name="item.slotName" />
						</template>
						<template v-else>
							<span class="vuehex-statusbar__label">{{ item.label }}</span>
							<span class="vuehex-statusbar__value" :style="item.valueStyle">{{ item.value }}</span>
						</template>
					</span>
				</div>
			</div>
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

			<div
				v-if="showStatusBar && statusBarPlacement === 'bottom'"
				:class="statusBarClass"
				role="status"
				aria-live="polite"
			>
				<div class="vuehex-statusbar__section vuehex-statusbar__section--left">
					<span
						v-for="item in statusBarItems.left"
						:key="item.key"
						v-show="item.visible"
						class="vuehex-statusbar__item"
					>
						<template v-if="item.kind === 'slot'">
							<slot :name="item.slotName" />
						</template>
						<template v-else>
							<span class="vuehex-statusbar__label">{{ item.label }}</span>
							<span class="vuehex-statusbar__value" :style="item.valueStyle">{{ item.value }}</span>
						</template>
					</span>
				</div>
				<div class="vuehex-statusbar__section vuehex-statusbar__section--middle">
					<span
						v-for="item in statusBarItems.middle"
						:key="item.key"
						v-show="item.visible"
						class="vuehex-statusbar__item"
					>
						<template v-if="item.kind === 'slot'">
							<slot :name="item.slotName" />
						</template>
						<template v-else>
							<span class="vuehex-statusbar__label">{{ item.label }}</span>
							<span class="vuehex-statusbar__value" :style="item.valueStyle">{{ item.value }}</span>
						</template>
					</span>
				</div>
				<div class="vuehex-statusbar__section vuehex-statusbar__section--right">
					<span
						v-for="item in statusBarItems.right"
						:key="item.key"
						v-show="item.visible"
						class="vuehex-statusbar__item"
					>
						<template v-if="item.kind === 'slot'">
							<slot :name="item.slotName" />
						</template>
						<template v-else>
							<span class="vuehex-statusbar__label">{{ item.label }}</span>
							<span class="vuehex-statusbar__value" :style="item.valueStyle">{{ item.value }}</span>
						</template>
					</span>
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
	useSlots,
	watch,
} from "vue";
import { useChunkNavigator } from "./composables/useChunkNavigator";
import { useHexWindow } from "./composables/useHexWindow";
import { useHoverLinking } from "./composables/useHoverLinking";
import { useSelection } from "./composables/useSelection";
import { useStatusBar } from "./composables/useStatusBar";
import type {
	VueHexAsciiRenderer,
	VueHexCellClassResolver,
	VueHexPrintableCheck,
	VueHexStatusBarComponent,
	VueHexStatusBarComponentName,
	VueHexStatusBarLayout,
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
	/** Hook for assigning classes per cell, useful for highlighting bytes of interest. */
	cellClassForByte?: VueHexCellClassResolver | null;
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
	statusbarLayout: null,
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

const slots = useSlots();
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
/** Classes applied to the scroll container, including theme modifiers. */
const containerClass = computed(() => {
	const classes = ["vuehex"];
	const normalized = themeKey.value;
	if (!normalized || normalized === "auto") {
		classes.push("vuehex-theme-auto");
	} else {
		classes.push(`vuehex-theme-${normalized}`);
	}
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

/** Chunk navigation helpers that keep oversized datasets scrollable. */
const {
	chunkStartRow,
	chunkRowCount,
	chunkHeight,
	chunkCount,
	activeChunkIndex,
	shouldShowChunkNavigator,
	rootClass: rootClassBase,
	chunkNavigatorClass: chunkNavigatorClassBase,
	viewerClass: viewerClassBase,
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

const rootClass = computed(() => {
	const classes = [...rootClassBase.value];
	if (isExpandToContent.value) {
		classes.push("vuehex-root--expand-to-content");
	}
	return classes;
});

const chunkNavigatorClass = computed(() => [...chunkNavigatorClassBase.value]);

const showStatusBar = computed(
	() => props.statusbar === "top" || props.statusbar === "bottom",
);

const statusBarPlacement = computed(() =>
	props.statusbar === "top" ? "top" : "bottom",
);

const viewerClass = computed(() => {
	const classes = [...viewerClassBase.value];
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

/** Hover coordination utilities that emit events and apply linked highlights. */
let handleStatusHoverEvent: ((event: string, payload: unknown) => void) | null =
	null;

const { handlePointerOver, handlePointerOut, clearHoverState } =
	useHoverLinking({
		emit: (event, payload) => {
			handleStatusHoverEvent?.(event, payload);
			emit(event as never, payload as never);
		},
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

const {
	cursorOffset,
	cursorHex,
	cursorAscii,
	selectionSummary,
	handleHoverEvent,
} = useStatusBar({
	getUppercase: () => Boolean(props.uppercase),
	getPrintableChecker: () => props.isPrintable ?? DEFAULT_PRINTABLE_CHECK,
	getAsciiRenderer: () => props.renderAscii ?? DEFAULT_ASCII_RENDERER,
	getNonPrintableChar: () => props.nonPrintableChar ?? ".",
	selectionRange,
	selectionCount,
});

handleStatusHoverEvent = (event, payload) =>
	handleHoverEvent(event as never, payload);

const statusBarClass = computed(() => {
	const classes = ["vuehex-statusbar"];
	classes.push(
		statusBarPlacement.value === "top"
			? "vuehex-statusbar--top"
			: "vuehex-statusbar--bottom",
	);
	return classes;
});

type NormalizedStatusBarComponent = { name: string; config?: unknown };
type StatusBarSectionKey = "left" | "middle" | "right";

function normalizeStatusBarComponent(
	component: VueHexStatusBarComponent,
): NormalizedStatusBarComponent | null {
	if (typeof component === "string") {
		const name = component.trim();
		return name ? { name } : null;
	}
	if (!component || typeof component !== "object") {
		return null;
	}
	const record = component as { name?: unknown; config?: unknown };
	const name = typeof record.name === "string" ? record.name.trim() : "";
	return name ? { name, config: record.config } : null;
}

function normalizeStatusBarSection(
	layout: VueHexStatusBarLayout | null | undefined,
	key: StatusBarSectionKey,
): VueHexStatusBarComponent[] {
	const value = layout?.[key];
	return Array.isArray(value) ? value : [];
}

const effectiveStatusBarLayout = computed<VueHexStatusBarLayout>(() => {
	const provided = props.statusbarLayout;
	if (!provided) {
		return {
			left: ["offset", "hex", "ascii"],
			middle: [],
			right: ["selection"],
		};
	}
	return {
		left: normalizeStatusBarSection(provided, "left"),
		middle: normalizeStatusBarSection(provided, "middle"),
		right: normalizeStatusBarSection(provided, "right"),
	};
});

function isBuiltInStatusBarName(
	name: string,
): name is VueHexStatusBarComponentName {
	return (
		name === "offset" ||
		name === "hex" ||
		name === "ascii" ||
		name === "selection" ||
		name === "slot"
	);
}

function getConfigString(config: unknown, key: string): string | null {
	if (!config || typeof config !== "object") {
		return null;
	}
	const record = config as Record<string, unknown>;
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function getConfigBoolean(config: unknown, key: string): boolean | null {
	if (!config || typeof config !== "object") {
		return null;
	}
	const record = config as Record<string, unknown>;
	const value = record[key];
	return typeof value === "boolean" ? value : null;
}

function getConfigNumber(config: unknown, key: string): number | null {
	if (!config || typeof config !== "object") {
		return null;
	}
	const record = config as Record<string, unknown>;
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatOffsetValue(offset: number | null, config: unknown): string {
	if (offset === null) {
		return "";
	}
	const format = getConfigString(config, "format");
	if (format === "hex") {
		const upper = Boolean(props.uppercase);
		const pad = Math.max(0, Math.trunc(getConfigNumber(config, "pad") ?? 0));
		const raw = Math.max(0, Math.trunc(offset)).toString(16);
		const value = (upper ? raw.toUpperCase() : raw).padStart(pad, "0");
		const prefix = getConfigBoolean(config, "prefix") ?? true;
		return prefix ? `0x${value}` : value;
	}
	return String(Math.max(0, Math.trunc(offset)));
}

function formatHexValue(hex: string, config: unknown): string {
	if (!hex) {
		return "";
	}
	const prefix = getConfigBoolean(config, "prefix");
	return prefix ? `0x${hex}` : hex;
}

function formatAsciiValue(ascii: string, config: unknown): string {
	if (!ascii) {
		return "";
	}
	const quote = getConfigBoolean(config, "quote");
	return quote ? `'${ascii}'` : ascii;
}

type RenderedStatusBarItem = {
	key: string;
	visible: boolean;
} & (
	| {
			kind: "builtin";
			name: Exclude<VueHexStatusBarComponentName, "slot">;
			label: string;
			value: string;
			valueStyle?: CSSProperties;
	  }
	| {
			kind: "slot";
			slotName: "statusbar-left" | "statusbar-middle" | "statusbar-right";
	  }
);

function resolveStatusBarSlotName(
	section: StatusBarSectionKey,
): "statusbar-left" | "statusbar-middle" | "statusbar-right" {
	if (section === "left") {
		return "statusbar-left";
	}
	if (section === "middle") {
		return "statusbar-middle";
	}
	return "statusbar-right";
}

function resolveDefaultValueMinWidth(
	name: VueHexStatusBarComponentName,
): string | null {
	// Reserve space for hover-driven values so the status bar doesn't jump.
	// These defaults are intentionally conservative and can be overridden per item.
	if (name === "slot") {
		return null;
	}
	if (name === "offset") {
		return "10ch";
	}
	if (name === "hex") {
		return "4ch";
	}
	if (name === "ascii") {
		return "3ch";
	}
	return null;
}

function resolveValueStyle(
	name: VueHexStatusBarComponentName,
	config: unknown,
): CSSProperties | undefined {
	if (name === "slot") {
		return undefined;
	}
	const width = getConfigString(config, "valueWidth");
	const minWidth = getConfigString(config, "valueMinWidth");
	const defaultMinWidth = resolveDefaultValueMinWidth(name);

	const style: CSSProperties = {};
	if (width) {
		style.width = width;
	}
	if (minWidth) {
		style.minWidth = minWidth;
	} else if (!width && defaultMinWidth) {
		style.minWidth = defaultMinWidth;
	}

	if (style.width || style.minWidth) {
		style.whiteSpace = "nowrap";
		style.overflow = "hidden";
		style.textOverflow = "ellipsis";
	}

	return Object.keys(style).length ? style : undefined;
}

function renderStatusBarItem(
	component: NormalizedStatusBarComponent,
	section: StatusBarSectionKey,
	key: string,
): RenderedStatusBarItem | null {
	const name = component.name.trim();
	if (!isBuiltInStatusBarName(name)) {
		return null;
	}
	if (name === "slot") {
		const slotName = resolveStatusBarSlotName(section);
		return {
			kind: "slot",
			key,
			slotName,
			visible: Boolean(slots[slotName]),
		};
	}
	const labelOverride = getConfigString(component.config, "label");
	const label =
		labelOverride ??
		(name === "offset"
			? "Offset"
			: name === "hex"
				? "Hex"
				: name === "ascii"
					? "ASCII"
					: "Selection");

	if (name === "offset") {
		return {
			kind: "builtin",
			key,
			name,
			label,
			value: formatOffsetValue(cursorOffset.value, component.config),
			visible: true,
			valueStyle: resolveValueStyle(name, component.config),
		};
	}
	if (name === "hex") {
		return {
			kind: "builtin",
			key,
			name,
			label,
			value: formatHexValue(cursorHex.value, component.config),
			visible: true,
			valueStyle: resolveValueStyle(name, component.config),
		};
	}
	if (name === "ascii") {
		return {
			kind: "builtin",
			key,
			name,
			label,
			value: formatAsciiValue(cursorAscii.value, component.config),
			visible: true,
			valueStyle: resolveValueStyle(name, component.config),
		};
	}

	const summary = selectionSummary.value;
	const showWhenEmpty = getConfigBoolean(component.config, "showWhenEmpty");
	const visible = showWhenEmpty ? true : Boolean(summary);
	return {
		kind: "builtin",
		key,
		name,
		label,
		value: summary,
		visible,
		valueStyle: resolveValueStyle(name, component.config),
	};
}

function renderStatusBarSection(
	section: StatusBarSectionKey,
): RenderedStatusBarItem[] {
	const items = effectiveStatusBarLayout.value[section] ?? [];
	const rendered: RenderedStatusBarItem[] = [];
	items.forEach((entry, index) => {
		const normalized = normalizeStatusBarComponent(entry);
		if (!normalized) {
			return;
		}
		const key = `${section}-${index}-${normalized.name}`;
		const item = renderStatusBarItem(normalized, section, key);
		if (item) {
			rendered.push(item);
		}
	});
	return rendered;
}

const statusBarItems = computed(() => ({
	left: renderStatusBarSection("left"),
	middle: renderStatusBarSection("middle"),
	right: renderStatusBarSection("right"),
}));

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
