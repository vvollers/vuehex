import type {
	VueHexCellClassResolver,
	VueHexCellClassResolverInput,
} from "./vuehex-api";
import { DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER } from "./vuehex-api";

/**
 * Normalizes `cellClassForByte` input into a single resolver function.
 *
 * Rules:
 * - `undefined`: use the default built-in ASCII category resolver.
 * - `null`: disable all per-cell class resolution.
 * - `function`: use as-is.
 * - `array`: filter to functions and merge results (flattened).
 */
export function normalizeCellClassForByteResolver(
	input: VueHexCellClassResolverInput | null | undefined,
): VueHexCellClassResolver | undefined {
	if (input === undefined) {
		return DEFAULT_ASCII_CATEGORY_CELL_CLASS_RESOLVER;
	}
	if (input === null) {
		return undefined;
	}
	if (typeof input === "function") {
		return input;
	}
	if (Array.isArray(input)) {
		const resolvers = input.filter(
			(resolver): resolver is VueHexCellClassResolver =>
				typeof resolver === "function",
		);
		if (resolvers.length === 0) {
			return undefined;
		}
		return (payload) => {
			const merged: Array<string | string[]> = [];
			for (const resolver of resolvers) {
				const resolved = resolver(payload);
				if (resolved == null) {
					continue;
				}
				merged.push(resolved);
			}
			if (merged.length === 0) {
				return undefined;
			}
			return merged.flat();
		};
	}

	return undefined;
}
