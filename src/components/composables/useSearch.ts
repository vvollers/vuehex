import type { ComputedRef, Ref } from "vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
	VueHexReplaceProvider,
	VueHexReplaceResponse,
	VueHexSearchDirection,
	VueHexSearchHit,
	VueHexSearchMode,
	VueHexSearchProvider,
} from "../vuehex-api";
import { findByteHits, parseSearchBytes } from "../vuehex-search-utils";

export interface SearchOptions {
	enabled: ComputedRef<boolean>;
	isWindowed: ComputedRef<boolean>;
	isEditable: ComputedRef<boolean>;
	getBytes: () => Uint8Array;
	replaceLocal: (
		ranges: ReadonlyArray<VueHexSearchHit>,
		values: Uint8Array,
	) => void;
	getInitialOffset: () => number;
	searchProvider: () => VueHexSearchProvider | undefined;
	replaceProvider: () => VueHexReplaceProvider | undefined;
	applyWindow: (window: { offset: number; data: Uint8Array }) => void;
	onReplaceResult: (response: VueHexReplaceResponse) => void;
	navigateTo: (hit: VueHexSearchHit) => void;
}

export interface SearchResult {
	open: Ref<boolean>;
	replaceOpen: Ref<boolean>;
	expanded: Ref<boolean>;
	mode: Ref<VueHexSearchMode>;
	replacementMode: Ref<VueHexSearchMode>;
	query: Ref<string>;
	replacement: Ref<string>;
	activeHit: Ref<VueHexSearchHit | null>;
	pending: Ref<boolean>;
	message: Ref<string | null>;
	error: Ref<boolean>;
	resultText: ComputedRef<string>;
	searchDisabled: ComputedRef<boolean>;
	canReplace: ComputedRef<boolean>;
	replaceHelp: ComputedRef<string>;
	openSearch: (options?: { replace?: boolean; selectQuery?: boolean }) => void;
	closeSearch: () => void;
	find: (direction: VueHexSearchDirection) => Promise<void>;
	replace: (scope: "one" | "all") => Promise<void>;
	getHighlightState: (index: number) => "active" | "match" | null;
}

/** Owns byte-oriented search state and routes full-source operations by data mode. */
export function useSearch(options: SearchOptions): SearchResult {
	const open = ref(false);
	const replaceOpen = ref(false);
	const expanded = ref(false);
	const mode = ref<VueHexSearchMode>("hex");
	const replacementMode = ref<VueHexSearchMode>("hex");
	const query = ref("");
	const replacement = ref("");
	const activeHit = ref<VueHexSearchHit | null>(null);
	const hits = ref<VueHexSearchHit[]>([]);
	const total = ref(0);
	const activeOrdinal = ref(0);
	const pending = ref(false);
	const message = ref<string | null>(null);
	const error = ref(false);
	let requestId = 0;
	let controller: AbortController | null = null;
	let debounceHandle: ReturnType<typeof setTimeout> | null = null;

	const parsedQuery = computed(() => parseSearchBytes(query.value, mode.value));
	const parsedReplacement = computed(() =>
		parseSearchBytes(replacement.value, replacementMode.value),
	);
	const searchDisabled = computed(
		() => options.isWindowed.value && !options.searchProvider(),
	);
	const canReplace = computed(() => {
		if (
			!options.isEditable.value ||
			!parsedQuery.value.bytes ||
			!activeHit.value
		) {
			return false;
		}
		return !options.isWindowed.value || Boolean(options.replaceProvider());
	});
	const replaceHelp = computed(() => {
		if (!options.isEditable.value) {
			return "Enable editable mode to replace matches.";
		}
		if (options.isWindowed.value && !options.replaceProvider()) {
			return "Provide replaceProvider to replace windowed data.";
		}
		return "Replace matching bytes.";
	});
	const resultText = computed(() => {
		if (pending.value) {
			return "Searching…";
		}
		if (!parsedQuery.value.bytes) {
			return "";
		}
		if (!total.value) {
			return "0 of 0";
		}
		return activeHit.value
			? `${activeOrdinal.value} of ${total.value}`
			: `0 of ${total.value}`;
	});

	function cancelPending() {
		requestId += 1;
		controller?.abort();
		controller = null;
		pending.value = false;
	}

	function setMessage(next: string | null, isError = false) {
		message.value = next;
		error.value = isError;
	}

	function setActive(hit: VueHexSearchHit | null, ordinal = 0) {
		activeHit.value = hit;
		activeOrdinal.value = ordinal;
		if (hit) {
			options.navigateTo(hit);
		}
	}

	function resetResults() {
		hits.value = [];
		total.value = 0;
		setActive(null);
	}

	function localFind(direction: VueHexSearchDirection, from: number) {
		const parsed = parsedQuery.value;
		if (!parsed.bytes) {
			resetResults();
			setMessage(parsed.error, Boolean(parsed.error));
			return;
		}
		const nextHits = findByteHits(options.getBytes(), parsed.bytes);
		hits.value = nextHits;
		total.value = nextHits.length;
		if (!nextHits.length) {
			setActive(null);
			setMessage("No matches.");
			return;
		}
		let index = -1;
		if (direction === "next") {
			index = nextHits.findIndex((hit) => hit.start >= from);
			if (index < 0) {
				index = 0;
			}
		} else {
			for (
				let candidate = nextHits.length - 1;
				candidate >= 0;
				candidate -= 1
			) {
				if ((nextHits[candidate]?.start ?? Number.POSITIVE_INFINITY) <= from) {
					index = candidate;
					break;
				}
			}
			if (index < 0) {
				index = nextHits.length - 1;
			}
		}
		setMessage(null);
		setActive(nextHits[index] ?? null, index + 1);
	}

	async function remoteFind(direction: VueHexSearchDirection, from: number) {
		const parsed = parsedQuery.value;
		const provider = options.searchProvider();
		if (!parsed.bytes) {
			resetResults();
			setMessage(parsed.error, Boolean(parsed.error));
			return;
		}
		if (!provider) {
			resetResults();
			setMessage("Provide searchProvider to search windowed data.", true);
			return;
		}
		cancelPending();
		const id = requestId;
		controller = new AbortController();
		pending.value = true;
		try {
			const response = await provider({
				mode: mode.value,
				query: parsed.bytes,
				direction,
				from,
				wrap: true,
				signal: controller.signal,
			});
			if (id !== requestId) {
				return;
			}
			total.value = Math.max(0, Math.trunc(response.total));
			hits.value = response.hit ? [response.hit] : [];
			setActive(
				response.hit,
				response.hit && total.value
					? Math.max(1, Math.min(total.value, response.activeOrdinal))
					: 0,
			);
			setMessage(response.hit ? null : "No matches.");
		} catch (reason) {
			if (
				id === requestId &&
				!(reason instanceof DOMException && reason.name === "AbortError")
			) {
				setMessage("Search failed. Please try again.", true);
			}
		} finally {
			if (id === requestId) {
				pending.value = false;
			}
		}
	}

	async function find(direction: VueHexSearchDirection) {
		if (!options.enabled.value) {
			return;
		}
		const active = activeHit.value;
		const from = active
			? direction === "next"
				? active.end + 1
				: active.start - 1
			: options.getInitialOffset();
		if (options.isWindowed.value) {
			await remoteFind(direction, from);
			return;
		}
		localFind(direction, from);
	}

	function refreshAfterInput() {
		if (!open.value) {
			return;
		}
		if (debounceHandle) {
			clearTimeout(debounceHandle);
		}
		debounceHandle = setTimeout(() => {
			debounceHandle = null;
			void find("next");
		}, 180);
	}

	function openSearch(
		openOptions: { replace?: boolean; selectQuery?: boolean } = {},
	) {
		if (!options.enabled.value) {
			return;
		}
		open.value = true;
		if (openOptions.replace) {
			replaceOpen.value = true;
		}
		if (query.value) {
			void find("next");
		}
	}

	function closeSearch() {
		if (debounceHandle) {
			clearTimeout(debounceHandle);
			debounceHandle = null;
		}
		cancelPending();
		open.value = false;
		resetResults();
		setMessage(null);
	}

	async function replace(scope: "one" | "all") {
		const queryBytes = parsedQuery.value.bytes;
		const replacementBytes = parsedReplacement.value.bytes;
		if (!queryBytes) {
			setMessage(parsedQuery.value.error ?? "Enter a search query.", true);
			return;
		}
		if (parsedReplacement.value.error) {
			setMessage(parsedReplacement.value.error, true);
			return;
		}
		const values = replacementBytes ?? new Uint8Array(0);
		if (!canReplace.value) {
			setMessage(replaceHelp.value, true);
			return;
		}
		if (!options.isWindowed.value) {
			if (scope === "all") {
				const localHits = findByteHits(options.getBytes(), queryBytes);
				options.replaceLocal(localHits, values);
				setMessage(
					`Replaced ${localHits.length} match${localHits.length === 1 ? "" : "es"}.`,
				);
			} else if (activeHit.value) {
				options.replaceLocal([activeHit.value], values);
				setMessage("Replaced 1 match.");
			}
			await find("next");
			return;
		}

		const provider = options.replaceProvider();
		if (!provider) {
			setMessage("Provide replaceProvider to replace windowed data.", true);
			return;
		}
		cancelPending();
		const id = requestId;
		controller = new AbortController();
		pending.value = true;
		try {
			const response = await provider({
				mode: mode.value,
				replacementMode: replacementMode.value,
				query: queryBytes,
				replacement: values,
				scope,
				hit: scope === "one" ? (activeHit.value ?? undefined) : undefined,
				signal: controller.signal,
			});
			if (id !== requestId) {
				return;
			}
			if (response.window) {
				options.applyWindow(response.window);
			}
			options.onReplaceResult(response);
			total.value = Math.max(0, Math.trunc(response.total));
			setActive(
				response.activeHit ?? null,
				response.activeHit && total.value
					? Math.max(1, Math.min(total.value, response.activeOrdinal ?? 1))
					: 0,
			);
			setMessage(
				`Replaced ${response.replaced} match${response.replaced === 1 ? "" : "es"}.`,
			);
		} catch (reason) {
			if (
				id === requestId &&
				!(reason instanceof DOMException && reason.name === "AbortError")
			) {
				setMessage("Replacement failed. Please try again.", true);
			}
		} finally {
			if (id === requestId) {
				pending.value = false;
			}
		}
	}

	function getHighlightState(index: number): "active" | "match" | null {
		if (
			activeHit.value &&
			index >= activeHit.value.start &&
			index <= activeHit.value.end
		) {
			return "active";
		}
		return hits.value.some((hit) => index >= hit.start && index <= hit.end)
			? "match"
			: null;
	}

	watch([query, mode], () => {
		cancelPending();
		resetResults();
		setMessage(parsedQuery.value.error, Boolean(parsedQuery.value.error));
		refreshAfterInput();
	});

	watch(options.enabled, (enabled) => {
		if (!enabled) {
			closeSearch();
		}
	});

	onBeforeUnmount(() => {
		if (debounceHandle) {
			clearTimeout(debounceHandle);
		}
		cancelPending();
	});

	return {
		open,
		replaceOpen,
		expanded,
		mode,
		replacementMode,
		query,
		replacement,
		activeHit,
		pending,
		message,
		error,
		resultText,
		searchDisabled,
		canReplace,
		replaceHelp,
		openSearch,
		closeSearch,
		find,
		replace,
		getHighlightState,
	};
}
