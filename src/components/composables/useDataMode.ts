import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";

export interface UseDataModeOptions {
	dataMode: Ref<"auto" | "buffer" | "window" | undefined>;
	isExpandToContent: ComputedRef<boolean>;
	windowOffset: ComputedRef<number>;
	totalSize: Ref<number | undefined>;
	dataLength: ComputedRef<number>;
}

export interface UseDataModeResult {
	normalizedMode: ComputedRef<"auto" | "buffer" | "window">;
	isWindowed: ComputedRef<boolean>;
	isSelfManaged: ComputedRef<boolean>;
}

/**
 * Composable that centralizes data mode detection logic.
 *
 * Determines whether VueHex expects external data (windowed mode) or manages
 * data internally (buffer mode), based on explicit mode prop or auto-detection.
 */
export function useDataMode(options: UseDataModeOptions): UseDataModeResult {
	const normalizedMode = computed<"auto" | "buffer" | "window">(() => {
		const mode = options.dataMode.value ?? "auto";
		return mode === "buffer" || mode === "window" || mode === "auto"
			? mode
			: "auto";
	});

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

		// Auto-detect: non-zero offset implies windowing
		if (options.windowOffset.value > 0) {
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

	const isSelfManaged = computed(() => !isWindowed.value);

	return {
		normalizedMode,
		isWindowed,
		isSelfManaged,
	};
}
