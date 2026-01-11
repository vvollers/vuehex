import type { ComputedRef, Ref, ShallowRef } from "vue";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import type {
	VueHexEditIntent,
	VueHexEditorColumn,
	VueHexEditorMode,
} from "../vuehex-api";

const ACTIVE_COLUMN_CLASS = "vuehex-cursor--active-column";

const DEFAULT_HISTORY_LIMIT = 200;

function isHexDigit(key: string): boolean {
	return /^[0-9a-fA-F]$/.test(key);
}

function nibbleToValue(key: string): number | null {
	if (!isHexDigit(key)) {
		return null;
	}
	const value = Number.parseInt(key, 16);
	return Number.isFinite(value) ? value : null;
}

function clampByte(value: number): number {
	const normalized = Math.trunc(value);
	if (!Number.isFinite(normalized)) {
		return 0;
	}
	return Math.max(0, Math.min(255, normalized));
}

function findCellForIndex(
	tbody: HTMLTableSectionElement,
	column: VueHexEditorColumn,
	index: number,
): HTMLElement | null {
	const selector =
		column === "hex"
			? `[data-hex-index="${index}"]`
			: `[data-ascii-index="${index}"]`;
	return tbody.querySelector<HTMLElement>(selector);
}

function readByteValueFromCell(cell: HTMLElement | null): number | null {
	if (!cell) {
		return null;
	}
	const raw = cell.getAttribute("data-byte-value");
	if (!raw) {
		return null;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatByteHex(value: number, uppercase: boolean): string {
	const raw = clampByte(value).toString(16).padStart(2, "0");
	return uppercase ? raw.toUpperCase() : raw;
}

function normalizeHexClipboardText(text: string): string {
	return text.replace(/\s+/g, "");
}

function parseHexBytesFromText(text: string): number[] | null {
	const normalized = normalizeHexClipboardText(text);
	if (!normalized) {
		return [];
	}
	if (/[^0-9a-fA-F]/.test(normalized)) {
		return null;
	}
	const evenLength = normalized.length - (normalized.length % 2);
	const bytes: number[] = [];
	for (let i = 0; i < evenLength; i += 2) {
		const pair = normalized.slice(i, i + 2);
		const value = Number.parseInt(pair, 16);
		if (!Number.isFinite(value)) {
			return null;
		}
		bytes.push(value);
	}
	return bytes;
}

function parseAsciiBytesFromText(text: string): number[] {
	const bytes: number[] = [];
	for (const char of Array.from(text)) {
		const codePoint = char.codePointAt(0) ?? 0;
		bytes.push(clampByte(codePoint));
	}
	return bytes;
}

export interface EditingOptions {
	enabled: ComputedRef<boolean>;
	containerEl: Ref<HTMLDivElement | undefined>;
	tbodyEl: Ref<HTMLTableSectionElement | undefined>;
	markup: ShallowRef<string>;
	uppercase: ComputedRef<boolean>;
	cursorIndex: ComputedRef<number | null>;
	setCursorIndex: (index: number | null) => void;
	selectionRange: ComputedRef<{ start: number; end: number } | null>;
	clearSelection: () => void;
	copySelectionToClipboard: () => Promise<boolean>;
	totalBytes: ComputedRef<number>;
	isSelfManagedData: ComputedRef<boolean>;
	getSelfManagedBytes: () => Uint8Array;
	setSelfManagedBytes: (bytes: Uint8Array) => void;
	emitEdit: (intent: VueHexEditIntent) => void;
}

export interface EditingResult {
	activeColumn: Ref<VueHexEditorColumn>;
	editorMode: Ref<VueHexEditorMode>;
	resetPendingHexInput: () => void;
}

export function useEditing(options: EditingOptions): EditingResult {
	const activeColumn = ref<VueHexEditorColumn>("hex");
	const editorMode = ref<VueHexEditorMode>("overwrite");

	// Some browsers do not dispatch Ctrl/Cmd+V "paste" events to a focusable div.
	// A hidden textarea is the most reliable way to receive paste data without
	// relying on the async clipboard API (permissions/HTTPS/etc.).
	const pasteCaptureEl = ref<HTMLTextAreaElement | null>(null);

	function ensurePasteCaptureEl(container: HTMLDivElement) {
		if (pasteCaptureEl.value) {
			return;
		}
		const el = document.createElement("textarea");
		el.setAttribute("aria-hidden", "true");
		el.tabIndex = -1;
		el.autocomplete = "off";
		el.autocapitalize = "off";
		el.spellcheck = false;

		Object.assign(el.style, {
			position: "fixed",
			left: "-10000px",
			top: "0",
			width: "1px",
			height: "1px",
			opacity: "0",
			pointerEvents: "none",
		} satisfies Partial<CSSStyleDeclaration>);

		container.appendChild(el);
		pasteCaptureEl.value = el;
	}

	interface HistoryEntry {
		undo: VueHexEditIntent[];
		redo: VueHexEditIntent[];
		cursorBefore: number | null;
		cursorAfter: number | null;
	}

	const undoStack: HistoryEntry[] = [];
	const redoStack: HistoryEntry[] = [];
	let activeHistoryTransaction: HistoryEntry | null = null;
	let isApplyingHistory = false;

	function pushHistoryEntry(entry: HistoryEntry) {
		if (!entry.redo.length || !entry.undo.length) {
			return;
		}
		redoStack.length = 0;
		undoStack.push(entry);
		if (undoStack.length > DEFAULT_HISTORY_LIMIT) {
			undoStack.shift();
		}
	}

	function runHistoryTransaction(action: () => void) {
		if (!options.isSelfManagedData.value || isApplyingHistory) {
			action();
			return;
		}
		if (activeHistoryTransaction) {
			action();
			return;
		}
		const cursorBefore = options.cursorIndex.value;
		activeHistoryTransaction = {
			undo: [],
			redo: [],
			cursorBefore,
			cursorAfter: cursorBefore,
		};
		action();
		const finished = activeHistoryTransaction;
		activeHistoryTransaction = null;
		finished.cursorAfter = options.cursorIndex.value;
		pushHistoryEntry(finished);
	}

	function computeHistoryForIntent(
		intent: VueHexEditIntent,
	): { undo: VueHexEditIntent[]; redo: VueHexEditIntent[] } | null {
		const bytes = options.getSelfManagedBytes();
		const total = bytes.length;
		const columnForUndo = activeColumn.value;

		switch (intent.kind) {
			case "overwrite-byte": {
				if (intent.index < 0 || intent.index > total) {
					return null;
				}
				const index = Math.trunc(intent.index);
				if (index === total) {
					// Appending a new byte: undo by deleting the appended byte.
					return {
						redo: [{ ...intent, index }],
						undo: [{ kind: "delete-range", start: index, end: index }],
					};
				}
				const previous = bytes[index] ?? 0;
				return {
					redo: [{ ...intent, index }],
					undo: [
						{
							kind: "overwrite-byte",
							index,
							value: previous,
							column: intent.column,
						},
					],
				};
			}
			case "insert-byte": {
				const index = Math.max(0, Math.min(total, Math.trunc(intent.index)));
				const normalized: VueHexEditIntent = { ...intent, index };
				return {
					redo: [normalized],
					undo: [{ kind: "delete-range", start: index, end: index }],
				};
			}
			case "overwrite-bytes": {
				const values = intent.values.map(clampByte);
				if (!values.length) {
					return null;
				}
				const index = Math.max(0, Math.trunc(intent.index));
				const preTotal = total;
				const newTotal = Math.max(preTotal, index + values.length);
				const overlapEnd = Math.min(preTotal, index + values.length);
				const overlapLen = Math.max(0, overlapEnd - index);

				const undo: VueHexEditIntent[] = [];
				if (newTotal > preTotal) {
					undo.push({
						kind: "delete-range",
						start: preTotal,
						end: newTotal - 1,
					});
				}
				if (overlapLen > 0) {
					const previous = Array.from(
						bytes.subarray(index, index + overlapLen),
					);
					undo.push({
						kind: "overwrite-bytes",
						index,
						values: previous,
						column: intent.column,
					});
				}
				if (!undo.length) {
					return null;
				}
				return {
					redo: [
						{ kind: "overwrite-bytes", index, values, column: intent.column },
					],
					undo,
				};
			}
			case "insert-bytes": {
				const values = intent.values.map(clampByte);
				if (!values.length) {
					return null;
				}
				const index = Math.max(0, Math.min(total, Math.trunc(intent.index)));
				return {
					redo: [
						{ kind: "insert-bytes", index, values, column: intent.column },
					],
					undo: [
						{
							kind: "delete-range",
							start: index,
							end: index + values.length - 1,
						},
					],
				};
			}
			case "delete-byte": {
				if (total <= 0) {
					return null;
				}
				const index = Math.trunc(intent.index);
				const removeIndex =
					intent.direction === "backspace" ? index - 1 : index;
				if (removeIndex < 0 || removeIndex >= total) {
					return null;
				}
				const removed = bytes[removeIndex] ?? 0;
				return {
					redo: [intent],
					undo: [
						{
							kind: "insert-byte",
							index: removeIndex,
							value: removed,
							column: columnForUndo,
						},
					],
				};
			}
			case "delete-range": {
				if (total <= 0) {
					return null;
				}
				const start = Math.max(
					0,
					Math.min(total - 1, Math.trunc(intent.start)),
				);
				const end = Math.max(0, Math.min(total - 1, Math.trunc(intent.end)));
				const from = Math.min(start, end);
				const to = Math.max(start, end);
				const removed = Array.from(bytes.subarray(from, to + 1));
				if (!removed.length) {
					return null;
				}
				const normalized: VueHexEditIntent = {
					kind: "delete-range",
					start: from,
					end: to,
				};
				return {
					redo: [normalized],
					undo: [
						{
							kind: "insert-bytes",
							index: from,
							values: removed,
							column: columnForUndo,
						},
					],
				};
			}
			case "undo":
			case "redo": {
				return null;
			}
			default: {
				const _exhaustive: never = intent;
				return _exhaustive;
			}
		}
	}

	function recordHistoryIntent(intent: VueHexEditIntent) {
		if (!options.isSelfManagedData.value || isApplyingHistory) {
			return;
		}
		const computed = computeHistoryForIntent(intent);
		if (!computed) {
			return;
		}
		if (!activeHistoryTransaction) {
			const cursorBefore = options.cursorIndex.value;
			const cursorAfter = cursorBefore;
			pushHistoryEntry({
				undo: computed.undo,
				redo: computed.redo,
				cursorBefore,
				cursorAfter,
			});
			return;
		}
		activeHistoryTransaction.redo.push(...computed.redo);
		activeHistoryTransaction.undo = [
			...computed.undo,
			...activeHistoryTransaction.undo,
		];
	}

	function applyHistoryIntents(
		intents: VueHexEditIntent[],
		cursorTarget: number | null,
	) {
		if (!options.isSelfManagedData.value) {
			return;
		}
		resetPendingHexInput();
		options.clearSelection();
		isApplyingHistory = true;
		try {
			for (const intent of intents) {
				options.emitEdit(intent);
				applyToSelfManaged(intent);
			}
		} finally {
			isApplyingHistory = false;
		}
		options.setCursorIndex(cursorTarget);
	}

	function handleUndoRedo(event: KeyboardEvent): boolean {
		const lower = event.key.toLowerCase();
		const hasModifier = event.ctrlKey || event.metaKey;
		if (!hasModifier) {
			return false;
		}

		const isUndo = lower === "z" && !event.shiftKey;
		const isRedo = lower === "y" || (lower === "z" && event.shiftKey);
		if (!isUndo && !isRedo) {
			return false;
		}
		if (!options.enabled.value) {
			return true;
		}
		event.preventDefault();
		resetPendingHexInput();

		// Windowed/parent-managed mode: host is responsible for maintaining history.
		if (!options.isSelfManagedData.value) {
			options.emitEdit({ kind: isUndo ? "undo" : "redo" });
			return true;
		}

		if (isUndo) {
			const entry = undoStack.pop();
			if (!entry) {
				return true;
			}
			redoStack.push(entry);
			applyHistoryIntents(entry.undo, entry.cursorBefore);
			return true;
		}

		const entry = redoStack.pop();
		if (!entry) {
			return true;
		}
		undoStack.push(entry);
		applyHistoryIntents(entry.redo, entry.cursorAfter);
		return true;
	}

	const pendingHexFirstNibble = ref<string | null>(null);
	const pendingHexIndex = ref<number | null>(null);

	const normalizedCursorIndex = computed(() => options.cursorIndex.value);

	function syncActiveColumnHighlight() {
		const tbody = options.tbodyEl.value;
		if (!tbody) {
			return;
		}
		// Remove any previous active-column classes.
		tbody.querySelectorAll(`.${ACTIVE_COLUMN_CLASS}`).forEach((el) => {
			el.classList.remove(ACTIVE_COLUMN_CLASS);
		});

		if (!options.enabled.value) {
			return;
		}
		const index = normalizedCursorIndex.value;
		if (index == null) {
			return;
		}
		const cell = findCellForIndex(tbody, activeColumn.value, index);
		cell?.classList.add(ACTIVE_COLUMN_CLASS);
	}

	function resetPendingHexInput() {
		pendingHexFirstNibble.value = null;
		pendingHexIndex.value = null;

		const tbody = options.tbodyEl.value;
		const index = normalizedCursorIndex.value;
		if (!tbody || index == null) {
			return;
		}
		const cell = findCellForIndex(tbody, "hex", index);
		const value = readByteValueFromCell(cell);
		if (!cell) {
			return;
		}
		if (value != null) {
			cell.textContent = formatByteHex(value, options.uppercase.value);
			return;
		}
		// EOF ghost cell has no data-byte-value; restore its placeholder.
		if (index === options.totalBytes.value) {
			cell.textContent = "__";
		}
	}

	function applyToSelfManaged(intent: VueHexEditIntent) {
		const bytes = options.getSelfManagedBytes();
		const total = bytes.length;

		switch (intent.kind) {
			case "overwrite-byte": {
				if (intent.index < 0 || intent.index > total) {
					return;
				}
				const index = Math.trunc(intent.index);
				// Support appending when editing the EOF ghost cell.
				if (index === total) {
					const next = new Uint8Array(total + 1);
					next.set(bytes, 0);
					next[index] = clampByte(intent.value);
					options.setSelfManagedBytes(next);
					return;
				}
				const next = bytes.slice();
				next[index] = clampByte(intent.value);
				options.setSelfManagedBytes(next);
				return;
			}
			case "insert-byte": {
				const index = Math.max(0, Math.min(total, intent.index));
				const next = new Uint8Array(total + 1);
				next.set(bytes.subarray(0, index), 0);
				next[index] = clampByte(intent.value);
				next.set(bytes.subarray(index), index + 1);
				options.setSelfManagedBytes(next);
				return;
			}
			case "overwrite-bytes": {
				const values = intent.values.map(clampByte);
				if (!values.length) {
					return;
				}
				const index = Math.max(0, Math.min(total, intent.index));
				const requiredLength = Math.max(total, index + values.length);
				const next = new Uint8Array(requiredLength);
				next.set(bytes, 0);
				for (let i = 0; i < values.length; i += 1) {
					next[index + i] = values[i] ?? 0;
				}
				options.setSelfManagedBytes(next);
				return;
			}
			case "insert-bytes": {
				const values = intent.values.map(clampByte);
				if (!values.length) {
					return;
				}
				const index = Math.max(0, Math.min(total, intent.index));
				const next = new Uint8Array(total + values.length);
				next.set(bytes.subarray(0, index), 0);
				next.set(values, index);
				next.set(bytes.subarray(index), index + values.length);
				options.setSelfManagedBytes(next);
				return;
			}
			case "delete-byte": {
				if (total <= 0) {
					return;
				}
				const removeIndex =
					intent.direction === "backspace" ? intent.index - 1 : intent.index;
				if (removeIndex < 0 || removeIndex >= total) {
					return;
				}
				const next = new Uint8Array(total - 1);
				next.set(bytes.subarray(0, removeIndex), 0);
				next.set(bytes.subarray(removeIndex + 1), removeIndex);
				options.setSelfManagedBytes(next);
				return;
			}
			case "delete-range": {
				if (total <= 0) {
					return;
				}
				const start = Math.max(
					0,
					Math.min(total - 1, Math.trunc(intent.start)),
				);
				const end = Math.max(0, Math.min(total - 1, Math.trunc(intent.end)));
				const from = Math.min(start, end);
				const to = Math.max(start, end);
				const removeCount = Math.max(0, to - from + 1);
				if (removeCount <= 0) {
					return;
				}
				const next = new Uint8Array(total - removeCount);
				next.set(bytes.subarray(0, from), 0);
				next.set(bytes.subarray(to + 1), from);
				options.setSelfManagedBytes(next);
				return;
			}
			case "undo":
			case "redo": {
				// Windowed mode can emit these as commands; buffer mode handles undo/redo internally.
				return;
			}
			default: {
				const _exhaustive: never = intent;
				return _exhaustive;
			}
		}
	}

	function handlePointerDown(event: PointerEvent) {
		if (!options.enabled.value) {
			return;
		}
		const target = event.target as Element | null;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const cell = target.closest<HTMLElement>(
			"[data-hex-index], [data-ascii-index]",
		);
		if (!cell || cell.getAttribute("aria-hidden") === "true") {
			return;
		}

		resetPendingHexInput();
		activeColumn.value = cell.hasAttribute("data-hex-index") ? "hex" : "ascii";
	}

	function handleNavigationKey(event: KeyboardEvent): boolean {
		switch (event.key) {
			case "ArrowLeft":
			case "ArrowRight":
			case "ArrowUp":
			case "ArrowDown":
			case "Home":
			case "End":
			case "PageUp":
			case "PageDown":
				resetPendingHexInput();
				return true;
			default:
				return false;
		}
	}

	function emitAndMaybeApply(intent: VueHexEditIntent) {
		recordHistoryIntent(intent);
		options.emitEdit(intent);
		if (options.isSelfManagedData.value) {
			applyToSelfManaged(intent);
		}
	}

	function deleteSelectionIfAny(): { start: number } | null {
		const range = options.selectionRange.value;
		if (!range) {
			return null;
		}
		resetPendingHexInput();
		options.clearSelection();
		options.setCursorIndex(range.start);
		emitAndMaybeApply({
			kind: "delete-range",
			start: range.start,
			end: range.end,
		});

		if (options.isSelfManagedData.value) {
			const nextTotal = options.totalBytes.value;
			if (nextTotal <= 0) {
				options.setCursorIndex(null);
			} else {
				options.setCursorIndex(Math.min(range.start, nextTotal));
			}
		}

		return { start: range.start };
	}

	function applyDelete(direction: "backspace" | "delete") {
		if (options.selectionRange.value) {
			deleteSelectionIfAny();
			return;
		}
		const index = normalizedCursorIndex.value;
		if (index == null) {
			return;
		}
		resetPendingHexInput();

		emitAndMaybeApply({ kind: "delete-byte", index, direction });

		// Cursor follow-up in self-managed mode.
		if (options.isSelfManagedData.value) {
			if (direction === "backspace") {
				options.setCursorIndex(Math.max(0, index - 1));
			}
			const nextTotal = options.totalBytes.value;
			if (nextTotal <= 0) {
				options.setCursorIndex(null);
			} else if (index > nextTotal) {
				options.setCursorIndex(nextTotal);
			}
		}
	}

	function finalizeByteEdit(
		index: number,
		value: number,
		column: VueHexEditorColumn,
	) {
		const wasAtEofGhost =
			options.isSelfManagedData.value && index === options.totalBytes.value;

		const intent: VueHexEditIntent =
			editorMode.value === "insert"
				? { kind: "insert-byte", index, value, column }
				: { kind: "overwrite-byte", index, value, column };

		emitAndMaybeApply(intent);

		if (options.isSelfManagedData.value) {
			// Advance cursor after successful character entry.
			if (wasAtEofGhost) {
				// Appending creates a new EOF ghost one byte later; wait for reactive
				// total-bytes to update before moving.
				void nextTick(() => {
					options.setCursorIndex(index + 1);
				});
				return;
			}
			const nextTotal = options.totalBytes.value;
			if (nextTotal > 0) {
				options.setCursorIndex(Math.min(index + 1, nextTotal));
			}
		}
	}

	function handleHexKey(event: KeyboardEvent) {
		// Do not treat modifier shortcuts (copy/paste/etc.) as editing input.
		// Without this, Ctrl/Cmd+C in the hex column looks like the hex digit "c".
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}

		const nibble = nibbleToValue(event.key);
		if (nibble == null) {
			return;
		}

		const index = normalizedCursorIndex.value;
		if (index == null) {
			return;
		}
		event.preventDefault();

		const tbody = options.tbodyEl.value;
		const cell = tbody ? findCellForIndex(tbody, "hex", index) : null;

		// If we're starting a new byte or moved since last nibble, reset state.
		if (pendingHexIndex.value !== index) {
			pendingHexFirstNibble.value = null;
			pendingHexIndex.value = index;
		}

		if (pendingHexFirstNibble.value == null) {
			pendingHexFirstNibble.value = event.key;
			pendingHexIndex.value = index;
			// Best-effort visual feedback while waiting for second nibble.
			if (cell) {
				const first = options.uppercase.value
					? event.key.toUpperCase()
					: event.key.toLowerCase();
				cell.textContent = `${first}_`;
			}
			return;
		}

		const firstValue = nibbleToValue(pendingHexFirstNibble.value);
		if (firstValue == null) {
			resetPendingHexInput();
			return;
		}

		const nextByte = (firstValue << 4) | nibble;
		pendingHexFirstNibble.value = null;
		pendingHexIndex.value = null;

		// In windowed mode we don't mutate local data, so restore display immediately.
		if (!options.isSelfManagedData.value && cell) {
			const original = readByteValueFromCell(cell);
			if (original != null) {
				cell.textContent = formatByteHex(original, options.uppercase.value);
			} else if (index === options.totalBytes.value) {
				cell.textContent = "__";
			}
		}

		runHistoryTransaction(() => {
			const selectionResult = deleteSelectionIfAny();
			const effectiveIndex = selectionResult?.start ?? index;
			finalizeByteEdit(effectiveIndex, nextByte, "hex");
		});
	}

	function handleAsciiKey(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (event.key.length !== 1) {
			return;
		}

		runHistoryTransaction(() => {
			const selectionResult = deleteSelectionIfAny();
			const index = selectionResult?.start ?? normalizedCursorIndex.value;
			if (index == null) {
				return;
			}

			event.preventDefault();
			resetPendingHexInput();

			const code = event.key.codePointAt(0);
			if (code == null) {
				return;
			}
			finalizeByteEdit(index, clampByte(code), "ascii");
		});
	}

	function applyPasteValues(values: number[], column: VueHexEditorColumn) {
		if (!values.length) {
			return;
		}
		runHistoryTransaction(() => {
			const selectionResult = deleteSelectionIfAny();
			const index = selectionResult?.start ?? normalizedCursorIndex.value;
			if (index == null) {
				return;
			}
			const wasAtEofGhost =
				options.isSelfManagedData.value && index === options.totalBytes.value;
			resetPendingHexInput();

			const intent: VueHexEditIntent =
				editorMode.value === "insert"
					? { kind: "insert-bytes", index, values, column }
					: { kind: "overwrite-bytes", index, values, column };
			emitAndMaybeApply(intent);

			if (options.isSelfManagedData.value) {
				if (wasAtEofGhost) {
					void nextTick(() => {
						options.setCursorIndex(index + values.length);
					});
					return;
				}
				const nextTotal = options.totalBytes.value;
				if (nextTotal > 0) {
					options.setCursorIndex(Math.min(index + values.length, nextTotal));
				}
			}
		});
	}

	function applyPasteText(text: string) {
		if (!options.enabled.value) {
			return;
		}
		if (!text) {
			return;
		}
		if (activeColumn.value === "hex") {
			const values = parseHexBytesFromText(text);
			if (!values) {
				return;
			}
			applyPasteValues(values, "hex");
			return;
		}
		applyPasteValues(parseAsciiBytesFromText(text), "ascii");
	}

	function handlePaste(event: ClipboardEvent) {
		if (!options.enabled.value) {
			return;
		}
		const text = event.clipboardData?.getData("text") ?? "";
		if (!text) {
			return;
		}
		event.preventDefault();
		applyPasteText(text);

		// Keep keyboard navigation/editing on the main container.
		options.containerEl.value?.focus?.({ preventScroll: true });
		if (pasteCaptureEl.value) {
			pasteCaptureEl.value.value = "";
		}
	}

	async function handlePasteShortcut(event: KeyboardEvent) {
		if (!options.enabled.value) {
			return;
		}

		const container = options.containerEl.value;
		const capture = pasteCaptureEl.value;
		if (container && capture) {
			// Do NOT preventDefault: we want the browser to dispatch an actual paste
			// event to the currently-focused element (the hidden textarea).
			capture.value = "";
			capture.focus({ preventScroll: true });
			capture.select();
			return;
		}

		// Fallback to async clipboard read when capture element is missing.
		const clipboard =
			typeof navigator !== "undefined" ? navigator.clipboard : undefined;
		if (!clipboard?.readText) {
			return;
		}
		event.preventDefault();
		try {
			const text = await clipboard.readText();
			applyPasteText(text);
		} catch {
			// Ignore clipboard permission errors.
		}
	}

	async function handleCut(event: KeyboardEvent) {
		if (!options.enabled.value) {
			return;
		}
		if (!options.selectionRange.value) {
			return;
		}
		event.preventDefault();
		await options.copySelectionToClipboard();
		runHistoryTransaction(() => {
			deleteSelectionIfAny();
		});
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!options.enabled.value) {
			return;
		}
		if (handleUndoRedo(event)) {
			return;
		}

		handleNavigationKey(event);

		const lower = event.key.toLowerCase();
		const isCut = (event.ctrlKey || event.metaKey) && lower === "x";
		if (isCut) {
			void handleCut(event);
			return;
		}
		const isPaste = (event.ctrlKey || event.metaKey) && lower === "v";
		if (isPaste) {
			void handlePasteShortcut(event);
			return;
		}

		if (event.key === "Tab") {
			event.preventDefault();
			resetPendingHexInput();
			activeColumn.value = activeColumn.value === "hex" ? "ascii" : "hex";
			return;
		}

		if (event.key === "Insert") {
			event.preventDefault();
			resetPendingHexInput();
			editorMode.value =
				editorMode.value === "overwrite" ? "insert" : "overwrite";
			return;
		}

		if (event.key === "Backspace") {
			if (options.selectionRange.value) {
				event.preventDefault();
				runHistoryTransaction(() => {
					deleteSelectionIfAny();
				});
				return;
			}
			// If half-entered hex, backspace just clears the pending nibble.
			if (pendingHexFirstNibble.value != null && activeColumn.value === "hex") {
				event.preventDefault();
				resetPendingHexInput();
				return;
			}
			event.preventDefault();
			runHistoryTransaction(() => {
				applyDelete("backspace");
			});
			return;
		}

		if (event.key === "Delete") {
			event.preventDefault();
			runHistoryTransaction(() => {
				applyDelete("delete");
			});
			return;
		}

		if (activeColumn.value === "hex") {
			handleHexKey(event);
			return;
		}

		handleAsciiKey(event);
	}

	watch(
		[options.markup, normalizedCursorIndex, activeColumn, options.enabled],
		async () => {
			await nextTick();
			syncActiveColumnHighlight();
		},
		{ flush: "post" },
	);

	watch(normalizedCursorIndex, (next, prev) => {
		if (next == null || next === prev) {
			return;
		}
		if (pendingHexIndex.value != null && next !== pendingHexIndex.value) {
			resetPendingHexInput();
		}
	});

	onMounted(() => {
		const container = options.containerEl.value;
		if (container) {
			ensurePasteCaptureEl(container);
			container.addEventListener("keydown", handleKeydown);
			container.addEventListener("pointerdown", handlePointerDown);
			container.addEventListener("paste", handlePaste);
		}
	});

	onBeforeUnmount(() => {
		const container = options.containerEl.value;
		if (container) {
			container.removeEventListener("keydown", handleKeydown);
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("paste", handlePaste);
		}

		if (pasteCaptureEl.value) {
			pasteCaptureEl.value.parentElement?.removeChild(pasteCaptureEl.value);
			pasteCaptureEl.value = null;
		}

		const tbody = options.tbodyEl.value;
		if (tbody) {
			tbody.querySelectorAll(`.${ACTIVE_COLUMN_CLASS}`).forEach((el) => {
				el.classList.remove(ACTIVE_COLUMN_CLASS);
			});
		}
	});

	return { activeColumn, editorMode, resetPendingHexInput };
}
