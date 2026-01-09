import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
	VueHexAsciiRenderer,
	VueHexPrintableCheck,
	VueHexSelectionDataProvider,
} from "../vuehex-api";
import { clamp, parseIndexAttribute } from "../vuehex-utils";

export interface SelectionOptions {
	containerEl: Ref<HTMLDivElement | undefined>;
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	markup: ShallowRef<string>;

	getSelectionDataProp: () => VueHexSelectionDataProvider | undefined;
	isSelfManagedData: ComputedRef<boolean>;
	totalBytes: ComputedRef<number>;
	getSelfManagedBytes: () => Uint8Array;

	getUppercase: () => boolean;
	getPrintableChecker: () => VueHexPrintableCheck;
	getAsciiRenderer: () => VueHexAsciiRenderer;
	getNonPrintableChar: () => string;

	updateRenderedSlice: () => void;

	emitByteClick?: (payload: {
		index: number;
		byte: number;
		kind: "hex" | "ascii";
	}) => void;
	emitSelectionChange?: (payload: {
		start: number | null;
		end: number | null;
		length: number;
	}) => void;
}

export interface SelectionResult {
	selectionDataProvider: ComputedRef<VueHexSelectionDataProvider | null>;
	selectionEnabled: ComputedRef<boolean>;
	selectionRange: ComputedRef<{ start: number; end: number } | null>;
	selectionCount: ComputedRef<number>;
}

interface SelectionState {
	mode: "hex" | "ascii";
	anchor: number;
	focus: number;
}

export function useSelection(options: SelectionOptions): SelectionResult {
	/**
	 * Calculate ordered start and end from anchor and focus.
	 */
	function getOrderedRange(
		anchor: number,
		focus: number,
	): { start: number; end: number } {
		return {
			start: Math.min(anchor, focus),
			end: Math.max(anchor, focus),
		};
	}

	const selectionDataProvider = computed<VueHexSelectionDataProvider | null>(
		() => {
			const provided = options.getSelectionDataProp();
			if (provided) {
				return provided;
			}

			if (!options.isSelfManagedData.value) {
				return null;
			}

			return (selectionStart, selectionEnd) => {
				const total = options.totalBytes.value;
				if (total <= 0) {
					return new Uint8Array(0);
				}
				const start = clamp(Math.trunc(selectionStart), 0, total - 1);
				const end = clamp(Math.trunc(selectionEnd), 0, total - 1);
				const { start: from, end: to } = getOrderedRange(start, end);
				return options.getSelfManagedBytes().slice(from, to + 1);
			};
		},
	);

	const selectionEnabled = computed(() => selectionDataProvider.value !== null);

	const selectionRange = computed<{ start: number; end: number } | null>(() => {
		if (!selectionEnabled.value) {
			return null;
		}
		const state = selectionState.value;
		if (!state) {
			return null;
		}
		return getOrderedRange(state.anchor, state.focus);
	});

	const selectionCount = computed(() => {
		const range = selectionRange.value;
		if (!range) {
			return 0;
		}
		return Math.max(0, range.end - range.start + 1);
	});

	const selectionState = ref<SelectionState | null>(null);
	const isPointerSelecting = ref(false);
	const activePointerId = ref<number | null>(null);
	let selectionSyncHandle: number | null = null;

	// Watch selection range and emit change events
	watch(selectionRange, (newRange) => {
		if (options.emitSelectionChange) {
			options.emitSelectionChange({
				start: newRange?.start ?? null,
				end: newRange?.end ?? null,
				length: selectionCount.value,
			});
		}
	});

	function scheduleSelectionSync() {
		if (typeof window === "undefined") {
			return;
		}
		if (selectionSyncHandle !== null) {
			cancelAnimationFrame(selectionSyncHandle);
		}
		selectionSyncHandle = requestAnimationFrame(() => {
			selectionSyncHandle = null;
			// Trigger markup regeneration which will embed selection classes
			options.updateRenderedSlice();
		});
	}

	function getSelectionPayloadFromElement(
		element: Element | null,
	): { mode: "hex" | "ascii"; index: number } | null {
		if (!(element instanceof HTMLElement)) {
			return null;
		}
		const cell = element.closest<HTMLElement>(
			"[data-hex-index], [data-ascii-index]",
		);
		if (!cell || cell.getAttribute("aria-hidden") === "true") {
			return null;
		}
		if (cell.hasAttribute("data-hex-index")) {
			const index = parseIndexAttribute(cell, "data-hex-index");
			return index !== null ? { mode: "hex", index } : null;
		}
		if (cell.hasAttribute("data-ascii-index")) {
			const index = parseIndexAttribute(cell, "data-ascii-index");
			return index !== null ? { mode: "ascii", index } : null;
		}
		return null;
	}

	function beginManualSelection(
		mode: "hex" | "ascii",
		index: number,
		pointerId: number,
	) {
		selectionState.value = { mode, anchor: index, focus: index };
		isPointerSelecting.value = true;
		activePointerId.value = pointerId;
		scheduleSelectionSync();
	}

	function updateManualSelection(index: number) {
		if (!selectionState.value) {
			return;
		}
		if (selectionState.value.focus === index) {
			return;
		}
		selectionState.value = {
			...selectionState.value,
			focus: index,
		};
		scheduleSelectionSync();
	}

	function finishPointerSelection() {
		isPointerSelecting.value = false;
		activePointerId.value = null;
	}

	function clearSelection() {
		if (!selectionState.value) {
			return;
		}
		selectionState.value = null;
		scheduleSelectionSync();
	}

	function handlePointerDown(event: PointerEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		if (event.button !== 0) {
			return;
		}
		const payload = getSelectionPayloadFromElement(
			event.target as Element | null,
		);

		// Emit byte-click event
		if (payload && options.emitByteClick) {
			const data = options.getSelfManagedBytes();
			if (payload.index < data.length) {
				const byte = data[payload.index];
				if (byte !== undefined) {
					options.emitByteClick({
						index: payload.index,
						byte,
						kind: payload.mode,
					});
				}
			}
		}

		const existing = selectionState.value;
		if (!payload) {
			if (!event.shiftKey) {
				clearSelection();
			}
			finishPointerSelection();
			return;
		}
		event.preventDefault();
		options.containerEl.value?.focus();

		if (event.shiftKey && existing && existing.mode === payload.mode) {
			selectionState.value = {
				mode: existing.mode,
				anchor: existing.anchor,
				focus: payload.index,
			};
			isPointerSelecting.value = false;
			activePointerId.value = null;
			scheduleSelectionSync();
			return;
		}
		beginManualSelection(payload.mode, payload.index, event.pointerId);
	}

	function resolveSelectionPayloadFromEvent(event: PointerEvent) {
		const direct = getSelectionPayloadFromElement(
			event.target as Element | null,
		);
		if (direct) {
			return direct;
		}
		const fallback = document.elementFromPoint(event.clientX, event.clientY);
		return getSelectionPayloadFromElement(fallback);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		if (!isPointerSelecting.value) {
			return;
		}
		if (
			activePointerId.value !== null &&
			activePointerId.value !== event.pointerId
		) {
			return;
		}
		const payload = resolveSelectionPayloadFromEvent(event);
		if (!payload) {
			return;
		}
		const state = selectionState.value;
		if (!state || payload.mode !== state.mode) {
			return;
		}
		updateManualSelection(payload.index);
	}

	function handlePointerUp(event: PointerEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		if (
			activePointerId.value !== null &&
			activePointerId.value !== event.pointerId
		) {
			return;
		}
		finishPointerSelection();
	}

	function buildSelectionText(state: SelectionState): string | null {
		const provider = selectionDataProvider.value;
		if (!provider) {
			return null;
		}
		const { start, end } = getOrderedRange(state.anchor, state.focus);
		const bytes = provider(start, end);
		if (!bytes.length) {
			return null;
		}

		if (state.mode === "ascii") {
			const isPrintable = options.getPrintableChecker();
			const renderAscii = options.getAsciiRenderer();
			const fallback = options.getNonPrintableChar();
			return Array.from(bytes, (byte) =>
				isPrintable(byte) ? renderAscii(byte) : fallback,
			).join("");
		}

		const upper = options.getUppercase();
		return Array.from(bytes, (byte) => {
			const hex = byte.toString(16).padStart(2, "0");
			return upper ? hex.toUpperCase() : hex;
		}).join(" ");
	}

	function writeTextToClipboard(text: string) {
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(text).catch(() => {
				console.error("Failed to write text to clipboard.");
			});
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!selectionEnabled.value) {
			return;
		}
		const key = event.key.toLowerCase();
		const isCopy = (event.ctrlKey || event.metaKey) && key === "c";
		if (isCopy) {
			const state = selectionState.value;
			if (!state) {
				return;
			}
			const text = buildSelectionText(state);
			if (!text) {
				return;
			}
			event.preventDefault();
			writeTextToClipboard(text);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			clearSelection();
		}
	}

	watch(options.markup, () => {
		scheduleSelectionSync();
	});

	watch(selectionEnabled, () => {
		scheduleSelectionSync();
	});

	onMounted(() => {
		const container = options.containerEl.value;
		if (container) {
			container.addEventListener("keydown", handleKeydown);
			container.addEventListener("pointerdown", handlePointerDown);
		}

		if (typeof window !== "undefined") {
			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
			window.addEventListener("pointercancel", handlePointerUp);
		}
	});

	onBeforeUnmount(() => {
		const container = options.containerEl.value;
		if (container) {
			container.removeEventListener("keydown", handleKeydown);
			container.removeEventListener("pointerdown", handlePointerDown);
		}

		if (typeof window !== "undefined") {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		}

		if (selectionSyncHandle !== null) {
			cancelAnimationFrame(selectionSyncHandle);
			selectionSyncHandle = null;
		}
	});

	return {
		selectionDataProvider,
		selectionEnabled,
		selectionRange,
		selectionCount,
	};
}
