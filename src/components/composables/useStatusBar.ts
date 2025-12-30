import type { ComputedRef } from "vue";
import { computed, ref } from "vue";
import type { VueHexAsciiRenderer, VueHexPrintableCheck } from "../vuehex-api";

export type VueHexHoverEvent =
	| "row-hover-on"
	| "row-hover-off"
	| "hex-hover-on"
	| "hex-hover-off"
	| "ascii-hover-on"
	| "ascii-hover-off";

export type VueHexHoverEmit = (
	event: VueHexHoverEvent,
	payload: unknown,
) => void;

export interface StatusBarSelectionRange {
	start: number;
	end: number;
}

export interface StatusBarOptions {
	getUppercase: () => boolean;
	getPrintableChecker: () => VueHexPrintableCheck;
	getAsciiRenderer: () => VueHexAsciiRenderer;
	getNonPrintableChar: () => string;

	selectionRange: ComputedRef<StatusBarSelectionRange | null>;
	selectionCount: ComputedRef<number>;
}

export interface StatusBarResult {
	cursorOffset: ComputedRef<number | null>;
	cursorHex: ComputedRef<string>;
	cursorAscii: ComputedRef<string>;
	selectionSummary: ComputedRef<string>;
	handleHoverEvent: VueHexHoverEmit;
}

function formatHexByte(byte: number, upper: boolean) {
	const value = Math.max(0, Math.min(255, Math.trunc(byte)));
	const hex = value.toString(16).padStart(2, "0");
	return upper ? hex.toUpperCase() : hex;
}

export function useStatusBar(options: StatusBarOptions): StatusBarResult {
	const hovered = ref<{ index: number; byte: number } | null>(null);

	const cursorOffset = computed(() => hovered.value?.index ?? null);

	const cursorHex = computed(() => {
		if (!hovered.value) {
			return "";
		}
		return formatHexByte(hovered.value.byte, options.getUppercase());
	});

	const cursorAscii = computed(() => {
		if (!hovered.value) {
			return "";
		}
		const byte = hovered.value.byte;
		const isPrintable = options.getPrintableChecker();
		const renderAscii = options.getAsciiRenderer();
		const fallback = options.getNonPrintableChar();
		return isPrintable(byte) ? renderAscii(byte) : fallback;
	});

	const selectionSummary = computed(() => {
		const range = options.selectionRange.value;
		const count = options.selectionCount.value;
		if (!range || count <= 0) {
			return "";
		}
		return `${count} bytes (${range.start}–${range.end})`;
	});

	const handleHoverEvent: VueHexHoverEmit = (event, payload) => {
		if (event === "hex-hover-on" || event === "ascii-hover-on") {
			const next = payload as { index?: unknown; byte?: unknown };
			const index = Number(next?.index);
			const byte = Number(next?.byte);
			if (Number.isFinite(index) && Number.isFinite(byte)) {
				hovered.value = {
					index: Math.trunc(index),
					byte: Math.trunc(byte),
				};
			}
			return;
		}
		if (event === "hex-hover-off" || event === "ascii-hover-off") {
			const current = hovered.value;
			if (!current) {
				return;
			}
			const prev = payload as { index?: unknown };
			const index = Number(prev?.index);
			if (!Number.isFinite(index) || Math.trunc(index) === current.index) {
				hovered.value = null;
			}
		}
	};

	return {
		cursorOffset,
		cursorHex,
		cursorAscii,
		selectionSummary,
		handleHoverEvent,
	};
}
