<template>
	<section
		v-if="open"
		class="vuehex-search"
		:class="{ 'vuehex-search--expanded': expanded }"
		:aria-busy="pending || undefined"
		@keydown.stop
	>
		<form class="vuehex-search__find" @submit.prevent="emit('next')">
			<button
				type="button"
				class="vuehex-search__icon-button"
				:title="expanded ? 'Use compact search controls' : 'Expand search controls to full width'"
				:aria-label="expanded ? 'Use compact search controls' : 'Expand search controls to full width'"
				:aria-pressed="expanded"
				@click="emit('toggle-expanded')"
			>
				↔
			</button>
			<div class="vuehex-search__mode" role="group" aria-label="Search mode">
				<button
					type="button"
					class="vuehex-search__mode-button"
					:class="{ 'vuehex-search__mode-button--active': mode === 'hex' }"
					:aria-pressed="mode === 'hex'"
					title="Search as hexadecimal bytes"
					aria-label="Search as hexadecimal bytes"
					@click="emit('update:mode', 'hex')"
				>
					Hex
				</button>
				<button
					type="button"
					class="vuehex-search__mode-button"
					:class="{ 'vuehex-search__mode-button--active': mode === 'text' }"
					:aria-pressed="mode === 'text'"
					title="Search as UTF-8 text"
					aria-label="Search as UTF-8 text"
					@click="emit('update:mode', 'text')"
				>
					Text
				</button>
			</div>
			<label class="vuehex-search__sr-only" :for="queryInputId">Search query</label>
			<input
				:id="queryInputId"
				ref="queryInput"
				class="vuehex-search__input"
				:placeholder="mode === 'hex' ? 'Search bytes (e.g. DE AD BE EF)' : 'Search UTF-8 text'"
				:value="query"
				autocomplete="off"
				spellcheck="false"
				@input="emit('update:query', ($event.target as HTMLInputElement).value)"
				@keydown.enter.exact.prevent="emit('next')"
				@keydown.shift.enter.prevent="emit('previous')"
				@keydown.escape.prevent="emit('close')"
			/>
			<output class="vuehex-search__results" aria-live="polite">{{ resultText }}</output>
			<button
				type="button"
				class="vuehex-search__icon-button"
				title="Previous match (Shift+Enter)"
				aria-label="Previous match"
				:disabled="disabled || pending"
				@click="emit('previous')"
			>
				‹
			</button>
			<button
				type="button"
				class="vuehex-search__icon-button"
				title="Next match (Enter)"
				aria-label="Next match"
				:disabled="disabled || pending"
				@click="emit('next')"
			>
				›
			</button>
			<button
				type="button"
				class="vuehex-search__icon-button"
				:title="replaceOpen ? 'Hide replace controls' : 'Show replace controls'"
				:aria-label="replaceOpen ? 'Hide replace controls' : 'Show replace controls'"
				:aria-pressed="replaceOpen"
				@click="emit('toggle-replace')"
			>
				↕
			</button>
			<button
				type="button"
				class="vuehex-search__icon-button"
				title="Close search (Escape)"
				aria-label="Close search"
				@click="emit('close')"
			>
				×
			</button>
		</form>
		<form v-if="replaceOpen" class="vuehex-search__replace" @submit.prevent="emit('replace-one')">
			<div class="vuehex-search__mode" role="group" aria-label="Replacement mode">
				<button
					type="button"
					class="vuehex-search__mode-button"
					:class="{ 'vuehex-search__mode-button--active': replacementMode === 'hex' }"
					:aria-pressed="replacementMode === 'hex'"
					title="Replace with hexadecimal bytes"
					aria-label="Replace with hexadecimal bytes"
					@click="emit('update:replacement-mode', 'hex')"
				>
					Hex
				</button>
				<button
					type="button"
					class="vuehex-search__mode-button"
					:class="{ 'vuehex-search__mode-button--active': replacementMode === 'text' }"
					:aria-pressed="replacementMode === 'text'"
					title="Replace with UTF-8 text"
					aria-label="Replace with UTF-8 text"
					@click="emit('update:replacement-mode', 'text')"
				>
					Text
				</button>
			</div>
			<label class="vuehex-search__sr-only" :for="replacementInputId">Replacement</label>
			<input
				:id="replacementInputId"
				ref="replacementInput"
				class="vuehex-search__input"
				:placeholder="replacementMode === 'hex' ? 'Replace bytes' : 'Replace UTF-8 text'"
				:value="replacement"
				autocomplete="off"
				spellcheck="false"
				@input="emit('update:replacement', ($event.target as HTMLInputElement).value)"
				@keydown.escape.prevent="emit('close')"
			/>
			<button type="submit" :disabled="!canReplace || pending" :title="replaceHelp">
				Replace
			</button>
			<button type="button" :disabled="!canReplace || pending" :title="replaceHelp" @click="emit('replace-all')">
				Replace All
			</button>
		</form>
		<p v-if="message" class="vuehex-search__message" :class="{ 'vuehex-search__message--error': error }" aria-live="polite">
			{{ message }}
		</p>
	</section>
</template>

<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import type { VueHexSearchMode } from "./vuehex-api";

const props = defineProps<{
	open: boolean;
	replaceOpen: boolean;
	expanded: boolean;
	mode: VueHexSearchMode;
	replacementMode: VueHexSearchMode;
	query: string;
	replacement: string;
	resultText: string;
	pending: boolean;
	disabled: boolean;
	canReplace: boolean;
	replaceHelp: string;
	message: string | null;
	error: boolean;
}>();

const emit = defineEmits<{
	(event: "update:mode", value: VueHexSearchMode): void;
	(event: "update:replacement-mode", value: VueHexSearchMode): void;
	(event: "update:query", value: string): void;
	(event: "update:replacement", value: string): void;
	(event: "next"): void;
	(event: "previous"): void;
	(event: "toggle-replace"): void;
	(event: "toggle-expanded"): void;
	(event: "replace-one"): void;
	(event: "replace-all"): void;
	(event: "close"): void;
}>();

const queryInput = ref<HTMLInputElement>();
const replacementInput = ref<HTMLInputElement>();
const idPrefix = useId();
const queryInputId = `${idPrefix}-search-query`;
const replacementInputId = `${idPrefix}-search-replacement`;

async function focusQuery(select = true) {
	await nextTick();
	queryInput.value?.focus();
	if (select) {
		queryInput.value?.select();
	}
}

async function focusReplacement() {
	await nextTick();
	if (props.query) {
		replacementInput.value?.focus();
		replacementInput.value?.select();
		return;
	}
	await focusQuery();
}

watch(
	() => props.open,
	(open) => {
		if (open) {
			void focusQuery();
		}
	},
);

watch(
	() => props.replaceOpen,
	(open) => {
		if (open && props.open) {
			void focusReplacement();
		}
	},
);

defineExpose({ focusQuery, focusReplacement });
</script>
