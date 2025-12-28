import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { computed, ref } from "vue";
import VueHex from "@/components/VueHex.vue";
import "./vuehex-custom-theme.css";
import type {
	VueHexCellClassResolver,
	VueHexWindowRequest,
} from "@/components/vuehex-api";
import { VUE_HEX_ASCII_PRESETS } from "@/components/vuehex-api";

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

type HighlightPresetKey = "asciiCategories" | "none";

interface HighlightLegendEntry {
	text: string;
	swatchClass?: string;
}

const asciiCategoryHighlight: VueHexCellClassResolver = ({ byte }) => {
	if (byte >= 0x30 && byte <= 0x39) {
		return "vuehex-demo-byte--digit";
	}
	if (byte >= 0x41 && byte <= 0x5a) {
		return "vuehex-demo-byte--uppercase";
	}
	if (byte >= 0x61 && byte <= 0x7a) {
		return "vuehex-demo-byte--lowercase";
	}
	if (byte === 0x00) {
		return "vuehex-demo-byte--null";
	}
	return undefined;
};

const HIGHLIGHT_PRESETS: ReadonlyArray<{
	key: HighlightPresetKey;
	label: string;
	legend: HighlightLegendEntry[];
	resolver?: VueHexCellClassResolver;
}> = [
	{
		key: "asciiCategories",
		label: "ASCII categories (default)",
		resolver: asciiCategoryHighlight,
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
		key: "none",
		label: "None (disable highlighting)",
		legend: [],
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
		expandToContent: {
			name: "expand-to-content",
			control: { type: "boolean" },
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
	args: {},
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
	args: {},
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

export const ExpandToContent: Story = {
	name: "Expand to content (no internal scroll)",
	args: {
		expandToContent: true,
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
	render: (args) => ({
		components: { VueHex },
		setup() {
			const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 40);
			const controller = createVirtualDataController(windowLength);
			const highlightEntries = HIGHLIGHT_PRESETS;
			const highlightKey = ref<HighlightPresetKey>("asciiCategories");
			const activeHighlight = computed(
				() =>
					highlightEntries.find((entry) => entry.key === highlightKey.value) ??
					highlightEntries[0] ?? {
						key: "none",
						label: "None (disable highlighting)",
						legend: [],
						resolver: () => "",
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
			          Highlighting disabled. Select "ASCII categories" to restore the default colors.
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

export const ThemeDark = createThemeStory(THEME_VARIANTS[0]);
export const ThemeLight = createThemeStory(THEME_VARIANTS[1]);
export const ThemeTerminal = createThemeStory(THEME_VARIANTS[2]);
export const ThemeSunset = createThemeStory(THEME_VARIANTS[3]);

export const CustomTheme: Story = {
	name: "Custom theme",
	args: {
		theme: "storybook-custom",
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
