import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  build: {
    target: "esnext",
    cssCodeSplit: true,

    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: (format) => `vuehex.${format}.js`,
    },

    rolldownOptions: {
      external: ["vue"],
      output: {
        preserveModules: false,
        exports: "named",
      },
    },
  },
});
