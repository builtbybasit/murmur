<script setup lang="ts">
import { computed, ref } from "vue";
import { Moon } from "@lucide/vue";
import { placePopover } from "../ui";
import { sleepTimer, setSleep } from "../engine";

const pop = ref<HTMLElement | null>(null);
const SLEEP: [string, null | "chapter" | number][] = [
  ["Off", null],
  ["End of chapter", "chapter"],
  ["15 minutes", 15],
  ["30 minutes", 30],
  ["45 minutes", 45],
  ["1 hour", 60],
];
const label = computed(() =>
  sleepTimer.mode === "chapter"
    ? "end of chapter"
    : sleepTimer.mode === "time"
      ? Math.ceil(sleepTimer.left / 60_000) + "m"
      : "",
);
const mins = ref(0); // the duration picked, to mark it in the menu
function pick(v: null | "chapter" | number) {
  setSleep(v);
  if (typeof v === "number") mins.value = v;
  pop.value?.hidePopover();
}
</script>

<template>
  <button
    class="chip sleep"
    :class="{ on: sleepTimer.mode }"
    :title="sleepTimer.mode ? `Sleep timer: ${label}` : 'Sleep timer'"
    aria-label="Sleep timer"
    popovertarget="lectern-sleep"
  >
    <Moon :size="13" /><span v-if="sleepTimer.mode">{{ label }}</span>
  </button>
  <div
    id="lectern-sleep"
    ref="pop"
    popover
    class="pop menu"
    @beforetoggle="placePopover($event, 'above')"
  >
    <h4>Sleep timer</h4>
    <button
      v-for="[l, v] in SLEEP"
      :key="l"
      :class="{
        on:
          (v === null && !sleepTimer.mode) ||
          (v === 'chapter' && sleepTimer.mode === 'chapter') ||
          (v === mins && sleepTimer.mode === 'time'),
      }"
      @click="pick(v)"
    >
      {{ l }}
    </button>
    <p class="note">Counts only while playing, and fades out over the last few seconds.</p>
  </div>
</template>

<style scoped>
.chip.sleep.on {
  color: var(--acc);
  border-color: color-mix(in srgb, var(--acc) 45%, var(--line));
}
.pop.menu {
  width: 200px;
  padding: 8px;
}
.pop.menu:popover-open {
  display: grid; /* only while open: a plain display would override the closed popover's none */
}
.pop.menu h4 {
  margin: 4px 8px 6px;
}
.pop.menu button {
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--r2);
  font-size: 13px;
}
.pop.menu button:hover {
  background: var(--hover);
}
.pop.menu button.on {
  color: var(--acc);
  font-weight: 600;
}
.pop.menu .note {
  margin: 6px 8px 2px;
  font-size: 11.5px;
  color: var(--ink3);
}
</style>
