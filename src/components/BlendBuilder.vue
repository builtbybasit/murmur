<script setup lang="ts">
// Mix 2–4 voices with weight sliders. Produces `a:0.7,b:0.3` (servers like Kokoro accept it).
import { computed, reactive } from "vue";
import { Play, Plus, X } from "@lucide/vue";
import { player, preview, stopPreview } from "../engine";
import { formatBlend, parseBlend, isBlend, type BlendPart } from "../lib/voice";
import type { Role } from "../store";

const props = defineProps<{ role: Role; voices: string[]; start: string }>();
const emit = defineEmits<{ use: [voice: string]; error: [message: string] }>();

const MAX = 4;
const singles = computed(() => props.voices.filter((v) => !isBlend(v)));
// Start from the current voice: a blend is edited as-is, a single voice gets a second one to mix with.
const parts = reactive<BlendPart[]>(
  (() => {
    const p = parseBlend(props.start).slice(0, MAX);
    if (p.length > 1) return p.map((x) => ({ id: x.id, w: Math.round(x.w * 100) }));
    const a = p[0]?.id || singles.value[0] || "";
    return [
      { id: a, w: 70 },
      { id: singles.value.find((v) => v !== a) ?? "", w: 30 },
    ];
  })(),
);
const result = computed(() => formatBlend(parts));
const total = computed(() => parts.reduce((s, p) => s + (p.id ? p.w : 0), 0) || 1);
const pct = (p: BlendPart) => (p.id ? Math.round((p.w / total.value) * 100) : 0);
const ready = computed(() => parts.filter((p) => p.id && p.w > 0).length > 1);

function add() {
  parts.push({ id: singles.value.find((v) => !parts.some((p) => p.id === v)) ?? "", w: 30 });
}
async function listen() {
  if (player.previewing === result.value) return stopPreview();
  try {
    await preview(props.role, result.value);
  } catch (e) {
    emit("error", (e as Error)?.message ?? String(e));
  }
}
</script>

<template>
  <div class="bb">
    <div v-for="(p, i) in parts" :key="i" class="row">
      <input
        v-model.trim="p.id"
        type="text"
        :list="`bb-${role}`"
        placeholder="voice id"
        spellcheck="false"
        aria-label="Voice"
      />
      <input v-model.number="p.w" type="range" min="0" max="100" step="5" aria-label="Weight" />
      <output>{{ pct(p) }}%</output>
      <button
        class="ib"
        :disabled="parts.length <= 2"
        title="Remove"
        aria-label="Remove voice"
        @click="parts.splice(i, 1)"
      >
        <X :size="13" />
      </button>
    </div>
    <datalist :id="`bb-${role}`">
      <option v-for="v in singles" :key="v" :value="v" />
    </datalist>
    <div class="foot">
      <button v-if="parts.length < MAX" class="btn ghost" @click="add">
        <Plus :size="13" /> Add voice
      </button>
      <code class="out">{{ result || "—" }}</code>
      <span class="sp" />
      <button class="btn" :disabled="!ready" @click="listen">
        <Play :size="13" /> {{ player.previewing === result ? "Stop" : "Listen" }}
      </button>
      <button class="btn pri" :disabled="!ready" @click="emit('use', result)">Use blend</button>
    </div>
  </div>
</template>

<style scoped>
.bb {
  border: 1px solid var(--line);
  border-radius: var(--r2);
  background: var(--bg);
  padding: 10px;
  display: grid;
  gap: 6px;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 180px) minmax(80px, 1fr) 40px 24px;
  align-items: center;
  gap: 10px;
}
.row input[type="text"] {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line2);
  border-radius: var(--r2);
  background: var(--raised);
  font: 12px var(--mono);
  min-width: 0;
}
.row input[type="range"] {
  width: 100%;
  margin: 0;
  accent-color: var(--c);
}
output {
  font: 12px var(--mono);
  text-align: right;
  color: var(--ink);
}
.ib {
  width: 24px;
  height: 24px;
}
.ib:disabled,
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.out {
  font: 11.5px var(--mono);
  color: var(--ink2);
  overflow-wrap: anywhere;
}
</style>
