import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";

export interface UseDataModeOptions {
	/** `dataMode` prop (or undefined) controlling buffer/window/auto behavior. */
	dataMode: Ref<"auto" | "buffer" | "window" | undefined>;
	/** When true, VueHex expands to content and never uses windowing. */
	isExpandToContent: ComputedRef<boolean>;
	/** Current window offset in bytes (used by the host in windowed mode). */
	windowOffset: ComputedRef<number>;
	/** Total size of the backing source (may be larger than provided data). */
	totalSize: Ref<number | undefined>;
	/** Current length of the provided data (e.g. modelValue.length). */
	dataLength: ComputedRef<number>;
}

export interface UseDataModeResult {
	/** Normalized mode after applying defaults and validation. */
	normalizedMode: ComputedRef<"auto" | "buffer" | "window">;
	/** True when VueHex should request/operate on a moving window of data. */
	isWindowed: ComputedRef<boolean>;
	/** True when VueHex owns the full buffer locally (non-windowed). */
	isSelfManaged: ComputedRef<boolean>;
}

/**
 * Composable that centralizes data mode detection logic.
 *
 * Why it exists:
 * - VueHex supports both "buffer" mode (all bytes provided) and "window" mode
 *   (only a slice provided; the host is responsible for loading more).
 * - This composable keeps the mode decision logic in one place so the rest of
 *   the component can branch on `isWindowed` / `isSelfManaged`.
 *
 * How it is used:
 * - VueHex passes `dataMode`, `expandToContent`, `totalSize`, and the current
 *   `modelValue.length`.
 * - In `auto` mode, it treats `totalSize > modelValue.length` as windowed.
 */
export function useDataMode(options: UseDataModeOptions): UseDataModeResult {
	/**
	 * Normalizes the user-provided mode into a safe enum.
	 *
	 * Why it exists: avoids propagating `undefined` or invalid values to the rest
	 * of the component.
	 */
	const normalizedMode = computed<"auto" | "buffer" | "window">(() => {
		const mode = options.dataMode.value ?? "auto";
		return mode === "buffer" || mode === "window" || mode === "auto"
			? mode
			: "auto";
	});

	/**
	 * True when VueHex should operate in windowed mode.
	 *
	 * Why it exists: windowed mode means the host is responsible for providing
	 * the correct data slice and responding to window requests.
	 */
	const isWindowed = computed(() => {
		// Expand-to-content always uses buffer mode
		if (options.isExpandToContent.value) {
			return false;
		}

		// Explicit buffer mode
		if (normalizedMode.value === "buffer") {
			return false;
		}

		// Explicit window mode
		if (normalizedMode.value === "window") {
			return true;
		}

		// Auto-detect: totalSize exceeds data length implies windowing
		const total = options.totalSize.value;
		return (
			typeof total === "number" &&
			Number.isFinite(total) &&
			total > options.dataLength.value
		);
	});

	/** True when VueHex treats the provided data as the full buffer. */
	const isSelfManaged = computed(() => !isWindowed.value);

	return {
		normalizedMode,
		isWindowed,
		isSelfManaged,
	};
}
