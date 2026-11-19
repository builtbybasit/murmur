<script setup lang="ts">
import { reactive, ref } from "vue";
import {
  settings,
  addProvider,
  removeProvider,
  rolesOf,
  type Provider,
  type PresetKey,
} from "../../settings";
import { ui, toast } from "../../ui";
import { player, retry } from "../../engine";
import { saveSettings } from "../../sync";
import { testConnection, fetchVoices } from "../../lib/api";

const ADD: [PresetKey, string][] = [
  ["kokoro", "Local Kokoro"],
  ["openai", "OpenAI"],
  ["stt", "Local STT"],
  ["blank", "Blank"],
];

type Msg = { cls: "" | "ok" | "bad"; text: string };
const msg = reactive<Record<string, Msg>>({}); // per provider id: inline result line
const conn = reactive<Record<string, "ok" | "bad">>({}); // last Test result per provider
const busy = ref<string | null>(null);

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
  await saveSettings(); // the relay uses the server's copy of the provider for its key
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
  await saveSettings();
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
</script>

<template>
  <h2>Providers</h2>
  <p class="hint">
    OpenAI-compatible endpoints. Requests are forwarded by the local relay, so CORS does not apply.
    Keys are kept by the relay on this Mac (<code>~/.lectern</code>); browsers never get them.
  </p>
  <div v-for="p in settings.providers" :key="p.id" class="prov" :class="{ bad: dot(p) === 'bad' }">
    <button class="prov-h" :aria-expanded="ui.openProviderId === p.id" @click="toggle(p)">
      <i class="dot" :class="dot(p)" />
      <b>{{ p.name }}</b>
      <span class="mono">{{ p.baseUrl }}</span>
      <span v-for="r in rolesOf(p.id)" :key="r" class="tag" :class="r">{{ r }}</span>
      <span class="num">{{ p.voices.length ? `${p.voices.length} voices` : "no voice list" }}</span>
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
            :placeholder="
              p.hasKey ? 'Saved on the server; type to replace' : 'Optional for local servers'
            "
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
            <code>GET /audio/voices</code>; if the server has no such route, type them by hand.
            These are only suggestions for the voice field.</small
          >
        </label>
      </div>
      <div class="acts-row">
        <button class="btn" :class="{ pri: fixing(p) }" :disabled="busy === p.id" @click="test(p)">
          Test connection
        </button>
        <button class="btn" :disabled="busy === p.id" @click="getVoices(p)">Fetch voices</button>
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
  border-radius: var(--r-pill);
  border: 1px solid var(--line2);
  color: var(--ink2);
  white-space: nowrap;
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
}
</style>
