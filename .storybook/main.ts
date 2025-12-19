import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/vue3-vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: StorybookConfig = {
	stories: [
		"../src/stories/**/*.mdx",
		"../src/stories/**/*.stories.@(ts|tsx)",
		"../src/stories/**/*.stories.@(js|jsx)",
	],

	addons: ["@storybook/addon-links", "@storybook/addon-docs"],

	framework: {
		name: "@storybook/vue3-vite",
		options: {},
	},

	core: {
		disableTelemetry: true,
	},

	viteFinal: async (baseConfig) => {
		baseConfig.resolve ??= {};
		baseConfig.resolve.alias = {
			...baseConfig.resolve.alias,
			"@": resolve(__dirname, "../src"),
		};
		return baseConfig;
	},
};

export default config;
