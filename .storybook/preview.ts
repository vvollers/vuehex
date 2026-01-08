import type { Preview } from "@storybook/vue3-vite";

import "../src/assets/vuehex.css";
import "./preview.css";

const preview: Preview = {
	parameters: {
		actions: { argTypesRegex: "^on[A-Z].*" },
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/,
			},
		},
		layout: "fullscreen",
		docs: {
			codePanel: true,
			source: {
				language: "vue",
			},
		},
	},
};

export default preview;
