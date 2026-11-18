// App state shared by every component. Settings live in localStorage, chapters in IndexedDB.
// The playback engine (src/engine.ts) owns everything about audio; this file owns data.
import { reactive, computed, watch } from "vue";
import { useLocalStorage, watchDebounced } from "@vueuse/core";
import { get, set } from "idb-keyval";
import { buildDoc, normalize, autoTitle, type Doc, type Kind } from "./lib/segment";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  voices: string[];
}
export interface VoiceSetting {
  providerId: string | null;
  model: string;
  voice: string;
}
export type Role = "narration" | "dialogue";
export type FontKey = "serif" | "literata" | "atkinson" | "sans";
export interface Settings {
  providers: Provider[];
  narration: VoiceSetting;
  dialogue: VoiceSetting & { same: boolean };
  stt: { enabled: boolean; providerId: string | null; model: string };
  smartQuotes: boolean;
  prefetch: number;
  speed: number;
  reading: {
    font: FontKey;
    size: number;
    lineHeight: number;
    width: number;
    theme: "light" | "dark" | "system";
    tintDialogue: boolean;
  };
  sidebarOpen: boolean;
  lastChapterId: string | null;
}
export interface Chapter {
  id: string;
  title: string;
  body: string;
  raw: string;
  addedAt: number;
  short: boolean;
  /** saved segment index */
  pos: number;
}
export interface ToastAction {
  label: string;
  run: () => void;
}
export interface Toast {
  title: string;
  sub?: string;
  warn?: boolean;
  actions?: ToastAction[];
  id?: number;
}
export type PresetKey = "kokoro" | "openai" | "stt" | "blank";

export const PRESETS: Record<PresetKey, Omit<Provider, "id" | "apiKey">> = {
  kokoro: {
    name: "Kokoro (local)",
    baseUrl: "http://localhost:8020/v1",
    models: ["kokoro"],
    voices: [
      "af_heart",
      "af_bella",
      "af_nicole",
      "af_sky",
      "am_onyx",
      "am_michael",
      "bf_emma",
      "bm_george",
      "af_heart:0.7,af_bella:0.3",
    ],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd", "whisper-1"],
    voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"],
  },
  stt: {
    name: "Local STT",
    baseUrl: "http://localhost:8010/v1",
    models: ["FermionResearch/Phonon-2"],
    voices: [],
  },
  blank: { name: "New provider", baseUrl: "", models: [], voices: [] },
};

export const FONTS: Record<FontKey, { label: string; css: string }> = {
  serif: { label: "Source Serif", css: `'Source Serif 4',Georgia,serif` },
  literata: { label: "Literata", css: `'Literata',Georgia,serif` },
  atkinson: { label: "Atkinson", css: `'Atkinson Hyperlegible',system-ui,sans-serif` },
  sans: { label: "Geist Sans", css: `'Geist',system-ui,sans-serif` },
};

const DEFAULTS: Settings = {
  providers: [],
  narration: { providerId: null, model: "", voice: "" },
  dialogue: { same: true, providerId: null, model: "", voice: "" },
  stt: { enabled: true, providerId: null, model: "whisper-1" },
  smartQuotes: true,
  prefetch: 3,
  speed: 1,
  reading: {
    font: "serif",
    size: 19,
    lineHeight: 1.7,
    width: 66,
    theme: "system",
    tintDialogue: true,
  },
  sidebarOpen: true,
  lastChapterId: null,
};

const stored = useLocalStorage<Settings>("lectern.settings", DEFAULTS, {
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
  view: "reader" as "reader" | "settings",
  settingsTab: "providers" as "providers" | "voices" | "segments" | "storage",
  openProviderId: null as string | null, // provider row expanded in Settings
  fixKey: false, // Settings opened from a 401: mark the key field
  currentId: null as string | null, // chapter shown in the reader (the engine plays this one)
  follow: true, // reader auto-scrolls to the current word
  readingOpen: false, // Aa popover
  shortcutsOpen: false,
  sidebarDrawer: false, // narrow-window overlay drawer
  toast: null as Toast | null,
  flashId: null as string | null, // chapter row to flash
  renamingId: null as string | null, // chapter row in rename mode (Sidebar)
  editingId: null as string | null, // chapter whose text is open in the editor (Reader)
});

/** Chapters, in list order. chapter = { id, title, body, raw, addedAt, short, pos } (pos = segment index). */
export const library = reactive({ chapters: [] as Chapter[], loaded: false });

void get<Chapter[]>("chapters").then((cs) => {
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

const docs = new Map<string, { key: string; doc: Doc }>();
/** Segmented chapter (see buildDoc in lib/segment.js). Memoised on body + quote rule. */
export function docOf(ch: Chapter): Doc {
  const key = settings.smartQuotes + "|" + ch.body;
  const hit = docs.get(ch.id);
  if (hit?.key === key) return hit.doc;
  const doc = buildDoc(ch.body, settings.smartQuotes);
  docs.set(ch.id, { key, doc });
  return doc;
}

export const current = computed(() => library.chapters.find((c) => c.id === ui.currentId) ?? null);
export const currentDoc = computed(() => (current.value ? docOf(current.value) : null));

export const providerById = (id: string | null | undefined): Provider | null =>
  settings.providers.find((p) => p.id === id) ?? null;

/** Resolved voice for a segment kind (provider may be null). */
export function voiceFor(kind: Kind): {
  role: Role;
  provider: Provider | null;
  model: string;
  voice: string;
} {
  const role: Role = kind === "dlg" && !settings.dialogue.same ? "dialogue" : "narration";
  const v = settings[role];
  return { role, provider: providerById(v.providerId), model: v.model, voice: v.voice };
}

/** Roles a provider is used for, for the tags in Settings. */
export function rolesOf(id: string): ("narration" | "dialogue" | "alignment")[] {
  const r: ("narration" | "dialogue" | "alignment")[] = [];
  if (settings.narration.providerId === id) r.push("narration");
  if (!settings.dialogue.same && settings.dialogue.providerId === id) r.push("dialogue");
  if (settings.stt.enabled && settings.stt.providerId === id) r.push("alignment");
  return r;
}

export const hasTts = computed(() => !!voiceFor("narr").provider);

/** Rough audio length before anything is generated, at 1.0x. */
export const CHARS_PER_SEC = 15;

// ---------- toast ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(t: Toast, ms = 6000) {
  ui.toast = { ...t, id: Date.now() };
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (ui.toast = null), ms);
}

// ---------- providers ----------

let uid = Date.now();
export const newId = (p: string) => p + (uid++).toString(36);

export function addProvider(preset: PresetKey = "blank"): Provider {
  const p = PRESETS[preset];
  const prov: Provider = {
    id: newId("p"),
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: "",
    models: [...p.models],
    voices: [...p.voices],
  };
  settings.providers.push(prov);
  // first provider fills empty roles so a fresh install can play immediately
  if (!settings.narration.providerId && preset !== "stt") {
    Object.assign(settings.narration, {
      providerId: prov.id,
      model: prov.models[0] ?? "",
      voice: prov.voices[0] ?? "",
    });
  }
  if (!settings.stt.providerId && (preset === "stt" || preset === "openai")) {
    Object.assign(settings.stt, {
      providerId: prov.id,
      model: preset === "openai" ? "whisper-1" : (prov.models[0] ?? "whisper-1"),
    });
  }
  return settings.providers.at(-1)!;
}

export function removeProvider(id: string) {
  const i = settings.providers.findIndex((p) => p.id === id);
  if (i >= 0) settings.providers.splice(i, 1);
  for (const r of [settings.narration, settings.dialogue, settings.stt])
    if (r.providerId === id) r.providerId = null;
}

// ---------- chapters ----------

let undoEntry: { kind: "add" | "delete"; chapter: Chapter; index: number } | null = null;

/**
 * Add a pasted chapter at the end.
 * Toasts are the caller's job (it knows about Rename/Undo buttons).
 */
export function addChapter(rawIn: string | null | undefined): {
  status: "added" | "dup" | "empty";
  chapter?: Chapter;
} {
  const raw = normalize(rawIn ?? "");
  if (!raw) return { status: "empty" };
  const dup = library.chapters.find((c) => c.raw === raw);
  if (dup) {
    ui.flashId = dup.id;
    return { status: "dup", chapter: dup };
  }
  const { title, body } = autoTitle(
    raw,
    library.chapters.map((c) => c.title),
  );
  const words = body.split(/\s+/).length;
  library.chapters.push({
    id: newId("c"),
    title,
    body,
    raw,
    addedAt: Date.now(),
    short: words < 40,
    pos: 0,
  });
  const ch = library.chapters.at(-1)!;
  undoEntry = { kind: "add", chapter: ch, index: library.chapters.length - 1 };
  ui.flashId = ch.id;
  if (!ui.currentId) ui.currentId = ch.id; // the very first chapter opens itself
  return { status: "added", chapter: ch };
}

/** Replace a chapter's text. Unchanged segments keep their cached audio (cache keys are per text). */
export function setChapterBody(id: string, text: string): boolean {
  const c = library.chapters.find((c) => c.id === id);
  const body = normalize(text);
  if (!c || !body) return false;
  c.body = body;
  c.short = body.split(/\s+/).length < 40;
  return true;
}

export function renameChapter(id: string, title: string) {
  const c = library.chapters.find((c) => c.id === id);
  if (c && title.trim()) c.title = title.trim();
}

export function moveChapter(id: string, to: number) {
  const from = library.chapters.findIndex((c) => c.id === id);
  if (from < 0 || to < 0 || to >= library.chapters.length) return;
  const [c] = library.chapters.splice(from, 1);
  library.chapters.splice(to, 0, c!);
}

export function deleteChapter(id: string): Chapter | undefined {
  const index = library.chapters.findIndex((c) => c.id === id);
  if (index < 0) return;
  const [chapter] = library.chapters.splice(index, 1);
  undoEntry = { kind: "delete", chapter: chapter!, index };
  if (ui.currentId === id)
    ui.currentId = (library.chapters[index] ?? library.chapters[index - 1])?.id ?? null;
  return chapter;
}

/** Undo the last add or delete. Returns the entry kind, or null if nothing to undo. */
export function undo(): "add" | "delete" | null {
  const e = undoEntry;
  if (!e) return null;
  undoEntry = null;
  if (e.kind === "add") deleteChapterQuiet(e.chapter.id);
  else library.chapters.splice(e.index, 0, e.chapter);
  return e.kind;
}
function deleteChapterQuiet(id: string) {
  const i = library.chapters.findIndex((c) => c.id === id);
  if (i >= 0) library.chapters.splice(i, 1);
  if (ui.currentId === id)
    ui.currentId = library.chapters[i - 1]?.id ?? library.chapters[0]?.id ?? null;
}
