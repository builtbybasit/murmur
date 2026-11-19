<script setup lang="ts">
import { defineAsyncComponent, watchEffect } from "vue";
import { useEventListener, useMediaQuery, usePreferredDark } from "@vueuse/core";
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
import { settings, device, FONTS } from "./settings";
import { library } from "./library";
import { ui } from "./ui";
import { addFromText, undoWithToast } from "./paste";
import * as engine from "./engine";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const dark = usePreferredDark();
const narrow = useMediaQuery("(max-width: 820px)");

watchEffect(() => {
  const r = device.reading;
  const root = document.documentElement;
  root.dataset.theme = r.theme === "system" ? (dark.value ? "dark" : "light") : r.theme;
  root.style.setProperty("--read", (FONTS[r.font] ?? FONTS.serif).css);
  root.style.setProperty("--rs", r.size + "px");
  root.style.setProperty("--rl", String(r.lineHeight));
  root.style.setProperty("--rw", r.width + "ch");
});

function toggleSide() {
  if (narrow.value) ui.sidebarDrawer = !ui.sidebarDrawer;
  else device.sidebarOpen = !device.sidebarOpen;
}

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

const speed = (d: number) => engine.setSpeed(Math.round((settings.speed + d) * 10) / 10);

useEventListener(document, "keydown", (e: KeyboardEvent) => {
  // rows in the sidebar handle their own keys and preventDefault them
  if (e.defaultPrevented || inField(e.target) || ui.shortcutsOpen) return;
  const k = e.key;
  if (MAC ? e.metaKey : e.ctrlKey) {
    if (k === ",") {
      e.preventDefault();
      ui.view = ui.view === "settings" ? "reader" : "settings";
    } else if (k.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undoWithToast();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ((e.target as HTMLElement).tagName === "BUTTON" && (k === " " || k === "Enter")) return;
  const fwd = k === "ArrowRight";
  switch (k) {
    case " ":
      e.preventDefault();
      return engine.toggle();
    case "ArrowLeft":
    case "ArrowRight":
      if (ui.view !== "reader") return;
      e.preventDefault();
      if (e.shiftKey) return fwd ? engine.nextPara() : engine.prevPara();
      return fwd ? engine.next() : engine.prev();
    case "j":
    case "J":
      return engine.nextChapter();
    case "k":
    case "K":
      return engine.prevChapter();
    case "[":
      return speed(-0.1);
    case "]":
      return speed(0.1);
    case "f":
    case "F":
      ui.follow = true;
      return;
    case "r":
    case "R":
      return engine.retry();
    case "e":
    case "E":
      if (ui.currentId) engine.edit(ui.currentId);
      return;
    case "b":
    case "B":
      return toggleSide();
    case "a":
    case "A":
      ui.readingOpen = !ui.readingOpen;
      return;
    case "?":
      ui.shortcutsOpen = true;
      return;
    case "Escape":
      if (ui.view === "settings") ui.view = "reader";
      return;
  }
});
</script>

<template>
  <div class="app">
    <TopBar @side="toggleSide" />
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
