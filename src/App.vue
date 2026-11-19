<script setup lang="ts">
import { defineAsyncComponent, watchEffect } from "vue";
import { useEventListener, usePreferredDark } from "@vueuse/core";
import TopBar from "./components/TopBar.vue";
import Sidebar from "./components/Sidebar.vue";
import Toast from "./components/Toast.vue";
import ShortcutSheet from "./components/ShortcutSheet.vue";
import PlayerBar from "./components/PlayerBar.vue";
import Reader from "./components/Reader.vue";
import Settings from "./components/Settings.vue";
import Onboarding from "./components/Onboarding.vue";
// loaded on first use: epub-ts and jszip stay out of the main bundle
const EpubImport = defineAsyncComponent(() => import("./components/EpubImport.vue"));
import { device, FONTS } from "./settings";
import { library } from "./library";
import { ui } from "./ui";
import { addFromText } from "./paste";
import { runShortcut } from "./shortcuts";

const dark = usePreferredDark();

watchEffect(() => {
  const r = device.reading;
  const root = document.documentElement;
  root.dataset.theme = r.theme === "system" ? (dark.value ? "dark" : "light") : r.theme;
  root.style.setProperty("--read", (FONTS[r.font] ?? FONTS.serif).css);
  root.style.setProperty("--rs", r.size + "px");
  root.style.setProperty("--rl", String(r.lineHeight));
  root.style.setProperty("--rw", r.width + "ch");
});

const inField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.matches("input,textarea,select") || t.isContentEditable);

useEventListener(document, "paste", (e: ClipboardEvent) => {
  if (inField(e.target)) return;
  e.preventDefault();
  addFromText(e.clipboardData?.getData("text/plain"), e.clipboardData?.getData("text/html"));
});

// drop an .epub anywhere to import it
useEventListener(document, "dragover", (e: DragEvent) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});
useEventListener(document, "drop", (e: DragEvent) => {
  const f = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.epub$/i.test(f.name));
  if (!f) return;
  e.preventDefault();
  ui.epubFile = f;
});

useEventListener(document, "keydown", (e: KeyboardEvent) => {
  // rows in the sidebar handle their own keys and preventDefault them; dialogs keep theirs
  if (e.defaultPrevented || inField(e.target) || document.querySelector("dialog[open]")) return;
  if ((e.target as HTMLElement).tagName === "BUTTON" && (e.key === " " || e.key === "Enter"))
    return;
  if (runShortcut(e)) e.preventDefault();
  else if (e.key === "Escape" && ui.view === "settings") ui.view = "reader";
});
</script>

<template>
  <div class="app">
    <TopBar />
    <div class="mid" :class="{ noside: !device.sidebarOpen }">
      <Sidebar />
      <main>
        <Settings v-if="ui.view === 'settings'" />
        <Onboarding v-else-if="!library.chapters.length" />
        <Reader v-else />
      </main>
    </div>
    <div class="bottom"><PlayerBar /></div>
    <Toast />
    <ShortcutSheet />
    <EpubImport v-if="ui.epubFile" :key="ui.epubFile.name + ui.epubFile.lastModified" />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.mid {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  min-height: 0;
  position: relative;
}
.mid.noside {
  grid-template-columns: minmax(0, 1fr);
}
main {
  min-height: 0;
  min-width: 0;
  position: relative;
  display: grid;
}
main > :deep(*) {
  min-height: 0;
}
@media (max-width: 820px) {
  .mid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
