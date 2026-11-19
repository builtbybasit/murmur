<script setup lang="ts">
import { onUnmounted } from "vue";
import { ArrowLeft } from "@lucide/vue";
import { ui } from "@/ui";
import Providers from "./settings/Providers.vue";
import Voices from "./settings/Voices.vue";
import Segments from "./settings/Segments.vue";
import SpeechRules from "./SpeechRules.vue";
import Storage from "./settings/Storage.vue";

const TABS = {
  providers: ["Providers", Providers],
  voices: ["Voices", Voices],
  segments: ["Segments & timing", Segments],
  speech: ["Spoken text", SpeechRules],
  storage: ["Storage", Storage],
} as const;

onUnmounted(() => (ui.fixKey = false));
</script>

<template>
  <section class="set">
    <nav class="set-nav">
      <h1 class="label">Settings</h1>
      <button
        v-for="([l], k) in TABS"
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
      <component :is="TABS[ui.settingsTab][1]" />
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
.set-nav .label {
  margin: 0 8px 8px;
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
  background: var(--acc-bg);
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
  .set-nav .label {
    display: none;
  }
  .set-nav .back {
    margin: 0 0 0 auto;
  }
  .set-body {
    padding: 18px 16px 80px;
  }
}
</style>
