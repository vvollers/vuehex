import type {
  VueHexAsciiRenderer,
  VueHexCellClassResolver,
  VueHexPrintableCheck,
} from "./vuehex-api";

export const OFFSET_PAD = 8;
export const PLACEHOLDER_HEX = "--";
export const PLACEHOLDER_ASCII = "--";

const HEX_LOWER: readonly string[] = Array.from({ length: 256 }, (_, value) =>
  value.toString(16).padStart(2, "0")
);
const HEX_UPPER: readonly string[] = HEX_LOWER.map((value) =>
  value.toUpperCase()
);

const TEXT_ENCODER = new TextEncoder();

const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export type BuildHexTableMarkupFn = (
  bytes: Uint8Array,
  bytesPerRow: number,
  uppercase: boolean,
  fallbackAscii: string,
  baseOffset: number,
  isPrintable: VueHexPrintableCheck,
  renderAscii: VueHexAsciiRenderer,
  resolveCellClass?: VueHexCellClassResolver
) => string;

/**
 * Normalizes any supported data source into a Uint8Array, allowing components to accept
 * arrays, typed arrays, or arbitrary values while receiving a consistent byte buffer.
 */
export function normalizeSource(source: unknown): Uint8Array {
  if (source instanceof Uint8Array) {
    return source;
  }

  if (Array.isArray(source)) {
    return Uint8Array.from(source, (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }

      const clampedValue = Math.min(255, Math.max(0, Math.trunc(numeric)));
      return clampedValue;
    });
  }

  return TEXT_ENCODER.encode(String(source ?? ""));
}

/**
 * Sanitizes the requested bytes-per-row value, ensuring downstream layout logic always
 * receives a finite integer at least one byte wide per row.
 */
export function clampBytesPerRow(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 16;
  }

  return Math.max(1, Math.trunc(value));
}

/**
 * Produces the fallback ASCII character used for non-printable bytes, escaping it so
 * it can be dropped directly into HTML markup.
 */
export function resolveFallbackChar(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    const candidate = value.slice(0, 1);
    return escapeHtml(candidate);
  }

  return ".";
}

/**
 * Escapes a provided ASCII representation so it can be safely interpolated into HTML.
 */
export function escapeAsciiChar(value: string): string {
  return escapeHtml(value);
}

/**
 * Escapes raw text for safe HTML insertion by replacing reserved characters.
 */
export function escapeHtml(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    result += HTML_ESCAPE_LOOKUP[char] ?? char;
  }
  return result;
}

/**
 * Formats a byte offset as plain hexadecimal text (no HTML) for summary displays.
 */
export function formatOffsetPlain(value: number, uppercase: boolean): string {
  const raw = value.toString(16).padStart(OFFSET_PAD, "0");
  return uppercase ? raw.toUpperCase() : raw;
}

/**
 * Formats a byte offset for the table header, decorating leading zeros with markup for
 * visual differentiation while honoring casing preferences.
 */
export function formatOffset(value: number, uppercase: boolean): string {
  const raw = value.toString(16).padStart(OFFSET_PAD, "0");
  const normalized = uppercase ? raw.toUpperCase() : raw;
  const trimmed = normalized.replace(/^0+/, "");
  const leadingCount = normalized.length - trimmed.length;

  if (leadingCount <= 0) {
    return normalized;
  }

  const leading = normalized.slice(0, leadingCount);
  const significant = normalized.slice(leadingCount);

  return `<span class="vuehex-offset-leading">${leading}</span>${significant}`;
}

/**
 * Clamps a numeric value into an inclusive range for shared viewport math helpers.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Normalizes a theme identifier into a kebab-case token that can be appended to class names.
 */
export function normalizeThemeKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}

/**
 * Flattens and cleans arbitrary class token inputs so renderer utilities can safely append them.
 */
export function normalizeClassTokens(
  value: string | string[] | null | undefined
): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    const flattened: string[] = [];
    for (const entry of value) {
      flattened.push(...normalizeClassTokens(entry));
    }
    return flattened;
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Escapes a list of class names for inclusion in an attribute, deduplicating tokens on the way.
 */
export function escapeClassAttribute(classes: string[]): string {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const token of classes) {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(escapeHtml(trimmed));
  }
  return normalized.join(" ");
}

/**
 * Builds the inner HTML for the hex table body, returning a string that can be assigned via
 * v-html while taking care of alignment, placeholders, and optional cell class resolution.
 */
export const buildHexTableMarkup: BuildHexTableMarkupFn = (
  bytes,
  bytesPerRow,
  uppercase,
  fallbackAscii,
  baseOffset,
  isPrintable,
  renderAscii,
  resolveCellClass
) => {
  if (bytes.length === 0) {
    return "";
  }

  const hexLookup = uppercase ? HEX_UPPER : HEX_LOWER;
  const asciiFallbackEscaped = fallbackAscii;
  const tableMarkup: string[] = [];
  const useColumnSplit = bytesPerRow % 2 === 0;
  const columnBreakIndex = useColumnSplit ? bytesPerRow / 2 : -1;

  const buildClassList = (
    base: string,
    columnIndex: number,
    payload: {
      kind: "hex" | "ascii";
      absoluteIndex: number;
      byteValue: number;
      isPlaceholder?: boolean;
      isNonPrintable?: boolean;
      resolver?: VueHexCellClassResolver;
    }
  ): string => {
    const classes: string[] = [base];
    if (useColumnSplit && columnIndex >= columnBreakIndex) {
      classes.push(`${base}--second-column`);
      if (columnIndex === columnBreakIndex) {
        classes.push(`${base}--column-start`);
      }
    }

    if (!payload.isPlaceholder) {
      classes.push(`${base}--value-${payload.byteValue}`);
    }

    if (payload.isPlaceholder) {
      classes.push(`${base}--placeholder`);
    }

    if (payload.kind === "ascii" && !payload.isPlaceholder) {
      if (payload.isNonPrintable) {
        classes.push("vuehex-ascii-char--non-printable");
      } else {
        classes.push("vuehex-ascii-char--printable");
      }
    }

    if (payload.resolver && !payload.isPlaceholder) {
      const resolved = payload.resolver({
        kind: payload.kind,
        index: payload.absoluteIndex,
        byte: payload.byteValue,
      });
      if (resolved != null) {
        classes.push(...normalizeClassTokens(resolved));
      }
    }

    return escapeClassAttribute(classes);
  };

  for (let offset = 0; offset < bytes.length; offset += bytesPerRow) {
    const remaining = Math.min(bytesPerRow, bytes.length - offset);
    const rowOffset = baseOffset + offset;

    tableMarkup.push(
      `<tr role="row" data-row-offset="${rowOffset}"><th scope="row" class="vuehex-offset" role="rowheader">${formatOffset(
        rowOffset,
        uppercase
      )}</th><td class="vuehex-bytes" role="cell">`
    );

    for (let index = 0; index < remaining; index += 1) {
      const value = bytes[offset + index] ?? 0;
      const absoluteIndex = rowOffset + index;
      const className = buildClassList("vuehex-byte", index, {
        kind: "hex",
        absoluteIndex,
        byteValue: value,
        resolver: resolveCellClass,
      });
      tableMarkup.push(
        `<span class="${className}" data-hex-index="${absoluteIndex}" data-byte-value="${value}">${hexLookup[value]}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      const columnIndex = pad;
      const className = buildClassList("vuehex-byte", columnIndex, {
        kind: "hex",
        absoluteIndex: rowOffset + columnIndex,
        byteValue: 0,
        isPlaceholder: true,
      });
      tableMarkup.push(
        `<span class="${className}" aria-hidden="true">${PLACEHOLDER_HEX}</span>`
      );
    }

    tableMarkup.push('</td><td class="vuehex-ascii" role="cell">');

    for (let index = 0; index < remaining; index += 1) {
      const value = bytes[offset + index] ?? 0;
      const absoluteIndex = rowOffset + index;
      let asciiContent = asciiFallbackEscaped;
      let isNonPrintable = true;
      if (isPrintable(value)) {
        const rendered = renderAscii(value);
        const renderedString = rendered != null ? String(rendered) : "";
        if (renderedString.length > 0) {
          asciiContent = escapeAsciiChar(renderedString);
          isNonPrintable = false;
        }
      }
      const className = buildClassList("vuehex-ascii-char", index, {
        kind: "ascii",
        absoluteIndex,
        byteValue: value,
        isNonPrintable,
        resolver: resolveCellClass,
      });
      tableMarkup.push(
        `<span class="${className}" data-ascii-index="${absoluteIndex}" data-byte-value="${value}">${asciiContent}</span>`
      );
    }

    for (let pad = remaining; pad < bytesPerRow; pad += 1) {
      const columnIndex = pad;
      const className = buildClassList("vuehex-ascii-char", columnIndex, {
        kind: "ascii",
        absoluteIndex: rowOffset + columnIndex,
        byteValue: 0,
        isPlaceholder: true,
      });
      tableMarkup.push(
        `<span class="${className}" aria-hidden="true">${PLACEHOLDER_ASCII}</span>`
      );
    }

    tableMarkup.push("</td></tr>");
  }

  return tableMarkup.join("");
};
