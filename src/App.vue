<template>
  <main class="app">
    <h1>VueHex demo</h1>

    <section class="panel">
      <h2 class="panel-title">Virtualized hex viewer</h2>

      <div class="options">
        <label class="option">
          <input type="checkbox" v-model="uppercase" />
          Uppercase
        </label>
        <label class="option">
          Bytes per row
          <input
            type="number"
            min="4"
            max="64"
            step="1"
            v-model.number="bytesPerRowInput"
          />
        </label>
        <label class="option">
          Non-printable
          <input type="text" maxlength="1" v-model="nonPrintableInput" />
        </label>
      </div>

      <div class="viewer">
        <VueHex
          ref="viewerRef"
          :binding="viewerBinding"
          :bytes-per-row="bytesPerRow"
          :uppercase="uppercase"
          :non-printable-char="nonPrintableChar"
          @row-hover="handleRowHover"
          @hex-hover="handleHexHover"
          @ascii-hover="handleAsciiHover"
        />
      </div>

      <div class="events">
        <h3 class="events-title">Hover events</h3>
        <div class="events-grid">
          <div class="events-card">
            <h4>Row</h4>
            <p>{{ rowHoverText }}</p>
          </div>
          <div class="events-card">
            <h4>Hex byte</h4>
            <p>{{ hexHoverText }}</p>
          </div>
          <div class="events-card">
            <h4>ASCII char</h4>
            <p>{{ asciiHoverText }}</p>
          </div>
        </div>
      </div>

      <div class="controls">
        <span class="controls-label">Jump to:</span>
        <button type="button" @click="scrollToStart">Start</button>
        <button type="button" @click="scrollToMiddle">Middle</button>
        <button type="button" @click="scrollToEnd">End</button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  VueHexDataBinding,
  VueHexWindow,
  VueHexWindowRequest,
} from "./components/VueHex.vue";
import VueHex from "./components/VueHex.vue";
import "@/assets/vuehex.css";

const BYTES_PER_ROW = 16;
const VISIBLE_ROWS = 48;
const SAMPLE_SIZE = 256 * 256;

const viewerRef = ref<InstanceType<typeof VueHex> | null>(null);

const backingData = new Uint8Array(SAMPLE_SIZE);
for (let index = 0; index < backingData.length; index += 1) {
  backingData[index] = index % 256;
}

const totalBytes = backingData.length;

const uppercase = ref(false);
const bytesPerRowInput = ref(BYTES_PER_ROW);
const nonPrintableInput = ref(".");

const bytesPerRow = computed(() =>
  Math.max(1, Math.trunc(bytesPerRowInput.value))
);

const nonPrintableChar = computed(() =>
  nonPrintableInput.value.length > 0 ? nonPrintableInput.value[0] : "."
);

const viewerBinding = ref<VueHexDataBinding>({
  window: {
    offset: 0,
    data: backingData.slice(0, BYTES_PER_ROW * VISIBLE_ROWS),
  } as VueHexWindow,
  totalBytes,
  requestWindow: handleRequestWindow,
});

const rowHoverOffset = ref<number | null>(null);
const hexHoverDetails = ref<{ index: number; byte: number } | null>(null);
const asciiHoverDetails = ref<{ index: number; byte: number } | null>(null);

const rowHoverText = computed(() => {
  const offset = rowHoverOffset.value;
  if (offset == null) {
    return "Hover a row to see offset";
  }
  return `${formatHex(offset, 8)} (${offset})`;
});

const hexHoverText = computed(() => {
  const details = hexHoverDetails.value;
  if (!details) {
    return "Hover a hex byte";
  }
  return `Index ${formatHex(details.index, 8)} | Byte ${formatHex(
    details.byte,
    2
  )}`;
});

const asciiHoverText = computed(() => {
  const details = asciiHoverDetails.value;
  if (!details) {
    return "Hover an ASCII character";
  }
  return `Index ${formatHex(details.index, 8)} | Byte ${formatHex(
    details.byte,
    2
  )}`;
});

function handleRequestWindow(request: VueHexWindowRequest) {
  const offset = Math.max(0, Math.min(request.offset, totalBytes));
  const length = Math.min(request.length, totalBytes - offset);
  const slice = backingData.slice(offset, offset + length);
  viewerBinding.value.window = {
    offset,
    data: slice,
  };
}

function handleRowHover(payload: { offset: number }) {
  rowHoverOffset.value = payload.offset;
}

function handleHexHover(payload: { index: number; byte: number }) {
  hexHoverDetails.value = payload;
}

function handleAsciiHover(payload: { index: number; byte: number }) {
  asciiHoverDetails.value = payload;
}

function scrollToByte(offset: number) {
  viewerRef.value?.scrollToByte(offset);
}

function scrollToStart() {
  scrollToByte(0);
}

function scrollToMiddle() {
  scrollToByte(Math.floor(totalBytes / 2));
}

function scrollToEnd() {
  scrollToByte(Math.max(totalBytes - bytesPerRow.value, 0));
}

function formatHex(value: number, pad: number): string {
  return `0x${value.toString(16).padStart(pad, "0")}`;
}
</script>

<style scoped>
.app {
  padding: 2rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  display: grid;
  gap: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.panel {
  display: grid;
  gap: 1rem;
}

.viewer {
  height: min(480px, 70vh);
  min-height: 320px;
}

.events {
  display: grid;
  gap: 0.75rem;
}

.events-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.events-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.events-card {
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.1);
  padding: 0.75rem;
  display: grid;
  gap: 0.35rem;
}

.events-card h4 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.events-card p {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.8rem;
}

.panel-title {
  margin: 0;
  font-size: 1.25rem;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
}

.option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
}

.controls button {
  border-radius: 0.5rem;
  border: 1px solid rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.15);
  color: #312e81;
  padding: 0.35rem 0.75rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.controls button:hover {
  border-color: rgba(99, 102, 241, 0.75);
  background: rgba(99, 102, 241, 0.25);
}

.controls-label {
  font-weight: 600;
}

input[type="number"],
input[type="text"] {
  border-radius: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  background: rgba(15, 23, 42, 0.05);
  color: inherit;
}

input[type="number"]:focus,
input[type="text"]:focus {
  outline: 2px solid rgba(99, 102, 241, 0.35);
  outline-offset: 1px;
}
</style>
