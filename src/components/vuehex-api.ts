/**
 * Describes the currently loaded window of bytes, including the absolute offset into the full data set.
 */
export interface VueHexWindow {
	offset: number;
	data: Uint8Array;
}

/**
 * Payload emitted when VueHex needs a new slice of bytes from the host application.
 */
export interface VueHexWindowRequest {
	offset: number;
	length: number;
}

/**
 * Built-in theme keys supported by VueHex out of the box.
 *
 * Custom themes are also supported by passing any token to the `theme` prop
 * (VueHex emits `.vuehex-theme-<token>`).
 */
export const VUE_HEX_BUILTIN_THEME_KEYS = [
	"auto",
	"light",
	"dark",
	"terminal",
	"sunset",
] as const;

/** Union type of the built-in theme keys. */
export type VueHexBuiltinThemeKey = (typeof VUE_HEX_BUILTIN_THEME_KEYS)[number];

/**
 * Function that determines whether a given byte should be treated as printable ASCII for the viewer.
 */
export type VueHexPrintableCheck = (byte: number) => boolean;
/**
 * Function that renders a printable byte into its display string representation.
 */
export type VueHexAsciiRenderer = (byte: number) => string;

/**
 * Fetches raw bytes for the given inclusive selection range.
 */
export type VueHexSelectionDataProvider = (
	selectionStart: number,
	selectionEnd: number,
) => Uint8Array;

/** Which column the editor is currently targeting. */
export type VueHexEditorColumn = "hex" | "ascii";

/** Editing mode: overwrite replaces bytes; insert grows the buffer. */
export type VueHexEditorMode = "overwrite" | "insert";

/**
 * Single edit intent emitted by VueHex when `editable` is enabled.
 *
 * Consumers that own the backing buffer should apply these intents to their
 * data source and feed the updated bytes back via `v-model`.
 */
export type VueHexEditIntent =
	| {
			kind: "overwrite-byte";
			index: number;
			value: number;
			column: VueHexEditorColumn;
	  }
	| {
			kind: "insert-byte";
			index: number;
			value: number;
			column: VueHexEditorColumn;
	  }
	| {
			kind: "overwrite-bytes";
			index: number;
			values: number[];
			column: VueHexEditorColumn;
	  }
	| {
			kind: "insert-bytes";
			index: number;
			values: number[];
			column: VueHexEditorColumn;
	  }
	| {
			kind: "delete-byte";
			index: number;
			direction: "backspace" | "delete";
	  }
	| {
			kind: "delete-range";
			start: number;
			end: number;
	  };

/**
 * Built-in status bar component identifiers.
 *
 * - "offset": cursor offset (absolute byte index)
 * - "hex": current byte rendered as hex
 * - "ascii": current byte rendered as ASCII (or nonPrintableChar)
 * - "selection": selection summary text
 * - "slot": renders a named Vue slot in the status bar section
 */
export type VueHexStatusBarComponentName =
	| "offset"
	| "hex"
	| "ascii"
	| "selection"
	| "slot";

/**
 * Declares a component that can appear in the VueHex status bar.
 *
 * A string is treated as the component name. The object form allows
 * attaching per-component configuration.
 */
export type VueHexStatusBarComponent =
	| string
	| {
			name: string;
			config?: unknown;
	  };

/**
 * Controls where status bar components render.
 *
 * The status bar is split into three sections:
 * - left (left-aligned)
 * - middle (centered)
 * - right (right-aligned)
 */
export interface VueHexStatusBarLayout {
	left?: VueHexStatusBarComponent[];
	middle?: VueHexStatusBarComponent[];
	right?: VueHexStatusBarComponent[];
}

/**
 * Identifies which table column a cell represents when resolving custom classes.
 */
export type VueHexCellKind = "hex" | "ascii";

/**
 * Shape of the payload provided to the cell class resolver, including the absolute index and byte value.
 */
export interface VueHexCellClassPayload {
	kind: VueHexCellKind;
	index: number;
	byte: number;
}

/**
 * Allows consumers to return custom class names for individual cells in the hex or ASCII columns.
 */
export type VueHexCellClassResolver = (
	payload: VueHexCellClassPayload,
) => string | string[] | null | undefined;

/**
 * Accepts either a single cell class resolver or an ordered list of resolvers.
 *
 * When multiple resolvers are supplied, VueHex will call each resolver and merge
 * the returned class names.
 */
export type VueHexCellClassResolverInput =
	| VueHexCellClassResolver
	| ReadonlyArray<VueHexCellClassResolver>;

const VUEHEX_CATEGORY_DIGIT_CLASS = "vuehex-category-digit";
const VUEHEX_CATEGORY_UPPERCASE_CLASS = "vuehex-category-uppercase";
const VUEHEX_CATEGORY_LOWERCASE_CLASS = "vuehex-category-lowercase";
const VUEHEX_CATEGORY_NULL_CLASS = "vuehex-category-null";
const VUEHEX_CATEGORY_ERASED_CLASS = "vuehex-category-erased";
const VUEHEX_CATEGORY_CONTROL_CLASS = "vuehex-category-control";
const VUEHEX_CATEGORY_HIGHBIT_CLASS = "vuehex-category-highbit";

/**
 * Default per-byte cell classifier used by VueHex when `cellClassForByte` is not provided.
 *
 * Returns built-in category classes (`vuehex-category-*`) based on ASCII ranges.
 */
export const DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER: VueHexCellClassResolver =
	({ byte }) => {
		if (byte >= 0x30 && byte <= 0x39) {
			return VUEHEX_CATEGORY_DIGIT_CLASS;
		}
		if (byte >= 0x41 && byte <= 0x5a) {
			return VUEHEX_CATEGORY_UPPERCASE_CLASS;
		}
		if (byte >= 0x61 && byte <= 0x7a) {
			return VUEHEX_CATEGORY_LOWERCASE_CLASS;
		}
		if (byte === 0x00) {
			return VUEHEX_CATEGORY_NULL_CLASS;
		}
		if (byte === 0xff) {
			return VUEHEX_CATEGORY_ERASED_CLASS;
		}
		if ((byte >= 0x01 && byte <= 0x1f) || byte === 0x7f) {
			return VUEHEX_CATEGORY_CONTROL_CLASS;
		}
		if (byte >= 0x80 && byte <= 0xfe) {
			return VUEHEX_CATEGORY_HIGHBIT_CLASS;
		}
		return undefined;
	};

/**
 * Default printable check for standard ASCII range (0x20-0x7E).
 */
export const DEFAULT_PRINTABLE_CHECK: VueHexPrintableCheck = (byte) =>
	byte >= 0x20 && byte <= 0x7e;

/**
 * Default renderer that converts printable bytes to their character form.
 */
export const DEFAULT_ASCII_RENDERER: VueHexAsciiRenderer = (byte) =>
	String.fromCharCode(byte);

const LATIN1_PRINTABLE_CHECK: VueHexPrintableCheck = (byte) =>
	DEFAULT_PRINTABLE_CHECK(byte) || (byte >= 0xa0 && byte <= 0xff);

const VISIBLE_WHITESPACE_CHECK: VueHexPrintableCheck = (byte) =>
	DEFAULT_PRINTABLE_CHECK(byte) ||
	byte === 0x09 ||
	byte === 0x0a ||
	byte === 0x0d;

const VISIBLE_WHITESPACE_RENDERER: VueHexAsciiRenderer = (byte) => {
	switch (byte) {
		case 0x09:
			return "⇥";
		case 0x0a:
			return "␊";
		case 0x0d:
			return "␍";
		case 0x20:
			return "␠";
		default:
			return String.fromCharCode(byte);
	}
};

/**
 * Describes an ASCII preset bundle with labeling and behavior for rendering/printability.
 */
export interface VueHexAsciiPreset {
	label: string;
	isPrintable: VueHexPrintableCheck;
	renderAscii: VueHexAsciiRenderer;
}

/**
 * Built-in presets for common ASCII rendering scenarios that consumers can reuse.
 */
export const VUE_HEX_ASCII_PRESETS: Record<
	"standard" | "latin1" | "visibleWhitespace",
	VueHexAsciiPreset
> = Object.freeze({
	standard: {
		label: "Standard ASCII (0x20-0x7E)",
		isPrintable: DEFAULT_PRINTABLE_CHECK,
		renderAscii: DEFAULT_ASCII_RENDERER,
	},
	latin1: {
		label: "Latin-1 Supplement (0x20-0x7E, 0xA0-0xFF)",
		isPrintable: LATIN1_PRINTABLE_CHECK,
		renderAscii: DEFAULT_ASCII_RENDERER,
	},
	visibleWhitespace: {
		label: "Visible ASCII + whitespace glyphs",
		isPrintable: VISIBLE_WHITESPACE_CHECK,
		renderAscii: VISIBLE_WHITESPACE_RENDERER,
	},
});
