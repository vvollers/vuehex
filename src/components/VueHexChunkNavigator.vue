<template>
	<div :class="rootClass">
		<nav
			v-if="shouldShow"
			:class="chunkNavigatorClass"
			role="navigation"
			aria-label="Chunk navigator"
		>
			<header class="vuehex-chunk-nav__header">
				<span class="vuehex-chunk-nav__title">Chunks</span>
				<span class="vuehex-chunk-nav__summary">{{ chunks.length }} chunks</span>
			</header>
			<div class="vuehex-chunk-list" role="listbox">
				<button
					v-for="chunk in chunks"
					:key="chunk.index"
					type="button"
					role="option"
					:aria-selected="chunk.index === activeIndex"
					:class="chunkButtonClass(chunk.index)"
					@click="handleChunkSelect(chunk.index)"
				>
					<span class="vuehex-chunk-item__label">{{ chunk.label }}</span>
					<span class="vuehex-chunk-item__range">{{ chunk.range }}</span>
				</button>
			</div>
		</nav>

		<div :class="viewerClass">
			<slot />
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

export type ChunkNavigatorPlacement = "left" | "right" | "top" | "bottom";

export interface ChunkDescriptor {
	index: number;
	label: string;
	range: string;
}

interface VueHexChunkNavigatorProps {
	show?: boolean;
	placement?: ChunkNavigatorPlacement;
	chunks: ChunkDescriptor[];
	activeIndex: number;
	rootClassExtra?: string[];
	viewerClassExtra?: string[];
	expandToContent?: boolean;
}

const props = withDefaults(defineProps<VueHexChunkNavigatorProps>(), {
	show: false,
	placement: "right",
	rootClassExtra: () => [],
	viewerClassExtra: () => [],
	expandToContent: false,
});

const emit = defineEmits<{
	(event: "select", index: number): void;
}>();

const chunks = computed(() => props.chunks ?? []);
const activeIndex = computed(() => Math.max(0, Math.trunc(props.activeIndex)));

const placement = computed<ChunkNavigatorPlacement>(() => {
	const requested = props.placement ?? "right";
	switch (requested) {
		case "left":
		case "right":
		case "top":
		case "bottom":
			return requested;
		default:
			return "right";
	}
});

const isNavigatorVertical = computed(
	() => placement.value === "top" || placement.value === "bottom",
);

const shouldShow = computed(
	() => Boolean(props.show) && Array.isArray(chunks.value) && chunks.value.length > 1,
);

const rootClass = computed(() => {
	const classes = ["vuehex-root", ...(props.rootClassExtra ?? [])];
	if (props.expandToContent) {
		classes.push("vuehex-root--expand-to-content");
	}
	if (shouldShow.value) {
		classes.push(
			isNavigatorVertical.value
				? "vuehex-root--vertical"
				: "vuehex-root--horizontal",
		);
		classes.push(`vuehex-root--nav-${placement.value}`);
	}
	return classes;
});

const chunkNavigatorClass = computed(() => {
	const classes = ["vuehex-chunk-nav"];
	if (shouldShow.value) {
		classes.push(`vuehex-chunk-nav--${placement.value}`);
	}
	return classes;
});

const viewerClass = computed(() => {
	const classes = ["vuehex-viewer", ...(props.viewerClassExtra ?? [])];
	if (shouldShow.value) {
		classes.push("vuehex-viewer--with-nav");
		classes.push(`vuehex-viewer--nav-${placement.value}`);
	}
	return classes;
});

function chunkButtonClass(index: number): string[] {
	const classes = ["vuehex-chunk-item"];
	if (index === activeIndex.value) {
		classes.push("vuehex-chunk-item--active");
	}
	return classes;
}

function handleChunkSelect(index: number) {
	if (!Number.isFinite(index)) {
		return;
	}
	emit("select", Math.trunc(index));
}

defineExpose({
	shouldShow,
	chunkButtonClass,
} satisfies Record<string, unknown>);
</script>
