import type { Ref } from "vue";
import { ref } from "vue";
import { parseIndexAttribute } from "../vuehex-utils";

/**
 * Typed emitter contract for hover events forwarded by VueHex.
 *
 * Why it exists: keeps the composable decoupled from the Vue component instance
 * while still allowing consumers to observe hover state.
 */
type HoverEmit = (
	event:
		| "row-hover-on"
		| "row-hover-off"
		| "hex-hover-on"
		| "hex-hover-off"
		| "ascii-hover-on"
		| "ascii-hover-off",
	payload: unknown,
) => void;

export interface HoverLinkingOptions {
	/** Event emitter from VueHex; hover events are forwarded to component consumers. */
	emit: HoverEmit;
	/** Table body element containing rendered cells (used for class toggling). */
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
}

export interface HoverLinkingResult {
	/** Pointer-over handler (attach to the table body). */
	handlePointerOver: (event: PointerEvent) => void;
	/** Pointer-out handler (attach to the table body). */
	handlePointerOut: (event: PointerEvent) => void;
	/** Clears any active hover state and linked highlighting. */
	clearHoverState: () => void;
}

/**
 * Links hover state between rows, hex cells, and ASCII cells.
 *
 * Why it exists:
 * - Keeps hex/ASCII columns visually synchronized on hover.
 * - Emits semantic hover events (row/hex/ascii enter/leave) for consumers.
 * - Debounces DOM class updates to avoid excessive work during pointer movement.
 *
 * How it is used:
 * - VueHex forwards `pointerover`/`pointerout` events from the rendered `tbody`.
 * - The composable reads `data-*` attributes embedded in the markup to determine
 *   which row/cell is under the pointer and emits matching events.
 * - `clearHoverState` is called when the pointer leaves the table or when the
 *   rendered markup changes.
 */
export function useHoverLinking(
	options: HoverLinkingOptions,
): HoverLinkingResult {
	/**
	 * Tracks the row offset currently hovered so enter/leave events can be emitted once per row.
	 */
	const activeRowOffset = ref<number | null>(null);
	/**
	 * Records the active hex cell hover state, allowing linked ASCII highlighting.
	 */
	const activeHex = ref<{ index: number; byte: number } | null>(null);
	/**
	 * Records the active ASCII cell hover state, allowing linked hex highlighting.
	 */
	const activeAscii = ref<{ index: number; byte: number } | null>(null);
	/**
	 * Remembers the shared index being highlighted across hex and ASCII cells.
	 */
	const linkedHighlightIndex = ref<number | null>(null);

	/**
	 * RAF handle for debounced hover class application.
	 */
	let rafHandle: number | null = null;

	/**
	 * Pointer-enter handler for the tbody; delegates to element-specific hover logic.
	 */
	function handlePointerOver(event: PointerEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		applyRowEnter(target);
		applyHexEnter(target);
		applyAsciiEnter(target);
	}

	/**
	 * Pointer-leave handler for the tbody; manages hover exit and clearing when leaving the table.
	 */
	function handlePointerOut(event: PointerEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		const related = event.relatedTarget;
		applyRowLeave(target, related);
		applyHexLeave(target, related);
		applyAsciiLeave(target, related);

		const currentTarget = event.currentTarget;
		if (
			currentTarget instanceof HTMLElement &&
			(!(related instanceof HTMLElement) || !currentTarget.contains(related))
		) {
			clearHoverState();
		}
	}

	/**
	 * Applies row hover enter behaviour, issuing row hover events and managing state transitions.
	 */
	function applyRowEnter(element: HTMLElement) {
		const rowEl = element.closest<HTMLElement>("tr[data-row-offset]");
		if (!rowEl?.dataset.rowOffset) {
			return;
		}

		const offset = parseIndexAttribute(rowEl, "data-row-offset");
		if (offset === null) {
			return;
		}

		if (activeRowOffset.value != null && activeRowOffset.value !== offset) {
			options.emit("row-hover-off", { offset: activeRowOffset.value });
			activeRowOffset.value = null;
		}

		if (activeRowOffset.value === offset) {
			return;
		}

		activeRowOffset.value = offset;
		options.emit("row-hover-on", { offset });
	}

	/**
	 * Handles row hover exit logic for when the pointer leaves a row.
	 */
	function applyRowLeave(element: HTMLElement, related: EventTarget | null) {
		if (activeRowOffset.value == null) {
			return;
		}

		const rowEl = element.closest<HTMLElement>("tr[data-row-offset]");
		if (!rowEl?.dataset.rowOffset) {
			return;
		}

		const offset = parseIndexAttribute(rowEl, "data-row-offset");
		if (offset === null || offset !== activeRowOffset.value) {
			return;
		}

		if (related instanceof HTMLElement && rowEl.contains(related)) {
			return;
		}

		options.emit("row-hover-off", { offset });
		activeRowOffset.value = null;
	}

	/**
	 * Runs when entering a hex cell, ensuring events fire and linked ASCII highlights engage.
	 */
	function applyHexEnter(element: HTMLElement) {
		const hexEl = element.closest<HTMLElement>("span[data-hex-index]");
		if (!hexEl?.dataset.hexIndex || !hexEl.dataset.byteValue) {
			return;
		}

		const index = parseIndexAttribute(hexEl, "data-hex-index");
		const byte = parseIndexAttribute(hexEl, "data-byte-value");
		if (index === null || byte === null) {
			return;
		}

		if (activeHex.value) {
			if (activeHex.value.index === index && activeHex.value.byte === byte) {
				return;
			}
			options.emit("hex-hover-off", activeHex.value);
			activeHex.value = null;
		}

		activeHex.value = { index, byte };
		options.emit("hex-hover-on", activeHex.value);

		applyLinkedHighlight(index);
	}

	/**
	 * Handles leaving a hex cell, firing events and clearing linked highlights when appropriate.
	 */
	function applyHexLeave(element: HTMLElement, related: EventTarget | null) {
		if (!activeHex.value) {
			return;
		}

		const hexEl = element.closest<HTMLElement>("span[data-hex-index]");
		if (!hexEl?.dataset.hexIndex) {
			return;
		}

		const index = parseIndexAttribute(hexEl, "data-hex-index");
		if (index === null || index !== activeHex.value.index) {
			return;
		}

		if (related instanceof HTMLElement && hexEl.contains(related)) {
			return;
		}

		if (
			related instanceof HTMLElement &&
			(related.dataset.hexIndex === hexEl.dataset.hexIndex ||
				related.dataset.asciiIndex === hexEl.dataset.hexIndex)
		) {
			return;
		}

		options.emit("hex-hover-off", activeHex.value);
		activeHex.value = null;

		if (!activeAscii.value || activeAscii.value.index !== index) {
			clearLinkedHighlight();
		}
	}

	/**
	 * Runs when entering an ASCII cell, mirroring hex logic to keep rows synchronized.
	 */
	function applyAsciiEnter(element: HTMLElement) {
		const asciiEl = element.closest<HTMLElement>("span[data-ascii-index]");
		if (!asciiEl?.dataset.asciiIndex || !asciiEl.dataset.byteValue) {
			return;
		}

		const index = parseIndexAttribute(asciiEl, "data-ascii-index");
		const byte = parseIndexAttribute(asciiEl, "data-byte-value");
		if (index === null || byte === null) {
			return;
		}

		if (activeAscii.value) {
			if (
				activeAscii.value.index === index &&
				activeAscii.value.byte === byte
			) {
				return;
			}
			options.emit("ascii-hover-off", activeAscii.value);
			activeAscii.value = null;
		}

		activeAscii.value = { index, byte };
		options.emit("ascii-hover-on", activeAscii.value);

		applyLinkedHighlight(index);
	}

	/**
	 * Handles leaving an ASCII cell, maintaining proper paired highlights.
	 */
	function applyAsciiLeave(element: HTMLElement, related: EventTarget | null) {
		if (!activeAscii.value) {
			return;
		}

		const asciiEl = element.closest<HTMLElement>("span[data-ascii-index]");
		if (!asciiEl?.dataset.asciiIndex) {
			return;
		}

		const index = parseIndexAttribute(asciiEl, "data-ascii-index");
		if (index === null || index !== activeAscii.value.index) {
			return;
		}

		if (related instanceof HTMLElement && asciiEl.contains(related)) {
			return;
		}

		if (
			related instanceof HTMLElement &&
			(related.dataset.asciiIndex === asciiEl.dataset.asciiIndex ||
				related.dataset.hexIndex === asciiEl.dataset.asciiIndex)
		) {
			return;
		}

		options.emit("ascii-hover-off", activeAscii.value);
		activeAscii.value = null;

		if (!activeHex.value || activeHex.value.index !== index) {
			clearLinkedHighlight();
		}
	}

	/**
	 * Applies CSS classes to both hex and ASCII cells that share the same absolute byte index.
	 * Debounced via requestAnimationFrame to prevent excessive DOM updates.
	 */
	function applyLinkedHighlight(index: number) {
		if (!Number.isFinite(index) || index < 0) {
			return;
		}

		if (linkedHighlightIndex.value === index) {
			return;
		}

		// Cancel any pending highlight application
		if (rafHandle !== null) {
			if (typeof window !== "undefined" && window.cancelAnimationFrame) {
				window.cancelAnimationFrame(rafHandle);
			}
			rafHandle = null;
		}

		const applyHighlight = () => {
			rafHandle = null;
			clearLinkedHighlight();

			const tbody = options.tbodyEl.value;
			if (!tbody) {
				linkedHighlightIndex.value = index;
				return;
			}

			const selector =
				`[data-hex-index="${index}"]` + `, [data-ascii-index="${index}"]`;
			const elements = tbody.querySelectorAll<HTMLElement>(selector);
			elements.forEach((el) => {
				el.classList.add("vuehex-linked-hover");
			});

			linkedHighlightIndex.value = index;
		};

		if (typeof window !== "undefined" && window.requestAnimationFrame) {
			rafHandle = window.requestAnimationFrame(applyHighlight);
		} else {
			applyHighlight();
		}
	}

	/**
	 * Clears any pending linked hover highlighting across hex and ASCII cells.
	 */
	function clearLinkedHighlight() {
		if (linkedHighlightIndex.value == null) {
			return;
		}

		const tbody = options.tbodyEl.value;
		if (tbody) {
			const selector =
				`[data-hex-index="${linkedHighlightIndex.value}"]` +
				`, [data-ascii-index="${linkedHighlightIndex.value}"]`;
			const elements = tbody.querySelectorAll<HTMLElement>(selector);
			elements.forEach((el) => {
				el.classList.remove("vuehex-linked-hover");
			});
		}

		linkedHighlightIndex.value = null;
	}

	/**
	 * Clears all active hover state and notifies listeners that highlighting has ended.
	 */
	function clearHoverState() {
		// Cancel any pending RAF
		if (rafHandle !== null) {
			if (typeof window !== "undefined" && window.cancelAnimationFrame) {
				window.cancelAnimationFrame(rafHandle);
			}
			rafHandle = null;
		}

		if (activeHex.value) {
			options.emit("hex-hover-off", activeHex.value);
			activeHex.value = null;
		}
		if (activeAscii.value) {
			options.emit("ascii-hover-off", activeAscii.value);
			activeAscii.value = null;
		}
		if (activeRowOffset.value != null) {
			options.emit("row-hover-off", { offset: activeRowOffset.value });
			activeRowOffset.value = null;
		}

		clearLinkedHighlight();
	}

	return {
		handlePointerOver,
		handlePointerOut,
		clearHoverState,
	};
}
