// App state shared by every component. Settings live in localStorage, chapters in IndexedDB.
// The playback engine (src/engine.js) owns everything about audio; this file owns data.
import { reactive, computed, watch } from "vue";
import { useLocalStorage, watchDebounced } from "@vueuse/core";
import { get, set } from "idb-keyval";
import { buildDoc, normalize, autoTitle } from "./lib/segment.js";

export const PRESETS = {
  kokoro: {
    name: "Kokoro (local)",
    baseUrl: "http://localhost:8880/v1",
    models: ["kokoro"],
    voices: ["af_heart", "af_bella", "af_nicole", "af_sky", "am_onyx", "am_michael", "bf_emma", "bm_george", "af_heart:0.7,af_bella:0.3"],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd", "whisper-1"],
    voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"],
  },
  stt: { name: "Local STT", baseUrl: "http://localhost:8000/v1", models: ["whisper-1"], voices: [] },
  blank: { name: "New provider", baseUrl: "", models: [], voices: [] },
};

export const FONTS = {
  serif: { label: "Source Serif", css: `'Source Serif 4',Georgia,serif` },
  literata: { label: "Literata", css: `'Literata',Georgia,serif` },
  atkinson: { label: "Atkinson", css: `'Atkinson Hyperlegible',system-ui,sans-serif` },
  sans: { label: "Geist Sans", css: `'Geist',system-ui,sans-serif` },
};

const DEFAULTS = {
  /** @type {{id:string,name:string,baseUrl:string,apiKey:string,models:string[],voices:string[]}[]} */
  providers: [],
  narration: { providerId: null, model: "", voice: "" },
  dialogue: { same: true, providerId: null, model: "", voice: "" },
  stt: { enabled: true, providerId: null, model: "whisper-1" },
  smartQuotes: true,
  prefetch: 3,
  speed: 1,
  reading: { font: "serif", size: 19, lineHeight: 1.7, width: 66, theme: "system", tintDialogue: true },
  sidebarOpen: true,
  lastChapterId: null,
};

const stored = useLocalStorage("lectern.settings", DEFAULTS, {
  mergeDefaults: (s, d) => ({
    ...d,
    ...s,
    narration: { ...d.narration, ...s.narration },
    dialogue: { ...d.dialogue, ...s.dialogue },
    stt: { ...d.stt, ...s.stt },
    reading: { ...d.reading, ...s.reading },
  }),
});
/** Persisted settings. Mutate in place; never reassign. */
export const settings = stored.value;

/** Transient UI state. */
export const ui = reactive({
  view: "reader", // 'reader' | 'settings'
  settingsTab: "providers", // 'providers' | 'voices' | 'segments' | 'storage'
  openProviderId: null, // provider row expanded in Settings
  fixKey: false, // Settings opened from a 401: mark the key field
  currentId: null, // chapter shown in the reader (the engine plays this one)
  follow: true, // reader auto-scrolls to the current word
  readingOpen: false, // Aa popover
  shortcutsOpen: false,
  sidebarDrawer: false, // narrow-window overlay drawer
  toast: null, // { title, sub?, warn?, actions?: [{label, run}] , id }
  flashId: null, // chapter row to flash
});

/** Chapters, in list order. chapter = { id, title, body, raw, addedAt, short, pos } (pos = segment index). */
export const library = reactive({ chapters: [], loaded: false });

get("chapters").then((cs) => {
  library.chapters = cs || [];
  library.loaded = true;
  ui.currentId = library.chapters.some((c) => c.id === settings.lastChapterId)
    ? settings.lastChapterId
    : (library.chapters[0]?.id ?? null);
});
watchDebounced(
  () => library.chapters,
  (cs) => library.loaded && set("chapters", JSON.parse(JSON.stringify(cs))),
  { deep: true, debounce: 300 },
);
watch(
  () => ui.currentId,
  (id) => (settings.lastChapterId = id),
);

// ---------- derived ----------

const docs = new Map(); // chapter id -> { key, doc }
/** Segmented chapter (see buildDoc in lib/segment.js). Memoised on body + quote rule. */
export function docOf(ch) {
  const key = settings.smartQuotes + "|" + ch.body;
  const hit = docs.get(ch.id);
  if (hit?.key === key) return hit.doc;
  const doc = buildDoc(ch.body, settings.smartQuotes);
  docs.set(ch.id, { key, doc });
  return doc;
}

export const current = computed(() => library.chapters.find((c) => c.id === ui.currentId) ?? null);
export const currentDoc = computed(() => current.value && docOf(current.value));

export const providerById = (id) => settings.providers.find((p) => p.id === id) ?? null;

/** Resolved voice for a segment kind: { provider, model, voice, role } (provider may be null). */
export function voiceFor(kind) {
  const role = kind === "dlg" && !settings.dialogue.same ? "dialogue" : "narration";
  const v = settings[role];
  return { role, provider: providerById(v.providerId), model: v.model, voice: v.voice };
}

/** Roles a provider is used for, for the tags in Settings. */
export function rolesOf(id) {
  const r = [];
  if (settings.narration.providerId === id) r.push("narration");
  if (!settings.dialogue.same && settings.dialogue.providerId === id) r.push("dialogue");
  if (settings.stt.enabled && settings.stt.providerId === id) r.push("alignment");
  return r;
}

export const hasTts = computed(() => !!voiceFor("narr").provider);

/** Rough audio length before anything is generated, at 1.0x. */
export const CHARS_PER_SEC = 15;

// ---------- toast ----------

let toastTimer;
export function toast(t, ms = 6000) {
  ui.toast = { ...t, id: Date.now() };
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (ui.toast = null), ms);
}

// ---------- providers ----------

let uid = Date.now();
export const newId = (p) => p + (uid++).toString(36);

export function addProvider(preset = "blank") {
  const p = PRESETS[preset];
  const prov = { id: newId("p"), name: p.name, baseUrl: p.baseUrl, apiKey: "", models: [...p.models], voices: [...p.voices] };
  settings.providers.push(prov);
  // first provider fills empty roles so a fresh install can play immediately
  if (!settings.narration.providerId && preset !== "stt") {
    Object.assign(settings.narration, { providerId: prov.id, model: prov.models[0] ?? "", voice: prov.voices[0] ?? "" });
  }
  if (!settings.stt.providerId && (preset === "stt" || preset === "openai")) {
    Object.assign(settings.stt, { providerId: prov.id, model: preset === "openai" ? "whisper-1" : (prov.models[0] ?? "whisper-1") });
  }
  return settings.providers.at(-1);
}

export function removeProvider(id) {
  settings.providers.splice(settings.providers.findIndex((p) => p.id === id), 1);
  for (const r of [settings.narration, settings.dialogue, settings.stt]) if (r.providerId === id) r.providerId = null;
}

// ---------- chapters ----------

let undoEntry = null; // { kind: 'add'|'delete', chapter, index }

/**
 * Add a pasted chapter at the end. Returns { status: 'added'|'dup'|'empty', chapter? }.
 * Toasts are the caller's job (it knows about Rename/Undo buttons).
 */
export function addChapter(rawIn) {
  const raw = normalize(rawIn ?? "");
  if (!raw) return { status: "empty" };
  const dup = library.chapters.find((c) => c.raw === raw);
  if (dup) {
    ui.flashId = dup.id;
    return { status: "dup", chapter: dup };
  }
  const { title, body } = autoTitle(raw, library.chapters.map((c) => c.title));
  const words = body.split(/\s+/).length;
  library.chapters.push({ id: newId("c"), title, body, raw, addedAt: Date.now(), short: words < 40, pos: 0 });
  const ch = library.chapters.at(-1);
  undoEntry = { kind: "add", chapter: ch, index: library.chapters.length - 1 };
  ui.flashId = ch.id;
  if (!ui.currentId) ui.currentId = ch.id; // the very first chapter opens itself
  return { status: "added", chapter: ch };
}

export function renameChapter(id, title) {
  const c = library.chapters.find((c) => c.id === id);
  if (c && title.trim()) c.title = title.trim();
}

export function moveChapter(id, to) {
  const from = library.chapters.findIndex((c) => c.id === id);
  if (from < 0 || to < 0 || to >= library.chapters.length) return;
  const [c] = library.chapters.splice(from, 1);
  library.chapters.splice(to, 0, c);
}

export function deleteChapter(id) {
  const index = library.chapters.findIndex((c) => c.id === id);
  if (index < 0) return;
  const [chapter] = library.chapters.splice(index, 1);
  undoEntry = { kind: "delete", chapter, index };
  if (ui.currentId === id) ui.currentId = (library.chapters[index] ?? library.chapters[index - 1])?.id ?? null;
  return chapter;
}

/** Undo the last add or delete. Returns the entry kind, or null if nothing to undo. */
export function undo() {
  const e = undoEntry;
  if (!e) return null;
  undoEntry = null;
  if (e.kind === "add") deleteChapterQuiet(e.chapter.id);
  else library.chapters.splice(e.index, 0, e.chapter);
  return e.kind;
}
function deleteChapterQuiet(id) {
  const i = library.chapters.findIndex((c) => c.id === id);
  if (i >= 0) library.chapters.splice(i, 1);
  if (ui.currentId === id) ui.currentId = library.chapters[i - 1]?.id ?? library.chapters[0]?.id ?? null;
}
