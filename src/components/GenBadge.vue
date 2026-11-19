<script setup lang="ts">
// A chapter's background-generation state as a small button: progress ring, waiting, failed, done.
import { computed } from "vue";
import { CircleCheck, Clock, TriangleAlert } from "@lucide/vue";
import type { Chapter } from "@/library";
import { generating, genState, toggleGenerate } from "@/generate";

const props = defineProps<{ c: Chapter }>();
const state = computed(() => genState(props.c));
const job = computed(() => generating[props.c.id] ?? { done: 0, total: 0, error: "" });
const TITLES = {
  queued: () => "Waiting to generate audio. Click to cancel.",
  running: () =>
    `Generating audio: ${job.value.done} of ${job.value.total} segments. Click to stop; finished segments stay.`,
  failed: () => `Audio generation stopped: ${job.value.error}. Click to try again.`,
  done: () => "Audio ready for the whole chapter. Click to check again.",
};
const title = computed(() => (state.value ? TITLES[state.value]() : ""));
const RING = 2 * Math.PI * 6; // progress ring circumference (r = 6)
</script>

<template>
  <button
    v-if="state"
    class="gen"
    :class="state"
    :title="title"
    :aria-label="title"
    @click.stop="toggleGenerate(c.id)"
  >
    <svg v-if="state === 'running'" viewBox="0 0 16 16" width="14" height="14">
      <circle cx="8" cy="8" r="6" class="track" />
      <circle
        cx="8"
        cy="8"
        r="6"
        class="bar"
        :stroke-dasharray="`${(RING * job.done) / Math.max(1, job.total)} ${RING}`"
        transform="rotate(-90 8 8)"
      />
    </svg>
    <Clock v-else-if="state === 'queued'" :size="13" />
    <TriangleAlert v-else-if="state === 'failed'" :size="13" />
    <CircleCheck v-else :size="13" />
  </button>
</template>

<style scoped>
.gen {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--ink3);
}
.gen:hover {
  background: var(--raised);
}
.gen.running {
  color: var(--acc);
}
.gen.failed {
  color: var(--err);
}
.gen.done {
  color: var(--ok);
}
.gen circle {
  fill: none;
  stroke-width: 2.2;
}
.gen .track {
  stroke: var(--line2);
}
.gen .bar {
  stroke: currentColor;
  stroke-linecap: round;
  transition: stroke-dasharray 0.3s;
}
</style>
