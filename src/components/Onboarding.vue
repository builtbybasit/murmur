<script setup lang="ts">
import { reactive, ref } from "vue";
import { Check } from "@lucide/vue";
import { PRESETS, addProvider, hasTts, settings, type PresetKey } from "../settings";
import { openSettings, toast } from "../ui";
import { MOD } from "../lib/format";
import { testConnection } from "../lib/api";
import { pasteFromClipboard } from "../paste";

const OPTS: [PresetKey, string][] = [
  ["kokoro", "Local Kokoro"],
  ["openai", "OpenAI"],
  ["blank", "Custom"],
];
const preset = ref<PresetKey>("kokoro");
const form = reactive({ name: "", baseUrl: "", apiKey: "" });
const res = reactive({ cls: "", text: "" });
const busy = ref(false);

function pick(k: PresetKey) {
  preset.value = k;
  Object.assign(form, {
    name: k === "blank" ? "" : PRESETS[k].name,
    baseUrl: PRESETS[k].baseUrl,
    apiKey: "",
  });
  Object.assign(res, { cls: "", text: "" });
}
pick("kokoro");

async function save() {
  const baseUrl = form.baseUrl.trim();
  if (!/^https?:\/\/\S+/.test(baseUrl))
    return Object.assign(res, {
      cls: "bad",
      text: "Enter a base URL starting with http:// or https://",
    });
  const name = form.name.trim() || baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const apiKey = form.apiKey.trim();
  busy.value = true;
  Object.assign(res, { cls: "", text: "Testing…" });
  const r = await testConnection({ ...PRESETS[preset.value], id: "tmp", name, baseUrl, apiKey });
  busy.value = false;
  if (!r.ok)
    return Object.assign(res, {
      cls: "bad",
      text: [r.error?.status, r.error?.message].filter(Boolean).join(" · ") || "Request failed",
    });
  const p = addProvider(preset.value);
  Object.assign(p, { name, baseUrl, apiKey });
  const v = settings.narration.voice;
  toast({
    title: `${p.name} connected`,
    sub: v ? `Narration uses ${v}. Change it in Settings.` : "Set a narration voice in Settings.",
  });
}
</script>

<template>
  <section class="onb">
    <div class="onb-in">
      <h1>{{ hasTts ? "Add your first chapter" : "Two things, then you can listen" }}</h1>
      <p class="lead">
        {{
          hasTts
            ? "Copy a chapter from wherever you read, then paste it here. Each paste becomes one chapter."
            : "lectern reads webnovel chapters aloud and highlights each word as it is spoken. It needs a speech provider and something to read. Do them in either order."
        }}
      </p>
      <div class="steps">
        <div class="step" :class="{ done: hasTts }">
          <h2>
            <span class="k"
              ><Check v-if="hasTts" :size="13" :stroke-width="3" /><template v-else
                >1</template
              ></span
            >Connect a speech provider
          </h2>
          <template v-if="hasTts">
            <p>
              {{ settings.providers.map((p) => p.name).join(", ") }} connected. Voices and more
              providers are in Settings.
            </p>
            <button class="btn" @click="openSettings('providers')">Open settings</button>
          </template>
          <form v-else @submit.prevent="save">
            <p>
              Any OpenAI-compatible endpoint. Requests go through the local relay, which keeps the
              key on this Mac.
            </p>
            <div class="segc">
              <button
                v-for="[k, l] in OPTS"
                :key="k"
                type="button"
                :class="{ on: preset === k }"
                :aria-pressed="preset === k"
                @click="pick(k)"
              >
                {{ l }}
              </button>
            </div>
            <div class="f">
              <label>Name<input v-model="form.name" type="text" /></label>
              <label
                >Base URL<input
                  v-model="form.baseUrl"
                  type="url"
                  class="monoi"
                  placeholder="https://…/v1"
              /></label>
              <label class="wide"
                >API key<input
                  v-model="form.apiKey"
                  type="password"
                  class="monoi"
                  placeholder="Optional for local servers"
                  autocomplete="off"
              /></label>
            </div>
            <div class="acts-row">
              <button class="btn pri" :disabled="busy">Test and save</button>
              <span class="res" :class="res.cls">{{ res.text }}</span>
            </div>
          </form>
        </div>
        <div class="step">
          <h2><span class="k">2</span>Paste a chapter</h2>
          <p>
            One chapter per paste. The first line becomes the title if it looks like one. Then paste
            the next.
          </p>
          <div class="pz">
            <strong>Press <kbd>{{ MOD }}V</kbd> anywhere</strong>No dialog, no text box. The chapter
            is added and you can paste the next one straight away.
            <div class="pz-b">
              <button class="btn" @click="pasteFromClipboard">Paste from clipboard</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.onb {
  background: var(--page);
  display: grid;
  place-items: start center;
  padding: 56px 24px;
  height: 100%;
  overflow: auto;
}
.onb-in {
  width: min(880px, 100%);
}
.onb h1 {
  font: 600 26px/1.2 var(--read);
  color: var(--ink-hi);
  margin: 0 0 6px;
  letter-spacing: -0.015em;
}
.lead {
  color: var(--ink2);
  font-size: 14px;
  margin: 0 0 26px;
  max-width: 60ch;
}
.steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}
.step {
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  padding: 16px;
}
.step.done {
  border-color: color-mix(in srgb, var(--ok) 45%, var(--line));
}
.step h2 {
  font: 600 14px var(--ui);
  margin: 0 0 4px;
  color: var(--ink-hi);
  display: flex;
  align-items: center;
  gap: 8px;
}
.step h2 .k {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font: 600 11px var(--mono);
  background: var(--hover);
  color: var(--ink2);
}
.step.done h2 .k {
  background: var(--ok);
  color: var(--on-acc);
}
.step p {
  margin: 0 0 12px;
  color: var(--ink2);
}
.pz {
  border: 1px dashed var(--line2);
  border-radius: var(--r3);
  padding: 26px 14px;
  text-align: center;
  background: var(--bg);
  color: var(--ink2);
}
.pz strong {
  display: block;
  font: 600 15px var(--ui);
  color: var(--ink-hi);
  margin-bottom: 4px;
}
.pz-b {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.segc {
  margin-bottom: 10px;
}

@media (max-width: 820px) {
  .onb {
    padding: 28px 16px;
  }
}
</style>
