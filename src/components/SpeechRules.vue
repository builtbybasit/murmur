<script setup lang="ts">
// Settings › Spoken text: what the TTS is sent. The reader always shows the original.
import { computed, ref } from "vue";
import { Plus, RotateCcw, Search, X } from "@lucide/vue";
import { settings, toast, fillDefaultSpeech } from "../store";
import { makeSpeaker } from "../lib/speech";
import { DEFAULT_RULES } from "../lib/kaomoji";

const rules = settings.speech.rules;
const sample = ref(
  `"See you tomorrow!" (￣▽￣)ノ she waved.\nHe blushed ♡(>ᴗ•) and flipped the table (╯°□°)╯︵ ┻━┻ 😅`,
);
const spoken = computed(() => makeSpeaker(settings.speech)(sample.value));

const q = ref("");
const shown = computed(() => {
  const f = q.value.trim().toLowerCase();
  return rules
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) => !f || r.find.toLowerCase().includes(f) || r.replace.toLowerCase().includes(f),
    );
});

function add() {
  q.value = "";
  rules.unshift({ find: "", replace: "" });
}
function restore() {
  const have = new Set(rules.map((r) => r.find));
  const missing = DEFAULT_RULES.filter((r) => !have.has(r.find));
  rules.push(...missing.map((r) => ({ ...r })));
  const filled = fillDefaultSpeech();
  const parts = [missing.length && `added ${missing.length}`, filled && `filled ${filled} blank`];
  const msg = parts.filter(Boolean).join(", ");
  toast({ title: msg ? `Defaults restored: ${msg}` : "Nothing to restore" }, 3000);
}
</script>

<template>
  <h2>Spoken text</h2>
  <p class="hint">
    What the voice is sent. The reader always shows the text as you pasted it; changing anything
    here only regenerates the segments it affects.
  </p>

  <label class="sw"
    ><input v-model="settings.speech.auto" type="checkbox" /> Skip emoji and kaomoji
    automatically</label
  >
  <p class="hint tight">
    Removes emoji and face-like runs such as <code>(￣▽￣)ノ</code> or <code>♡(&gt;ᴗ•)</code> before
    speaking. Words, numbers and normal punctuation are left alone. Turn it off for Chinese or
    Japanese text.
  </p>

  <div class="try">
    <label
      >Try it<textarea v-model="sample" rows="2" spellcheck="false" aria-label="Sample text" />
    </label>
    <div class="out">
      <small>Spoken as</small>
      <span>{{ spoken || "(silence)" }}</span>
    </div>
  </div>

  <h2>Replace before speaking</h2>
  <p class="hint tight">
    Applied first, longest match first. Word-like entries match whole words, ignoring case (<code
      >Xianxia → Shee-en-shah</code
    >); faces and symbols match anywhere. Leave “speak as” empty to skip it.
  </p>
  <div class="bar">
    <label class="filter">
      <Search :size="13" />
      <input v-model="q" type="text" placeholder="Filter" spellcheck="false" />
    </label>
    <span class="num">{{ shown.length }} of {{ rules.length }}</span>
    <span class="sp" />
    <button
      class="btn ghost"
      title="Add back default kaomoji you removed and fill blank speak-as words"
      @click="restore"
    >
      <RotateCcw :size="13" /> Restore defaults
    </button>
    <button class="btn" @click="add"><Plus :size="13" /> Add rule</button>
  </div>
  <div class="rules">
    <div class="head"><span>Find</span><span>Speak as</span><span /></div>
    <div v-for="{ r, i } in shown" :key="i" class="rule">
      <input
        v-model="r.find"
        type="text"
        spellcheck="false"
        placeholder="text or kaomoji"
        aria-label="Find"
      />
      <input
        v-model="r.replace"
        type="text"
        spellcheck="false"
        placeholder="(skip)"
        aria-label="Speak as"
      />
      <button class="ib" title="Remove" aria-label="Remove rule" @click="rules.splice(i, 1)">
        <X :size="13" />
      </button>
    </div>
    <small v-if="!shown.length" class="h">No rule matches “{{ q }}”.</small>
  </div>
</template>

<style scoped>
h2 {
  margin: 22px 0 6px;
  font: 600 16px var(--ui);
  color: var(--ink-hi);
}
h2:first-child {
  margin-top: 0;
}
.hint {
  margin: 0 0 12px;
  color: var(--ink2);
  max-width: 70ch;
}
.hint.tight {
  margin-top: 4px;
}
.sw {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}
.sw input {
  accent-color: var(--acc);
}
code {
  font: 11.5px var(--mono);
}
.try {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
}
.try label {
  display: grid;
  gap: 4px;
  font: 500 11.5px var(--ui);
  color: var(--ink2);
}
textarea,
.rule input,
.filter {
  border: 1px solid var(--line2);
  border-radius: var(--r2);
  background: var(--raised);
  color: var(--ink);
}
textarea {
  padding: 6px 8px;
  font: 13px/1.5 var(--ui);
  resize: vertical;
}
.out small {
  display: block;
  font: 600 10.5px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink3);
}
.out span {
  font: 13px/1.5 var(--ui);
  color: var(--ink-hi);
  white-space: pre-wrap;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.filter {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  color: var(--ink3);
  width: min(220px, 100%);
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
.rules {
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  padding: 8px;
  max-height: 420px;
  overflow: auto;
  display: grid;
  gap: 4px;
}
.head,
.rule {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 24px;
  gap: 8px;
  align-items: center;
}
.head {
  position: sticky;
  top: -8px;
  padding: 4px 0;
  background: var(--surface);
  font: 600 10.5px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink3);
}
.rule input {
  height: 28px;
  padding: 0 8px;
  font: 12.5px var(--mono);
  min-width: 0;
}
.ib {
  width: 24px;
  height: 24px;
}
small.h {
  color: var(--ink3);
  font-size: 11.5px;
  padding: 6px 2px;
}
</style>
