import type { App } from "vue";
import VueHex from "./components/VueHex.vue";

export interface VueHexPluginOptions {
  componentName?: string;
}

export function install(app: App, options: VueHexPluginOptions = {}) {
  const name = options.componentName ?? "VueHex";
  app.component(name, VueHex);
}

export default { install };

export { VueHex };

export * from "./components/vuehex-api";
