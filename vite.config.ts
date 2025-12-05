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
			entry: {
				index: resolve(__dirname, "src/index.ts"),
				styles: resolve(__dirname, "src/styles.ts"),
			},
			formats: ["es"],
			fileName: (_format, entryName) =>
				entryName === "index" ? "index.js" : `${entryName}.js`,
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
