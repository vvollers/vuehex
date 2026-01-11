import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { action } from "storybook/actions";
import { computed, ref } from "vue";
import VueHex from "@/components/VueHex.vue";
import "./vuehex-custom-theme.css";
import type {
	VueHexCellClassResolver,
	VueHexCellClassResolverInput,
	VueHexEditIntent,
	VueHexStatusBarLayout,
	VueHexWindowRequest,
} from "@/components/vuehex-api";
import {
	DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER,
	VUE_HEX_ASCII_PRESETS,
} from "@/components/vuehex-api";

const DEMO_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MiB of procedurally generated data
const SELF_MANAGED_BYTES = 64 * 1024; // 64 KiB sample for the full-data demo
const EXPAND_TO_CONTENT_ROWS = 120;
const THEME_SAMPLE_ROWS = 32;

const THEME_VARIANTS = [
	{
		key: "dark",
		title: "Dark Mode",
		description: "High-contrast midnight palette for long debugging sessions.",
	},
	{
		key: "light",
		title: "Light Mode",
		description: "Soft neutrals that feel at home inside docs or wikis.",
	},
	{
		key: "terminal",
		title: "Terminal",
		description: "Retro CRT green glow for console nostalgia.",
	},
	{
		key: "sunset",
		title: "Sunset",
		description: "Gradient backdrop with playful highlight colors.",
	},
] as const;

type ThemeVariant = (typeof THEME_VARIANTS)[number];

type AsciiPresetKey = keyof typeof VUE_HEX_ASCII_PRESETS;

const ASCII_PRESET_OPTIONS = (
	Object.keys(VUE_HEX_ASCII_PRESETS) as AsciiPresetKey[]
).map((key) => ({
	key,
	label: VUE_HEX_ASCII_PRESETS[key].label,
}));

type HighlightPresetKey =
	| "defaultCategories"
	| "customOnly"
	| "defaultPlusCustom"
	| "none";

interface HighlightLegendEntry {
	text: string;
	swatchClass?: string;
}

const customStripeHighlight: VueHexCellClassResolver = ({ index }) => {
	if (index % 16 === 0) {
		return "vuehex-demo-byte--uppercase";
	}
	if (index % 16 === 15) {
		return "vuehex-demo-byte--lowercase";
	}
	return undefined;
};

const HIGHLIGHT_PRESETS: ReadonlyArray<{
	key: HighlightPresetKey;
	label: string;
	legend: HighlightLegendEntry[];
	resolver?: VueHexCellClassResolverInput | null;
}> = [
	{
		key: "defaultCategories",
		label: "Default ASCII categories",
		resolver: undefined,
		legend: [
			{
				text: "Digits 0-9",
				swatchClass: "story-highlight-swatch--digit",
			},
			{
				text: "Uppercase ASCII",
				swatchClass: "story-highlight-swatch--uppercase",
			},
			{
				text: "Lowercase ASCII",
				swatchClass: "story-highlight-swatch--lowercase",
			},
			{
				text: "Null bytes",
				swatchClass: "story-highlight-swatch--null",
			},
		],
	},
	{
		key: "customOnly",
		label: "Custom only (no defaults)",
		resolver: customStripeHighlight,
		legend: [
			{
				text: "Row start (index % 16 = 0)",
				swatchClass: "story-highlight-swatch--uppercase",
			},
			{
				text: "Row end (index % 16 = 15)",
				swatchClass: "story-highlight-swatch--lowercase",
			},
		],
	},
	{
		key: "defaultPlusCustom",
		label: "Default + custom (layered)",
		resolver: [
			DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER,
			customStripeHighlight,
		],
		legend: [
			{ text: "ASCII categories (built-in)" },
			{ text: "Row start/end stripes (custom)" },
		],
	},
	{
		key: "none",
		label: "None (disable highlighting)",
		legend: [],
		resolver: null,
	},
];

function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

function clampByte(value: number): number {
	const normalized = Math.trunc(value);
	if (!Number.isFinite(normalized)) {
		return 0;
	}
	return Math.max(0, Math.min(255, normalized));
}

function applyEditIntent(
	bytes: Uint8Array,
	intent: VueHexEditIntent,
): Uint8Array {
	switch (intent.kind) {
		case "overwrite-byte": {
			const index = Math.max(0, Math.trunc(intent.index));
			const requiredLength = Math.max(bytes.length, index + 1);
			const next = new Uint8Array(requiredLength);
			next.set(bytes, 0);
			next[index] = clampByte(intent.value);
			return next;
		}
		case "insert-byte": {
			const index = Math.max(
				0,
				Math.min(bytes.length, Math.trunc(intent.index)),
			);
			const next = new Uint8Array(bytes.length + 1);
			next.set(bytes.subarray(0, index), 0);
			next[index] = clampByte(intent.value);
			next.set(bytes.subarray(index), index + 1);
			return next;
		}
		case "overwrite-bytes": {
			const index = Math.max(0, Math.trunc(intent.index));
			const values = intent.values.map(clampByte);
			const requiredLength = Math.max(bytes.length, index + values.length);
			const next = new Uint8Array(requiredLength);
			next.set(bytes, 0);
			for (let i = 0; i < values.length; i += 1) {
				next[index + i] = values[i] ?? 0;
			}
			return next;
		}
		case "insert-bytes": {
			const index = Math.max(
				0,
				Math.min(bytes.length, Math.trunc(intent.index)),
			);
			const values = intent.values.map(clampByte);
			const next = new Uint8Array(bytes.length + values.length);
			next.set(bytes.subarray(0, index), 0);
			next.set(values, index);
			next.set(bytes.subarray(index), index + values.length);
			return next;
		}
		case "delete-byte": {
			if (bytes.length <= 0) {
				return bytes;
			}
			const index = Math.trunc(intent.index);
			const removeIndex = intent.direction === "backspace" ? index - 1 : index;
			if (removeIndex < 0 || removeIndex >= bytes.length) {
				return bytes;
			}
			const next = new Uint8Array(bytes.length - 1);
			next.set(bytes.subarray(0, removeIndex), 0);
			next.set(bytes.subarray(removeIndex + 1), removeIndex);
			return next;
		}
		case "delete-range": {
			if (bytes.length <= 0) {
				return bytes;
			}
			const start = Math.max(
				0,
				Math.min(bytes.length - 1, Math.trunc(intent.start)),
			);
			const end = Math.max(
				0,
				Math.min(bytes.length - 1, Math.trunc(intent.end)),
			);
			const from = Math.min(start, end);
			const to = Math.max(start, end);
			const removeCount = Math.max(0, to - from + 1);
			if (removeCount <= 0) {
				return bytes;
			}
			const next = new Uint8Array(bytes.length - removeCount);
			next.set(bytes.subarray(0, from), 0);
			next.set(bytes.subarray(to + 1), from);
			return next;
		}
		case "undo":
		case "redo": {
			// The demo applier is stateless; history is handled by VueHex in buffer mode.
			// Windowed-mode consumers should implement their own history if desired.
			return bytes;
		}
		default: {
			const _exhaustive: never = intent;
			void _exhaustive;
			return bytes;
		}
	}
}

function sliceDemoData(offset: number, length: number): Uint8Array {
	const normalizedOffset = clamp(Math.trunc(offset), 0, DEMO_TOTAL_BYTES);
	const normalizedLength = Math.max(0, Math.trunc(length));
	const maxLength = Math.min(
		normalizedLength,
		DEMO_TOTAL_BYTES - normalizedOffset,
	);
	const buffer = new Uint8Array(maxLength);
	for (let index = 0; index < maxLength; index += 1) {
		const absoluteIndex = normalizedOffset + index;
		buffer[index] = (absoluteIndex * 37 + index * 13) % 256;
	}
	return buffer;
}

function createVirtualDataController(windowLength: number) {
	const totalBytes = DEMO_TOTAL_BYTES;
	const fallbackLength = Math.max(1, Math.trunc(windowLength));
	const windowData = ref(sliceDemoData(0, fallbackLength));
	const windowOffset = ref(0);

	const getSelectionData = (selectionStart: number, selectionEnd: number) => {
		const start = Math.max(0, Math.trunc(selectionStart));
		const end = Math.max(0, Math.trunc(selectionEnd));
		const from = Math.min(start, end);
		const to = Math.max(start, end);
		return sliceDemoData(from, to - from + 1);
	};

	const handleUpdateVirtualData = (payload: VueHexWindowRequest) => {
		// Log to Storybook actions panel
		action("updateVirtualData")(payload);

		const normalizedOffset = clamp(Math.trunc(payload.offset), 0, totalBytes);
		const requestedLength = Math.max(
			1,
			Math.trunc(payload.length || fallbackLength),
		);
		windowOffset.value = normalizedOffset;
		windowData.value = sliceDemoData(normalizedOffset, requestedLength);
	};

	return {
		totalBytes,
		windowData,
		windowOffset,
		handleUpdateVirtualData,
		getSelectionData,
	};
}

const meta: Meta<typeof VueHex> = {
	title: "Components/VueHex",
	component: VueHex,
	argTypes: {
		modelValue: { control: false },
		editable: {
			control: { type: "boolean" },
		},
		dataMode: {
			name: "data-mode",
			control: { type: "select" },
			options: ["auto", "buffer", "window"],
		},
		expandToContent: {
			name: "expand-to-content",
			control: { type: "boolean" },
		},
		statusbar: {
			name: "statusbar",
			control: { type: "radio" },
			options: [null, "top", "bottom"],
		},
		windowOffset: { control: false },
		totalSize: { control: false },
		cellClassForByte: { control: false },
	},
	parameters: {
		layout: "fullscreen",
	},
};

export default meta;

type Story = StoryObj<typeof meta>;

function createThemeStory(variant: ThemeVariant): Story {
	return {
		name: `${variant.title} theme`,
		args: {
			theme: variant.key,
		},
		parameters: {
			docs: {
				source: {
					language: "vue",
					code: `<template>
  <VueHex
    v-model="windowData"
    v-model:window-offset="windowOffset"
    :total-size="fileSize"
    :get-selection-data="getSelectionData"
    theme="${variant.key}"
    style="height: 300px"
    @updateVirtualData="handleUpdateVirtualData"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexWindowRequest } from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function readBytes(offset: number, length: number): Uint8Array {
  return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
  windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
  const from = Math.min(selectionStart, selectionEnd);
  const to = Math.max(selectionStart, selectionEnd);
  return readBytes(from, to - from + 1);
}
</script>`,
				},
			},
		},
		render: (args) => ({
			components: { VueHex },
			setup() {
				const windowLength = Math.max(
					1,
					(args.bytesPerRow ?? 16) * THEME_SAMPLE_ROWS,
				);
				const controller = createVirtualDataController(windowLength);
				const variantInfo = variant;
				return { args, ...controller, variantInfo };
			},
			template: `
				<div class="story-viewport story-viewport--column">
				  <section class="story-stack">
				    <header class="story-card__header">
				      <p class="story-card__eyebrow">Built-in theme</p>
				      <h3 class="story-card__title">{{ variantInfo.title }}</h3>
				      <p class="story-card__subtitle">{{ variantInfo.description }}</p>
				    </header>
				    <div class="story-demo">
				      <VueHex
				        v-bind="args"
				        v-model="windowData"
				        :window-offset="windowOffset"
				        :total-size="totalBytes"
				        :get-selection-data="getSelectionData"
				        style="height: 300px"
				        @updateVirtualData="handleUpdateVirtualData"
				      />
				    </div>
				    <p class="story-caption">
				      Apply <code>theme="{{ variantInfo.key }}"</code> to switch palettes in your own app.
				    </p>
				  </section>
				</div>
				`,
		}),
	};
}

export const VirtualBinding: Story = {
	name: "Virtual data",
	args: { dataMode: "window" },
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="windowData"
		data-mode="window"
    v-model:window-offset="windowOffset"
    :total-size="fileSize"
    :get-selection-data="getSelectionData"
    style="height: 320px"
    @updateVirtualData="handleUpdateVirtualData"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexWindowRequest } from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function readBytes(offset: number, length: number): Uint8Array {
  // Load bytes from disk / HTTP range / IndexedDB...
  return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
  // windowOffset is automatically synced via v-model:window-offset
  windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
  const from = Math.min(selectionStart, selectionEnd);
  const to = Math.max(selectionStart, selectionEnd);
  return readBytes(from, to - from + 1);
}
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 48);
			const controller = createVirtualDataController(windowLength);
			return { args, ...controller };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Data contract</p>
			      <h3 class="story-card__title">Virtual source demo</h3>
			      <p class="story-card__subtitle">
			        VueHex only renders what you send; scroll to trigger fresh windows.
			      </p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="totalBytes"
			        :get-selection-data="getSelectionData"
			        style="height: 320px"
			        @updateVirtualData="handleUpdateVirtualData"
			      />
			    </div>
			    <p class="story-caption">
			      Watch <code>updateVirtualData</code> fire in the actions panel whenever a new range is needed.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const SelfManagedDataset: Story = {
	name: "Self-managed data",
	args: { dataMode: "buffer" },
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex v-model="fullData" data-mode="buffer" style="height: 320px" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";

// Provide the full buffer; VueHex will virtualize rows internally.
const fullData = ref(new Uint8Array(await file.arrayBuffer()));
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const fullData = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
			return { args, fullData };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Full buffer</p>
			      <h3 class="story-card__title">Self-managed dataset</h3>
			      <p class="story-card__subtitle">
			        Hand VueHex the complete <code>Uint8Array</code>; it virtualizes rows on its own.
			      </p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="fullData"
			        style="height: 320px"
			      />
			    </div>
			    <p class="story-caption">
			      No <code>total-size</code> or <code>updateVirtualData</code> handler required -- ideal for fixtures or editor previews.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const StatusBar: Story = {
	name: "Status bar",
	args: {
		statusbar: "bottom",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex v-model="data" statusbar="bottom" style="height: 320px" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";

const data = ref(new Uint8Array(await file.arrayBuffer()));
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const fullData = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
			return { args, fullData };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">UI</p>
			      <h3 class="story-card__title">Status bar</h3>
			      <p class="story-card__subtitle">
			        Hover bytes to see offset/hex/ASCII, or drag to select a range.
			      </p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="fullData"
			        style="height: 320px"
			      />
			    </div>
			    <p class="story-caption">
			      Tip: shift-click extends the selection; <code>Esc</code> clears it; <code>Ctrl/Cmd+C</code> copies.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const Cursor: Story = {
	name: "Cursor",
	args: {
		cursor: true,
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="data"
    cursor
    v-model:cursorLocation="cursorLocation"
    style="height: 320px"
  />
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import VueHex from "vuehex";

const data = ref(new Uint8Array(await file.arrayBuffer()));
const cursorLocation = ref<number | null>(0);

// cursorLocation automatically updates via v-model
// You can watch it to react to cursor changes
watch(cursorLocation, (newLocation) => {
  console.log('Cursor moved to:', newLocation);
});
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const dataLength = Math.max(1, (args.bytesPerRow ?? 16) * 80);
			const fullData = ref(sliceDemoData(0, dataLength));
			const cursorLocation = ref<number | null>(0);
			return {
				args,
				fullData,
				dataLength,
				cursorLocation,
			};
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Interaction</p>
			      <h3 class="story-card__title">Cursor navigation</h3>
			      <p class="story-card__subtitle">
			        Enable <code>cursor</code> to navigate with arrow keys (when focused) or click a byte to move the cursor.
			      </p>
			    </header>
			    <div class="story-panel">
			      <p class="story-label">v-model:cursorLocation</p>
			      <p class="story-value">{{ cursorLocation === null ? 'null' : cursorLocation.toLocaleString() }}</p>
			      <p class="story-caption" style="margin-top: 0.5rem; opacity: 0.75;">
			        The cursor location automatically updates via two-way binding when you navigate with arrow keys or click bytes.
			      </p>
			    </div>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="fullData"
			        v-model:cursorLocation="cursorLocation"
			        style="height: 320px"
			      />
			    </div>
			    <p class="story-caption">
			      Click inside the viewer to focus it, then use <code>↑ ↓ ← →</code>. The cursor is rendered in both the hex and ASCII columns.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const Editable: Story = {
	name: "Editable",
	args: {
		dataMode: "buffer",
		editable: true,
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="data"
    data-mode="buffer"
    editable
    style="height: 320px"
    @edit="onEdit"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex, { type VueHexEditIntent } from "vuehex";

const data = ref(new Uint8Array(await file.arrayBuffer()));

function onEdit(intent: VueHexEditIntent) {
  // Optional: listen for edit intents (e.g. for undo/redo, persistence, etc.)
  console.log(intent);
}
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const fullData = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
			const handleEdit = (intent: unknown) => {
				action("edit")(intent);
			};

			return { args, fullData, handleEdit };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Editor</p>
			      <h3 class="story-card__title">Editable mode</h3>
			      <p class="story-card__subtitle">
			        Click hex/ASCII to choose a column; <code>Tab</code> toggles; <code>Insert</code> switches overwrite/insert; selection + paste work too.
			      </p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="fullData"
			        style="height: 320px"
			        @edit="handleEdit"
			      />
			    </div>
			    <p class="story-caption">
			      Edit intents are logged to the actions panel via <code>@edit</code>. Tip: select a range, then type/paste (or <code>Ctrl/Cmd+X</code> to cut).
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const EditableWindowed: Story = {
	name: "Editable (windowed)",
	args: {
		dataMode: "window",
		editable: true,
		cursor: true,
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="windowData"
    data-mode="window"
    :window-offset="windowOffset"
    :total-size="store.length"
    :get-selection-data="getSelectionData"
    editable
    style="height: 320px"
    @updateVirtualData="handleUpdateVirtualData"
    @edit="handleEdit"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex, { type VueHexEditIntent, type VueHexWindowRequest } from "vuehex";

const store = ref(new Uint8Array(await file.arrayBuffer()));
const windowOffset = ref(0);
const windowData = ref(new Uint8Array());
let windowLength = 0x4000;

function handleUpdateVirtualData(request: VueHexWindowRequest) {
  windowOffset.value = request.offset;
  windowLength = request.length ?? windowLength;
  windowData.value = store.value.slice(windowOffset.value, windowOffset.value + windowLength);
}

function getSelectionData(start: number, end: number) {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return store.value.slice(from, to + 1);
}

function handleEdit(intent: VueHexEditIntent) {
  // Apply the intent to your backing store, then refresh windowData.
  store.value = applyEditIntent(store.value, intent);
  windowOffset.value = Math.max(0, Math.min(windowOffset.value, store.value.length));
  windowData.value = store.value.slice(windowOffset.value, windowOffset.value + windowLength);
}
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const store = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
			const windowOffset = ref(0);
			const windowData = ref(new Uint8Array());
			const windowLength = ref(0x4000);

			const refreshWindow = () => {
				const start = clamp(windowOffset.value, 0, store.value.length);
				const end = Math.min(store.value.length, start + windowLength.value);
				windowData.value = store.value.slice(start, end);
			};

			const handleUpdateVirtualData = (payload: VueHexWindowRequest) => {
				action("updateVirtualData")(payload);
				windowOffset.value = clamp(payload.offset, 0, store.value.length);
				windowLength.value = Math.max(1, payload.length ?? windowLength.value);
				refreshWindow();
			};

			const getSelectionData = (
				selectionStart: number,
				selectionEnd: number,
			) => {
				const from = Math.min(selectionStart, selectionEnd);
				const to = Math.max(selectionStart, selectionEnd);
				return store.value.slice(from, to + 1);
			};

			const handleEdit = (intent: VueHexEditIntent) => {
				action("edit")(intent);
				store.value = applyEditIntent(store.value, intent);
				windowOffset.value = clamp(windowOffset.value, 0, store.value.length);
				refreshWindow();
			};

			refreshWindow();

			return {
				args,
				store,
				windowOffset,
				windowData,
				handleUpdateVirtualData,
				getSelectionData,
				handleEdit,
			};
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Editor contract</p>
			      <h3 class="story-card__title">Editable + windowed data</h3>
			      <p class="story-card__subtitle">
			        In <code>data-mode="window"</code>, VueHex emits edit intents; you apply them to your backing store and refresh <code>windowData</code>.
			      </p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="store.length"
			        :get-selection-data="getSelectionData"
			        style="height: 320px"
			        @updateVirtualData="handleUpdateVirtualData"
			        @edit="handleEdit"
			      />
			    </div>
			    <p class="story-caption">
			      Try paste in hex mode (whitespace is ignored). Cut uses <code>Ctrl/Cmd+X</code>.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const StatusBarLayouts: Story = {
	name: "Status bar layouts",
	args: {
		statusbar: "bottom",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="data"
    statusbar="bottom"
    :statusbar-layout="layout"
    style="height: 260px"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexStatusBarLayout } from "vuehex";

const data = ref(new Uint8Array(await file.arrayBuffer()));

const layout: VueHexStatusBarLayout = {
  left: [{ name: "offset", config: { format: "hex", pad: 8 } }, "hex"],
  middle: [{ name: "ascii", config: { quote: true } }],
  right: [{ name: "selection", config: { label: "Sel" } }],
};
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const fullData = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
			const layoutCenteredAscii: VueHexStatusBarLayout = {
				left: [
					{ name: "offset", config: { format: "hex", pad: 8, prefix: true } },
					{ name: "hex", config: { prefix: false } },
				],
				middle: [{ name: "ascii", config: { quote: true } }],
				right: [{ name: "selection", config: { label: "Sel" } }],
			};

			const layoutRightHeavy: VueHexStatusBarLayout = {
				left: ["selection"],
				middle: [],
				right: ["offset", "hex", "ascii"],
			};

			return {
				args,
				fullData,
				layoutCenteredAscii,
				layoutRightHeavy,
			};
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">UI</p>
			      <h3 class="story-card__title">Status bar layouts</h3>
			      <p class="story-card__subtitle">
			        Compare default status bar placement vs custom left/middle/right layouts.
			      </p>
			    </header>
			    <div class="story-demo" style="flex-direction: column; gap: 1.25rem;">
			      <div style="width: 100%;">
			        <p class="story-caption" style="margin-bottom: 0.5rem;">
			          Default layout (no <code>statusbarLayout</code>)
			        </p>
			        <VueHex v-bind="args" v-model="fullData" style="height: 220px" />
			      </div>
			      <div style="width: 100%;">
			        <p class="story-caption" style="margin-bottom: 0.5rem;">
			          Center ASCII + formatted offset
			        </p>
			        <VueHex
			          v-bind="args"
			          v-model="fullData"
			          :statusbar-layout="layoutCenteredAscii"
			          style="height: 220px"
			        />
			      </div>
			      <div style="width: 100%;">
			        <p class="story-caption" style="margin-bottom: 0.5rem;">
			          Selection on the left, cursor details on the right
			        </p>
			        <VueHex
			          v-bind="args"
			          v-model="fullData"
			          :statusbar-layout="layoutRightHeavy"
			          style="height: 220px"
			        />
			      </div>
			    </div>
			  </section>
			</div>
			`,
	}),
};

export const StatusBarSlots: Story = {
	name: "Status bar slots",
	args: {
		statusbar: "bottom",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
	<VueHex
		v-model="data"
		statusbar="bottom"
		:statusbar-layout="layout"
		style="height: 260px"
	>
		<template #statusbar-left>
			<span>Mode: RO</span>
		</template>

		<template #statusbar-middle>
			<span>View: Hex</span>
		</template>

		<template #statusbar-right>
			<span>Endian: LE</span>
		</template>
	</VueHex>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexStatusBarLayout } from "vuehex";

const data = ref(new Uint8Array(await file.arrayBuffer()));

// Place "slot" anywhere in the arrays to control relative order.
const layout: VueHexStatusBarLayout = {
	left: ["offset", "slot", "hex"],
	middle: ["ascii", "slot"],
	right: ["selection", "slot"],
};
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const fullData = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
			const layoutWithSlots: VueHexStatusBarLayout = {
				left: ["offset", "slot", "hex"],
				middle: ["ascii", "slot"],
				right: ["selection", "slot"],
			};
			return { args, fullData, layoutWithSlots };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">UI</p>
			      <h3 class="story-card__title">Status bar slots</h3>
			      <p class="story-card__subtitle">
			        Provide custom content via <code>#statusbar-left</code>, <code>#statusbar-middle</code>, and <code>#statusbar-right</code>.
			        Use <code>statusbarLayout</code> with the <code>"slot"</code> component name to position them.
			      </p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="fullData"
			        :statusbar-layout="layoutWithSlots"
			        style="height: 260px"
			      >
			        <template #statusbar-left>
			          <span style="display: inline-flex; gap: 0.4rem; white-space: nowrap;">
			            <span style="opacity: 0.75;">Mode</span>
			            <span style="font-weight: 600;">RO</span>
			          </span>
			        </template>
			        <template #statusbar-middle>
			          <span style="display: inline-flex; gap: 0.4rem; white-space: nowrap;">
			            <span style="opacity: 0.75;">View</span>
			            <span style="font-weight: 600;">Hex</span>
			          </span>
			        </template>
			        <template #statusbar-right>
			          <span style="display: inline-flex; gap: 0.4rem; white-space: nowrap;">
			            <span style="opacity: 0.75;">Endian</span>
			            <span style="font-weight: 600;">LE</span>
			          </span>
			        </template>
			      </VueHex>
			    </div>
			    <p class="story-caption">
			      The <code>"slot"</code> entry can be placed anywhere inside each section array to control its relative position.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const ExpandToContent: Story = {
	name: "Expand to content (no internal scroll)",
	args: {
		expandToContent: true,
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex v-model="data" expand-to-content />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";

const data = ref(new Uint8Array(await file.arrayBuffer()));
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const dataLength = Math.max(
				1,
				(args.bytesPerRow ?? 16) * EXPAND_TO_CONTENT_ROWS,
			);
			const fullData = ref(sliceDemoData(0, dataLength));
			return { args, fullData, dataLength };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Layout</p>
			      <h3 class="story-card__title">Expand to content</h3>
			      <p class="story-card__subtitle">
			        Disable internal scrolling/virtualization and let the component grow to fit <code>v-model</code>.
			      </p>
			    </header>
			    <div class="story-demo" style="min-height: unset; align-items: flex-start;">
			      <VueHex
			        v-bind="args"
			        v-model="fullData"
			      />
			    </div>
			    <p class="story-caption">
			      This story renders {{ dataLength.toLocaleString() }} bytes without a fixed height. The page scrolls; the component does not.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const AsciiPrintablePresets: Story = {
	name: "ASCII printability presets",
	args: {
		nonPrintableChar: ".",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
	<VueHex
		v-model="windowData"
		:window-offset="windowOffset"
		:total-size="fileSize"
		:get-selection-data="getSelectionData"
		:is-printable="isPrintable"
		:render-ascii="renderAscii"
		non-printable-char="."
		style="height: 320px"
		@updateVirtualData="handleUpdateVirtualData"
	/>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexWindowRequest } from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function readBytes(offset: number, length: number): Uint8Array {
	return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
	windowOffset.value = payload.offset;
	windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
	const from = Math.min(selectionStart, selectionEnd);
	const to = Math.max(selectionStart, selectionEnd);
	return readBytes(from, to - from + 1);
}

function isPrintable(byte: number) {
	return byte >= 0x20 && byte <= 0x7e;
}

function renderAscii(byte: number) {
	return String.fromCharCode(byte);
}
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 40);
			const controller = createVirtualDataController(windowLength);
			const presetKey = ref<AsciiPresetKey>("standard");
			const presetEntries = ASCII_PRESET_OPTIONS;
			const activePreset = computed(
				() => VUE_HEX_ASCII_PRESETS[presetKey.value],
			);
			return {
				args,
				...controller,
				presetKey,
				presetEntries,
				activePreset,
			};
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">ASCII rendering</p>
			      <h3 class="story-card__title">Choose printable byte ranges</h3>
			      <p class="story-card__subtitle">
			        Swap between the built-in helpers or wire up a custom <code>isPrintable</code> function.
			      </p>
			    </header>
			    <div class="story-panel">
			      <label class="story-label" for="ascii-preset">ASCII preset</label>
			      <select id="ascii-preset" v-model="presetKey" style="width: 100%; padding: 0.4rem 0.5rem;">
			        <option
			          v-for="option in presetEntries"
			          :key="option.key"
			          :value="option.key"
			        >
			          {{ option.label }}
			        </option>
			      </select>
			      <p class="story-caption" style="margin-top: 0.5rem;">
			        Printable bytes follow <code>{{ activePreset.label }}</code>.
			      </p>
			    </div>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="totalBytes"
			        :get-selection-data="getSelectionData"
			        :is-printable="activePreset.isPrintable"
			        :render-ascii="activePreset.renderAscii"
			        style="height: 320px"
			        @updateVirtualData="handleUpdateVirtualData"
			      />
			    </div>
			    <p class="story-caption">
			      Lookups receive a raw byte value, so you can treat control codes, Latin-1, or even domain-specific tokens as printable characters.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const CellClassHighlighting: Story = {
	name: "Highlight bytes with cellClassForByte",
	args: {},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
	<VueHex
		v-model="windowData"
		:window-offset="windowOffset"
		:total-size="fileSize"
		:get-selection-data="getSelectionData"
		:cell-class-for-byte="cellClassForByte"
		style="height: 320px"
		@updateVirtualData="handleUpdateVirtualData"
	/>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import {
	DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER,
	type VueHexCellClassResolver,
	type VueHexCellClassResolverInput,
	type VueHexWindowRequest,
} from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function readBytes(offset: number, length: number): Uint8Array {
	return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
	windowOffset.value = payload.offset;
	windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
	const from = Math.min(selectionStart, selectionEnd);
	const to = Math.max(selectionStart, selectionEnd);
	return readBytes(from, to - from + 1);
}

// Disable all highlighting (including the built-in ASCII categories).
// const cellClassForByte: VueHexCellClassResolverInput | null = null;

// Keep the built-in ASCII categories AND add custom classes.
const customHighlight: VueHexCellClassResolver = ({ index }) => {
	if (index % 16 === 0) {
		return "my-row-start";
	}
	if (index % 16 === 15) {
		return "my-row-end";
	}
	return undefined;
};

const cellClassForByte: VueHexCellClassResolverInput = [
	DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER,
	customHighlight,
];

</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 40);
			const controller = createVirtualDataController(windowLength);
			const highlightEntries = HIGHLIGHT_PRESETS;
			const highlightKey = ref<HighlightPresetKey>("defaultCategories");
			const activeHighlight = computed(
				() =>
					highlightEntries.find((entry) => entry.key === highlightKey.value) ??
					highlightEntries[0] ?? {
						key: "none",
						label: "None (disable highlighting)",
						legend: [],
						resolver: null,
					},
			);
			const cellClassForByte = computed(() => activeHighlight.value.resolver);
			return {
				args,
				...controller,
				highlightEntries,
				highlightKey,
				activeHighlight,
				cellClassForByte,
			};
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Highlighting</p>
			      <h3 class="story-card__title">Style bytes by category</h3>
			      <p class="story-card__subtitle">
			        Drive custom classes through <code>cellClassForByte</code> to colorize ASCII groups or surface search hits.
			      </p>
			    </header>
			    <div class="story-panel">
			      <label class="story-label" for="highlight-preset">Highlight preset</label>
			      <select
			        id="highlight-preset"
			        v-model="highlightKey"
			        style="width: 100%; padding: 0.4rem 0.5rem;"
			      >
			        <option
			          v-for="option in highlightEntries"
			          :key="option.key"
			          :value="option.key"
			        >
			          {{ option.label }}
			        </option>
			      </select>
			      <div class="story-highlight-legend">
			        <h4 class="story-highlight-legend__title">Legend</h4>
			        <ul
			          v-if="activeHighlight.legend.length"
			          class="story-highlight-legend__list"
			        >
			          <li
			            v-for="entry in activeHighlight.legend"
			            :key="entry.text"
			            class="story-highlight-legend__item"
			          >
			            <span
			              class="story-highlight-legend__swatch"
			              :class="entry.swatchClass"
			              aria-hidden="true"
			            ></span>
			            {{ entry.text }}
			          </li>
			        </ul>
			        <p v-else class="story-highlight-legend__empty">
					  Highlighting disabled. Select "Default ASCII categories" to restore the built-in colors.
			        </p>
			      </div>
			    </div>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="totalBytes"
			        :get-selection-data="getSelectionData"
			        :cell-class-for-byte="cellClassForByte"
			        style="height: 320px"
			        @updateVirtualData="handleUpdateVirtualData"
			      />
			    </div>
			    <p class="story-caption">
			      Swap presets to show how <code>cellClassForByte</code> can toggle between live categorization and plain output.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const ChunkNavigatorHover: Story = {
	name: "Chunk navigator + hover",
	args: {
		showChunkNavigator: true,
		chunkNavigatorPlacement: "left",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
	<VueHex
		v-model="windowData"
		:window-offset="windowOffset"
		:total-size="fileSize"
		:get-selection-data="getSelectionData"
		:show-chunk-navigator="true"
		chunk-navigator-placement="left"
		:cell-class-for-byte="cellClassForByte"
		style="height: 360px"
		@updateVirtualData="handleUpdateVirtualData"
		@hex-hover-on="handleHover"
		@hex-hover-off="clearHover"
		@ascii-hover-on="handleHover"
		@ascii-hover-off="clearHover"
	/>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import VueHex from "vuehex";
import type { VueHexCellClassResolver, VueHexWindowRequest } from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);
const hoverIndex = ref<number | null>(null);

function readBytes(offset: number, length: number): Uint8Array {
	return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
	windowOffset.value = payload.offset;
	windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
	const from = Math.min(selectionStart, selectionEnd);
	const to = Math.max(selectionStart, selectionEnd);
	return readBytes(from, to - from + 1);
}

function handleHover(payload: { index: number }) {
	hoverIndex.value = payload.index;
}

function clearHover() {
	hoverIndex.value = null;
}

const cellClassForByte: VueHexCellClassResolver = ({ index }) =>
	hoverIndex.value === index ? "my-active-byte" : undefined;
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(1, (args.bytesPerRow ?? 32) * 48);
			const controller = createVirtualDataController(windowLength);
			const hoverIndex = ref<number | null>(null);

			const handleHover = (payload: { index: number }) => {
				hoverIndex.value = payload.index;
			};

			const clearHover = () => {
				hoverIndex.value = null;
			};

			const cellClassForByte: VueHexCellClassResolver = ({ index }) =>
				hoverIndex.value === index ? "story-byte--active" : undefined;

			const formatOffset = (index: number) =>
				`0x${index.toString(16).toUpperCase().padStart(4, "0")}`;

			return {
				args,
				...controller,
				hoverIndex,
				handleHover,
				clearHover,
				cellClassForByte,
				formatOffset,
			};
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Navigation</p>
			      <h3 class="story-card__title">Chunk navigator + linked hover</h3>
			      <p class="story-card__subtitle">
			        Jump across massive files while mirroring hover state between hex + ASCII columns.
			      </p>
			    </header>
			    <div class="story-demo story-demo--tall">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="totalBytes"
			        :get-selection-data="getSelectionData"
			        :cell-class-for-byte="cellClassForByte"
			        style="height: 360px"
			        @updateVirtualData="handleUpdateVirtualData"
			        @hex-hover-on="handleHover"
			        @hex-hover-off="clearHover"
			        @ascii-hover-on="handleHover"
			        @ascii-hover-off="clearHover"
			      />
			    </div>
			    <p class="story-caption story-caption--mono">
			      <span v-if="hoverIndex !== null">Active byte: {{ formatOffset(hoverIndex) }}</span>
			      <span v-else>Move your pointer over the table to see the linked highlight index.</span>
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const ChunkNavigatorCustomTemplate: Story = {
	name: "Chunk navigator custom templates",
	args: {
		showChunkNavigator: true,
		chunkNavigatorPlacement: "right",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="windowData"
    :window-offset="windowOffset"
    :total-size="fileSize"
    :get-selection-data="getSelectionData"
    :show-chunk-navigator="true"
    chunk-navigator-placement="right"
    style="height: 360px"
    @updateVirtualData="handleUpdateVirtualData"
  >
    <template #chunk-navigator-header="{ chunks, activeIndex }">
      <div style="padding: 0.5rem; border-bottom: 2px solid rgba(96, 165, 250, 0.3);">
        <h3 style="margin: 0; font-size: 1rem; color: #60a5fa;">File Segments</h3>
        <p style="margin: 0.25rem 0 0; font-size: 0.75rem; opacity: 0.8;">
          {{ chunks.length }} segments · Viewing #{{ activeIndex + 1 }}
        </p>
      </div>
    </template>
    
    <template #chunk-navigator-item="{ chunk, active }">
      <div :style="{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        padding: active ? '0.5rem' : '0.4rem',
        borderLeft: active ? '3px solid #60a5fa' : '3px solid transparent',
        backgroundColor: active ? 'rgba(96, 165, 250, 0.15)' : 'transparent'
      }">
        <span :style="{ fontWeight: active ? '700' : '600', fontSize: '0.85rem' }">
          📦 {{ chunk.label }}
        </span>
        <span style="font-size: 0.7rem; opacity: 0.7; font-family: monospace;">
          {{ chunk.range }}
        </span>
      </div>
    </template>
  </VueHex>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexWindowRequest } from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function readBytes(offset: number, length: number): Uint8Array {
  return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
  windowOffset.value = payload.offset;
  windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
  const from = Math.min(selectionStart, selectionEnd);
  const to = Math.max(selectionStart, selectionEnd);
  return readBytes(from, to - from + 1);
}
</script>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 48);
			const controller = createVirtualDataController(windowLength);
			return { args, ...controller };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Customization</p>
			      <h3 class="story-card__title">Custom chunk navigator templates</h3>
			      <p class="story-card__subtitle">
			        Use slots to customize the chunk navigator header and individual chunk items with your own styles and layout.
			      </p>
			    </header>
			    <div class="story-demo story-demo--tall">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="totalBytes"
			        :get-selection-data="getSelectionData"
			        style="height: 360px"
			        @updateVirtualData="handleUpdateVirtualData"
			      >
			        <template #chunk-navigator-header="{ chunks, activeIndex }">
			          <div style="padding: 0.5rem; border-bottom: 2px solid rgba(96, 165, 250, 0.3);">
			            <h3 style="margin: 0; font-size: 1rem; color: #60a5fa;">File Segments</h3>
			            <p style="margin: 0.25rem 0 0; font-size: 0.75rem; opacity: 0.8;">
			              {{ chunks.length }} segments · Viewing #{{ activeIndex + 1 }}
			            </p>
			          </div>
			        </template>
			        
			        <template #chunk-navigator-item="{ chunk, active }">
			          <div :style="{
			            display: 'flex',
			            flexDirection: 'column',
			            gap: '0.25rem',
			            padding: active ? '0.5rem' : '0.4rem',
			            borderLeft: active ? '3px solid #60a5fa' : '3px solid transparent',
			            backgroundColor: active ? 'rgba(96, 165, 250, 0.15)' : 'transparent'
			          }">
			            <span :style="{ fontWeight: active ? '700' : '600', fontSize: '0.85rem' }">
			              📦 {{ chunk.label }}
			            </span>
			            <span style="font-size: 0.7rem; opacity: 0.7; font-family: monospace;">
			              {{ chunk.range }}
			            </span>
			          </div>
			        </template>
			      </VueHex>
			    </div>
			    <p class="story-caption">
			      The <code>#chunk-navigator-header</code> slot provides access to <code>chunks</code> and <code>activeIndex</code>.
			      The <code>#chunk-navigator-item</code> slot gives you <code>chunk</code>, <code>active</code>, and <code>select</code> function for each item.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const ThemeDark = createThemeStory(THEME_VARIANTS[0]);
export const ThemeLight = createThemeStory(THEME_VARIANTS[1]);
export const ThemeTerminal = createThemeStory(THEME_VARIANTS[2]);
export const ThemeSunset = createThemeStory(THEME_VARIANTS[3]);

export const CustomTheme: Story = {
	name: "Custom theme",
	args: {
		theme: "storybook-custom",
		bytesPerRow: 8,
		statusbar: "bottom",
		showChunkNavigator: true,
		chunkNavigatorPlacement: "left",
	},
	parameters: {
		docs: {
			source: {
				language: "vue",
				code: `<template>
  <VueHex
    v-model="windowData"
    :window-offset="windowOffset"
    :total-size="fileSize"
    :get-selection-data="getSelectionData"
		:bytes-per-row="8"
		statusbar="bottom"
		:show-chunk-navigator="true"
		chunk-navigator-placement="left"
		theme="storybook-custom"
    style="height: 300px"
    @updateVirtualData="handleUpdateVirtualData"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import VueHex from "vuehex";
import type { VueHexWindowRequest } from "vuehex";

const fileSize = 4 * 1024 * 1024;
const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function readBytes(offset: number, length: number): Uint8Array {
  return new Uint8Array(length);
}

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
  windowOffset.value = payload.offset;
  windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}

function getSelectionData(selectionStart: number, selectionEnd: number) {
  const from = Math.min(selectionStart, selectionEnd);
  const to = Math.max(selectionStart, selectionEnd);
  return readBytes(from, to - from + 1);
}
</script>

<style>
/* Provide CSS for .vuehex-theme-storybook-custom (see docs for tokens). */
.vuehex-theme-storybook-custom {
	--vuehex-background: radial-gradient(
		circle at 25% 20%,
		#312e81,
		#1e1b4b 55%,
		#0f0a1f
	);
	--vuehex-foreground: #e0e7ff;
	--vuehex-border-color: rgba(99, 102, 241, 0.5);
	--vuehex-offset-color: rgba(191, 219, 254, 0.9);
	--vuehex-offset-leading-opacity: 0.55;
	--vuehex-row-divider: rgba(99, 102, 241, 0.25);
	--vuehex-byte-color: #fef9c3;
	--vuehex-ascii-color: #c7d2fe;
	--vuehex-ascii-non-printable-color: rgba(199, 210, 254, 0.55);
	--vuehex-ascii-column-border: rgba(99, 102, 241, 0.35);
	--vuehex-mid-column-gutter: 2ch;

	/* Status bar + chunk navigator surfaces */
	--vuehex-ui-background: rgba(15, 10, 31, 0.78);
	--vuehex-ui-foreground: var(--vuehex-foreground);
	--vuehex-ui-border-color: rgba(129, 140, 248, 0.55);
	--vuehex-ui-shadow: 0 18px 40px rgba(15, 23, 42, 0.5);
	--vuehex-ui-button-border-color: rgba(129, 140, 248, 0.25);
	--vuehex-ui-button-border-color-hover: rgba(129, 140, 248, 0.5);
	--vuehex-ui-button-border-color-active: rgba(251, 191, 36, 0.8);
	--vuehex-ui-button-background: rgba(129, 140, 248, 0.12);
	--vuehex-ui-button-background-hover: rgba(129, 140, 248, 0.18);
	--vuehex-ui-button-background-active: rgba(251, 191, 36, 0.16);
	--vuehex-ui-focus-ring-color: rgba(251, 191, 36, 0.75);
	box-shadow: 0 20px 45px rgba(15, 23, 42, 0.55);
}

.vuehex-theme-storybook-custom .vuehex-byte.vuehex-linked-hover,
.vuehex-theme-storybook-custom .vuehex-ascii-char.vuehex-linked-hover {
	background: rgba(251, 191, 36, 0.35);
	outline-color: rgba(255, 255, 255, 0.4);
}
</style>`,
			},
		},
	},
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(
				1,
				(args.bytesPerRow ?? 16) * THEME_SAMPLE_ROWS,
			);
			const controller = createVirtualDataController(windowLength);
			return { args, ...controller };
		},
		template: `
			<div class="story-viewport story-viewport--column">
			  <section class="story-stack">
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Custom CSS</p>
			      <h3 class="story-card__title">Aurora blueprint</h3>
			      <p class="story-card__subtitle">Define your own token and supply matching CSS.</p>
			    </header>
			    <div class="story-demo">
			      <VueHex
			        v-bind="args"
			        v-model="windowData"
			        :window-offset="windowOffset"
			        :total-size="totalBytes"
			        :get-selection-data="getSelectionData"
			        style="height: 300px"
			        @updateVirtualData="handleUpdateVirtualData"
			      />
			    </div>
			    <p class="story-caption">
			      Target the emitted <code>.vuehex-theme-storybook-custom</code> selector to restyle every surface.
			    </p>
			  </section>
			</div>
			`,
	}),
};

export const InteractiveEvents: StoryObj<typeof VueHex> = (() => {
	return {
		name: "Interactive Events",
		args: {
			dataMode: "buffer",
			bytesPerRow: 16,
			uppercase: false,
			theme: "dark",
			cursor: true,
		},
		render: (args) => ({
			components: { VueHex },
			setup() {
				const data = ref(sliceDemoData(0, SELF_MANAGED_BYTES));
				const lastByteClick = ref<{
					index: number;
					byte: number;
					kind: string;
				} | null>(null);
				const lastSelection = ref<{
					start: number | null;
					end: number | null;
					length: number;
				} | null>(null);

				const handleByteClick = (payload: {
					index: number;
					byte: number;
					kind: "hex" | "ascii";
				}) => {
					lastByteClick.value = payload;
				};

				const handleSelectionChange = (payload: {
					start: number | null;
					end: number | null;
					length: number;
				}) => {
					lastSelection.value = payload;
				};

				const formatHex = (value: number) => {
					return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
				};

				return {
					args,
					data,
					lastByteClick,
					lastSelection,
					handleByteClick,
					handleSelectionChange,
					formatHex,
				};
			},
			template: `
				<div class="story-viewport story-viewport--column">
				  <section class="story-stack">
				    <header class="story-card__header">
				      <p class="story-card__eyebrow">Interaction</p>
				      <h3 class="story-card__title">Byte Click & Selection Events</h3>
				      <p class="story-card__subtitle">Listen to <code>byte-click</code> and <code>selection-change</code> events for custom interactions.</p>
				    </header>
				    <div class="story-demo">
				      <VueHex
				        v-bind="args"
				        v-model="data"
				        style="height: 400px"
				        @byte-click="handleByteClick"
				        @selection-change="handleSelectionChange"
				      />
				    </div>
				    <div class="story-event-log">
				      <div class="story-event-card">
				        <h4 class="story-event-title">Last Byte Click</h4>
				        <div v-if="lastByteClick" class="story-event-content">
				          <div><strong>Index:</strong> {{ lastByteClick.index }} ({{ formatHex(lastByteClick.index) }})</div>
				          <div><strong>Value:</strong> {{ lastByteClick.byte }} ({{ formatHex(lastByteClick.byte) }})</div>
				          <div><strong>Column:</strong> {{ lastByteClick.kind }}</div>
				        </div>
				        <div v-else class="story-event-empty">Click on a byte to see details</div>
				      </div>
				      <div class="story-event-card">
				        <h4 class="story-event-title">Current Selection</h4>
				        <div v-if="lastSelection && lastSelection.start !== null" class="story-event-content">
				          <div><strong>Start:</strong> {{ lastSelection.start }} ({{ formatHex(lastSelection.start) }})</div>
				          <div><strong>End:</strong> {{ lastSelection.end }} ({{ formatHex(lastSelection.end ?? 0) }})</div>
				          <div><strong>Length:</strong> {{ lastSelection.length }} bytes</div>
				        </div>
				        <div v-else class="story-event-empty">Select bytes to see range</div>
				      </div>
				    </div>
				    <p class="story-caption">
				      Click individual bytes to trigger <code>byte-click</code> events. Click and drag to select a range and watch <code>selection-change</code> update in real-time.
				    </p>
				  </section>
				</div>
			`,
		}),
	};
})();
