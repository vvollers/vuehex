
	import type { Meta, StoryObj } from "@storybook/vue3-vite";
	import { ref } from "vue";
	import VueHex from "@/components/VueHex.vue";
	import type {
		VueHexCellClassResolver,
		VueHexWindowRequest,
	} from "@/components/vuehex-api";

	const DEMO_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MiB of procedurally generated data

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
		const maxLength = Math.min(normalizedLength, DEMO_TOTAL_BYTES - normalizedOffset);
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
			<div class="story-viewport">
			  <VueHex
			    v-bind="args"
			    v-model="windowData"
			    :window-offset="windowOffset"
			    :total-size="totalBytes"
			    style="height: 320px"
			    @updateVirtualData="handleUpdateVirtualData"
			  />
			</div>
			`,
		}),
		parameters: {
			docs: {
				description: {
					story:
						"Demonstrates the v-model driven contract. Scroll to trigger updateVirtualData events as VueHex requests new slices.",
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
			<div class="story-viewport story-viewport--split">
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
			  <div class="story-panel">
			    <p class="story-label">Hovered byte</p>
			    <p class="story-value" v-if="hoverIndex !== null">{{ formatOffset(hoverIndex) }}</p>
			    <p class="story-value" v-else>Move your pointer over the viewer.</p>
			  </div>
			</div>
			`,
		}),
		parameters: {
			docs: {
				description: {
					story:
						"Highlights the chunk navigator UI alongside hover-driven embellishments.",
				},
			},
		},
	};

	export const ThemeGallery: Story = {
		name: "Theme gallery",
		args: {
			bytesPerRow: 16,
			overscan: 2,
		},
		render: (args) => ({
			components: { VueHex },
			setup() {
				const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 32);
				const variants = ref(
					THEME_VARIANTS.map((variant) => ({
						...variant,
						windowOffset: 0,
						windowData: sliceDemoData(0, windowLength),
						totalBytes: DEMO_TOTAL_BYTES,
					})),
				);

				const handleVariantUpdate = (
					index: number,
					payload: VueHexWindowRequest,
				) => {
					const normalizedOffset = clamp(
						Math.trunc(payload.offset),
						0,
						DEMO_TOTAL_BYTES,
					);
					const requestedLength = Math.max(
						1,
						Math.trunc(payload.length || windowLength),
					);
					const nextData = sliceDemoData(normalizedOffset, requestedLength);
					variants.value[index]!.windowOffset = normalizedOffset;
					variants.value[index]!.windowData = nextData;
				};

				return {
					args,
					variants,
					handleVariantUpdate,
				};
			},
			template: `
			<div class="story-viewport story-viewport--grid">
			  <section
			    v-for="(variant, index) in variants"
			    :key="variant.key"
			    class="story-card"
			  >
			    <header class="story-card__header">
			      <p class="story-card__eyebrow">Theme</p>
			      <h3 class="story-card__title">{{ variant.title }}</h3>
			      <p class="story-card__subtitle">{{ variant.description }}</p>
			    </header>
			    <div class="story-card__viewer">
			      <VueHex
			        v-bind="args"
			        :model-value="variant.windowData"
			        :window-offset="variant.windowOffset"
			        :total-size="variant.totalBytes"
			        :theme="variant.key"
			        class="story-card__hex"
			        style="height: 260px"
			        @updateVirtualData="payload => handleVariantUpdate(index, payload)"
			      />
			    </div>
			  </section>
			</div>
			`,
		}),
		parameters: {
			docs: {
				description: {
					story:
						"Compare every built-in theme. Each card maintains its own virtual data source so scrolling remains independent.",
				},
			},
		},
	};
