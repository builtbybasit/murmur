<script setup lang="ts">
import { computed } from "vue";
import { settings } from "../../settings";
import { segmentPara } from "../../lib/segment";
import ProviderModelFields from "./ProviderModelFields.vue";

const SAMPLE = `'Mind the third step,' Wren said, shaking the twins' boots dry. "It's been loose since spring."`;
const sample = computed(() =>
  segmentPara(SAMPLE, settings.smartQuotes).map(({ kind, text }) => {
    const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    return { kind, lead, core, trail };
  }),
);
function setPrefetch(e: Event) {
  const n = Math.round(+(e.target as HTMLInputElement).value);
  settings.prefetch = Math.min(8, Math.max(1, n || 3));
  (e.target as HTMLInputElement).value = String(settings.prefetch);
}
</script>

<template>
  <h2>Segmentation</h2>
  <label class="sw"
    ><input v-model="settings.smartQuotes" type="checkbox" /> Treat single quotes as dialogue (smart
    rule)</label
  >
  <p class="hint tight">
    Double quotes always count as dialogue. A single quote counts only when no letter touches its
    outer side, so <code>don't</code> and <code>twins'</code> are left alone. Off means double
    quotes only.
  </p>
  <div class="prev">
    <template v-for="(s, i) in sample" :key="i"
      >{{ s.lead }}<span class="seg" :class="s.kind">{{ s.core }}</span>{{ s.trail }}</template
    >
    <small class="h"
      >Blue = narration voice, teal = dialogue voice. Toggle the rule to see the first quote
      change.</small
    >
  </div>

  <h2>Word alignment</h2>
  <label class="sw"
    ><input v-model="settings.stt.enabled" type="checkbox" /> Align the highlight with
    speech-to-text</label
  >
  <p class="hint tight">
    Runs in the background for each segment after its audio arrives. Until the transcript is back,
    or when it fails, the highlight is estimated from character positions and playback carries on.
  </p>
  <div class="f">
    <ProviderModelFields
      v-model:provider-id="settings.stt.providerId"
      v-model:model="settings.stt.model"
      kind="stt"
      placeholder="whisper-1"
      :disabled="!settings.stt.enabled"
    />
  </div>

  <h2>Playback</h2>
  <div class="f">
    <label
      >Segments to prefetch ahead<input
        type="number"
        min="1"
        max="8"
        :value="settings.prefetch"
        @change="setPrefetch"
      />
      <small>Higher hides slow providers, lower wastes less when you skip around.</small>
    </label>
  </div>
  <div class="gaps">
    <label
      ><span>Pause between segments</span
      ><input v-model.number="settings.segmentGap" type="range" min="0" max="800" step="25" />
      <output>{{ settings.segmentGap }} ms</output></label
    >
    <label
      ><span>Pause between paragraphs</span
      ><input v-model.number="settings.paragraphGap" type="range" min="0" max="1500" step="50" />
      <output>{{ settings.paragraphGap }} ms</output></label
    >
    <small class="h"
      >Silence added after a segment ends, on top of what the voice already leaves. Segments are the
      narration/dialogue switches inside a paragraph. Pauses shrink with playback speed.</small
    >
  </div>
</template>

<style scoped>
.gaps {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.gaps label {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) 64px;
  align-items: center;
  gap: 10px;
  font: 500 11.5px var(--ui);
  color: var(--ink2);
}
.gaps input {
  width: 100%;
  margin: 0;
  accent-color: var(--acc);
}
.gaps output {
  font: 12px var(--mono);
  text-align: right;
  color: var(--ink);
}
@media (max-width: 520px) {
  .gaps label {
    grid-template-columns: minmax(0, 1fr) 64px;
  }
  .gaps label span {
    grid-column: 1/-1;
  }
}

.prev {
  font: 17px/1.7 var(--read);
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--bg);
  border: 1px solid var(--line);
}
.prev .seg {
  padding: 0.1em 0;
}
.prev .seg.narr {
  background: color-mix(in srgb, var(--acc) 11%, transparent);
}
.prev .seg.dlg {
  background: color-mix(in srgb, var(--dlg) 14%, transparent);
  color: color-mix(in oklab, var(--ink) 52%, var(--dlg));
}
.prev small {
  display: block;
  font-family: var(--ui);
  margin-top: 6px;
}
</style>
