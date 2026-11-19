// Shared library: chapters, reading positions and most settings live on the lectern server
// (dev/library-api.ts), so every device on your network sees the same thing. Each device keeps
// its own audio cache, reading look and sidebar state. Without the server (a static build) this
// does nothing and the browser's own copy is used.
import { reactive } from "vue";
import { until, useEventListener, watchDebounced } from "@vueuse/core";
import { library, settings, ui, type Chapter, type Settings } from "./store";
import { open, player } from "./engine";
import { apiFetch, putJson } from "./lib/server";

const SHARED = [
  "providers",
  "narration",
  "dialogue",
  "system",
  "stt",
  "speech",
  "smartQuotes",
  "prefetch",
  "segmentGap",
  "paragraphGap",
  "speed",
  "collapsed",
  "lastChapterId",
] as const satisfies (keyof Settings)[];
const shared = () => JSON.stringify(Object.fromEntries(SHARED.map((k) => [k, settings[k]])));

/** online: the server answered; error: the last save failed (shown in Settings › Storage) */
export const sync = reactive({ online: false, error: "" });

const sent = new Map<string, string>(); // chapter id -> its JSON as the server has it
let sentOrder = "";
let sentSettings = "";
let pushing: Promise<void> | null = null;
let again = false;

function remember(chapters: Chapter[]) {
  sent.clear();
  for (const c of chapters) sent.set(c.id, JSON.stringify(c));
  sentOrder = JSON.stringify(chapters.map((c) => c.id));
}

/** Send what changed since the last save: changed chapters, deletions, the order. */
function push(): Promise<void> {
  if (!sync.online) return Promise.resolve();
  if (pushing) {
    again = true;
    return pushing;
  }
  // .finally runs after this assignment even when there is nothing to send (no await inside)
  pushing = send().finally(() => {
    pushing = null;
    if (again) {
      again = false;
      void push();
    }
  });
  return pushing;
}
async function send() {
  try {
    const now = library.chapters;
    for (const c of now) {
      const j = JSON.stringify(c);
      if (sent.get(c.id) === j) continue;
      await putJson("chapters/" + c.id, c);
      sent.set(c.id, j);
    }
    const ids = new Set(now.map((c) => c.id));
    for (const id of sent.keys())
      // deleting while iterating a Map is safe
      if (!ids.has(id)) {
        await apiFetch("chapters/" + id, { method: "DELETE" });
        sent.delete(id);
      }
    const order = JSON.stringify(now.map((c) => c.id));
    if (order !== sentOrder) {
      await putJson("order", JSON.parse(order));
      sentOrder = order;
    }
    const s = shared();
    if (s !== sentSettings) {
      await putJson("settings", JSON.parse(s));
      sentSettings = s;
    }
    sync.error = "";
  } catch (e) {
    sync.error = (e as Error).message; // retried with the next change
  }
}

const playing = () => player.status === "playing" || player.status === "buffering";

/** Take the server's library and settings; follow the chapter and position you left off at. */
async function pull() {
  const lib = (await (await apiFetch("library")).json()) as {
    initialized: boolean;
    chapters: Chapter[];
  };
  const s = (await (await apiFetch("settings")).json()) as Partial<Settings> | null;
  return { lib, s };
}

function apply(lib: { chapters: Chapter[] }, s: Partial<Settings> | null) {
  if (s) {
    Object.assign(settings, s);
    sentSettings = shared();
  }
  if (JSON.stringify(lib.chapters) !== JSON.stringify(library.chapters)) {
    remember(lib.chapters);
    library.chapters = lib.chapters;
  } else remember(library.chapters);
  const want = settings.lastChapterId;
  const id = library.chapters.some((c) => c.id === want)
    ? want
    : library.chapters.some((c) => c.id === ui.currentId)
      ? ui.currentId
      : (library.chapters[0]?.id ?? null);
  if (id) open(id, { seg: library.chapters.find((c) => c.id === id)!.pos });
  else ui.currentId = null;
}

let lastPull = 0;
async function refresh() {
  if (!sync.online || playing() || Date.now() - lastPull < 2000) return;
  lastPull = Date.now();
  await push(); // our own unsaved changes first
  try {
    const { lib, s } = await pull();
    if (!playing()) apply(lib, s);
  } catch {
    /* server gone for now: keep the local copy */
  }
}

export async function startSync() {
  let first: Awaited<ReturnType<typeof pull>>;
  try {
    first = await pull();
  } catch {
    return; // no lectern server: this browser's copy only
  }
  await until(() => library.loaded).toBe(true);
  sync.online = true;
  if (first.lib.initialized) {
    // A device joining for the first time keeps its own chapters: they are added to the shared
    // library rather than replaced by it. After that, the shared library is the truth.
    const joining = !localStorage.getItem("lectern.synced");
    const known = new Set(first.lib.chapters.map((c) => c.id));
    const mine = joining ? library.chapters.filter((c) => !known.has(c.id)) : [];
    apply(first.lib, first.s);
    if (mine.length) library.chapters.push(...mine); // uploaded by the watcher below
  } else {
    // the first device to connect brings its library and settings
    await putJson("library", library.chapters).catch(() => {});
    remember(library.chapters);
    sentSettings = "";
    if (first.s) apply({ chapters: library.chapters }, first.s);
  }
  localStorage.setItem("lectern.synced", "1");
  watchDebounced(() => library.chapters, push, { deep: true, debounce: 400 });
  watchDebounced(shared, push, { debounce: 500 });
  void push(); // chapters this device brought along
  // back on this device (other app, other tab, other window): pick up what changed elsewhere
  useEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  useEventListener(window, "focus", () => void refresh());
}
