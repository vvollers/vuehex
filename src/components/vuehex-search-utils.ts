import type { VueHexSearchHit, VueHexSearchMode } from "./vuehex-api";

export interface ParsedSearchBytes {
	bytes: Uint8Array | null;
	error: string | null;
}

/** Converts user-entered text or byte pairs into an exact search byte sequence. */
export function parseSearchBytes(
	value: string,
	mode: VueHexSearchMode,
): ParsedSearchBytes {
	if (!value) {
		return { bytes: null, error: null };
	}

	if (mode === "text") {
		const bytes = new TextEncoder().encode(value);
		return bytes.length
			? { bytes, error: null }
			: { bytes: null, error: "Enter text to search." };
	}

	const tokens = value.trim().split(/\s+/g);
	let normalized = "";
	for (const rawToken of tokens) {
		const token = rawToken.replace(/^0x/i, "");
		if (!token || token.includes("x") || !/^[\da-f]+$/i.test(token)) {
			return {
				bytes: null,
				error:
					"Hex input may contain only byte pairs, whitespace, and 0x prefixes.",
			};
		}
		normalized += token;
	}
	if (!normalized) {
		return { bytes: null, error: "Enter one or more hexadecimal byte pairs." };
	}
	if (normalized.length % 2 !== 0) {
		return {
			bytes: null,
			error: "Hex input must contain complete two-digit byte pairs.",
		};
	}

	const bytes = new Uint8Array(normalized.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(
			normalized.slice(index * 2, index * 2 + 2),
			16,
		);
	}
	return { bytes, error: null };
}

function bytesEqualAt(source: Uint8Array, query: Uint8Array, start: number) {
	if (start < 0 || start + query.length > source.length) {
		return false;
	}
	for (let index = 0; index < query.length; index += 1) {
		if (source[start + index] !== query[index]) {
			return false;
		}
	}
	return true;
}

/** Finds all non-overlapping exact byte matches using absolute source offsets. */
export function findByteHits(
	source: Uint8Array,
	query: Uint8Array,
): VueHexSearchHit[] {
	if (!query.length || query.length > source.length) {
		return [];
	}
	const hits: VueHexSearchHit[] = [];
	for (let start = 0; start <= source.length - query.length; ) {
		if (bytesEqualAt(source, query, start)) {
			hits.push({ start, end: start + query.length - 1 });
			start += query.length;
		} else {
			start += 1;
		}
	}
	return hits;
}

/** Counts non-overlapping exact byte matches without retaining their positions. */
export function countByteHits(source: Uint8Array, query: Uint8Array): number {
	if (!query.length || query.length > source.length) {
		return 0;
	}
	let count = 0;
	for (let start = 0; start <= source.length - query.length; ) {
		if (bytesEqualAt(source, query, start)) {
			count += 1;
			start += query.length;
		} else {
			start += 1;
		}
	}
	return count;
}

/** Returns the next/previous matching hit, wrapping once when requested. */
export function findByteHit(
	source: Uint8Array,
	query: Uint8Array,
	from: number,
	direction: "next" | "previous",
	wrap = true,
): VueHexSearchHit | null {
	const hits = findByteHits(source, query);
	if (!hits.length) {
		return null;
	}
	const normalized = Math.max(0, Math.min(source.length, Math.trunc(from)));
	if (direction === "next") {
		return (
			hits.find((hit) => hit.start >= normalized) ?? (wrap ? hits[0] : null)
		);
	}
	for (let index = hits.length - 1; index >= 0; index -= 1) {
		const hit = hits[index];
		if (hit && hit.start <= normalized) {
			return hit;
		}
	}
	return wrap ? (hits[hits.length - 1] ?? null) : null;
}

/** Replaces a single inclusive byte range without converting source bytes to text. */
export function replaceByteRange(
	source: Uint8Array,
	start: number,
	end: number,
	replacement: Uint8Array,
): Uint8Array {
	const from = Math.max(0, Math.min(source.length, Math.trunc(start)));
	const to = Math.max(from - 1, Math.min(source.length - 1, Math.trunc(end)));
	const removedLength = to >= from ? to - from + 1 : 0;
	const next = new Uint8Array(
		source.length - removedLength + replacement.length,
	);
	next.set(source.subarray(0, from));
	next.set(replacement, from);
	next.set(source.subarray(to + 1), from + replacement.length);
	return next;
}

/** Replaces every non-overlapping match from the original source in one allocation. */
export function replaceAllByteHits(
	source: Uint8Array,
	query: Uint8Array,
	replacement: Uint8Array,
): { bytes: Uint8Array; replaced: number } {
	const hits = findByteHits(source, query);
	if (!hits.length) {
		return { bytes: source, replaced: 0 };
	}
	const nextLength =
		source.length + hits.length * (replacement.length - query.length);
	const next = new Uint8Array(nextLength);
	let sourceOffset = 0;
	let targetOffset = 0;
	for (const hit of hits) {
		next.set(source.subarray(sourceOffset, hit.start), targetOffset);
		targetOffset += hit.start - sourceOffset;
		next.set(replacement, targetOffset);
		targetOffset += replacement.length;
		sourceOffset = hit.end + 1;
	}
	next.set(source.subarray(sourceOffset), targetOffset);
	return { bytes: next, replaced: hits.length };
}

/** Whether an absolute byte position belongs to a known hit range. */
export function hitContains(
	hit: VueHexSearchHit | null,
	index: number,
): boolean {
	return Boolean(hit && index >= hit.start && index <= hit.end);
}
