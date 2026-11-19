<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { X } from "@lucide/vue";
import {
  settings,
  addProvider,
  removeProvider,
  rolesOf,
  PRESETS,
  type Provider,
  type PresetKey,
  type ProviderKind,
} from "@/settings";
import { ui, toast } from "@/ui";
import { player, retry } from "@/engine";
import { saveSettings } from "@/sync";
import { testConnection, fetchVoices } from "@/lib/api";
import { plural } from "@/lib/format";

const ADD: [PresetKey, ProviderKind, string][] = [
  ["kokoro", "tts", "Local Kokoro"],
  ["openai", "tts", "OpenAI"],
  ["blank", "tts", "Other TTS"],
  ["stt", "stt", "Local STT"],
  ["blank", "stt", "Other STT"],
];
const KINDS: [ProviderKind, string][] = [
  ["tts", "TTS · reads aloud"],
  ["stt", "STT · word timing"],
];

interface Check {
  state: "checking" | "ok" | "bad";
  text: string; // status line: "Connected · 38 ms · 12 models · 54 voices", or the error
  noVoiceRoute?: boolean; // the server has no /audio/voices: voice ids are typed by hand
}
const checks = reactive<Record<string, Check>>({});
const runs: Record<string, number> = {}; // newest check per provider; older results are dropped
const showKey = ref(false);
const newVoice = ref("");

const failing = (p: Provider) => player.error?.providerId === p.id;
const fixing = (p: Provider) => ui.fixKey && ui.openProviderId === p.id;
const dot = (p: Provider) =>
  failing(p) || checks[p.id]?.state === "bad" ? "bad" : (checks[p.id]?.state ?? "");
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Test the connection, fetch models and voices, all at once. */
async function check(p: Provider) {
  if (!p.baseUrl) return void delete checks[p.id];
  const run = (runs[p.id] = (runs[p.id] ?? 0) + 1);
  checks[p.id] = { state: "checking", text: "Checking…" };
  await saveSettings(); // the relay uses the server's copy of the provider for its key
  const [t, v] = await Promise.all([testConnection(p), fetchVoices(p)]);
  if (run !== runs[p.id]) return;
  if (!t.ok) {
    const e = t.error;
    checks[p.id] = {
      state: "bad",
      text: [e?.status, e?.message].filter(Boolean).join(" · ") || "Request failed",
    };
    return;
  }
  if (t.models.length) p.models = t.models;
  if (v.ok) p.voices = [...new Set([...p.voices, ...v.voices])]; // keep hand-typed blends
  checks[p.id] = {
    state: "ok",
    text: `Connected · ${t.ms} ms · ${plural(p.models.length, "model")}`,
    noVoiceRoute: !v.ok && v.notFound,
  };
  if (failing(p)) {
    retry();
    ui.fixKey = false;
    toast({
      title: "Playback resumed",
      sub: `${p.name} answered. Continuing from the segment that failed.`,
      actions: [{ label: "Back to reader", run: () => (ui.view = "reader") }],
    });
  }
}
const checkSoon = useDebounceFn(check, 700);
onMounted(() => settings.providers.forEach(check));

function toggle(p: Provider) {
  ui.openProviderId = ui.openProviderId === p.id ? null : p.id;
  showKey.value = false;
}
async function add(k: PresetKey, kind: ProviderKind) {
  const p = addProvider(k, kind);
  ui.openProviderId = p.id;
  await nextTick();
  document.querySelector<HTMLInputElement>(`#url-${p.id}`)?.select();
  if (p.baseUrl) void check(p);
}
function remove(p: Provider) {
  const undo = removeProvider(p.id);
  delete checks[p.id];
  toast({ title: `Removed ${p.name}`, actions: [{ label: "Undo", run: undo }] });
}
function setUrl(p: Provider, url: string) {
  // a name nobody chose follows the host
  if (p.name === PRESETS.blank.name || p.name === host(p.baseUrl)) p.name = host(url);
  p.baseUrl = url.trim();
  checkSoon(p);
}
async function clearKey(p: Provider) {
  Object.assign(p, { apiKey: "", hasKey: false, clearKey: true });
  await saveSettings();
  delete p.clearKey;
  void check(p);
}
function addVoice(p: Provider) {
  const v = newVoice.value.trim();
  if (v && !p.voices.includes(v)) p.voices.push(v);
  newVoice.value = "";
}
</script>

<template>
  <h2>Providers</h2>
  <p class="hint">
    OpenAI-compatible endpoints, reached through the relay on this Mac. Keys stay in
    <code>~/.lectern</code>; browsers never get them.
  </p>
  <div v-for="p in settings.providers" :key="p.id" class="prov" :class="{ bad: dot(p) === 'bad' }">
    <button class="prov-h" :aria-expanded="ui.openProviderId === p.id" @click="toggle(p)">
      <i class="dot" :class="dot(p)" />
      <b>{{ p.name }}</b>
      <span class="mono">{{
        p.name === host(p.baseUrl) ? "" : host(p.baseUrl) || "no URL yet"
      }}</span>
      <span class="cap">{{ p.kind.toUpperCase() }}</span>
      <span v-for="r in rolesOf(p.id)" :key="r" class="tag" :class="r">{{ r }}</span>
    </button>
    <div v-if="ui.openProviderId === p.id" class="prov-b">
      <div class="segc">
        <button
          v-for="[k, l] in KINDS"
          :key="k"
          type="button"
          :class="{ on: p.kind === k }"
          @click="p.kind = k"
        >
          {{ l }}
        </button>
      </div>
      <div class="f">
        <label>Name<input v-model="p.name" type="text" /></label>
        <label
          >Base URL<input
            :id="`url-${p.id}`"
            :value="p.baseUrl"
            type="url"
            class="monoi"
            placeholder="https://…/v1"
            @input="setUrl(p, ($event.target as HTMLInputElement).value)"
        /></label>
        <label class="wide"
          >API key
          <span class="key">
            <input
              v-model.trim="p.apiKey"
              :type="showKey ? 'text' : 'password'"
              class="monoi"
              :class="{ bad: fixing(p) }"
              :placeholder="p.hasKey ? 'Saved; type to replace' : 'Optional for local servers'"
              autocomplete="off"
              @input="checkSoon(p)"
            />
            <button v-if="p.apiKey" class="lnk" type="button" @click="showKey = !showKey">
              {{ showKey ? "Hide" : "Show" }}
            </button>
            <button
              v-else-if="p.hasKey"
              class="lnk danger"
              type="button"
              @click.prevent="clearKey(p)"
            >
              Clear saved key
            </button>
          </span>
          <small v-if="fixing(p)" class="err"
            >This key was rejected{{
              player.error?.status ? ` with ${player.error.status}` : ""
            }}
            during playback. Paste a working key; it is checked as you type.</small
          >
        </label>
      </div>

      <details v-if="p.kind === 'tts'" class="voices">
        <summary>
          {{ p.voices.length ? plural(p.voices.length, "voice") : "No voices" }}
          <span v-if="checks[p.id]?.noVoiceRoute" class="muted">
            · this server does not list voices; add ids by hand</span
          >
        </summary>
        <div class="chips">
          <span v-for="v in p.voices" :key="v" class="vchip"
            >{{ v
            }}<button
              :aria-label="`Remove ${v}`"
              @click="p.voices = p.voices.filter((x) => x !== v)"
            >
              <X :size="11" /></button
          ></span>
        </div>
        <div class="f">
          <input
            v-model="newVoice"
            class="monoi"
            placeholder="Add a voice id, e.g. af_heart:0.7,af_bella:0.3, then Enter"
            spellcheck="false"
            @keydown.enter.prevent="addVoice(p)"
          />
        </div>
      </details>

      <div class="acts-row">
        <span class="res" :class="checks[p.id]?.state">
          <i class="dot" :class="dot(p)" /> {{ checks[p.id]?.text ?? "Add a base URL" }}
        </span>
        <span class="sp" />
        <button
          class="btn"
          :class="{ pri: fixing(p) }"
          :disabled="!p.baseUrl || checks[p.id]?.state === 'checking'"
          @click="check(p)"
        >
          Recheck
        </button>
        <button class="btn ghost danger" @click="remove(p)">Remove</button>
      </div>
    </div>
  </div>
  <div v-if="!settings.providers.length" class="box muted">
    No providers yet. Add one below to enable listening.
  </div>
  <div class="acts-row">
    <span class="muted">Add</span>
    <button v-for="[k, kind, l] in ADD" :key="l" class="btn" @click="add(k, kind)">{{ l }}</button>
  </div>
</template>

<style scoped>
.prov {
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  margin-bottom: 8px;
  overflow: hidden;
}
.prov.bad {
  border-color: color-mix(in srgb, var(--err) 55%, var(--line));
}
.prov-h {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  text-align: left;
}
.prov-h:hover {
  background: var(--hover);
}
.prov-h b {
  font-weight: 600;
  color: var(--ink-hi);
  white-space: nowrap;
}
.prov-h .mono {
  color: var(--ink3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.cap,
.tag {
  font: 500 10.5px var(--ui);
  padding: 1px 6px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line2);
  color: var(--ink2);
  white-space: nowrap;
}
.cap {
  font-family: var(--mono);
}
.tag.narration {
  border-color: color-mix(in srgb, var(--acc) 50%, transparent);
  color: var(--acc);
}
.tag.dialogue {
  border-color: color-mix(in srgb, var(--dlg) 50%, transparent);
  color: var(--dlg);
}
.tag.system {
  border-color: color-mix(in srgb, var(--sys) 50%, transparent);
  color: var(--sys);
}
.prov-b {
  padding: 12px;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 12px;
}
.prov-b .acts-row {
  margin: 0;
}
.prov-b .segc {
  justify-self: start;
}
.key {
  display: flex;
  align-items: center;
  gap: 10px;
}
.key input {
  flex: 1;
}
.key .lnk {
  white-space: nowrap;
}
.lnk.danger {
  color: var(--err);
}
.res {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.res.checking .dot {
  animation: pulse 1s ease-in-out infinite alternate;
}
@keyframes pulse {
  to {
    opacity: 0.25;
  }
}
.voices summary {
  cursor: pointer;
  font-size: 12.5px;
  color: var(--ink2);
}
.voices[open] summary {
  margin-bottom: 8px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 140px;
  overflow: auto;
  margin-bottom: 8px;
}
.vchip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font: 11.5px var(--mono);
  padding: 1px 2px 1px 7px;
  border-radius: var(--r-pill);
  background: var(--hover);
  color: var(--ink2);
}
.vchip button {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: var(--ink3);
}
.vchip button:hover {
  background: var(--line);
  color: var(--ink);
}
</style>
