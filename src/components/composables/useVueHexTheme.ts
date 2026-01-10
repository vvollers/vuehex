import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";
import { normalizeThemeKey } from "../vuehex-utils";

export interface UseVueHexThemeOptions {
	/** Theme token provided by the consumer (prop). */
	theme: Ref<string | null | undefined>;
	/** True when VueHex expands to fit content (no virtualization). */
	isExpandToContent: ComputedRef<boolean>;
	/** True when selection features are enabled; affects container classes. */
	selectionEnabled: ComputedRef<boolean>;
	/** Status bar placement prop; null/undefined means hidden. */
	statusbar: Ref<"top" | "bottom" | null | undefined>;
}

export interface UseVueHexThemeResult {
	/** Canonical theme key (kebab-case), or null when no explicit theme is set. */
	themeKey: ComputedRef<string | null>;
	/** Theme classes applied to the component root and related wrappers. */
	themeClass: ComputedRef<string[]>;
	/** Classes applied to the scroll container element. */
	containerClass: ComputedRef<string[]>;
	/** Extra classes forwarded to the chunk navigator root wrapper. */
	rootClassExtra: ComputedRef<string[]>;
	/** True when the status bar should be rendered. */
	showStatusBar: ComputedRef<boolean>;
	/** Status bar placement, or null when the status bar is hidden. */
	statusBarPlacement: ComputedRef<"top" | "bottom" | null>;
	/** Extra classes forwarded to the chunk navigator viewer wrapper. */
	viewerClassExtra: ComputedRef<string[]>;
}

/**
 * Centralizes theme + class computations for VueHex.
 *
 * Why it exists:
 * - VueHex derives multiple class lists (container/root/viewer) from the theme,
 *   interactive state, and status bar placement.
 */
export function useVueHexTheme(
	options: UseVueHexThemeOptions,
): UseVueHexThemeResult {
	/**
	 * Normalized theme key derived from the consumer-specified string.
	 *
	 * Built-in themes:
	 * - "auto" (default)
	 * - "light"
	 * - "dark"
	 * - "terminal"
	 * - "sunset"
	 *
	 * Any other token is treated as a custom theme key and emitted as
	 * `.vuehex-theme-<token>`.
	 */
	const themeKey = computed(() => {
		return normalizeThemeKey(options.theme.value);
	});

	/** Theme modifier class applied to the component. */
	const themeClass = computed(() => {
		const normalized = themeKey.value;
		if (!normalized || normalized === "auto") {
			return ["vuehex-theme-auto"];
		}
		return [`vuehex-theme-${normalized}`];
	});

	/** Classes applied to the scroll container, including theme modifiers. */
	const containerClass = computed(() => {
		const classes = ["vuehex"];
		classes.push(...themeClass.value);
		if (options.isExpandToContent.value) {
			classes.push("vuehex--expand-to-content");
		}
		if (!options.selectionEnabled.value) {
			classes.push("vuehex-selection-disabled");
		}
		return classes;
	});

	const rootClassExtra = computed(() => [...themeClass.value]);

	const statusBarPlacement = computed<"top" | "bottom" | null>(() => {
		return options.statusbar.value === "top" ||
			options.statusbar.value === "bottom"
			? options.statusbar.value
			: null;
	});

	const showStatusBar = computed(() => statusBarPlacement.value != null);

	const viewerClassExtra = computed(() => {
		const placement = statusBarPlacement.value;
		if (!placement) {
			return [];
		}

		return [
			"vuehex-viewer--with-statusbar",
			placement === "top"
				? "vuehex-viewer--statusbar-top"
				: "vuehex-viewer--statusbar-bottom",
		];
	});

	return {
		themeKey,
		themeClass,
		containerClass,
		rootClassExtra,
		showStatusBar,
		statusBarPlacement,
		viewerClassExtra,
	};
}
