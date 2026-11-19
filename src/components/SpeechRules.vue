<script setup lang="ts">
// Settings › Spoken text: what the TTS is sent. The reader always shows the original.
import { computed, ref } from "vue";
import { Plus, RotateCcw, Search, X } from "@lucide/vue";
import { settings, toast, upgradeSpeech } from "../store";
import { makeSpeaker } from "../lib/speech";

const rules = settings.speech.rules;
const sample = ref(
  `"See you tomorrow!" (￣▽￣)ノ she waved.\nHe blushed ♡(>ᴗ•) and flipped the table (╯°□°)╯︵ ┻━┻ 😂👍🏽 ❤️ ✦`,
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
  const { filled, added } = upgradeSpeech();
  const parts = [added && `added ${added}`, filled && `filled ${filled}`].filter(Boolean);
  toast(
    { title: parts.length ? `Defaults restored: ${parts.join(", ")}` : "Nothing to restore" },
    3000,
  );
}
</script>

<template>
  <h2>Spoken text</h2>
  <p class="hint">
    What the voice is sent. The reader always shows the text as you pasted it; changing anything
    here only regenerates the segments it affects.
  </p>

  <label class="sfx-field"
    ><span>Say after each emoji or kaomoji</span
    ><input v-model="settings.speech.suffix" type="text" placeholder="nothing" spellcheck="false" />
    <small
      >Faces in the list below are read as their label plus this word, so
      <code>(￣▽￣)ノ</code> becomes “waving {{ settings.speech.suffix.trim() }}” and listeners can
      tell it apart from the story. Leave empty to say only the label.</small
    ></label
  >

  <label class="sw"
    ><input v-model="settings.speech.auto" type="checkbox" /> Skip other emoji and kaomoji
    silently</label
  >
  <p class="hint tight">
    Emoji and face-like runs that are not in the list are removed before speaking. Words, numbers
    and normal punctuation are left alone. Turn it off for Chinese or Japanese text.
  </p>

  <label class="sw"
    ><input v-model="settings.speech.images" type="checkbox" /> Say “Illustration” for images</label
  >
  <p class="hint tight">
    Each picture in an imported book is read as “Illustration.”, or “Illustration: a dragon over the
    city.” when the book describes it. Off: the voice passes over pictures silently.
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
    >); faces and symbols match anywhere. Leave “speak as” empty to skip it. The pill adds the
    suffix to that rule.
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
    <div class="head"><span>Find</span><span>Speak as</span><span>Suffix</span><span /></div>
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
      <button
        class="pill"
        :class="{ on: r.face }"
        :aria-pressed="!!r.face"
        :title="r.face ? 'Suffix is said after this' : 'Add the suffix after this'"
        @click="r.face = !r.face"
      >
        {{ settings.speech.suffix.trim() || "suffix" }}
      </button>
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
.sfx-field {
  display: grid;
  gap: 4px;
  margin-bottom: 14px;
  font: 500 11.5px var(--ui);
  color: var(--ink2);
}
.sfx-field input {
  width: min(240px, 100%);
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--line2);
  border-radius: var(--r2);
  background: var(--raised);
  font: 12.5px var(--mono);
  color: var(--ink);
}
.sfx-field small {
  font: 400 11.5px/1.4 var(--ui);
  color: var(--ink3);
  max-width: 70ch;
}
.pill {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px dashed var(--line2);
  font: 11px var(--mono);
  color: var(--ink3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill.on {
  border-style: solid;
  border-color: var(--acc);
  color: var(--acc);
  background: color-mix(in srgb, var(--acc) 11%, transparent);
}
.head,
.rule {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 72px 24px;
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
