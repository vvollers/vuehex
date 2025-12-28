import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
	VueHexAsciiRenderer,
	VueHexPrintableCheck,
	VueHexSelectionDataProvider,
} from "../vuehex-api";

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
}

export interface SelectionResult {
	selectionDataProvider: ComputedRef<VueHexSelectionDataProvider | null>;
	selectionEnabled: ComputedRef<boolean>;
}

interface SelectionState {
	mode: "hex" | "ascii";
	anchor: number;
	focus: number;
}

const SELECTED_CLASS = "vuehex-selected";
const SELECTED_ASCII_CLASS = "vuehex-selected--ascii";

export function useSelection(options: SelectionOptions): SelectionResult {
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
				const start = Math.max(
					0,
					Math.min(Math.trunc(selectionStart), Math.max(0, total - 1)),
				);
				const end = Math.max(
					0,
					Math.min(Math.trunc(selectionEnd), Math.max(0, total - 1)),
				);
				const from = Math.min(start, end);
				const to = Math.max(start, end);
				return options.getSelfManagedBytes().slice(from, to + 1);
			};
		},
	);

	const selectionEnabled = computed(() => selectionDataProvider.value !== null);

	const selectionState = ref<SelectionState | null>(null);
	const isPointerSelecting = ref(false);
	const activePointerId = ref<number | null>(null);
	let selectionSyncHandle: number | null = null;

	function scheduleSelectionSync() {
		if (typeof window === "undefined") {
			return;
		}
		if (selectionSyncHandle !== null) {
			cancelAnimationFrame(selectionSyncHandle);
		}
		selectionSyncHandle = requestAnimationFrame(() => {
			selectionSyncHandle = null;
			applySelectionHighlight();
		});
	}

	function applySelectionHighlight() {
		const tbody = options.tbodyEl.value;
		if (!tbody) {
			return;
		}
		const allNodes = tbody.querySelectorAll<HTMLElement>(
			"[data-hex-index], [data-ascii-index]",
		);
		allNodes.forEach((node) => {
			node.classList.remove(SELECTED_CLASS, SELECTED_ASCII_CLASS);
		});

		const state = selectionState.value;
		if (!state || !selectionEnabled.value) {
			if (state) {
				selectionState.value = null;
			}
			return;
		}

		const start = Math.min(state.anchor, state.focus);
		const end = Math.max(state.anchor, state.focus);
		const selector =
			state.mode === "hex" ? "[data-hex-index]" : "[data-ascii-index]";
		const classNames =
			state.mode === "hex"
				? [SELECTED_CLASS]
				: [SELECTED_CLASS, SELECTED_ASCII_CLASS];

		const nodes = tbody.querySelectorAll<HTMLElement>(selector);
		nodes.forEach((node) => {
			if (node.getAttribute("aria-hidden") === "true") {
				return;
			}
			const attr =
				state.mode === "hex"
					? node.getAttribute("data-hex-index")
					: node.getAttribute("data-ascii-index");
			if (!attr) {
				return;
			}
			const index = Number.parseInt(attr, 10);
			if (!Number.isFinite(index)) {
				return;
			}
			if (index < start || index > end) {
				return;
			}
			for (const className of classNames) {
				node.classList.add(className);
			}
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
			const attr = cell.getAttribute("data-hex-index");
			const index = attr ? Number.parseInt(attr, 10) : NaN;
			return Number.isFinite(index) ? { mode: "hex", index } : null;
		}
		if (cell.hasAttribute("data-ascii-index")) {
			const attr = cell.getAttribute("data-ascii-index");
			const index = attr ? Number.parseInt(attr, 10) : NaN;
			return Number.isFinite(index) ? { mode: "ascii", index } : null;
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
		const start = Math.min(state.anchor, state.focus);
		const end = Math.max(state.anchor, state.focus);
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

	return { selectionDataProvider, selectionEnabled };
}
