<script setup lang="ts">
import { reactive } from "vue";
import { Play } from "@lucide/vue";
import { settings, providerById, providerChanged, setSame, type Role } from "../../settings";
import { preview } from "../../preview";
import VoicePicker from "../VoicePicker.vue";
import ProviderModelFields from "./ProviderModelFields.vue";

const ROLES = [
  { key: "narration", dot: "narr", label: "Narration" },
  { key: "dialogue", dot: "dlg", label: "Dialogue" },
  { key: "system", dot: "sys", label: "System messages" },
] as const;
const SAME_HINT = {
  dialogue:
    "Quoted speech is read by the narration voice. It is still split into its own segments, so switching to a separate voice later needs no re-import.",
  system:
    "Lines in [brackets], fully bold lines, tables and boxes are read by the narration voice. Quotes inside them never switch to the dialogue voice.",
};

type Msg = { cls: "" | "bad"; text: string };
const msg = reactive<Partial<Record<Role, Msg>>>({}); // per role: preview result line

async function doPreview(role: Role) {
  msg[role] = { cls: "", text: "Speaking…" };
  try {
    await preview(role);
    msg[role] = { cls: "", text: "" };
  } catch (e) {
    msg[role] = { cls: "bad", text: (e as Error)?.message ?? String(e) };
  }
}
</script>

<template>
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
        <ProviderModelFields
          v-model:provider-id="settings[r.key].providerId"
          v-model:model="settings[r.key].model"
          kind="tts"
          placeholder="tts-1"
          @change="providerChanged(r.key)"
        />
        <label class="wide"
          >Voice<input
            v-model.trim="settings[r.key].voice"
            type="text"
            class="monoi"
            placeholder="Type a voice id"
            spellcheck="false"
          />
          <small
            >Free text. Click a voice below to use it and hear it, or mix several with Blend voices
            (servers like Kokoro accept <code>af_heart:0.7,af_bella:0.3</code>).</small
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
    Changing a voice never deletes audio. New segments are generated as you listen, and switching
    back reuses what was cached before.
  </p>
</template>
