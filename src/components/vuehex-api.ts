/**
 * Represents any supported byte source that can back the viewer: typed array, numeric array, or string.
 */
export type VueHexSource = Uint8Array | number[] | string;

/**
 * Describes the currently loaded window of bytes, including the absolute offset into the full data set.
 */
export interface VueHexWindow {
	offset: number;
	data: VueHexSource;
}

/**
 * Payload used when requesting a new slice of data from the binding layer.
 */
export interface VueHexWindowRequest {
	offset: number;
	length: number;
}

/**
 * Binding contract between the component and the host application, allowing window updates and total length reporting.
 */
export interface VueHexDataBinding {
	window: VueHexWindow;
	totalBytes: number;
	requestWindow: (payload: VueHexWindowRequest) => void | Promise<void>;
}

/**
 * Function that determines whether a given byte should be treated as printable ASCII for the viewer.
 */
export type VueHexPrintableCheck = (byte: number) => boolean;
/**
 * Function that renders a printable byte into its display string representation.
 */
export type VueHexAsciiRenderer = (byte: number) => string;

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
