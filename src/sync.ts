// Loading the shared library and settings from the murmur server, saving settings, and picking
// up what other devices changed when you come back to this one. Library changes are sent as
// they happen (library.ts); the engine follows another device's chapter and position itself.
import { useEventListener, watchDebounced } from "@vueuse/core";
import { flush, loadAllBodies, replaceLibrary } from "./library";
import { getJson, sendJson, sync } from "./lib/server";
import type { Library } from "./lib/ops";
import { loadSettings, settings, type Settings } from "./settings";

let saved = ""; // the settings as the server has them
let saving: Promise<void> = Promise.resolve();
const now = () => JSON.stringify(settings);

/** Save settings if they changed, one save at a time. Await it before a call that needs the
 * server's copy of a provider (its key). */
export function saveSettings(): Promise<void> {
  return (saving = saving.then(async () => {
    const j = now();
    if (j === saved) return;
    try {
      await sendJson("settings", JSON.parse(j));
      saved = j;
      sync.error = "";
    } catch (e) {
      sync.error = (e as Error).message;
    }
  }));
}

async function pull() {
  const [lib, s] = await Promise.all([
    getJson<Library>("library"),
    getJson<Partial<Settings> | null>("settings"),
  ]);
  replaceLibrary(lib);
  void loadAllBodies(); // the list is enough to start; the texts follow in the background
  if (now() === saved) {
    loadSettings(s); // unsaved edits here win; they are sent next
    saved = now();
  }
}

/** First load; the app starts once this resolves. Throws when the server cannot be reached. */
export async function startSync() {
  saved = now(); // nothing edited yet: the server's settings win
  await pull();
  watchDebounced(now, saveSettings, { debounce: 400 });
  let last = Date.now();
  const refresh = async () => {
    if (Date.now() - last < 2000) return;
    last = Date.now();
    await Promise.all([flush(), saveSettings()]); // ours first
    await pull().catch(() => {}); // server gone for now: keep what we have
  };
  // back on this device (other app, other tab, other window): pick up what changed elsewhere
  useEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  useEventListener(window, "focus", () => void refresh());
}
