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
        <label class="option">
          ASCII preset
          <select v-model="asciiPresetKey">
            <option
              v-for="option in asciiPresetOptions"
              :key="option.key"
              :value="option.key"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="option">
          Theme
          <select v-model="themeKey">
            <option
              v-for="option in themeOptions"
              :key="option.key"
              :value="option.key"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="option">
          Highlights
          <select v-model="highlightKey">
            <option
              v-for="option in highlightOptions"
              :key="option.key"
              :value="option.key"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>

      <div class="file-loader">
        <label class="option option-file">
          <span>Load local file</span>
          <input type="file" @change="handleFileSelection" />
        </label>
        <button
          type="button"
          class="file-loader-button"
          @click="resetToSampleData"
        >
          Use sample data
        </button>
        <p class="file-status">Current source: {{ currentSourceSummary }}</p>
        <p v-if="fileError" class="file-error">{{ fileError }}</p>
      </div>

      <div class="viewer">
        <VueHex
          ref="viewerRef"
          :binding="viewerBinding"
          :bytes-per-row="bytesPerRow"
          :uppercase="uppercase"
          :non-printable-char="nonPrintableChar"
          :is-printable="activeAsciiPreset.isPrintable"
          :render-ascii="activeAsciiPreset.renderAscii"
          :theme="themeKey"
          :cell-class-for-byte="activeCellClassResolver"
          @row-hover-on="handleRowHoverOn"
          @row-hover-off="handleRowHoverOff"
          @hex-hover-on="handleHexHoverOn"
          @hex-hover-off="handleHexHoverOff"
          @ascii-hover-on="handleAsciiHoverOn"
          @ascii-hover-off="handleAsciiHoverOff"
        />
      </div>

      <div v-if="activeHighlightNotes.length" class="highlight-legend">
        <h3 class="highlight-legend-title">Highlight guide</h3>
        <ul class="highlight-legend-list">
          <li v-for="note in activeHighlightNotes" :key="note">
            {{ note }}
          </li>
        </ul>
      </div>

      <div class="events">
        <h3 class="events-title">Hover events</h3>
        <div class="events-grid">
          <div class="events-card">
            <h4>Row (active)</h4>
            <p>{{ activeRowText }}</p>
          </div>
          <div class="events-card">
            <h4>Hex byte (active)</h4>
            <p>{{ activeHexText }}</p>
          </div>
          <div class="events-card">
            <h4>ASCII char (active)</h4>
            <p>{{ activeAsciiText }}</p>
          </div>
        </div>
        <div class="events-log">
          <h4>Event log</h4>
          <ul class="events-log-list">
            <li v-for="entry in hoverLog" :key="entry.id">{{ entry.text }}</li>
            <li v-if="hoverLog.length === 0" class="events-log-empty">
              Hover bytes to see enter/leave events
            </li>
          </ul>
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
import { computed, nextTick, ref } from "vue";
import VueHex from "./components/VueHex.vue";
import {
  VUE_HEX_ASCII_PRESETS,
  type VueHexAsciiPreset,
  type VueHexCellClassResolver,
  type VueHexDataBinding,
  type VueHexWindow,
  type VueHexWindowRequest,
} from "./components/vuehex-api";
import "@/assets/vuehex.css";

const BYTES_PER_ROW = 16;
const VISIBLE_ROWS = 48;
const SAMPLE_SIZE = 256 * 256;
const SAMPLE_LABEL = "Generated sample data";

const viewerRef = ref<InstanceType<typeof VueHex> | null>(null);

const uppercase = ref(false);
const bytesPerRowInput = ref(BYTES_PER_ROW);
const nonPrintableInput = ref(".");

const bytesPerRow = computed(() =>
  Math.max(1, Math.trunc(bytesPerRowInput.value))
);

const nonPrintableChar = computed(() =>
  nonPrintableInput.value.length > 0 ? nonPrintableInput.value[0] : "."
);

const backingData = ref<Uint8Array>(createSampleData());
const sourceLabel = ref<string>(SAMPLE_LABEL);
const fileError = ref<string | null>(null);

const totalBytes = computed(() => backingData.value.length);

const viewerBinding = ref<VueHexDataBinding>({
  window: createInitialWindow(backingData.value, 0),
  totalBytes: totalBytes.value,
  requestWindow: handleRequestWindow,
});

const presetStandard: VueHexAsciiPreset = VUE_HEX_ASCII_PRESETS.standard;
const presetLatin1: VueHexAsciiPreset = VUE_HEX_ASCII_PRESETS.latin1;
const presetWhitespace: VueHexAsciiPreset =
  VUE_HEX_ASCII_PRESETS.visibleWhitespace;

const customAsciiPreset: VueHexAsciiPreset = {
  label: "Digits + uppercase (custom demo)",
  isPrintable: (byte) =>
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a),
  renderAscii: (byte) => {
    if (byte >= 0x41 && byte <= 0x5a) {
      return String.fromCharCode(byte + 0x20);
    }
    if (byte >= 0x30 && byte <= 0x39) {
      return `[${String.fromCharCode(byte)}]`;
    }
    return "";
  },
};

const asciiPresetOptions = [
  {
    key: "standard",
    label: presetStandard.label,
    preset: presetStandard,
  },
  {
    key: "latin1",
    label: presetLatin1.label,
    preset: presetLatin1,
  },
  {
    key: "visibleWhitespace",
    label: presetWhitespace.label,
    preset: presetWhitespace,
  },
  {
    key: "custom",
    label: customAsciiPreset.label,
    preset: customAsciiPreset,
  },
] as const;

type AsciiPresetKey = (typeof asciiPresetOptions)[number]["key"];

const asciiPresetKey = ref<AsciiPresetKey>("standard");

const themeOptions = [
  { key: "default", label: "Midnight (default)" },
  { key: "light", label: "Cloud Light" },
  { key: "terminal", label: "Terminal Green" },
  { key: "sunset", label: "Sunset Glow" },
] as const;

type ThemeKey = (typeof themeOptions)[number]["key"];

const themeKey = ref<ThemeKey>("default");

const highlightOptions = [
  { key: "structure", label: "Sample structure" },
  { key: "asciiCategories", label: "ASCII categories" },
  { key: "none", label: "No highlights" },
] as const;

type HighlightKey = (typeof highlightOptions)[number]["key"];

const highlightKey = ref<HighlightKey>("structure");

const activeAsciiPreset = computed(() => {
  const found = asciiPresetOptions.find(
    (option) => option.key === asciiPresetKey.value
  );
  return found?.preset ?? asciiPresetOptions[0].preset;
});

const structureHighlight: VueHexCellClassResolver = ({ index }) => {
  const total = totalBytes.value;
  const headerLimit = Math.min(0x40, Math.max(total, 0));
  const hasFooter = total >= 0x80;
  const footerStart = hasFooter
    ? Math.max(total - 0x40, headerLimit)
    : Infinity;
  const metadataLimit = Math.min(0x180, footerStart);

  if (index < headerLimit) {
    return "vuehex-demo-region--header";
  }
  if (index < metadataLimit) {
    return "vuehex-demo-region--metadata";
  }
  if (index >= footerStart) {
    return "vuehex-demo-region--footer";
  }
  return "vuehex-demo-region--payload";
};

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

const highlightResolverMap: Record<
  HighlightKey,
  VueHexCellClassResolver | undefined
> = {
  structure: structureHighlight,
  asciiCategories: asciiCategoryHighlight,
  none: undefined,
};

const highlightNotesMap: Record<HighlightKey, string[]> = {
  structure: [
    "Header: first 64 bytes (or the whole file if shorter)",
    "Metadata: bytes 0x40–0x17F until the footer boundary",
    "Payload: everything after metadata until the footer",
    "Footer: final 64 bytes when available",
  ],
  asciiCategories: [
    "Digits highlighted in gold",
    "Uppercase ASCII highlighted in cyan",
    "Lowercase ASCII highlighted in violet",
    "Null bytes dimmed",
  ],
  none: [],
};

const activeCellClassResolver = computed(
  () => highlightResolverMap[highlightKey.value]
);

const activeHighlightNotes = computed(
  () => highlightNotesMap[highlightKey.value] ?? []
);

const activeRowOffset = ref<number | null>(null);
const activeHex = ref<{ index: number; byte: number } | null>(null);
const activeAscii = ref<{ index: number; byte: number } | null>(null);

interface HoverLogEntry {
  id: number;
  text: string;
}

const hoverLog = ref<HoverLogEntry[]>([]);
let hoverLogId = 0;

const activeRowText = computed(() => {
  const offset = activeRowOffset.value;
  if (offset == null) {
    return "None";
  }
  return `${formatHex(offset, 8)} (${offset})`;
});

const activeHexText = computed(() => {
  const details = activeHex.value;
  if (!details) {
    return "None";
  }
  return `Index ${formatHex(details.index, 8)} | Byte ${formatHex(
    details.byte,
    2
  )}`;
});

const activeAsciiText = computed(() => {
  const details = activeAscii.value;
  if (!details) {
    return "None";
  }
  return `Index ${formatHex(details.index, 8)} | Byte ${formatHex(
    details.byte,
    2
  )}`;
});

const currentSourceSummary = computed(() => {
  const sizeText = formatBytes(totalBytes.value);
  return `${sourceLabel.value} - ${sizeText}`;
});

async function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement;
  const fileList = input.files;
  if (!fileList || fileList.length === 0) {
    return;
  }

  const file = fileList.item(0);
  if (!file) {
    return;
  }

  fileError.value = null;

  try {
    const buffer = await file.arrayBuffer();
    replaceBackingData(new Uint8Array(buffer), file.name);
    await nextTick();
    scrollToStart();
  } catch (error) {
    fileError.value =
      error instanceof Error
        ? error.message
        : "Unable to read the selected file.";
  } finally {
    input.value = "";
  }
}

async function resetToSampleData() {
  fileError.value = null;
  replaceBackingData(createSampleData(), SAMPLE_LABEL);
  await nextTick();
  scrollToStart();
}

function replaceBackingData(data: Uint8Array, label: string) {
  backingData.value = data;
  sourceLabel.value = label;
  resetViewerToOffset(0);
  resetHoverState();
  clearHoverLog();
}

function resetViewerToOffset(offset: number) {
  const nextWindow = createInitialWindow(backingData.value, offset);
  viewerBinding.value = {
    window: nextWindow,
    totalBytes: backingData.value.length,
    requestWindow: handleRequestWindow,
  };
}

function handleRequestWindow(request: VueHexWindowRequest) {
  const total = totalBytes.value;
  if (total <= 0) {
    viewerBinding.value.window = {
      offset: 0,
      data: new Uint8Array(0),
    };
    viewerBinding.value.totalBytes = 0;
    return;
  }

  const offset = Math.max(0, Math.min(Math.trunc(request.offset), total));
  const requestedLength = Math.max(0, Math.trunc(request.length));
  const available = Math.max(total - offset, 0);
  const length = Math.min(requestedLength, available);
  const slice =
    length > 0
      ? backingData.value.slice(offset, offset + length)
      : new Uint8Array(0);

  viewerBinding.value = {
    window: {
      offset,
      data: slice,
    },
    totalBytes: total,
    requestWindow: handleRequestWindow,
  };
}

function handleRowHoverOn(payload: { offset: number }) {
  activeRowOffset.value = payload.offset;
  pushHoverLog(
    `row-hover-on  offset ${formatHex(payload.offset, 8)} (${payload.offset})`
  );
}

function handleRowHoverOff(payload: { offset: number }) {
  if (activeRowOffset.value === payload.offset) {
    activeRowOffset.value = null;
  }
  pushHoverLog(
    `row-hover-off offset ${formatHex(payload.offset, 8)} (${payload.offset})`
  );
}

function handleHexHoverOn(payload: { index: number; byte: number }) {
  activeHex.value = payload;
  pushHoverLog(
    `hex-hover-on  index ${formatHex(payload.index, 8)} byte ${formatHex(
      payload.byte,
      2
    )}`
  );
}

function handleHexHoverOff(payload: { index: number; byte: number }) {
  if (activeHex.value && activeHex.value.index === payload.index) {
    activeHex.value = null;
  }
  pushHoverLog(
    `hex-hover-off index ${formatHex(payload.index, 8)} byte ${formatHex(
      payload.byte,
      2
    )}`
  );
}

function handleAsciiHoverOn(payload: { index: number; byte: number }) {
  activeAscii.value = payload;
  pushHoverLog(
    `ascii-hover-on index ${formatHex(payload.index, 8)} byte ${formatHex(
      payload.byte,
      2
    )}`
  );
}

function handleAsciiHoverOff(payload: { index: number; byte: number }) {
  if (activeAscii.value && activeAscii.value.index === payload.index) {
    activeAscii.value = null;
  }
  pushHoverLog(
    `ascii-hover-off index ${formatHex(payload.index, 8)} byte ${formatHex(
      payload.byte,
      2
    )}`
  );
}

function pushHoverLog(message: string) {
  hoverLogId += 1;
  const entry: HoverLogEntry = { id: hoverLogId, text: message };
  hoverLog.value = [entry, ...hoverLog.value].slice(0, 8);
}

function clearHoverLog() {
  hoverLogId = 0;
  hoverLog.value = [];
}

function scrollToByte(offset: number) {
  viewerRef.value?.scrollToByte(offset);
}

function scrollToStart() {
  if (totalBytes.value === 0) {
    return;
  }
  scrollToByte(0);
}

function scrollToMiddle() {
  if (totalBytes.value === 0) {
    return;
  }
  scrollToByte(Math.floor(totalBytes.value / 2));
}

function scrollToEnd() {
  if (totalBytes.value === 0) {
    return;
  }
  scrollToByte(Math.max(totalBytes.value - bytesPerRow.value, 0));
}

function resetHoverState() {
  activeRowOffset.value = null;
  activeHex.value = null;
  activeAscii.value = null;
}

function formatHex(value: number, pad: number): string {
  return `0x${value.toString(16).padStart(pad, "0").toUpperCase()}`;
}

function createSampleData(): Uint8Array {
  const data = new Uint8Array(SAMPLE_SIZE);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = index % 256;
  }
  return data;
}

function createInitialWindow(data: Uint8Array, offset: number): VueHexWindow {
  const total = data.length;
  if (total === 0) {
    return {
      offset: 0,
      data: new Uint8Array(0),
    };
  }

  const rowSize = Math.max(bytesPerRow.value, 1);
  const clampedOffset = Math.max(0, Math.trunc(offset));
  const alignedOffset = clampedOffset - (clampedOffset % rowSize);
  const rowsToShow = Math.max(VISIBLE_ROWS, 1);
  const visibleLength = Math.min(
    rowSize * rowsToShow,
    Math.max(total - alignedOffset, 0)
  );

  const slice =
    visibleLength > 0
      ? data.slice(alignedOffset, alignedOffset + visibleLength)
      : new Uint8Array(0);

  return {
    offset: alignedOffset,
    data: slice,
  };
}

function formatBytes(size: number): string {
  if (size <= 0) {
    return "0 bytes";
  }

  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 || value >= 100 ? 0 : 1;
  const formatted = value.toFixed(precision);
  const normalized = Number(formatted).toString();

  return `${normalized} ${units[unitIndex]}`;
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

.events-log {
  display: grid;
  gap: 0.5rem;
}

.events-log h4 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.events-log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
}

.events-log-list li {
  border-radius: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.15);
  padding: 0.35rem 0.5rem;
}

.events-log-empty {
  text-align: center;
  color: rgba(30, 41, 59, 0.6);
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

.file-loader {
  display: grid;
  gap: 0.5rem;
  align-items: start;
}

.option-file {
  flex-direction: column;
  align-items: flex-start;
}

.option-file input[type="file"] {
  font-size: 0.875rem;
}

.file-loader-button {
  border-radius: 0.5rem;
  border: 1px solid rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.15);
  color: #312e81;
  padding: 0.35rem 0.75rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.file-loader-button:hover {
  border-color: rgba(99, 102, 241, 0.75);
  background: rgba(99, 102, 241, 0.25);
}

.file-status {
  margin: 0;
  font-size: 0.85rem;
  color: rgba(30, 41, 59, 0.75);
}

.file-error {
  margin: 0;
  font-size: 0.85rem;
  color: #b91c1c;
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
input[type="text"],
select {
  border-radius: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  background: rgba(15, 23, 42, 0.05);
  color: inherit;
}

input[type="number"]:focus,
input[type="text"]:focus,
select:focus {
  outline: 2px solid rgba(99, 102, 241, 0.35);
  outline-offset: 1px;
}

.highlight-legend {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.12);
}

.highlight-legend-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.highlight-legend-list {
  list-style: disc;
  margin: 0 0 0 1.2rem;
  padding: 0;
  display: grid;
  gap: 0.2rem;
  font-size: 0.8rem;
}

:deep(.vuehex-demo-region--header),
:deep(.vuehex-demo-region--metadata),
:deep(.vuehex-demo-region--payload),
:deep(.vuehex-demo-region--footer) {
  border-radius: 0.25rem;
  padding: 0 0.2rem;
}

:deep(.vuehex-demo-region--header) {
  background: rgba(56, 189, 248, 0.2);
}

:deep(.vuehex-demo-region--metadata) {
  background: rgba(94, 234, 212, 0.18);
}

:deep(.vuehex-demo-region--payload) {
  background: rgba(251, 191, 36, 0.18);
}

:deep(.vuehex-demo-region--footer) {
  background: rgba(249, 115, 22, 0.2);
}

:deep(.vuehex-demo-byte--digit) {
  color: #facc15;
}

:deep(.vuehex-demo-byte--uppercase) {
  color: #38bdf8;
}

:deep(.vuehex-demo-byte--lowercase) {
  color: #c084fc;
}

:deep(.vuehex-demo-byte--null) {
  opacity: 0.5;
}
</style>
