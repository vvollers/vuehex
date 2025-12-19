import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { computed, ref } from "vue";
import VueHex from "@/components/VueHex.vue";
import type {
  VueHexCellClassResolver,
  VueHexDataBinding,
  VueHexWindow,
  VueHexWindowRequest,
} from "@/components/vuehex-api";

const TOTAL_BYTES = 16 * 512;

function buildWindow(offset: number, length: number): VueHexWindow {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    const absoluteIndex = offset + index;
    data[index] = (absoluteIndex * 37 + index * 13) % 256;
  }
  return { offset, data };
}

function useDemoBinding(initialLength: number) {
  const windowState = ref<VueHexWindow>(buildWindow(0, initialLength));

  const requestWindow = (payload: VueHexWindowRequest) => {
    const nextLength = payload.length > 0 ? payload.length : initialLength;
    windowState.value = buildWindow(payload.offset, nextLength);
  };

  const binding = computed<VueHexDataBinding>(() => ({
    window: windowState.value,
    totalBytes: TOTAL_BYTES,
    requestWindow,
  }));

  return { binding };
}

const meta: Meta<typeof VueHex> = {
  title: "Components/VueHex",
  component: VueHex,
  tags: ["autodocs"],
  argTypes: {
    binding: { control: false },
    cellClassForByte: { control: false },
  },
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const VirtualBinding: Story = {
  name: "Virtual binding",
  args: {
    bytesPerRow: 16,
    overscan: 4,
  },
  render: (args) => ({
    components: { VueHex },
    setup() {
      const windowLength = Math.max(1, (args.bytesPerRow ?? 16) * 48);
      const { binding } = useDemoBinding(windowLength);
      return { args, binding };
    },
    template: `
        <div class="story-viewport">
          <VueHex v-bind="args" :binding="binding" style="height: 320px" />
        </div>
      `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the minimal virtual binding contract. Scroll to see VueHex request fresh slices through the provided requestWindow callback.",
      },
    },
  },
};

export const ChunkNavigatorHover: Story = {
  name: "Chunk navigator + hover",
  args: {
    bytesPerRow: 32,
    overscan: 3,
    showChunkNavigator: true,
    chunkNavigatorPlacement: "left",
  },
  render: (args) => ({
    components: { VueHex },
    setup() {
      const windowLength = Math.max(1, (args.bytesPerRow ?? 32) * 48);
      const { binding } = useDemoBinding(windowLength);
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
        binding,
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
            :binding="binding"
            :cell-class-for-byte="cellClassForByte"
            style="height: 360px"
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
          "Highlights the optional chunk navigator UI and demonstrates emitting hover events to drive auxiliary UI like tooltips or inspector panels.",
      },
    },
  },
};
