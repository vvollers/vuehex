import type { App } from "vue";
import VueHex from "./components/VueHex.vue";

function install(app: App) {
  app.component("VueHex", VueHex);
}

import "./assets/vuehex.css";

export default { install };

export * from "./components/VueHex.vue";
