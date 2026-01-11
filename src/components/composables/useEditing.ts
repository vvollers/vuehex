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
		if (cell && value != null) {
			cell.textContent = formatByteHex(value, options.uppercase.value);
		}
	}

	function applyToSelfManaged(intent: VueHexEditIntent) {
		const bytes = options.getSelfManagedBytes();
		const total = bytes.length;

		switch (intent.kind) {
			case "overwrite-byte": {
				if (intent.index < 0 || intent.index >= total) {
					return;
				}
				const next = bytes.slice();
				next[intent.index] = clampByte(intent.value);
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
				options.setCursorIndex(Math.min(range.start, nextTotal - 1));
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
			} else if (index >= nextTotal) {
				options.setCursorIndex(nextTotal - 1);
			}
		}
	}

	function finalizeByteEdit(
		index: number,
		value: number,
		column: VueHexEditorColumn,
	) {
		const intent: VueHexEditIntent =
			editorMode.value === "insert"
				? { kind: "insert-byte", index, value, column }
				: { kind: "overwrite-byte", index, value, column };

		emitAndMaybeApply(intent);

		if (options.isSelfManagedData.value) {
			// Advance cursor after successful character entry.
			const nextTotal = options.totalBytes.value;
			if (nextTotal > 0) {
				options.setCursorIndex(Math.min(index + 1, nextTotal - 1));
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

		const selectionResult = deleteSelectionIfAny();
		const index = selectionResult?.start ?? normalizedCursorIndex.value;
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
			}
		}

		finalizeByteEdit(index, nextByte, "hex");
	}

	function handleAsciiKey(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (event.key.length !== 1) {
			return;
		}

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
	}

	function applyPasteValues(values: number[], column: VueHexEditorColumn) {
		const selectionResult = deleteSelectionIfAny();
		const index = selectionResult?.start ?? normalizedCursorIndex.value;
		if (index == null) {
			return;
		}
		resetPendingHexInput();

		const intent: VueHexEditIntent =
			editorMode.value === "insert"
				? { kind: "insert-bytes", index, values, column }
				: { kind: "overwrite-bytes", index, values, column };
		emitAndMaybeApply(intent);

		if (options.isSelfManagedData.value) {
			const nextTotal = options.totalBytes.value;
			if (nextTotal > 0) {
				options.setCursorIndex(Math.min(index + values.length, nextTotal - 1));
			}
		}
	}

	function handlePaste(event: ClipboardEvent) {
		if (!options.enabled.value) {
			return;
		}
		const text = event.clipboardData?.getData("text") ?? "";
		if (!text) {
			return;
		}

		if (activeColumn.value === "hex") {
			const values = parseHexBytesFromText(text);
			if (!values) {
				return;
			}
			event.preventDefault();
			applyPasteValues(values, "hex");
			return;
		}

		event.preventDefault();
		applyPasteValues(parseAsciiBytesFromText(text), "ascii");
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
		deleteSelectionIfAny();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!options.enabled.value) {
			return;
		}

		handleNavigationKey(event);

		const lower = event.key.toLowerCase();
		const isCut = (event.ctrlKey || event.metaKey) && lower === "x";
		if (isCut) {
			void handleCut(event);
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
				deleteSelectionIfAny();
				return;
			}
			// If half-entered hex, backspace just clears the pending nibble.
			if (pendingHexFirstNibble.value != null && activeColumn.value === "hex") {
				event.preventDefault();
				resetPendingHexInput();
				return;
			}
			event.preventDefault();
			applyDelete("backspace");
			return;
		}

		if (event.key === "Delete") {
			event.preventDefault();
			applyDelete("delete");
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

		const tbody = options.tbodyEl.value;
		if (tbody) {
			tbody.querySelectorAll(`.${ACTIVE_COLUMN_CLASS}`).forEach((el) => {
				el.classList.remove(ACTIVE_COLUMN_CLASS);
			});
		}
	});

	return { activeColumn, editorMode, resetPendingHexInput };
}
