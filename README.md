# VueHex

VueHex is a virtualized hex viewer for Vue 3. It renders only the bytes that are currently visible and asks your application for new slices as people scroll, which keeps memory usage predictable even for multi‑gigabyte files.

## Installation

```bash
npm install vuehex
```

Optionally register the plugin once to make the `<VueHex>` component available everywhere and load the default theme:

```ts
import { createApp } from "vue";
import VueHexPlugin from "vuehex";
import "vuehex/styles";

import App from "./App.vue";

const app = createApp(App);
app.use(VueHexPlugin);
app.mount("#app");
```

## Quick start

VueHex now follows the familiar Vue data model pattern:

- `v-model` carries the currently visible `Uint8Array` window.
- `window-offset` tells VueHex where that window belongs in the full file.
- `total-size` declares the total byte length (defaults to the current window length).
- `updateVirtualData` is emitted whenever VueHex needs a new slice.

```vue
<template>
  <VueHex
    v-model="windowData"
    :window-offset="windowOffset"
    :total-size="totalBytes"
    :bytes-per-row="16"
    @updateVirtualData="handleUpdateVirtualData"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { VueHexWindowRequest } from "vuehex";

const backingFile = crypto.getRandomValues(new Uint8Array(2 ** 20));
const totalBytes = backingFile.length;

const windowOffset = ref(0);
const windowData = ref(backingFile.slice(0, 16 * 48));

function handleUpdateVirtualData(request: VueHexWindowRequest) {
	const offset = Math.max(0, Math.min(request.offset, totalBytes));
	const length = Math.max(
		0,
		Math.min(request.length, totalBytes - offset),
	);
	windowOffset.value = offset;
	windowData.value = backingFile.slice(offset, offset + length);
}
</script>
```

## Virtual data contract

When VueHex needs different bytes it emits `updateVirtualData` with `{ offset, length }`. The component keeps rendering whatever you provide through `v-model` until you feed it a new slice. That means you can back the viewer with disk I/O, HTTP range requests, IndexedDB, or any other storage you control.

### Asynchronous providers

Responding to `updateVirtualData` can be asynchronous—just update `windowOffset` and `windowData` when the bytes arrive:

```ts
async function handleUpdateVirtualData(request: VueHexWindowRequest) {
	const response = await fetch(
		`/api/blob?offset=${request.offset}&length=${request.length}`,
	);
	const arrayBuffer = await response.arrayBuffer();
	windowOffset.value = request.offset;
	windowData.value = new Uint8Array(arrayBuffer);
}
```

## Storybook workspace

Run Storybook to explore prebuilt demos (chunk navigator, hover linking, theming, etc.):

```bash
npm install
npm run storybook
```

The static build lives in `storybook-static/` when you run `npm run storybook:build`.

## Viewport sizing

VueHex virtualizes DOM rows, so make sure the component has a bounded height. Set `height`, `max-height`, or place it inside a flex/grid cell with a defined size. Without a viewport the table expands indefinitely and virtualization is effectively disabled.

## Imperative scrolling

Call `scrollToByte` through a template ref to jump to absolute offsets:

```vue
<VueHex ref="viewer" v-model="windowData" ... />

const viewer = ref<InstanceType<typeof VueHex> | null>(null);
viewer.value?.scrollToByte(0x1f400);
```

## Hover events

VueHex emits enter/leave events for rows, hex cells, and ASCII cells so you can power tooltips or side panels:

- `row-hover-on` / `row-hover-off` – `{ offset }`
- `hex-hover-on` / `hex-hover-off` – `{ index, byte }`
- `ascii-hover-on` / `ascii-hover-off` – `{ index, byte }`

```vue
<VueHex
	v-model="windowData"
	:window-offset="windowOffset"
	@hex-hover-on="handleHexEnter"
	@hex-hover-off="handleHexLeave"
/>

function handleHexEnter(payload: { index: number; byte: number }) {
	tooltip.open({ byteOffset: payload.index, value: payload.byte });
}

function handleHexLeave() {
	tooltip.close();
}
```

## ASCII rendering overrides

The ASCII pane renders characters in the standard printable range (`0x20`–`0x7E`) by default. Override the behaviour with `is-printable` and `render-ascii` props:

```vue
<VueHex
	v-model="windowData"
	:window-offset="windowOffset"
	:is-printable="(byte) => byte >= 0x30 && byte <= 0x39"
	:render-ascii="(byte) => `[${String.fromCharCode(byte)}]`"
/>
```

VueHex also exports `VUE_HEX_ASCII_PRESETS` (`standard`, `latin1`, `visibleWhitespace`) if you want a drop-in configuration.

## Props

- `modelValue` (**required via `v-model`**) – the currently visible `Uint8Array`.
- `windowOffset` (default `0`) – absolute start offset represented by `modelValue`.
- `totalSize` – total bytes available; defaults to `modelValue.length` if omitted.
- `bytesPerRow` (default `16`).
- `uppercase` (default `false`).
- `nonPrintableChar` (default `'.'`).
- `isPrintable` / `renderAscii` – customize ASCII rendering.
- `theme` (default `'default'`) – applies bundled palettes (`default`, `light`, `terminal`, `sunset`).
- `cellClassForByte` – `(payload: { kind: 'hex' | 'ascii'; index: number; byte: number }) => string | string[] | void` for custom highlighting.
- `overscan` (default `2`).
- `showChunkNavigator` + `chunkNavigatorPlacement` – enable the optional navigator UI.

## Styling options

1. Import `vuehex/styles` for the default look.
2. Pass `theme="light" | "terminal" | "sunset"` to toggle bundled palettes.
3. Roll your own styles targeting the emitted class names (`.vuehex`, `.vuehex-byte`, `.vuehex-ascii-char`, etc.). The default sheet sets `.vuehex { height: 100%; }`, so remember to give the wrapper a concrete height.

## Plugin options

Override the registered component name if needed:

```ts
app.use(VueHexPlugin, { componentName: "HexViewer" });
```

## License

MIT © Vincent Vollers
