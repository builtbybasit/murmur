<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { ArrowLeft, Play } from "@lucide/vue";
import {
  settings,
  ui,
  library,
  addProvider,
  removeProvider,
  rolesOf,
  providerById,
  toast,
  type Provider,
  type PresetKey,
  type Role,
} from "../store";
import { player, preview, cacheStats, clearCache, retry } from "../engine";
import { testConnection, fetchVoices } from "../lib/api";
import { segmentPara } from "../lib/segment";
import VoicePicker from "./VoicePicker.vue";
import SpeechRules from "./SpeechRules.vue";

const TABS = [
  ["providers", "Providers"],
  ["voices", "Voices"],
  ["segments", "Segments & timing"],
  ["speech", "Spoken text"],
  ["storage", "Storage"],
] as const;
const ADD: [PresetKey, string][] = [
  ["kokoro", "Local Kokoro"],
  ["openai", "OpenAI"],
  ["stt", "Local STT"],
  ["blank", "Blank"],
];
const ROLES = [
  { key: "narration", dot: "narr", label: "Narration" },
  { key: "dialogue", dot: "dlg", label: "Dialogue" },
  { key: "system", dot: "sys", label: "System messages" },
] as const;
const TAG: Record<string, string> = {
  narration: "narr",
  dialogue: "dlg",
  system: "sys",
  alignment: "",
};
const SAME_HINT = {
  dialogue:
    "Quoted speech is read by the narration voice. It is still split into its own segments, so switching to a separate voice later needs no re-import.",
  system:
    "Lines in [brackets], fully bold lines, tables and boxes are read by the narration voice. Quotes inside them never switch to the dialogue voice.",
};

type Msg = { cls: "" | "ok" | "bad"; text: string };
const msg = reactive<Record<string, Msg>>({}); // per provider id or role: inline result line
const conn = reactive<Record<string, "ok" | "bad">>({}); // last Test result per provider
const busy = ref<string | null>(null);

onUnmounted(() => (ui.fixKey = false));

// ---------- providers ----------
const errText = (e?: { status?: number; message?: string }) =>
  [e?.status, e?.message].filter(Boolean).join(" · ") || "Request failed";
const failing = (p: Provider) => player.error?.providerId === p.id;
const fixing = (p: Provider) => ui.fixKey && ui.openProviderId === p.id;
const dot = (p: Provider) =>
  failing(p) || conn[p.id] === "bad" ? "bad" : conn[p.id] === "ok" ? "ok" : "";

function toggle(p: Provider) {
  ui.openProviderId = ui.openProviderId === p.id ? null : p.id;
}
function add(k: PresetKey) {
  ui.openProviderId = addProvider(k).id;
}
function remove(p: Provider) {
  removeProvider(p.id);
  delete msg[p.id];
  delete conn[p.id];
}
function setVoices(p: Provider, e: Event) {
  // on change, not input: re-rendering the filtered list while typing would eat the Enter key
  p.voices = (e.target as HTMLTextAreaElement).value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function test(p: Provider) {
  busy.value = p.id;
  msg[p.id] = { cls: "", text: "Testing…" };
  const r = await testConnection(p);
  busy.value = null;
  if (!r.ok) {
    conn[p.id] = "bad";
    msg[p.id] = { cls: "bad", text: errText(r.error) };
    return;
  }
  conn[p.id] = "ok";
  if (r.models.length) p.models = r.models;
  msg[p.id] = { cls: "ok", text: `Connected in ${r.ms} ms · ${r.models.length} models` };
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

async function getVoices(p: Provider) {
  busy.value = p.id;
  msg[p.id] = { cls: "", text: "Fetching /audio/voices…" };
  const r = await fetchVoices(p);
  busy.value = null;
  if (r.ok) {
    p.voices = [...new Set([...p.voices, ...r.voices])]; // keep hand-typed blends
    msg[p.id] = { cls: "ok", text: `${p.voices.length} voices` };
  } else
    msg[p.id] = {
      cls: "bad",
      text: r.notFound
        ? "404: this server has no /audio/voices. Type voice ids by hand."
        : errText(r.error),
    };
}

// ---------- voices ----------
function onProvider(role: Role) {
  const v = settings[role];
  const p = providerById(v.providerId);
  if (p) Object.assign(v, { model: p.models[0] ?? v.model, voice: p.voices[0] ?? "" });
}
function setSame(role: "dialogue" | "system", same: boolean) {
  const d = settings[role];
  d.same = same;
  if (!same && !d.providerId)
    Object.assign(d, {
      providerId: settings.narration.providerId,
      model: settings.narration.model,
      voice: settings.narration.voice,
    });
}
async function doPreview(role: Role) {
  msg[role] = { cls: "", text: "Speaking…" };
  try {
    await preview(role);
    msg[role] = { cls: "", text: "" };
  } catch (e) {
    msg[role] = { cls: "bad", text: (e as Error)?.message ?? String(e) };
  }
}

// ---------- segments & timing ----------
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

// ---------- storage ----------
const stats = ref<{ segments: number; bytes: number } | null>(null);
const loadStats = async () => (stats.value = await cacheStats());
watch(
  () => ui.settingsTab,
  (t) => t === "storage" && loadStats(),
  { immediate: true },
);
function size(b: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}
async function clear() {
  await clearCache();
  await loadStats();
  toast({ title: "Cache cleared", sub: "Audio is generated again the next time you play." });
}
</script>

<template>
  <section class="set">
    <nav class="set-nav">
      <h1>Settings</h1>
      <button
        v-for="[k, l] in TABS"
        :key="k"
        :class="{ on: ui.settingsTab === k }"
        @click="ui.settingsTab = k"
      >
        {{ l }}
      </button>
      <button class="back" @click="ui.view = 'reader'">
        <ArrowLeft :size="14" /> Back to reader <kbd>Esc</kbd>
      </button>
    </nav>

    <div class="set-body">
      <!-- providers -->
      <template v-if="ui.settingsTab === 'providers'">
        <h2>Providers</h2>
        <p class="hint">
          OpenAI-compatible endpoints. Requests are forwarded by the local relay, so CORS does not
          apply. Keys are stored in this browser only.
        </p>
        <div
          v-for="p in settings.providers"
          :key="p.id"
          class="prov"
          :class="{ bad: dot(p) === 'bad' }"
        >
          <button class="prov-h" :aria-expanded="ui.openProviderId === p.id" @click="toggle(p)">
            <i class="dot" :class="dot(p)" />
            <b>{{ p.name }}</b>
            <span class="mono">{{ p.baseUrl }}</span>
            <span v-for="r in rolesOf(p.id)" :key="r" class="tag" :class="TAG[r]">{{ r }}</span>
            <span class="num">{{
              p.voices.length ? `${p.voices.length} voices` : "no voice list"
            }}</span>
          </button>
          <div v-if="ui.openProviderId === p.id" class="prov-b">
            <div class="f">
              <label>Name<input v-model="p.name" type="text" /></label>
              <label
                >Base URL<input
                  v-model.trim="p.baseUrl"
                  type="url"
                  class="monoi"
                  placeholder="https://…/v1"
              /></label>
              <label class="wide"
                >API key<input
                  v-model.trim="p.apiKey"
                  type="password"
                  class="monoi"
                  :class="{ bad: fixing(p) }"
                  placeholder="Optional for local servers"
                  autocomplete="off"
                />
                <small v-if="fixing(p)" class="err"
                  >This key was rejected{{
                    player.error?.status ? ` with ${player.error.status}` : ""
                  }}
                  during playback. Paste a working key, then test.</small
                >
              </label>
              <label class="wide"
                >Voices<textarea
                  rows="3"
                  :value="p.voices.join('\n')"
                  placeholder="One voice id per line"
                  spellcheck="false"
                  @change="setVoices(p, $event)"
                />
                <small
                  >One id per line, because blend ids contain commas. Fetch voices fills this from
                  <code>GET /audio/voices</code>; if the server has no such route, type them by
                  hand. These are only suggestions for the voice field.</small
                >
              </label>
            </div>
            <div class="acts-row">
              <button
                class="btn"
                :class="{ pri: fixing(p) }"
                :disabled="busy === p.id"
                @click="test(p)"
              >
                Test connection
              </button>
              <button class="btn" :disabled="busy === p.id" @click="getVoices(p)">
                Fetch voices
              </button>
              <span class="res" :class="msg[p.id]?.cls">{{ msg[p.id]?.text }}</span>
              <span class="sp" />
              <button class="btn ghost danger" @click="remove(p)">Remove</button>
            </div>
          </div>
        </div>
        <div v-if="!settings.providers.length" class="box muted">
          No providers yet. Add one below to enable listening.
        </div>
        <div class="acts-row">
          <span class="muted">Add</span>
          <button v-for="[k, l] in ADD" :key="k" class="btn" @click="add(k)">{{ l }}</button>
        </div>
      </template>

      <!-- voices -->
      <template v-else-if="ui.settingsTab === 'voices'">
        <h2>Voices</h2>
        <p class="hint">
          Every segment is one request. Narration, dialogue and system messages can use different
          providers, models and voices.
        </p>
        <div v-for="r in ROLES" :key="r.key" class="box" :class="r.dot">
          <h3>
            <i class="dot" :class="r.dot" />{{ r.label }}
            <template v-if="r.key !== 'narration'">
              <span class="sp" />
              <span class="segc">
                <button
                  :class="{ on: settings[r.key].same }"
                  :aria-pressed="settings[r.key].same"
                  @click="setSame(r.key, true)"
                >
                  Same as narration
                </button>
                <button
                  :class="{ on: !settings[r.key].same }"
                  :aria-pressed="!settings[r.key].same"
                  @click="setSame(r.key, false)"
                >
                  Separate voice
                </button>
              </span>
            </template>
          </h3>
          <small v-if="r.key !== 'narration' && settings[r.key].same" class="h">{{
            SAME_HINT[r.key]
          }}</small>
          <template v-else>
            <div class="f">
              <label
                >Provider<select v-model="settings[r.key].providerId" @change="onProvider(r.key)">
                  <option v-if="!settings.providers.length" :value="null">No providers yet</option>
                  <option
                    v-else-if="!providerById(settings[r.key].providerId)"
                    :value="settings[r.key].providerId"
                    disabled
                  >
                    Choose a provider
                  </option>
                  <option v-for="p in settings.providers" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select></label
              >
              <label
                >Model<input
                  v-model.trim="settings[r.key].model"
                  type="text"
                  class="monoi"
                  :list="`dl-${r.key}`"
                  placeholder="tts-1"
                />
                <datalist :id="`dl-${r.key}`">
                  <option
                    v-for="m in providerById(settings[r.key].providerId)?.models"
                    :key="m"
                    :value="m"
                  />
                </datalist>
              </label>
              <label class="wide"
                >Voice<input
                  v-model.trim="settings[r.key].voice"
                  type="text"
                  class="monoi"
                  placeholder="Type a voice id"
                  spellcheck="false"
                />
                <small
                  >Free text. Click a voice below to use it and hear it, or mix several with Blend
                  voices (servers like Kokoro accept <code>af_heart:0.7,af_bella:0.3</code>).</small
                >
              </label>
            </div>
            <VoicePicker
              v-model="settings[r.key].voice"
              :role="r.key"
              :provider="providerById(settings[r.key].providerId)"
              @error="msg[r.key] = { cls: 'bad', text: $event }"
            />
            <div class="acts-row">
              <button class="btn" @click="doPreview(r.key)"><Play :size="13" /> Preview</button>
              <span class="res" :class="msg[r.key]?.cls">{{ msg[r.key]?.text }}</span>
            </div>
          </template>
        </div>
        <p class="hint">
          Changing a voice never deletes audio. New segments are generated as you listen, and
          switching back reuses what was cached before.
        </p>
      </template>

      <!-- segments & timing -->
      <template v-else-if="ui.settingsTab === 'segments'">
        <h2>Segmentation</h2>
        <label class="sw"
          ><input v-model="settings.smartQuotes" type="checkbox" /> Treat single quotes as dialogue
          (smart rule)</label
        >
        <p class="hint tight">
          Double quotes always count as dialogue. A single quote counts only when no letter touches
          its outer side, so <code>don't</code> and <code>twins'</code> are left alone. Off means
          double quotes only.
        </p>
        <div class="prev">
          <template v-for="(s, i) in sample" :key="i"
            >{{ s.lead }}<span class="seg" :class="s.kind">{{ s.core }}</span
            >{{ s.trail }}</template
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
        <p class="hint tight2">
          Runs in the background for each segment after its audio arrives. Until the transcript is
          back, or when it fails, the highlight is estimated from character positions and playback
          carries on.
        </p>
        <div class="f">
          <label
            >Provider<select v-model="settings.stt.providerId" :disabled="!settings.stt.enabled">
              <option v-if="!settings.providers.length" :value="null">No providers yet</option>
              <option
                v-else-if="!providerById(settings.stt.providerId)"
                :value="settings.stt.providerId"
                disabled
              >
                Choose a provider
              </option>
              <option v-for="p in settings.providers" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          >
          <label
            >Model<input
              v-model.trim="settings.stt.model"
              type="text"
              class="monoi"
              list="dl-stt"
              placeholder="whisper-1"
              :disabled="!settings.stt.enabled"
            />
            <datalist id="dl-stt">
              <option
                v-for="m in providerById(settings.stt.providerId)?.models"
                :key="m"
                :value="m"
              />
            </datalist>
          </label>
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
            ><input
              v-model.number="settings.paragraphGap"
              type="range"
              min="0"
              max="1500"
              step="50"
            />
            <output>{{ settings.paragraphGap }} ms</output></label
          >
          <small class="h"
            >Silence added after a segment ends, on top of what the voice already leaves. Segments
            are the narration/dialogue switches inside a paragraph. Pauses shrink with playback
            speed.</small
          >
        </div>
      </template>

      <SpeechRules v-else-if="ui.settingsTab === 'speech'" />

      <!-- storage -->
      <template v-else-if="ui.settingsTab === 'storage'">
        <h2>Storage</h2>
        <p class="hint">
          Everything lives in this browser. Nothing is uploaded except the text sent to your
          providers.
        </p>
        <div class="box">
          <div class="kv">
            <span>Audio cache</span>
            <span
              >{{
                stats ? `${stats.segments.toLocaleString()} segments · ${size(stats.bytes)}` : "…"
              }}<br /><small class="h"
                >Keyed by provider, model, voice and text. Replaying costs nothing.</small
              ></span
            >
            <button class="btn danger" :disabled="!stats?.segments" @click="clear">
              Clear cache
            </button>
            <span>Word timings</span>
            <span
              >Stored next to the audio<br /><small class="h"
                >Cleared with the audio cache.</small
              ></span
            >
            <span />
            <span>Chapters</span>
            <span
              >{{ library.chapters.length }}
              {{ library.chapters.length === 1 ? "chapter" : "chapters" }}</span
            >
            <span />
            <span>Settings and keys</span>
            <span
              >Stored unencrypted in this browser<br /><small class="h"
                >Fine on your own machine. Do not use a shared browser profile.</small
              ></span
            >
            <span />
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.set {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  align-content: start;
  background: var(--page);
  height: 100%;
  overflow: auto;
}
.set-nav {
  padding: 18px 8px;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 0;
  align-self: start;
}
.set-nav h1 {
  font: 600 11px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink2);
  margin: 0 8px 8px;
}
.set-nav button {
  height: 30px;
  padding: 0 8px;
  border-radius: var(--r2);
  text-align: left;
  color: var(--ink2);
  font-weight: 500;
}
.set-nav button:hover {
  background: var(--hover);
}
.set-nav button.on {
  background: color-mix(in srgb, var(--acc) 13%, transparent);
  color: var(--ink-hi);
}
.set-nav .back {
  margin-top: 14px;
  color: var(--ink3);
  font-weight: 400;
  display: flex;
  gap: 6px;
  align-items: center;
}
.set-body {
  padding: 24px 28px 80px;
  max-width: 760px;
}
.set-body h2 {
  font: 600 16px var(--ui);
  color: var(--ink-hi);
  margin: 0 0 4px;
}
.set-body h2:not(:first-child) {
  margin-top: 30px;
}
.hint {
  color: var(--ink2);
  margin: 0 0 14px;
  max-width: 64ch;
}
.hint.tight {
  margin: 6px 0 0;
}
.hint.tight2 {
  margin: 6px 0 10px;
}
.muted {
  color: var(--ink2);
}

.f {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px 12px;
}
.f label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font: 500 11.5px var(--ui);
  color: var(--ink2);
}
.f .wide {
  grid-column: 1/-1;
}
.f small,
small.h {
  font-weight: 400;
  color: var(--ink3);
  font-size: 11.5px;
  line-height: 1.4;
}
.f small.err {
  color: var(--err);
}
input[type="text"],
input[type="password"],
input[type="number"],
input[type="url"],
select,
textarea {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--line2);
  border-radius: var(--r2);
  background: var(--raised);
  font-size: 13px;
  min-width: 0;
  width: 100%;
}
textarea {
  height: auto;
  padding: 6px 8px;
  font: 12px/1.5 var(--mono);
  resize: vertical;
}
input.monoi {
  font: 12px var(--mono);
}
input.bad {
  border-color: var(--err);
}
input:focus,
select:focus,
textarea:focus {
  outline: 2px solid color-mix(in srgb, var(--acc) 55%, transparent);
  outline-offset: 0;
  border-color: var(--acc);
}
input:disabled,
select:disabled,
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

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
  gap: 10px;
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
.tag {
  font: 500 10.5px var(--ui);
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--line2);
  color: var(--ink2);
  white-space: nowrap;
}
.tag.narr {
  border-color: color-mix(in srgb, var(--acc) 50%, transparent);
  color: var(--acc);
}
.tag.dlg {
  border-color: color-mix(in srgb, var(--dlg) 50%, transparent);
  color: var(--dlg);
}
.tag.sys {
  border-color: color-mix(in srgb, var(--sys) 50%, transparent);
  color: var(--sys);
}
.prov-b {
  padding: 12px;
  border-top: 1px solid var(--line);
}
.acts-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}
.res {
  font-size: 12px;
  color: var(--ink2);
}
.res.ok {
  color: var(--ok);
}
.res.bad {
  color: var(--err);
}

.box {
  --c: var(--acc);
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  padding: 14px;
  margin-bottom: 10px;
}
.box.dlg {
  --c: var(--dlg);
}
.box.sys {
  --c: var(--sys);
}
.box h3 {
  margin: 0 0 10px;
  font: 600 13px var(--ui);
  color: var(--ink-hi);
  display: flex;
  align-items: center;
  gap: 8px;
}
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
.segc {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--r2);
  background: var(--bg);
  border: 1px solid var(--line);
  gap: 2px;
}
.segc button {
  height: 24px;
  padding: 0 10px;
  border-radius: var(--r1);
  color: var(--ink2);
  font-weight: 500;
  font-size: 12px;
}
.segc button.on {
  background: var(--raised);
  color: var(--ink-hi);
  box-shadow: 0 0 0 1px var(--line2);
}

.sw {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
}
.sw input {
  appearance: none;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: var(--line2);
  position: relative;
  cursor: pointer;
  flex: none;
  margin: 0;
  transition: background 0.15s;
}
.sw input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.sw input:checked {
  background: var(--acc);
}
.sw input:checked::after {
  transform: translateX(12px);
}
.prev {
  font: 17px/1.7 var(--read);
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--bg);
  border: 1px solid var(--line);
  margin: 10px 0 0;
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
.kv {
  display: grid;
  grid-template-columns: 150px 1fr auto;
  gap: 10px 14px;
  align-items: center;
}
.kv > span:nth-child(3n + 1) {
  color: var(--ink2);
  font-weight: 500;
}

@media (max-width: 820px) {
  .set {
    grid-template-columns: minmax(0, 1fr);
  }
  .set-nav {
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 8px;
  }
  .set-nav h1 {
    display: none;
  }
  .set-nav .back {
    margin: 0 0 0 auto;
  }
  .set-body {
    padding: 18px 16px 80px;
  }
  .kv {
    grid-template-columns: 1fr auto;
  }
  .kv > span:nth-child(3n + 2) {
    grid-column: 1;
  }
}
</style>
