import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
	const isDemo = mode === "demo";

	return {
		base: isDemo ? "/vuehex/demo/" : "/",
		plugins: [vue()],

		resolve: {
			alias: {
				"@": resolve(__dirname, "src"),
			},
		},

		build: {
			target: "esnext",
			cssCodeSplit: !isDemo,
			outDir: isDemo ? "dist-demo" : "dist",
			copyPublicDir: false,

			...(isDemo
				? {
						// Demo app build
						rollupOptions: {
							input: resolve(__dirname, "index.html"),
						},
					}
				: {
						// Library build
						lib: {
							entry: resolve(__dirname, "src/index.ts"),
							formats: ["es"],
							fileName: () => "index.js",
						},
						rolldownOptions: {
							external: ["vue"],
							output: {
								preserveModules: false,
								exports: "named",
							},
						},
					}),
		},
	};
});
