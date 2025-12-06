import { ref } from "vue";
import type { Ref } from "vue";

type HoverEmit = (
  event:
    | "row-hover-on"
    | "row-hover-off"
    | "hex-hover-on"
    | "hex-hover-off"
    | "ascii-hover-on"
    | "ascii-hover-off",
  payload: unknown
) => void;

export interface HoverLinkingOptions {
  emit: HoverEmit;
  tbodyEl: Ref<HTMLTableSectionElement | undefined>;
}

export interface HoverLinkingResult {
  handlePointerOver: (event: PointerEvent) => void;
  handlePointerOut: (event: PointerEvent) => void;
  clearHoverState: () => void;
}

export function useHoverLinking(
  options: HoverLinkingOptions
): HoverLinkingResult {
  const activeRowOffset = ref<number | null>(null);
  const activeHex = ref<{ index: number; byte: number } | null>(null);
  const activeAscii = ref<{ index: number; byte: number } | null>(null);
  const linkedHighlightIndex = ref<number | null>(null);

  function handlePointerOver(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    applyRowEnter(target);
    applyHexEnter(target);
    applyAsciiEnter(target);
  }

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

  function applyRowEnter(element: HTMLElement) {
    const rowEl = element.closest<HTMLElement>("tr[data-row-offset]");
    if (!rowEl?.dataset.rowOffset) {
      return;
    }

    const offset = Number.parseInt(rowEl.dataset.rowOffset, 10);
    if (!Number.isFinite(offset)) {
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

  function applyRowLeave(element: HTMLElement, related: EventTarget | null) {
    if (activeRowOffset.value == null) {
      return;
    }

    const rowEl = element.closest<HTMLElement>("tr[data-row-offset]");
    if (!rowEl?.dataset.rowOffset) {
      return;
    }

    const offset = Number.parseInt(rowEl.dataset.rowOffset, 10);
    if (!Number.isFinite(offset) || offset !== activeRowOffset.value) {
      return;
    }

    if (related instanceof HTMLElement && rowEl.contains(related)) {
      return;
    }

    options.emit("row-hover-off", { offset });
    activeRowOffset.value = null;
  }

  function applyHexEnter(element: HTMLElement) {
    const hexEl = element.closest<HTMLElement>("span[data-hex-index]");
    if (!hexEl?.dataset.hexIndex || !hexEl.dataset.byteValue) {
      return;
    }

    const index = Number.parseInt(hexEl.dataset.hexIndex, 10);
    const byte = Number.parseInt(hexEl.dataset.byteValue, 10);
    if (!Number.isFinite(index) || !Number.isFinite(byte)) {
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

  function applyHexLeave(element: HTMLElement, related: EventTarget | null) {
    if (!activeHex.value) {
      return;
    }

    const hexEl = element.closest<HTMLElement>("span[data-hex-index]");
    if (!hexEl?.dataset.hexIndex) {
      return;
    }

    const index = Number.parseInt(hexEl.dataset.hexIndex, 10);
    if (!Number.isFinite(index) || index !== activeHex.value.index) {
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

  function applyAsciiEnter(element: HTMLElement) {
    const asciiEl = element.closest<HTMLElement>("span[data-ascii-index]");
    if (!asciiEl?.dataset.asciiIndex || !asciiEl.dataset.byteValue) {
      return;
    }

    const index = Number.parseInt(asciiEl.dataset.asciiIndex, 10);
    const byte = Number.parseInt(asciiEl.dataset.byteValue, 10);
    if (!Number.isFinite(index) || !Number.isFinite(byte)) {
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

  function applyAsciiLeave(element: HTMLElement, related: EventTarget | null) {
    if (!activeAscii.value) {
      return;
    }

    const asciiEl = element.closest<HTMLElement>("span[data-ascii-index]");
    if (!asciiEl?.dataset.asciiIndex) {
      return;
    }

    const index = Number.parseInt(asciiEl.dataset.asciiIndex, 10);
    if (!Number.isFinite(index) || index !== activeAscii.value.index) {
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

  function applyLinkedHighlight(index: number) {
    if (!Number.isFinite(index) || index < 0) {
      return;
    }

    if (linkedHighlightIndex.value === index) {
      return;
    }

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
  }

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

  function clearHoverState() {
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
