import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import VueHex from "@/components/VueHex.vue";
import "./vuehex-custom-theme.css";
import type {
	VueHexCellClassResolver,
	VueHexWindowRequest,
} from "@/components/vuehex-api";

const DEMO_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MiB of procedurally generated data
const SELF_MANAGED_BYTES = 64 * 1024; // 64 KiB sample for the full-data demo
const THEME_SAMPLE_ROWS = 32;

const THEME_VARIANTS = [
	{
		key: "default",
		title: "Deep Space",
		description: "High-contrast midnight palette for long debugging sessions.",
	},
	{
		key: "light",
		title: "Daylight",
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

	const handleUpdateVirtualData = (payload: VueHexWindowRequest) => {
		const normalizedOffset = clamp(Math.trunc(payload.offset), 0, totalBytes);
		const requestedLength = Math.max(
			1,
			Math.trunc(payload.length || fallbackLength),
		);
		windowOffset.value = normalizedOffset;
		windowData.value = sliceDemoData(normalizedOffset, requestedLength);
	};

	return { totalBytes, windowData, windowOffset, handleUpdateVirtualData };
}

const meta: Meta<typeof VueHex> = {
	title: "Components/VueHex",
	component: VueHex,
	tags: ["autodocs"],
	argTypes: {
		modelValue: { control: false },
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
			bytesPerRow: 16,
			overscan: 2,
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
		parameters: {
			docs: {
				description: {
					story: `
**When to use it**

Lean on the ${variant.title} palette whenever you want ${variant.description.toLowerCase()}
without building your own token map.

**Usage**

\`\`\`vue
<template>
  <VueHex
    theme="${variant.key}"
    :bytes-per-row="16"
    :overscan="2"
    v-model="windowData"
    :window-offset="windowOffset"
    :total-size="totalBytes"
    @updateVirtualData="handleUpdateVirtualData"
  />
</template>
\`\`\`

**Details**

- Themes are pure CSS: switching values never triggers re-computation inside VueHex.
- Combine with chunk navigation, hover linking, or full data mode--the palette layers on top of any other story.
- Override individual CSS custom properties (for example \`--vuehex-byte-color\`) when you only need to tweak a small portion of the palette.
`,
				},
			},
		},
	};
}

export const VirtualBinding: Story = {
	name: "Virtual data",
	args: {
		bytesPerRow: 16,
		overscan: 4,
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
	parameters: {
		docs: {
			description: {
				story: `
**Concept**

VueHex renders only a sliver of the backing file. As you scroll, it emits
\`updateVirtualData\` describing which slice is needed next so you can fetch it
from disk, over the network, or from an IndexedDB cache.

**Event payload**

\`ts
type VueHexWindowRequest = {
  offset: number; // byte index to start reading from
  length: number; // preferred chunk length; use as a hint when allocating buffers
};
\`

**Typical usage**

\`vue
<template>
  <VueHex
    :bytes-per-row="16"
    :overscan="4"
    v-model="windowData"
    :window-offset="windowOffset"
    :total-size="fileSize"
    @updateVirtualData="handleUpdateVirtualData"
  />
</template>

<script setup lang="ts">
import type { VueHexWindowRequest } from "@/components/vuehex-api";

const windowData = ref(new Uint8Array());
const windowOffset = ref(0);

function handleUpdateVirtualData(payload: VueHexWindowRequest) {
  windowOffset.value = payload.offset;
  windowData.value = readBytes(payload.offset, payload.length ?? 0x4000);
}
</script>
\`

**Notes**

- Emit \`total-size\` even if you stream from a socket--VueHex uses it to size the scrollbar.
- You can debounce expensive fetches, but always resolve them in order so the table does not briefly display stale chunks.
- When providing \`modelValue\` ref objects, prefer reusing buffers to avoid GC churn; the story uses fresh arrays for clarity.
`,
			},
		},
	},
};

export const SelfManagedDataset: Story = {
	name: "Self-managed data",
	args: {
		bytesPerRow: 24,
		overscan: 2,
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
	parameters: {
		docs: {
			description: {
				story: `
**Why this exists**

Not every viewer needs streaming. When you already have a \`Uint8Array\`--for
example from drag-and-drop, clipboard paste, or a fixture in Storybook--VueHex
can virtualize internally without ever emitting \`updateVirtualData\`.

**Usage**

\`\`\`vue
<template>
  <VueHex v-model="fullData" :bytes-per-row="24" />
</template>

<script setup lang="ts">
const fullData = ref(await file.arrayBuffer().then((buf) => new Uint8Array(buf)));
</script>
\`\`\`

**Behavior**

- The component detects "self-managed" mode when no \`updateVirtualData\` listener
  exists and no \`total-size\` prop is supplied.
- Chunking still happens internally; VueHex just slices the provided array instead
  of calling back out to you.
- You can still mutate \`fullData.value\` (e.g., to highlight differences or to
  replace a selection) and VueHex will re-render the affected rows.
- If you later supply \`total-size\` or an \`updateVirtualData\` handler, the
  component flips back to external virtualization automatically.
`,
			},
		},
	},
};

export const ChunkNavigatorHover: Story = {
	name: "Chunk navigator + hover",
	args: {
		bytesPerRow: 16,
		overscan: 3,
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
	parameters: {
		docs: {
			description: {
				story: `
**What it demonstrates**

- The chunk navigator exposes a mini-map for multi-megabyte buffers.
- Hex and ASCII columns emit synchronized hover events so you can decorate
  related UI (status bars, disassembly panes, etc.).

**Hover events**

\`\`\`ts
type HoverPayload = { index: number };
// Events: "hex-hover-on", "hex-hover-off", "ascii-hover-on", "ascii-hover-off"
// "*-on" events include the payload above. "*-off" events emit no payload.
\`\`\`

**Usage**

\`\`\`vue
<VueHex
  :show-chunk-navigator="true"
  chunk-navigator-placement="left"
  :cell-class-for-byte="cellClassForByte"
  v-model="windowData"
  :window-offset="windowOffset"
  :total-size="totalBytes"
  @hex-hover-on="handleHover"
  @hex-hover-off="clearHover"
  @ascii-hover-on="handleHover"
  @ascii-hover-off="clearHover"
  @updateVirtualData="handleUpdateVirtualData"
/>
\`\`\`

**Implementation notes**

- The chunk navigator works without additional props--\`total-size\` alone lets it
  compute proportional blocks--but providing \`showChunkNavigator\` clarifies intent.
- Returning \`story-byte--active\` from \`cellClassForByte\` is just an example; you
  can return any CSS class to highlight ranges, diffs, or search matches.
- Hover payloads are absolute byte indexes (relative to the full file), not the
  current window offset, which keeps downstream consumers simple.
`,
			},
		},
	},
};

export const ThemeDefault = createThemeStory(THEME_VARIANTS[0]!);
export const ThemeLight = createThemeStory(THEME_VARIANTS[1]!);
export const ThemeTerminal = createThemeStory(THEME_VARIANTS[2]!);
export const ThemeSunset = createThemeStory(THEME_VARIANTS[3]!);

export const CustomTheme: Story = {
	name: "Custom theme",
	args: {
		theme: "storybook-custom",
		bytesPerRow: 16,
		overscan: 2,
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
	parameters: {
		docs: {
			description: {
				story: `
**Goal**

Ship a totally bespoke art direction while keeping VueHex's structure intact.
Attach your own stylesheet, target the emitted \`.vuehex-theme-<token>\` class,
and redefine the CSS custom properties the component consumes.

**How to wire it up**

\`\`\`vue
<template>
  <VueHex theme="storybook-custom" v-model="windowData" />
</template>

<style scoped src="./vuehex-custom-theme.css"></style>
\`\`\`

**Available CSS variables**

- \`--vuehex-background\`, \`--vuehex-foreground\`, \`--vuehex-border-color\`
- \`--vuehex-offset-color\`, \`--vuehex-offset-leading-opacity\`
- \`--vuehex-row-divider\`, \`--vuehex-byte-color\`
- \`--vuehex-ascii-color\`, \`--vuehex-ascii-non-printable-color\`
- \`--vuehex-ascii-column-border\`, \`--vuehex-mid-column-gutter\`

**Structural selectors**

\`\`\`css
.vuehex-theme-your-token .vuehex-byte { /* hex column cells */ }
.vuehex-theme-your-token .vuehex-ascii-char { /* ASCII column */ }
.vuehex-theme-your-token .vuehex-byte.vuehex-linked-hover { /* shared hover */ }
.vuehex-theme-your-token .vuehex-ascii-char.vuehex-linked-hover { /* ASCII hover */ }
\`\`\`

Pair those hooks with gradients, shadows, or data-URI textures to match your
brand. Because themes are pure CSS, no recompilation is necessary--just load the
stylesheet alongside the component.
`,
			},
		},
	},
};
