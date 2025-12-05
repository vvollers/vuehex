export type VueHexSource = Uint8Array | number[] | string;

export interface VueHexWindow {
  offset: number;
  data: VueHexSource;
}

export interface VueHexWindowRequest {
  offset: number;
  length: number;
}

export interface VueHexDataBinding {
  window: VueHexWindow;
  totalBytes: number;
  requestWindow: (payload: VueHexWindowRequest) => void | Promise<void>;
}

export type VueHexPrintableCheck = (byte: number) => boolean;
export type VueHexAsciiRenderer = (byte: number) => string;

export const DEFAULT_PRINTABLE_CHECK: VueHexPrintableCheck = (byte) =>
  byte >= 0x20 && byte <= 0x7e;

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

export interface VueHexAsciiPreset {
  label: string;
  isPrintable: VueHexPrintableCheck;
  renderAscii: VueHexAsciiRenderer;
}

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
