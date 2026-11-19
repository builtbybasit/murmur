// Settings. `settings` is shared by every device through the lectern server (loaded and saved
// by sync.ts); `device` is this browser's own (reading look, sidebar), in localStorage.
import { computed, reactive } from "vue";
import { useLocalStorage } from "@vueuse/core";
import type { Kind } from "./lib/segment";
import type { Rule } from "./lib/speech";
import { DEFAULT_RULES } from "./lib/kaomoji";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  /** typed here and not saved yet; the server keeps saved keys and sends "" with hasKey */
  apiKey: string;
  hasKey?: boolean;
  models: string[];
  voices: string[];
}
interface VoiceSetting {
  providerId: string | null;
  model: string;
  voice: string;
}
export type Role = "narration" | "dialogue" | "system";
type FontKey = "serif" | "literata" | "atkinson" | "sans";
export interface Settings {
  providers: Provider[];
  narration: VoiceSetting;
  dialogue: VoiceSetting & { same: boolean };
  /** [bracketed] / fully bold lines, tables, boxes */
  system: VoiceSetting & { same: boolean };
  stt: { enabled: boolean; providerId: string | null; model: string };
  /** text sent to TTS: replace rules, then automatic emoji/kaomoji removal */
  /** suffix: said after each face/emoji label ("waving emoji") */
  /** images: say "Illustration." for each picture (false: pass over it silently) */
  speech: { auto: boolean; rules: Rule[]; suffix: string; images: boolean };
  smartQuotes: boolean;
  prefetch: number;
  /** silence between segments / paragraphs, in ms at 1.0x */
  segmentGap: number;
  paragraphGap: number;
  speed: number;
  /** book names folded in the sidebar */
  collapsed: string[];
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
  system: { same: true, providerId: null, model: "", voice: "" },
  stt: { enabled: true, providerId: null, model: "whisper-1" },
  smartQuotes: true,
  prefetch: 3,
  speech: { auto: true, rules: DEFAULT_RULES, suffix: "emoji", images: true },
  segmentGap: 0,
  paragraphGap: 300,
  speed: 1,
  collapsed: [],
};

/** Shared settings. Mutate in place; never reassign. */
export const settings = reactive<Settings>(structuredClone(DEFAULTS));

/** Take the server's settings, with defaults for anything missing. */
export function loadSettings(s: Partial<Settings> | null) {
  const d = structuredClone(DEFAULTS);
  s ??= {};
  Object.assign(settings, {
    ...d,
    ...s,
    narration: { ...d.narration, ...s.narration },
    dialogue: { ...d.dialogue, ...s.dialogue },
    system: { ...d.system, ...s.system },
    stt: { ...d.stt, ...s.stt },
    speech: { ...d.speech, ...s.speech },
  });
}

/** This browser's own settings. */
export const device = useLocalStorage(
  "lectern.device",
  {
    reading: {
      font: "serif" as FontKey,
      size: 19,
      lineHeight: 1.7,
      width: 66,
      theme: "system" as "light" | "dark" | "system",
      tintDialogue: true,
    },
    sidebarOpen: true,
  },
  { mergeDefaults: (s, d) => ({ ...d, ...s, reading: { ...d.reading, ...s.reading } }) },
).value;

/** Default faces whose "speak as" is blank get their label back; missing default rules are added. */
export function restoreSpeechDefaults(): { filled: number; added: number } {
  const def = new Map(DEFAULT_RULES.map((r) => [r.find, r.replace]));
  const rules = settings.speech.rules;
  let filled = 0;
  for (const r of rules) {
    const label = def.get(r.find);
    if (label == null) continue;
    if (!r.replace) {
      r.replace = label;
      filled++;
    }
    if (r.replace === label) r.face = true;
  }
  const have = new Set(rules.map((r) => r.find));
  const missing = DEFAULT_RULES.filter((r) => !have.has(r.find));
  rules.push(...missing.map((r) => ({ ...r })));
  return { filled, added: missing.length };
}

export const providerById = (id: string | null | undefined): Provider | null =>
  settings.providers.find((p) => p.id === id) ?? null;

/** Resolved voice for a segment kind (provider may be null). */
export function voiceFor(kind: Kind): {
  role: Role;
  provider: Provider | null;
  model: string;
  voice: string;
} {
  const role: Role =
    kind === "dlg" && !settings.dialogue.same
      ? "dialogue"
      : kind === "sys" && !settings.system.same
        ? "system"
        : "narration";
  const v = settings[role];
  return { role, provider: providerById(v.providerId), model: v.model, voice: v.voice };
}

/** Roles a provider is used for, for the tags in Settings. */
export function rolesOf(id: string): (Role | "alignment")[] {
  const r: (Role | "alignment")[] = [];
  if (settings.narration.providerId === id) r.push("narration");
  if (!settings.dialogue.same && settings.dialogue.providerId === id) r.push("dialogue");
  if (!settings.system.same && settings.system.providerId === id) r.push("system");
  if (settings.stt.enabled && settings.stt.providerId === id) r.push("alignment");
  return r;
}

export const hasTts = computed(() => !!voiceFor("narr").provider);

export function addProvider(preset: PresetKey = "blank"): Provider {
  const p = PRESETS[preset];
  const prov: Provider = {
    id: "p" + crypto.randomUUID().slice(0, 8),
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
  for (const r of [settings.narration, settings.dialogue, settings.system, settings.stt])
    if (r.providerId === id) r.providerId = null;
}
