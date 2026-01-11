<template>
	<div :class="statusBarClass" :style="orderStyle" role="status" aria-live="polite">
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
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import { computed, ref, useSlots } from "vue";
import type {
	VueHexAsciiRenderer,
	VueHexEditorColumn,
	VueHexEditorMode,
	VueHexPrintableCheck,
	VueHexStatusBarComponent,
	VueHexStatusBarComponentName,
	VueHexStatusBarLayout,
} from "./vuehex-api";
import { DEFAULT_ASCII_RENDERER, DEFAULT_PRINTABLE_CHECK } from "./vuehex-api";

type StatusBarSectionKey = "left" | "middle" | "right";

type StatusBarPlacement = "top" | "bottom";

interface VueHexStatusBarProps {
	placement: StatusBarPlacement;
	layout?: VueHexStatusBarLayout | null;
	uppercase?: boolean;
	isPrintable?: VueHexPrintableCheck;
	renderAscii?: VueHexAsciiRenderer;
	nonPrintableChar?: string;
	selectionRange: { start: number; end: number } | null;
	selectionCount: number;
	editable?: boolean;
	editorMode?: VueHexEditorMode | null;
	editorColumn?: VueHexEditorColumn | null;
	totalBytes?: number;
}

const props = withDefaults(defineProps<VueHexStatusBarProps>(), {
	layout: null,
	uppercase: false,
	isPrintable: undefined,
	renderAscii: undefined,
	nonPrintableChar: ".",
	selectionRange: null,
	selectionCount: 0,
	editable: false,
	editorMode: null,
	editorColumn: null,
	totalBytes: undefined,
});

const slots = useSlots();

type VueHexHoverEvent =
	| "row-hover-on"
	| "row-hover-off"
	| "hex-hover-on"
	| "hex-hover-off"
	| "ascii-hover-on"
	| "ascii-hover-off";

type VueHexHoverEmit = (event: VueHexHoverEvent, payload: unknown) => void;

function normalizeNonNegativeInt(value: number): number {
	return Math.max(0, Math.trunc(value));
}

const intlNumberFormatter: Intl.NumberFormat | null = (() => {
	try {
		return new Intl.NumberFormat(undefined);
	} catch {
		return null;
	}
})();

function formatHexByte(byte: number, upper: boolean) {
	const value = Math.max(0, Math.min(255, Math.trunc(byte)));
	const hex = value.toString(16).padStart(2, "0");
	return upper ? hex.toUpperCase() : hex;
}

const hovered = ref<{ index: number; byte: number } | null>(null);

const cursorOffset = computed(() => hovered.value?.index ?? null);

const cursorHex = computed(() => {
	if (!hovered.value) {
		return "";
	}
	return formatHexByte(hovered.value.byte, Boolean(props.uppercase));
});

const cursorAscii = computed(() => {
	if (!hovered.value) {
		return "";
	}
	const byte = hovered.value.byte;
	const isPrintable = props.isPrintable ?? DEFAULT_PRINTABLE_CHECK;
	const renderAscii = props.renderAscii ?? DEFAULT_ASCII_RENDERER;
	const fallback = props.nonPrintableChar;
	return isPrintable(byte) ? renderAscii(byte) : fallback;
});

const selectionSummary = computed(() => {
	const range = props.selectionRange;
	const count = props.selectionCount;
	if (!range || count <= 0) {
		return "";
	}
	return `${count} bytes (${range.start}–${range.end})`;
});

const handleHoverEvent: VueHexHoverEmit = (event, payload) => {
	if (event === "hex-hover-on" || event === "ascii-hover-on") {
		const next = payload as { index?: unknown; byte?: unknown };
		const index = Number(next?.index);
		const byte = Number(next?.byte);
		if (Number.isFinite(index) && Number.isFinite(byte)) {
			hovered.value = {
				index: Math.trunc(index),
				byte: Math.trunc(byte),
			};
		}
		return;
	}
	if (event === "hex-hover-off" || event === "ascii-hover-off") {
		const current = hovered.value;
		if (!current) {
			return;
		}
		const prev = payload as { index?: unknown };
		const index = Number(prev?.index);
		if (!Number.isFinite(index) || Math.trunc(index) === current.index) {
			hovered.value = null;
		}
	}
};

defineExpose({ handleHoverEvent });

const statusBarClass = computed(() => {
	const classes = ["vuehex-statusbar"];
	classes.push(
		props.placement === "top"
			? "vuehex-statusbar--top"
			: "vuehex-statusbar--bottom",
	);
	return classes;
});

const orderStyle = computed<CSSProperties>(() => ({
	order: props.placement === "top" ? 0 : 2,
}));

type NormalizedStatusBarComponent = { name: string; config?: unknown };

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
	const provided = props.layout;
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
		name === "editable" ||
		name === "mode" ||
		name === "column" ||
		name === "total" ||
		name === "slot"
	);
}

type BuiltinName = Exclude<VueHexStatusBarComponentName, "slot">;

const DEFAULT_LABELS: Record<BuiltinName, string> = {
	offset: "Offset",
	hex: "Hex",
	ascii: "ASCII",
	selection: "Selection",
	editable: "Edit",
	mode: "Mode",
	column: "Col",
	total: "Total",
};

const DEFAULT_VALUE_MIN_WIDTH: Record<BuiltinName, string | null> = {
	offset: "10ch",
	hex: "4ch",
	ascii: "3ch",
	selection: null,
	editable: "4ch",
	mode: "3ch",
	column: "5ch",
	total: "10ch",
};

function formatNumber(value: number): string {
	const normalized = normalizeNonNegativeInt(value);
	return intlNumberFormatter
		? intlNumberFormatter.format(normalized)
		: String(normalized);
}

function formatHumanBytes(totalBytes: number, decimals: number): string {
	const value = normalizeNonNegativeInt(totalBytes);
	if (value < 1024) {
		return `${value} B`;
	}
	const units = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
	let size = value;
	let unitIndex = -1;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	const places = Math.max(0, Math.min(6, Math.trunc(decimals)));
	const rounded = places > 0 ? size.toFixed(places) : String(Math.round(size));
	const unit = units[Math.max(0, unitIndex)] ?? "KiB";
	return `${rounded} ${unit}`;
}

function formatTotalBytesValue(
	totalBytes: number | undefined,
	config: unknown,
) {
	if (totalBytes == null) {
		return "";
	}
	const normalized = normalizeNonNegativeInt(totalBytes);
	const format = getConfigString(config, "format");
	if (format === "human") {
		const decimals = getConfigNumber(config, "decimals") ?? 1;
		return formatHumanBytes(normalized, decimals);
	}
	if (format === "hex") {
		const upper = Boolean(props.uppercase);
		const pad = Math.max(0, Math.trunc(getConfigNumber(config, "pad") ?? 0));
		const raw = normalized.toString(16);
		const value = (upper ? raw.toUpperCase() : raw).padStart(pad, "0");
		const prefix = getConfigBoolean(config, "prefix") ?? true;
		return prefix ? `0x${value}` : value;
	}
	const value = formatNumber(normalized);
	const unit = getConfigBoolean(config, "unit") ?? false;
	return unit ? `${value} bytes` : value;
}

function formatEditableValue(editable: boolean, config: unknown): string {
	const short = getConfigBoolean(config, "short") ?? true;
	return editable
		? short
			? "EDIT"
			: "Editable"
		: short
			? "VIEW"
			: "Read-only";
}

function formatEditorModeValue(mode: VueHexEditorMode | null, config: unknown) {
	if (!mode) {
		return getConfigString(config, "placeholder") ?? "—";
	}
	const short = getConfigBoolean(config, "short") ?? true;
	if (mode === "insert") {
		return short ? "INS" : "Insert";
	}
	return short ? "OVR" : "Overwrite";
}

function formatEditorColumnValue(
	column: VueHexEditorColumn | null,
	config: unknown,
) {
	if (!column) {
		return getConfigString(config, "placeholder") ?? "—";
	}
	const short = getConfigBoolean(config, "short") ?? true;
	if (column === "hex") {
		return short ? "HEX" : "Hex";
	}
	return short ? "ASCII" : "ASCII";
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
	if (format === "decimal") {
		return String(normalizeNonNegativeInt(offset));
	}
	const upper = Boolean(props.uppercase);
	const pad = Math.max(0, Math.trunc(getConfigNumber(config, "pad") ?? 0));
	const raw = normalizeNonNegativeInt(offset).toString(16);
	const value = (upper ? raw.toUpperCase() : raw).padStart(pad, "0");
	const prefix = getConfigBoolean(config, "prefix") ?? true;
	return prefix ? `0x${value}` : value;
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
	switch (section) {
		case "left":
			return "statusbar-left";
		case "middle":
			return "statusbar-middle";
		default:
			return "statusbar-right";
	}
}

function resolveDefaultValueMinWidth(
	name: VueHexStatusBarComponentName,
	config: unknown,
): string | null {
	if (name === "slot") {
		return null;
	}

	if (name === "editable") {
		const short = getConfigBoolean(config, "short") ?? true;
		return short ? "6ch" : "10ch";
	}
	if (name === "mode") {
		const short = getConfigBoolean(config, "short") ?? true;
		return short ? "4ch" : "10ch";
	}
	if (name === "column") {
		// "ASCII" is the longest built-in value.
		return "5ch";
	}

	return DEFAULT_VALUE_MIN_WIDTH[name] ?? null;
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
	const defaultMinWidth = resolveDefaultValueMinWidth(name, config);

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

	const builtinName = name as BuiltinName;
	const label =
		getConfigString(component.config, "label") ?? DEFAULT_LABELS[builtinName];
	const valueStyle = resolveValueStyle(name, component.config);

	switch (name) {
		case "offset":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatOffsetValue(cursorOffset.value, component.config),
				visible: true,
				valueStyle,
			};
		case "hex":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatHexValue(cursorHex.value, component.config),
				visible: true,
				valueStyle,
			};
		case "ascii":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatAsciiValue(cursorAscii.value, component.config),
				visible: true,
				valueStyle,
			};
		case "editable":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatEditableValue(Boolean(props.editable), component.config),
				visible: true,
				valueStyle,
			};
		case "mode":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatEditorModeValue(
					props.editorMode ?? null,
					component.config,
				),
				visible: true,
				valueStyle,
			};
		case "column":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatEditorColumnValue(
					props.editorColumn ?? null,
					component.config,
				),
				visible: true,
				valueStyle,
			};
		case "total":
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: formatTotalBytesValue(props.totalBytes, component.config),
				visible: true,
				valueStyle,
			};
		case "selection": {
			const summary = selectionSummary.value;
			const showWhenEmpty = getConfigBoolean(component.config, "showWhenEmpty");
			return {
				kind: "builtin",
				key,
				name,
				label,
				value: summary,
				visible: showWhenEmpty ? true : Boolean(summary),
				valueStyle,
			};
		}
	}
}

const statusBarItems = computed(() => {
	const renderSection = (section: StatusBarSectionKey) => {
		const items = (effectiveStatusBarLayout.value[section] ?? [])
			.map(normalizeStatusBarComponent)
			.filter((c): c is NormalizedStatusBarComponent => c !== null);
		return items
			.map((component, index) =>
				renderStatusBarItem(component, section, `${section}-${index}`),
			)
			.filter((item): item is RenderedStatusBarItem => item !== null);
	};

	return {
		left: renderSection("left"),
		middle: renderSection("middle"),
		right: renderSection("right"),
	};
});
</script>
