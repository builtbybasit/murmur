// Generating whole chapters' audio in the background, and what the audio cache holds per book.
import { reactive, watch } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { settings } from "./settings";
import {
  library,
  docOf,
  hasBody,
  loadBodies,
  loadAllBodies,
  statsOf,
  type Chapter,
} from "./library";
import { player, recountUntimed, rescan } from "./engine";
import { align, audioSig, getAudio, keyOf, retrying, spoken, sttProvider } from "./synth";
import { toError } from "./lib/api";
import * as cache from "./lib/cache";
import type { Doc } from "./lib/segment";

/** Chapters whose audio is all generated, per device (its own cache): id -> audioSig. */
const readyMarks = useLocalStorage<Record<string, string>>("murmur.ready", {});

interface GenJob {
  state: "queued" | "running" | "failed";
  done: number; // segments ready (audio, and word timings when alignment is on)
  total: number;
  error: string;
}
/** Chapter id -> background job. Chapters run one at a time, in click order; finished jobs go. */
export const generating = reactive<Record<string, GenJob>>({});
const queue: string[] = [];
let running: { id: string; ac: AbortController } | null = null;

export const genState = (c: Chapter): GenJob["state"] | "done" | null =>
  generating[c.id]?.state ?? (readyMarks.value[c.id] === audioSig.value ? "done" : null);

const active = (id: string) =>
  generating[id]?.state === "queued" || generating[id]?.state === "running";

function stop(id: string) {
  const q = queue.indexOf(id);
  if (q >= 0) queue.splice(q, 1);
  if (running?.id === id) running.ac.abort();
  delete generating[id];
}

/** Start (or queue) generating a chapter's audio; on a queued/running chapter, stop it. */
export function toggleGenerate(id: string) {
  if (active(id)) return stop(id);
  generating[id] = { state: "queued", done: 0, total: 0, error: "" };
  queue.push(id);
  void genLoop();
}

/** Queue several chapters in order, skipping ones already queued or running; returns how many. */
export function generateMany(ids: string[]) {
  const todo = ids.filter((id) => !active(id));
  for (const id of todo) toggleGenerate(id);
  return todo.length;
}

// Voices or spoken text changed: the running chapter starts over with the new keys.
watch(audioSig, () => {
  if (!running) return;
  const { id, ac } = running;
  ac.abort();
  generating[id] = { state: "queued", done: 0, total: 0, error: "" };
  queue.unshift(id);
});
// Changed text (here or on another device): some segments need audio again. Compared by hash:
// a text arriving in the background (see loadBodies) is not a change.
// Deleted chapters: their jobs stop.
watch(
  () => library.chapters.map((c) => [c.id, statsOf(c).h] as const),
  (now, old) => {
    const was = new Map(old);
    for (const [id, h] of now) if (was.has(id) && was.get(id) !== h) delete readyMarks.value[id];
    const ids = new Set(now.map(([id]) => id));
    for (const id in generating) if (!ids.has(id)) stop(id);
  },
);

// All of the open chapter's audio is here (you listened through it, or it was generated while you
// played): it is done too, as if generated in the background.
watch(
  () => [player.chapter, player.cachedCount, player.spokenCount, player.untimedCount] as const,
  ([id, cached, spoken, untimed]) => {
    if (id && spoken && cached >= spoken && !(untimed && sttProvider()))
      readyMarks.value[id] = audioSig.value;
  },
);

async function genLoop() {
  if (running) return;
  while (queue.length) {
    const id = queue.shift()!;
    const c = library.chapters.find((c) => c.id === id);
    const j = generating[id];
    if (!c || !j) {
      delete generating[id];
      continue;
    }
    const ac = new AbortController();
    running = { id, ac };
    j.state = "running";
    try {
      await loadBodies([id]);
      if (!hasBody(c)) throw new Error("Couldn't load the chapter text");
      await genChapter(docOf(c), j, ac.signal);
      delete generating[id];
      readyMarks.value[id] = audioSig.value;
    } catch (e) {
      if (!ac.signal.aborted) {
        Object.assign(j, { state: "failed", error: toError(e).message });
        ac.abort(); // stops the other worker
      }
    }
    running = null;
    void recountUntimed(); // alignment failures in that chapter show in the reader
  }
}

async function genChapter(d: Doc, j: GenJob, signal: AbortSignal) {
  const keys = d.segs.map(keyOf);
  const have = await cache.getEntries(keys).catch(() => [] as (cache.CacheEntry | undefined)[]);
  j.total = d.segs.length;
  j.done = 0;
  const todo: number[] = [];
  d.segs.forEach((seg, i) => {
    const e = have[i];
    if (!spoken(seg) || (e && (e.stt || !sttProvider()))) j.done++;
    else todo.push(i);
  });
  let sttFails = 0;
  // two workers; the second rests while you listen, and both wait while playback is buffering
  const worker = async (k: number) => {
    for (;;) {
      await until(
        () => player.status !== "buffering" && !(k && player.status === "playing"),
        signal,
      );
      const i = todo.shift();
      if (i === undefined) return;
      const e = await retrying(() => getAudio(d.segs[i]!, signal), signal);
      const sp = sttProvider();
      if (sp && !e.stt && sttFails < 3)
        try {
          await align(keys[i]!, e, sp, settings.stt.model, signal);
          sttFails = 0;
        } catch (err) {
          if (signal.aborted) throw err;
          sttFails++; // alignment is a bonus: after 3 failures in a row, audio only
        }
      j.done++;
    }
  };
  await Promise.all([worker(0), worker(1)]);
}

/** Resolves once ok() is true; rejects when stopped. */
function until(ok: () => boolean, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (ok()) return Promise.resolve();
  return new Promise<void>((res, rej) => {
    const stop = watch(ok, (v) => v && (stop(), res()));
    signal.addEventListener("abort", () => (stop(), rej(signal.reason)), { once: true });
  });
}

// ---------- word timings for audio made while STT was off or failing ----------

/** The alignment job: chapters (in list order), progress, and why it stopped early. */
export const timing = reactive({
  running: false,
  ids: [] as string[],
  done: 0,
  total: 0,
  error: "",
});
let timingAc: AbortController | null = null;

/**
 * Get word timings for these chapters' cached segments that have none. One segment at a time,
 * pausing while playback buffers; stops after 3 failures in a row. Called while running: stops.
 */
export async function alignMissing(ids: string[]) {
  if (timingAc) return timingAc.abort();
  const sp = sttProvider();
  if (!sp) return;
  const ac = (timingAc = new AbortController());
  Object.assign(timing, { running: true, ids, done: 0, total: 0, error: "" });
  try {
    await loadBodies(ids);
    const todo = new Set<string>(); // keys; a line repeated across chapters is aligned once
    for (const id of ids) {
      const c = library.chapters.find((c) => c.id === id);
      if (!hasBody(c)) continue;
      const keys = docOf(c).segs.filter(spoken).map(keyOf);
      const es = await cache.getEntries(keys);
      es.forEach((e, i) => e && !e.stt && todo.add(keys[i]!));
    }
    timing.total = todo.size;
    let fails = 0;
    for (const k of todo) {
      await until(() => player.status !== "buffering", ac.signal);
      const e = await cache.getEntry(k);
      if (e && !e.stt)
        try {
          await align(k, e, sp, settings.stt.model, ac.signal); // onCached tells the engine
          fails = 0;
        } catch (err) {
          if (ac.signal.aborted) throw err;
          if (++fails >= 3) {
            timing.error = `${sp.name}: ${toError(err).message}`;
            break;
          }
        }
      timing.done++;
    }
  } catch {
    // stopped
  } finally {
    timingAc = null;
    timing.running = false;
    void recountUntimed();
  }
}

// ---------- storage by book ----------

export interface BookStorage {
  book: string; // "" = loose chapters
  chapters: number;
  segments: number;
  cached: number;
  bytes: number;
  keys: string[];
}
/**
 * Cached audio per book for the current voices, plus "other" audio: old voices, old
 * spoken-text rules and deleted chapters (nothing in the library would play it).
 */
export async function storageByBook(): Promise<{
  books: BookStorage[];
  other: { segments: number; bytes: number; keys: string[] };
  /** segments of the library with audio here but no word timings */
  untimed: number;
}> {
  await loadAllBodies(); // every chapter's segments are needed
  const all = await cache.sizes();
  const size = new Map(all.map(([k, n]) => [k, n]));
  const timed = new Set(all.filter((x) => x[2]).map(([k]) => k));
  let untimed = 0;
  const byBook = new Map<string, BookStorage>();
  const used = new Set<string>();
  for (const c of library.chapters) {
    const book = c.book ?? "";
    let b = byBook.get(book);
    if (!b)
      byBook.set(book, (b = { book, chapters: 0, segments: 0, cached: 0, bytes: 0, keys: [] }));
    b.chapters++;
    if (!hasBody(c)) continue;
    for (const seg of docOf(c).segs) {
      if (!spoken(seg)) continue;
      const k = keyOf(seg);
      b.segments++;
      if (!size.has(k) || used.has(k)) continue; // a repeated line is counted once
      used.add(k);
      if (!timed.has(k)) untimed++;
      b.cached++;
      b.bytes += size.get(k)!;
      b.keys.push(k);
    }
  }
  const other = [...size].filter(([k]) => !used.has(k));
  return {
    books: [...byBook.values()],
    other: {
      segments: other.length,
      bytes: other.reduce((n, [, v]) => n + v, 0),
      keys: other.map(([k]) => k),
    },
    untimed,
  };
}

/** Delete cached audio by key; a book's chapters lose their "fully generated" mark. */
export async function dropAudio(keys: string[], book?: string) {
  await cache.dropEntries(keys);
  if (book !== undefined)
    for (const c of library.chapters) if ((c.book ?? "") === book) delete readyMarks.value[c.id];
  rescan();
}

export async function clearCache() {
  await cache.clearAll();
  readyMarks.value = {};
  rescan();
}
