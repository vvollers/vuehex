<template>
  <div class="demo-app">
    <div class="demo-container">
      <header class="demo-header">
        <h1>VueHex Demo</h1>
        <label class="file-input-wrapper">
          <input
            type="file"
            @change="handleFileSelect"
            class="file-input"
          />
          <span class="file-button">Select File</span>
          <span style="color: white">{{ fileData.length }} bytes</span>
          <span style="color: white"> offset: {{ offset }}</span>
        </label>
        <span v-if="fileName" class="file-name">{{ fileName }}</span>
      </header>

      <main class="demo-main">
        <VueHex
          v-model="fileData"
          v-model:window-offset="offset"
          statusbar="top"
          :theme="selectedTheme"
          :cell-class-for-byte="selectedHighlighting"
          :is-printable="selectedPreset.isPrintable"
          :render-ascii="selectedPreset.renderAscii"
          :cursor="true"
          :bytes-per-row="16"
          :show-chunk-navigator="true"
          chunk-navigator-placement="left"
        />
      </main>

      <footer class="demo-footer">
        <div class="demo-controls">
          <label class="control-label">
            <span>ASCII Preset:</span>
            <select v-model="selectedPresetKey" class="demo-select">
              <option value="standard">Standard ASCII (0x20-0x7E)</option>
              <option value="latin1">Latin-1 Supplement (0x20-0x7E, 0xA0-0xFF)</option>
              <option value="visibleWhitespace">Visible Whitespace</option>
            </select>
          </label>

          <label class="control-label">
            <span>Highlighting:</span>
            <select v-model="selectedHighlightingKey" class="demo-select">
              <option value="default">ASCII Categories (Default)</option>
              <option value="none">None</option>
              <option value="null-bytes">Null Bytes</option>
              <option value="printable">Printable Characters</option>
            </select>
          </label>

          <label class="control-label">
            <span>Theme:</span>
            <select v-model="selectedTheme" class="demo-select">
              <option value="auto">Auto (System)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
			  <option value="terminal">Terminal</option>
			  <option value="sunset">Sunset</option>
            </select>
          </label>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import VueHex from "./components/VueHex.vue";
import {
	VUE_HEX_ASCII_PRESETS,
	type VueHexCellClassResolver,
} from "./components/vuehex-api";
import "./assets/vuehex.css";

const fileData = ref<Uint8Array>(new Uint8Array(0));
const offset = ref<number>(0);

const fileName = ref<string>("");
const selectedPresetKey = ref<"standard" | "latin1" | "visibleWhitespace">(
	"standard",
);
const selectedHighlightingKey = ref<
	"default" | "none" | "null-bytes" | "printable"
>("default");
const selectedTheme = ref<"auto" | "light" | "dark" | "terminal" | "sunset">(
	"auto",
);

const selectedPreset = computed(
	() => VUE_HEX_ASCII_PRESETS[selectedPresetKey.value],
);

// Custom highlighting resolvers
const highlightNullBytes: VueHexCellClassResolver = ({ byte }) => {
	return byte === 0x00 ? "vuehex-highlight-null" : undefined;
};

const highlightPrintable: VueHexCellClassResolver = ({ byte }) => {
	return byte >= 0x20 && byte <= 0x7e
		? "vuehex-highlight-printable"
		: undefined;
};

const selectedHighlighting = computed(() => {
	switch (selectedHighlightingKey.value) {
		case "none":
			return null;
		case "null-bytes":
			return highlightNullBytes;
		case "printable":
			return highlightPrintable;
		default:
			return undefined;
	}
});

async function handleFileSelect(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];

	if (!file) {
		return;
	}

	fileName.value = file.name;

	try {
		const arrayBuffer = await file.arrayBuffer();
		fileData.value = new Uint8Array(arrayBuffer);
		offset.value = 0;
	} catch (error) {
		console.error("Failed to read file:", error);
		fileName.value = "";
		fileData.value = new Uint8Array(0);
	}
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}

#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}
</style>

<style scoped>
.demo-app {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100vh;
  background: #0d1117;
  font-family: 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
}

.demo-container {
  display: flex;
  flex-direction: column;
  width: 90vw;
  max-width: 1800px;
  height: calc(100vh - 4rem);
  background: #161b22;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.demo-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.demo-header h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #e6edf3;
  letter-spacing: -0.02em;
}

.file-input-wrapper {
  position: relative;
  cursor: pointer;
}

.file-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.file-button {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: #238636;
  color: #ffffff;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  border: 1px solid rgba(240, 246, 252, 0.1);
}

.file-button:hover {
  background: #2ea043;
}

.file-name {
  color: #7d8590;
  font-size: 0.875rem;
  font-style: normal;
}

.demo-main {
  flex: 1;
  padding: 1rem;
  min-height: 0;
}

.demo-footer {
  padding: 1rem 1.5rem;
  background: #161b22;
  border-top: 1px solid #30363d;
  flex-shrink: 0;
}

.demo-controls {
  display: flex;
  gap: 2rem;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.control-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #e6edf3;
}

.control-label span {
  font-weight: 500;
  color: #7d8590;
}

.demo-select {
  padding: 0.375rem 0.75rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  font-size: 0.875rem;
  background: #0d1117;
  color: #e6edf3;
  cursor: pointer;
  transition: all 0.2s;
}

.demo-select:hover {
  border-color: #484f58;
  background: #161b22;
}

.demo-select:focus {
  outline: none;
  border-color: #1f6feb;
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.15);
}

@media (prefers-color-scheme: light) {
  .demo-app {
    background: #f6f8fa;
  }

  .demo-container {
    background: #ffffff;
    border: 1px solid #d0d7de;
  }

  .demo-header,
  .demo-footer {
    background: #ffffff;
    border-color: #d0d7de;
  }

  .demo-header h1 {
    color: #24292f;
  }

  .file-button {
    background: #2da44e;
  }

  .file-button:hover {
    background: #2c974b;
  }

  .file-name {
    color: #57606a;
  }

  .control-label {
    color: #24292f;
  }

  .control-label span {
    color: #57606a;
  }

  .demo-select {
    background: #ffffff;
    color: #24292f;
    border-color: #d0d7de;
  }

  .demo-select:hover {
    border-color: #6e7781;
  }
}
</style>
<style>
/* Global highlighting styles for custom presets */
.vuehex-highlight-null {
  background: rgba(255, 0, 0, 0.6);
}

.vuehex-highlight-printable {
  background: rgba(0, 255, 0, 0.6);
}
</style>
