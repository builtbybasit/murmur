<script setup lang="ts">
// Provider voices as grouped chips. Click = choose and hear it. Filter shows when the list is long.
import { computed, ref } from "vue";
import { AudioLines, Blend, Search } from "@lucide/vue";
import { previewing, preview, stopPreview } from "../preview";
import { groupVoices } from "../lib/voice";
import { type Provider, type Role } from "../settings";
import BlendBuilder from "./BlendBuilder.vue";

const props = defineProps<{ role: Role; provider: Provider | null }>();
const voice = defineModel<string>({ required: true });
const emit = defineEmits<{ error: [message: string] }>();

const q = ref("");
const blending = ref(false);
const voices = computed(() => props.provider?.voices ?? []);
const groups = computed(() => {
  const f = q.value.trim().toLowerCase();
  return groupVoices(f ? voices.value.filter((v) => v.toLowerCase().includes(f)) : voices.value);
});

async function audition(id: string) {
  if (previewing.value === id) return stopPreview();
  try {
    await preview(props.role, id);
  } catch (e) {
    emit("error", (e as Error)?.message ?? String(e));
  }
}
function pick(id: string) {
  voice.value = id;
  void audition(id);
}
function useBlend(id: string) {
  voice.value = id;
  if (props.provider && !props.provider.voices.includes(id)) props.provider.voices.unshift(id);
  blending.value = false;
}
</script>

<template>
  <div class="vp">
    <div class="bar">
      <label v-if="voices.length > 10" class="filter">
        <Search :size="13" />
        <input v-model="q" type="text" placeholder="Filter voices" spellcheck="false" />
      </label>
      <span class="sp" />
      <button class="btn ghost" :class="{ on: blending }" @click="blending = !blending">
        <Blend :size="13" /> Blend voices
      </button>
    </div>

    <BlendBuilder
      v-if="blending"
      :role="role"
      :voices="voices"
      :start="voice"
      @use="useBlend"
      @error="emit('error', $event)"
    />

    <div v-for="g in groups" :key="g.name" class="grp">
      <small v-if="groups.length > 1">{{ g.name }}</small>
      <div class="chips">
        <button
          v-for="x in g.ids"
          :key="x"
          :class="{ on: x === voice, playing: previewing === x }"
          :title="previewing === x ? 'Stop' : 'Use and hear this voice'"
          @click="pick(x)"
        >
          <AudioLines v-if="previewing === x" :size="12" class="eq" />{{ x }}
        </button>
      </div>
    </div>
    <small v-if="voices.length && !groups.length" class="h">No voice matches “{{ q }}”.</small>
    <small v-if="!voices.length" class="h"
      >No voice list for this provider. Type an id above, or use Fetch voices under
      Providers.</small
    >
  </div>
</template>

<style scoped>
.vp {
  margin-top: 8px;
  display: grid;
  gap: 8px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.filter {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line2);
  border-radius: var(--r2);
  background: var(--raised);
  color: var(--ink3);
  width: min(240px, 100%);
}
.filter input {
  border: 0;
  background: none;
  outline: 0;
  min-width: 0;
  flex: 1;
  height: 26px;
  padding: 0;
  font: 12px var(--mono);
  color: var(--ink);
}
.btn.on {
  color: var(--c);
  background: var(--hover);
}
.grp small {
  display: block;
  margin-bottom: 4px;
  font: 600 10.5px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink3);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chips button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: 11.5px var(--mono);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--line2);
  color: var(--ink2);
  background: var(--raised);
}
.chips button:hover {
  color: var(--ink-hi);
  border-color: var(--c);
}
.chips button.on {
  border-color: var(--c);
  color: var(--c);
  background: color-mix(in srgb, var(--c) 11%, var(--raised));
}
.chips button.playing {
  border-color: var(--c);
}
.eq {
  color: var(--c);
  animation: pulse 0.9s ease-in-out infinite alternate;
}
@keyframes pulse {
  from {
    opacity: 0.4;
  }
}
small.h {
  color: var(--ink3);
  font-size: 11.5px;
}
</style>
