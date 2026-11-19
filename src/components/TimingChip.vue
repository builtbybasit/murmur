<script setup lang="ts">
import { computed, ref } from "vue";
import { settings, providerById } from "../settings";
import { openSettings, placePopover } from "../ui";
import { plural } from "../lib/format";
import { player, retryAlignment } from "../engine";

const timing = computed(() => {
  const stt = settings.stt;
  const p = providerById(stt.providerId);
  if (!stt.enabled || !p)
    return {
      label: "Estimated",
      cls: "",
      body: "Word alignment is off, so the highlight is timed from character positions. It drifts a little on long sentences.",
      act: stt.enabled
        ? { label: "Alignment settings", run: () => openSettings("segments") }
        : { label: "Turn on", run: () => (settings.stt.enabled = true) },
    };
  if (player.stt.failing)
    return {
      label: "Estimated",
      cls: "warn",
      body:
        `${p.name} failed on ${plural(player.stt.fails, "segment")}${player.stt.message ? ` (${player.stt.message})` : ""}` +
        `${player.stt.paused ? ", so alignment is paused for this chapter" : ""}. Audio is not affected.`,
      act: { label: "Retry alignment", run: retryAlignment },
      act2: { label: "Turn off", run: () => (settings.stt.enabled = false) },
    };
  if (player.timing === "aligned")
    return {
      label: "Aligned",
      cls: "al",
      body: `Word timestamps from ${p.name} (${stt.model}). The underlined highlight means the word is timed from the real audio.`,
    };
  return {
    label: "Estimated",
    cls: "",
    body: "The transcript for this segment has not arrived yet. The highlight is estimated until it does, then switches over without a jump.",
  };
});

const pop = ref<HTMLElement | null>(null);
function run(f: () => unknown) {
  f();
  pop.value?.hidePopover();
}
</script>

<template>
  <button class="chip timing" :class="timing.cls" popovertarget="lectern-timing">
    <i class="ring" /><span>{{ timing.label }}</span>
  </button>
  <div
    id="lectern-timing"
    ref="pop"
    popover
    class="pop"
    @beforetoggle="placePopover($event, 'above')"
  >
    <h4>Highlight timing · {{ timing.label }}</h4>
    <p>{{ timing.body }}</p>
    <div v-if="timing.act" class="acts">
      <button class="btn" @click="run(timing.act.run)">{{ timing.act.label }}</button>
      <button v-if="timing.act2" class="btn" @click="run(timing.act2.run)">
        {{ timing.act2.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ring {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--ink3);
  flex: none;
}
.chip.al .ring {
  background: var(--acc);
  border-color: var(--acc);
}
.chip.warn .ring {
  border-color: var(--warn);
  background: var(--warn);
}
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 520px) {
  .chip span {
    display: none;
  }
}
</style>
