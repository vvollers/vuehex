# VueHex

VueHex is a virtualized hex viewer for Vue 3. Instead of buffering an entire file in memory, it renders only the bytes that are currently visible and asks your application for new slices as the user scrolls. This makes it suitable for multi‑gigabyte files, lazy server streams, or any scenario where you want full control over data retrieval.

## Installation

```bash
npm install vuehex
```

tooltip.open({
byteOffset: payload.index,
value: payload.byte,
});

# VueHex

VueHex is a virtualized hex viewer for Vue 3. Instead of buffering an entire file in memory, it renders only the bytes that are currently visible and asks your application for new slices as the user scrolls. This makes it suitable for multi-gigabyte files, lazy server streams, or any scenario where you want full control over data retrieval.

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

## Storybook workspace

Run the bundled Storybook to browse live API demos without wiring up your own host application:

```bash
npm install
npm run storybook         # starts Storybook on http://localhost:6006
npm run storybook:build   # emits the static docs site into storybook-static/
```

All stories live in `src/stories` and showcase the binding contract, chunk navigator, and hover-driven embellishments.

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

## Hover events

VueHex surfaces pointer activity so you can layer on tooltips, highlight overlays, or metadata panels. Each event fires when the pointer enters (`*-hover-on`) or leaves (`*-hover-off`) a rendered element:

- `row-hover-on` / `row-hover-off` – payload `{ offset }`
- `hex-hover-on` / `hex-hover-off` – payload `{ index, byte }`
- `ascii-hover-on` / `ascii-hover-off` – payload `{ index, byte }`

The `offset`/`index` values are absolute byte offsets from the start of the underlying data and `byte` is the decoded 0–255 value currently rendered.

```vue
<VueHex
  :binding="viewerBinding"
  @hex-hover-on="handleHexEnter"
  @hex-hover-off="handleHexLeave"
/>

function handleHexEnter(payload: { index: number; byte: number }) {
tooltip.open({ byteOffset: payload.index, value: payload.byte, }); } function
handleHexLeave() { tooltip.close(); }
```

````

## ASCII rendering overrides

By default the ASCII column renders characters in the printable ASCII range (`0x20`–`0x7E`). You can override this behaviour by supplying two optional props:

- `isPrintable(byte: number): boolean` – return `true` when the byte should appear in the ASCII column.
- `renderAscii(byte: number): string` – return the string that will be displayed for printable bytes.

VueHex ships with a small preset catalogue you can reuse:

```ts
import { VUE_HEX_ASCII_PRESETS } from "vuehex";

const { standard, latin1, visibleWhitespace } = VUE_HEX_ASCII_PRESETS;
````

You can also provide your own callbacks:

```vue
<VueHex
  :binding="viewerBinding"
  :is-printable="(byte) => byte >= 0x30 && byte <= 0x39"
  :render-ascii="(byte) => String.fromCharCode(byte)"
/>
```

function handleHexLeave() {
Any byte that fails `isPrintable` falls back to the `nonPrintableChar` glyph, so you can mix custom logic with the existing fallback.

## Props

- `binding` (**required**) – `{ window, totalBytes, requestWindow }`
- `bytesPerRow` (default `16`) – how many bytes to display per row
- `uppercase` (default `false`) – render hex pairs in uppercase
- `nonPrintableChar` (default `"."`) – fallback character for ASCII column
- `isPrintable` – `(byte: number) => boolean` predicate that determines ASCII visibility (defaults to standard ASCII range)
- `renderAscii` – `(byte: number) => string` renderer for printable bytes (defaults to `String.fromCharCode`)
- `theme` (default `"default"`) – selects one of the packaged palettes (`default`, `light`, `terminal`, `sunset`) by applying `vuehex-theme-*` classes
- `cellClassForByte` – `(payload: { kind: "hex" | "ascii"; index: number; byte: number }) => string | string[] | void` callback for adding custom class names to rendered cells
- `overscan` (default `2`) – extra rows to fetch above/below the viewport to reduce churn

## Styling options

1. **Default theme** – `import "vuehex/styles"` once in your app to load the packaged CSS.
2. **Theme prop** – set the `theme` prop to swap between the bundled palettes without rewriting styles.
3. **Custom theme** – skip the import and write your own styles targeting the emitted class names: `vuehex`, `vuehex-spacer`, `vuehex-table`, `vuehex-offset`, `vuehex-bytes`, `vuehex-byte`, `vuehex-ascii`, `vuehex-ascii-char`, `vuehex-byte--placeholder`, and the value-aware helpers `vuehex-byte--value-<n>` / `vuehex-ascii-char--value-<n>`.

The build also exposes `vuehex/style.css` if your bundler prefers direct CSS imports.

> The default stylesheet makes `.vuehex` stretch to `height: 100%`, so wrap the component in an element with an explicit height to define the viewport.

## Plugin options

When registering the plugin you can override the component name it installs:

```ts
app.use(VueHexPlugin, { componentName: "HexViewer" });
```

## License

MIT © Vincent Vollers
tooltip.close();
}

## ASCII rendering overrides

By default the ASCII column renders characters in the printable ASCII range (`0x20`–`0x7E`). You can override this behaviour by supplying two optional props:

- `isPrintable(byte: number): boolean` – return `true` when the byte should appear in the ASCII column.
- `renderAscii(byte: number): string` – return the string that will be rendered for printable bytes.

VueHex ships with a small preset catalogue you can reuse:

```ts
import { VUE_HEX_ASCII_PRESETS } from "vuehex";

const { standard, latin1, visibleWhitespace } = VUE_HEX_ASCII_PRESETS;
```

You can also provide your own callbacks:

```vue
<VueHex
  :binding="viewerBinding"
  :is-printable="(byte) => byte >= 0x30 && byte <= 0x39"
  :render-ascii="(byte) => String.fromCharCode(byte)"
/>
```

Any byte that fails `isPrintable` falls back to the `nonPrintableChar` glyph.
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

## Hover events

VueHex surfaces pointer activity so you can layer on tooltips, highlight overlays, or metadata panels. Each event fires when the pointer enters (`*-hover-on`) or leaves (`*-hover-off`) a rendered element:

- `row-hover-on` / `row-hover-off` – payload `{ offset }`
- `hex-hover-on` / `hex-hover-off` – payload `{ index, byte }`
- `ascii-hover-on` / `ascii-hover-off` – payload `{ index, byte }`

The `offset`/`index` values are absolute byte offsets from the start of the underlying data and `byte` is the decoded 0–255 value currently rendered.

```vue
<VueHex
  :binding="viewerBinding"
  @hex-hover-on="handleHexEnter"
  @hex-hover-off="handleHexLeave"
/>

function handleHexEnter(payload: { index: number; byte: number }) {
tooltip.open({ byteOffset: payload.index, value: payload.byte, }); } function
handleHexLeave() { tooltip.close(); }
```

## Props

- `binding` (**required**) – `{ window, totalBytes, requestWindow }`
- `bytesPerRow` (default `16`) – how many bytes to display per row
- `uppercase` (default `false`) – render hex pairs in uppercase
- `nonPrintableChar` (default `"."`) – fallback character for ASCII column
- `isPrintable` – `(byte: number) => boolean` predicate for ASCII visibility (defaults to standard ASCII range)
- `renderAscii` – `(byte: number) => string` renderer for printable bytes (defaults to `String.fromCharCode`)
- `theme` (default `"default"`) – applies one of the bundled palettes via `vuehex-theme-*` classes
- `cellClassForByte` – `(payload: { kind: "hex" | "ascii"; index: number; byte: number }) => string | string[] | void` callback for injecting custom classes
- `overscan` (default `2`) – extra rows to fetch above/below the viewport to reduce churn

## Styling options

1. **Default theme** – `import "vuehex/styles"` once in your app to load the packaged CSS.
2. **Theme prop** – toggle the `theme` prop to swap between bundled palettes.
3. **Custom theme** – skip the import and write your own styles targeting the emitted class names: `vuehex`, `vuehex-spacer`, `vuehex-table`, `vuehex-offset`, `vuehex-bytes`, `vuehex-byte`, `vuehex-ascii`, `vuehex-ascii-char`, `vuehex-byte--placeholder`, and the value-soft selectors `vuehex-byte--value-<n>` / `vuehex-ascii-char--value-<n>`.

The build also exposes `vuehex/style.css` if your bundler prefers direct CSS imports.

> The default stylesheet makes `.vuehex` stretch to `height: 100%`, so wrap the component in an element with an explicit height to define the viewport.

## Plugin options

When registering the plugin you can override the component name it installs:

```ts
app.use(VueHexPlugin, { componentName: "HexViewer" });
```

## License

MIT © Vincent Vollers
