# VueHex

VueHex is a virtualized hex viewer for Vue 3. Instead of buffering an entire file in memory, it renders only the bytes that are currently visible and asks your application for new slices as the user scrolls. This makes it suitable for multi‑gigabyte files, lazy server streams, or any scenario where you want full control over data retrieval.

## Installation

```bash
npm install vuehex
```

## Quick start

Register the plugin and opt in to the shipped theme if desired:

```ts
import { createApp } from "vue";
import VueHexPlugin from "vuehex";
import "vuehex/styles"; // Optional default styles

import App from "./App.vue";

const app = createApp(App);
app.use(VueHexPlugin);
app.mount("#app");
```

Unlike a traditional component, VueHex does not receive the entire file up front. Instead, your application owns the data and passes a **binding** object that describes the currently buffered bytes and how to fetch more when needed.

```vue
<template>
  <VueHex :binding="viewerBinding" :bytes-per-row="16" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  VueHexDataBinding,
  VueHexWindow,
  VueHexWindowRequest,
} from "vuehex";

const backingFile = crypto.getRandomValues(new Uint8Array(2 ** 20));

const totalBytes = backingFile.length;
const windowState = ref<VueHexWindow>({
  offset: 0,
  data: backingFile.slice(0, 16 * 48),
});

function fetchWindow(request: VueHexWindowRequest) {
  const { offset, length } = request;
  const slice = backingFile.slice(offset, offset + length);
  windowState.value = { offset, data: slice };
}

const viewerBinding = computed<VueHexDataBinding>(() => ({
  window: windowState.value,
  totalBytes,
  requestWindow: fetchWindow,
}));
</script>
```

> The window `offset` should be aligned to whatever chunk you want to show (normally a row boundary). VueHex computes leading/trailing spacers so the scrollbar still reflects the total file size.

## Binding contract

- **`binding.window`** – `{ offset: number; data: Uint8Array | number[] | string }`
- **`binding.totalBytes`** – total length of the underlying resource (enables scroll virtualization)
- **`binding.requestWindow(payload)`** – callback invoked with `{ offset, length }` describing the slice VueHex wants next

You are free to satisfy the request however you like: disk reads, HTTP range requests, IndexedDB, etc. VueHex reuses the provided data until it scrolls out of view.

### Asynchronous providers

You can fulfill requests asynchronously. Load the bytes, then update `windowState` when the data arrives; VueHex renders whatever you hand back.

```ts
const viewerBinding = computed<VueHexDataBinding>(() => ({
  window: windowState.value,
  totalBytes,
  requestWindow: fetchWindow,
}));

async function fetchWindow(request: VueHexWindowRequest) {
  const response = await fetch(
    `/api/blob?offset=${request.offset}&length=${request.length}`
  );
  const arrayBuffer = await response.arrayBuffer();
  windowState.value = {
    offset: request.offset,
    data: new Uint8Array(arrayBuffer),
  };
}
```

## Viewport sizing

VueHex virtualizes both I/O and DOM work. It only renders the rows that fit inside its scroll container (plus overscan), so give the component a viewport height. Set a `height` or `max-height` on the wrapper element and VueHex will fill it; without a bounded height the component expands with its content and virtualization is effectively disabled.

## Imperative scrolling

`VueHex` exposes `scrollToByte(byteOffset: number)` via `defineExpose`. Grab a ref and call it whenever you want to jump to an absolute position.

```vue
<VueHex ref="viewer" ... />

const viewer = ref<InstanceType<typeof VueHex> | null>(null);
viewer.value?.scrollToByte(0x1f400);
```

## Props

- `binding` (**required**) – `{ window, totalBytes, requestWindow }`
- `bytesPerRow` (default `16`) – how many bytes to display per row
- `uppercase` (default `false`) – render hex pairs in uppercase
- `nonPrintableChar` (default `"."`) – fallback character for ASCII column
- `overscan` (default `2`) – extra rows to fetch above/below the viewport to reduce churn

## Styling options

1. **Default theme** – `import "vuehex/styles"` once in your app to load the packaged CSS.
2. **Custom theme** – skip the import and write your own styles targeting the emitted class names: `vuehex`, `vuehex-spacer`, `vuehex-table`, `vuehex-offset`, `vuehex-bytes`, `vuehex-byte`, `vuehex-ascii`, `vuehex-ascii-char`, and `vuehex-byte--placeholder`.

The build also exposes `vuehex/style.css` if your bundler prefers direct CSS imports.

> The default stylesheet makes `.vuehex` stretch to `height: 100%`, so wrap the component in an element with an explicit height to define the viewport.

## Plugin options

When registering the plugin you can override the component name it installs:

```ts
app.use(VueHexPlugin, { componentName: "HexViewer" });
```

## License

MIT © Vincent Vollers
