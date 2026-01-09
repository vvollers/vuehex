export const OFFSET_PAD = 8;

const HTML_ESCAPE_LOOKUP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/**
 * Validates that the input data source is a Uint8Array, failing fast otherwise.
 */
export function normalizeSource(source: unknown): Uint8Array {
	if (source instanceof Uint8Array) {
		return source;
	}

	throw new TypeError(
		"VueHex expects virtual window data as Uint8Array instances.",
	);
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
 * Parses an integer from a DOM element attribute and validates it.
 * Returns null if the attribute doesn't exist or contains an invalid number.
 */
export function parseIndexAttribute(
	element: HTMLElement,
	attrName: string,
): number | null {
	const attr = element.getAttribute(attrName);
	if (!attr) {
		return null;
	}
	const index = Number.parseInt(attr, 10);
	return Number.isFinite(index) ? index : null;
}

/**
 * Reads a byte index from a hex or ASCII cell element.
 * Returns null if the element is not a valid cell or has no index.
 */
export function readByteIndexFromElement(
	element: Element | null,
): number | null {
	if (!(element instanceof HTMLElement)) {
		return null;
	}
	const cell = element.closest<HTMLElement>(
		"[data-hex-index], [data-ascii-index]",
	);
	if (!cell || cell.getAttribute("aria-hidden") === "true") {
		return null;
	}
	const attr = cell.hasAttribute("data-hex-index")
		? cell.getAttribute("data-hex-index")
		: cell.getAttribute("data-ascii-index");
	if (!attr) {
		return null;
	}
	const parsed = Number.parseInt(attr, 10);
	return Number.isFinite(parsed) ? parsed : null;
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
