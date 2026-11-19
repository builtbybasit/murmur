// Playback engine: plays the open chapter segment by segment, fetching ahead, aligning words with
// STT, retrying failures, and fetching the next chapter's start near the end. Audio: synth.ts.
// CONTRACT: UI components only read `player` and call the exported functions below.
import { computed, reactive, watch } from "vue";
import { settings, voiceFor, hasTts, type Provider } from "./settings";
import { library, currentDoc, docOf, setPosition, CHARS_PER_SEC } from "./library";
import { ui, toast } from "./ui";
import type { Doc } from "./lib/segment";
import { MAX_RETRIES, retryDelay, toError, type ErrorCode, type ProviderError } from "./lib/api";
import { alignWords, estimateTimes, type Span } from "./lib/align";
import * as cache from "./lib/cache";
import {
  align,
  audioSig,
  getAudio,
  keyOf,
  onCached,
  retrying,
  spoken,
  sttProvider,
  SILENCE,
  type CacheEntry,
} from "./synth";

export type Status = "idle" | "buffering" | "playing" | "paused" | "error" | "ended";
type SegState = "loading" | "ready" | "failed";
interface PlayerError {
  seg: number;
  code: ErrorCode;
  status: number;
  message: string;
  providerId: string | null;
  attempt: number; // automatic retry number scheduled or last run (1..maxAttempts); 0 = none
  maxAttempts: number;
  retryAt: number | null; // epoch ms of the next automatic retry
  gaveUp: boolean; // automatic retries exhausted
  retrying: boolean; // a retry request is in flight right now
}
interface SttState {
  failing: boolean;
  fails: number; // failures in a row
  paused: boolean; // alignment paused for this chapter
  message: string; // e.g. "Local STT failed on 3 segments (HTTP 500)"
}
interface Player {
  status: Status;
  started: boolean; // playback has started in this chapter (reader shows band/word only then)
  seg: number; // current segment index in currentDoc
  word: number; // current word index in segs[seg].words, -1 = none
  timing: "aligned" | "estimated"; // for the current segment
  segState: Record<number, SegState>; // current chapter; 'ready' = audio available
  elapsed: number; // seconds into the chapter (known durations + estimates), at 1.0x
  total: number; // estimated chapter length in seconds at 1.0x
  totalExact: boolean; // true once every segment's duration is known
  cachedCount: number; // segments of this chapter with audio ready
  readonly error: PlayerError | null; // provider error at the current segment, else null
  skipped: Record<number, true>; // failed segments the user skipped
  stt: SttState;
}

const freshStt = (): SttState => ({ failing: false, fails: 0, paused: false, message: "" });
/** Failed segments of the open chapter. */
const fails = reactive<Record<number, PlayerError>>({});
export const player = reactive<Player>({
  status: "idle",
  started: false,
  seg: 0,
  word: -1,
  timing: "estimated",
  segState: {},
  elapsed: 0,
  total: 0,
  totalExact: false,
  cachedCount: 0,
  get error() {
    return fails[this.seg] ?? null;
  },
  skipped: {},
  stt: freshStt(),
});

const MAX_JOBS = 2; // concurrent segment requests (cache reads included, they are quick)

interface Mem {
  key: string;
  entry: CacheEntry;
  url: string;
  times: Span[] | null; // aligned
  est?: Span[];
}

let audio: HTMLAudioElement | null = null;
let chId: string | null = null;
let doc: Doc | null = null;
let gen = 0; // bumped on every reset; async work from an older generation is dropped
let wantPlay = false;
let ended = false;
let loaded = -1; // segment whose audio is in the element
let streamed = false; // the element plays /relay/stream/<id>, the full blob may not be here yet
let streamTimes: Span[] = []; // estimated word times while streaming
let startWord = 0; // word to start from when the current segment's audio arrives
let raf = 0;
let keys: string[] = []; // cache key per segment, for the current voices
const mem = new Map<number, Mem>(); // decoded-ready audio around the playhead
const jobs = new Map<number, AbortController>(); // in-flight cache reads / TTS (and retry waits)
let durs: (number | undefined)[] = [];
let sttJob: { i: number; ac: AbortController } | null = null;
const sttTried = new Set<number>(); // STT never retries a segment on its own

const noop = () => {};
const segs = () => doc?.segs ?? [];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v || 0));
const estDur = (i: number) => durs[i] ?? segs()[i]!.core.length / CHARS_PER_SEC;
const before = (i: number) => {
  let s = 0;
  for (let j = 0; j < i; j++) s += estDur(j);
  return s;
};
const timesOf = (i: number, m: Mem) =>
  m.times ?? (m.est ??= estimateTimes(segs()[i]!, m.entry.duration));
const chapterAfter = (id: string | null, delta: number) => {
  const i = library.chapters.findIndex((c) => c.id === id);
  return i < 0 ? null : (library.chapters[i + delta] ?? null);
};
/** The chapter after the open one, or null. */
export const upNext = computed(() => chapterAfter(ui.currentId, 1));

function el() {
  if (audio) return audio;
  const a = (audio = new Audio());
  a.preservesPitch = true;
  a.addEventListener("playing", () => {
    refreshStatus();
    if (!raf) raf = requestAnimationFrame(loop);
  });
  a.addEventListener("pause", () => {
    // paused from outside (OS media keys, headphones unplugged)
    if (wantPlay && loaded >= 0 && a.paused && !a.ended) {
      wantPlay = false;
      savePos();
    }
    refreshStatus();
  });
  a.addEventListener("ended", advance);
  a.addEventListener("error", () => {
    const i = loaded;
    if (i < 0) return;
    if (streamed) {
      // the browser could not play the stream: the downloaded blob takes over from this word
      startWord = Math.max(0, player.word);
      stopAudio();
      return kick();
    }
    const m = mem.get(i);
    stopAudio();
    if (m) {
      cache.dropEntry(m.key).catch(noop);
      URL.revokeObjectURL(m.url);
      mem.delete(i);
      durs[i] = undefined;
    }
    const message = "The audio for this segment could not be played";
    setFail(i, { code: "http", status: 0, message, retryAfter: null }, 0, null);
    updateTotals();
  });
  return a;
}

function stopAudio() {
  loaded = -1;
  streamed = false;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function savePos() {
  if (chId && doc) setPosition(chId, player.seg);
}

function updateTotals() {
  const n = segs().length;
  let t = 0;
  let exact = true;
  for (let i = 0; i < n; i++) {
    t += estDur(i);
    exact &&= durs[i] != null;
  }
  player.total = t;
  player.totalExact = n > 0 && exact;
  player.cachedCount = Object.values(player.segState).filter((s) => s === "ready").length;
}

function refreshStatus() {
  if (!doc) player.status = "idle";
  else if (fails[player.seg]) player.status = "error";
  else if (ended) player.status = "ended";
  else if (wantPlay)
    player.status =
      gap || (loaded === player.seg && audio && !audio.paused) ? "playing" : "buffering";
  else player.status = player.started ? "paused" : "idle";
}

function update() {
  const i = player.seg;
  const m = mem.get(i);
  const t = loaded === i && audio ? audio.currentTime : 0;
  const ts = loaded !== i ? null : m ? timesOf(i, m) : streamed ? streamTimes : null;
  if (ts) {
    let w = 0;
    while (w + 1 < ts.length && ts[w + 1]!.start <= t) w++;
    player.word = ts.length ? w : -1;
  }
  player.timing = m?.times ? "aligned" : "estimated";
  player.elapsed = before(i) + t;
}

function loop() {
  update();
  raf = audio && !audio.paused ? requestAnimationFrame(loop) : 0;
}

/** Throw away all per-chapter work. keep = segment whose loaded audio may keep playing. */
function resetWork(keep = -1) {
  gen++;
  for (const ac of jobs.values()) ac.abort();
  jobs.clear();
  for (const k in fails) delete fails[k];
  sttJob?.ac.abort();
  sttJob = null;
  sttTried.clear();
  for (const [i, m] of mem)
    if (i !== keep) {
      URL.revokeObjectURL(m.url);
      mem.delete(i);
    }
  durs = [];
  player.segState = {};
  player.skipped = {};
}

/** Read which segments are cached (and their durations) for the current chapter and voices. */
async function scan() {
  const g = gen;
  keys = segs().map(keyOf);
  const es = await cache.getEntries(keys).catch(() => [] as (CacheEntry | undefined)[]);
  if (g !== gen) return;
  segs().forEach((seg, i) => {
    const d = spoken(seg) ? es[i]?.duration : SILENCE; // nothing to say: always ready
    if (d == null) return;
    durs[i] = d;
    player.segState[i] ??= "ready";
  });
  updateTotals();
  kick();
}

// Audio cached elsewhere (background generation, next-chapter prefetch, alignment) for this chapter.
onCached((key, e) => {
  let hit = false;
  keys.forEach((k, i) => {
    if (k !== key) return;
    hit = true;
    durs[i] = e.duration;
    player.segState[i] ??= "ready";
    const m = mem.get(i);
    if (m && e.stt?.length && !m.times) {
      m.entry.stt = e.stt;
      m.times = alignWords(segs()[i]!.words, e.stt, m.entry.duration);
    }
  });
  if (hit) updateTotals();
  if (hit) update();
});

function load(
  id: string | null,
  o: { seg?: number; autoplay?: boolean; keepStarted?: boolean } = {},
) {
  endGap(false);
  stopAhead(id); // opening the prefetched chapter lets it finish
  if (id !== chId) player.stt = freshStt();
  wantPlay = false;
  ended = false;
  stopAudio();
  resetWork();
  chId = id;
  const c = library.chapters.find((c) => c.id === id);
  doc = c ? docOf(c) : null;
  const n = segs().length;
  Object.assign(player, {
    started: !!o.keepStarted && player.started,
    seg: clamp(o.seg ?? library.positions[id ?? ""] ?? 0, 0, Math.max(0, n - 1)),
    word: -1,
    timing: "estimated",
    elapsed: 0,
  });
  startWord = 0;
  updateTotals();
  player.elapsed = doc ? before(player.seg) : 0;
  refreshStatus();
  if (!doc) return;
  savePos(); // other devices open this chapter too
  void scan();
  if (o.autoplay) play();
}

/** Drop work outside the window [seg, seg + prefetch]; keep skipped failures (their red mark stays). */
function prune() {
  const lo = player.seg;
  const hi = lo + settings.prefetch;
  const out = (i: number) => i < lo || i > hi;
  for (const [i, ac] of jobs)
    if (out(i)) {
      ac.abort();
      jobs.delete(i);
      if (player.segState[i] === "loading") delete player.segState[i];
    }
  for (const k in fails) {
    const i = +k;
    if (out(i) && !player.skipped[i]) {
      delete fails[i];
      if (player.segState[i] === "failed") delete player.segState[i];
    }
  }
  for (const [i, m] of mem)
    if ((i < lo - 1 || i > hi + 1) && i !== loaded) {
      URL.revokeObjectURL(m.url);
      mem.delete(i);
    }
  if (sttJob && out(sttJob.i)) {
    sttTried.delete(sttJob.i);
    sttJob.ac.abort();
    sttJob = null;
  }
}

/** Start requests for the window, nearest first, bounded. Stops at a failed segment. */
function pump() {
  if (!doc || !player.started) return;
  const hi = Math.min(segs().length - 1, player.seg + settings.prefetch);
  for (let i = player.seg; i <= hi && jobs.size < MAX_JOBS; i++) {
    if (mem.has(i) || (player.skipped[i] && i !== player.seg)) continue;
    if (fails[i]) break;
    if (!jobs.has(i)) fetchSeg(i);
  }
}

/** Make the playhead move if it can, and keep the background work going. */
function kick() {
  if (!doc) return;
  pump();
  const i = player.seg;
  const m = mem.get(i);
  if (wantPlay && m && !fails[i] && loaded !== i) startAudio(i, m);
  refreshStatus();
  pumpStt();
  void prefetchNext();
}

// Next chapter: near the end of this one, its first segments go into the cache, one at a time,
// so it starts without a wait. They play from the cache when it opens.
let ahead: { id: string; ac: AbortController } | null = null;
async function prefetchNext() {
  const c = upNext.value;
  if (!wantPlay || !c || ahead?.id === c.id || player.seg + settings.prefetch < segs().length - 1)
    return;
  stopAhead();
  const ac = new AbortController();
  ahead = { id: c.id, ac };
  try {
    for (const seg of docOf(c).segs.slice(0, Math.max(1, settings.prefetch)))
      await getAudio(seg, ac.signal);
  } catch {} // stopped or failing: the chapter fetches (and reports) it itself when it opens
}
function stopAhead(keep?: string | null) {
  if (ahead && ahead.id !== keep) {
    ahead.ac.abort();
    ahead = null;
  }
}

function startAudio(i: number, m: Mem) {
  const a = el();
  loaded = i;
  streamed = false;
  a.src = m.url;
  a.defaultPlaybackRate = a.playbackRate = settings.speed; // load() resets playbackRate
  a.preservesPitch = true;
  a.currentTime = timesOf(i, m)[startWord]?.start ?? 0;
  startWord = 0;
  playEl(a);
}

/** Play segment i while it is still being generated (see the relay in dev/server.ts). */
function startStream(i: number, id: string) {
  const a = el();
  loaded = i;
  streamed = true;
  streamTimes = estimateTimes(segs()[i]!, estDur(i));
  a.src = "/relay/stream/" + id;
  a.defaultPlaybackRate = a.playbackRate = settings.speed;
  a.preservesPitch = true;
  playEl(a);
}

function playEl(a: HTMLAudioElement) {
  a.play().catch((e: Error) => {
    if (e.name !== "NotAllowedError") return; // AbortError: src changed under us
    wantPlay = false;
    refreshStatus();
  });
}

/** Get segment i's audio, retrying on its own (the error bar counts down) until it gives up. */
function fetchSeg(i: number) {
  const seg = segs()[i]!;
  const ac = new AbortController();
  jobs.set(i, ac);
  let tries = 0;
  const get = () => {
    const f = fails[i];
    if (f) Object.assign(f, { retryAt: null, retrying: true });
    if (player.segState[i] !== "ready") player.segState[i] = "loading";
    refreshStatus();
    // wanted right now and nothing plays: listen while it is generated
    const live = i === player.seg && wantPlay && !startWord && loaded < 0 && !gap;
    const onStream = (id: string) => void (!ac.signal.aborted && startStream(i, id));
    return getAudio(seg, ac.signal, live ? onStream : undefined);
  };
  const wait = (e: ProviderError, n: number, sec: number) => {
    tries = n + 1;
    setFail(i, e, tries, Date.now() + sec * 1000);
  };
  retrying(get, ac.signal, wait).then(
    (e) => {
      if (ac.signal.aborted) return;
      jobs.delete(i);
      remember(i, e);
      kick();
    },
    (err) => {
      if (ac.signal.aborted) return;
      jobs.delete(i);
      setFail(i, toError(err), tries, null);
      kick();
    },
  );
}

function remember(i: number, e: CacheEntry) {
  const old = mem.get(i);
  if (old) URL.revokeObjectURL(old.url);
  mem.set(i, {
    key: keys[i]!,
    entry: e,
    url: URL.createObjectURL(e.blob),
    times: e.stt?.length ? alignWords(segs()[i]!.words, e.stt, e.duration) : null,
  });
  durs[i] = e.duration;
  player.segState[i] = "ready";
  delete fails[i];
  delete player.skipped[i];
  updateTotals();
}

/** Segment i failed; retryAt: when the automatic retry runs (null: none planned). */
function setFail(i: number, e: ProviderError, attempt: number, retryAt: number | null) {
  if (i === loaded && streamed) stopAudio(); // its stream will never finish
  fails[i] = {
    seg: i,
    code: e.code,
    status: e.status,
    message: e.message,
    providerId: voiceFor(segs()[i]!.kind).provider?.id ?? null,
    attempt,
    maxAttempts: MAX_RETRIES,
    retryAt,
    gaveUp: !retryAt && retryDelay(e, 0) != null,
    retrying: false,
  };
  player.segState[i] = "failed";
  refreshStatus();
}

/** Move the playhead to segment i, word w. Keeps the play/pause intent. */
function go(i: number, w = 0) {
  endGap(false);
  ended = false;
  const m = mem.get(i);
  // a stream cannot seek: the blob plays from the word once it is here
  if (loaded >= 0 && (loaded !== i || streamed)) stopAudio();
  player.seg = i;
  player.word = w;
  startWord = w;
  player.timing = m?.times ? "aligned" : "estimated";
  if (loaded === i && m && audio) {
    audio.currentTime = timesOf(i, m)[w]?.start ?? 0;
    startWord = 0;
    if (wantPlay && audio.paused) audio.play().catch(noop);
  }
  player.elapsed = before(i) + (loaded === i && audio ? audio.currentTime : 0);
  savePos();
  prune();
  kick();
}

// Pause between segments: the next segment waits gap ms (scaled by speed) after one ends.
let gap: { timer: ReturnType<typeof setTimeout>; next: number } | null = null;
function endGap(move: boolean) {
  if (!gap) return;
  clearTimeout(gap.timer);
  const n = gap.next;
  gap = null;
  if (move) go(n);
}

function advance() {
  const n = segs().length;
  let i = player.seg + 1;
  while (i < n && player.skipped[i]) i++;
  if (i < n) {
    const newPara = segs()[i]!.para !== segs()[player.seg]!.para;
    const ms = (newPara ? settings.paragraphGap : settings.segmentGap) / settings.speed;
    if (ms <= 0) return go(i);
    gap = { timer: setTimeout(() => endGap(true), ms), next: i };
    kick(); // keeps fetching ahead during the pause
    return;
  }
  const next = upNext.value;
  const stop = stopAtChapterEnd();
  if (next && !stop) return open(next.id, { autoplay: true, seg: 0 });
  if (next) {
    open(next.id, { seg: 0 }); // ready at the next chapter, paused
    return toast({ title: "Sleep timer: stopped at the end of the chapter" });
  }
  stopAudio();
  wantPlay = false;
  ended = true;
  savePos();
  refreshStatus();
  toast({ title: "End of the list", sub: "Paste the next chapter with ⌘V to keep listening" });
}

// ---------- STT ----------

function pumpStt() {
  if (sttJob || !doc || !player.started || player.stt.paused) return;
  const prov = sttProvider();
  if (!prov) return;
  const hi = Math.min(segs().length - 1, player.seg + settings.prefetch);
  for (let i = player.seg; i <= hi; i++) {
    const m = mem.get(i);
    if (m && !m.entry.stt && !sttTried.has(i)) return void runStt(i, m, prov);
  }
}

async function runStt(i: number, m: Mem, prov: Provider) {
  sttTried.add(i);
  const g = gen;
  const ac = new AbortController();
  sttJob = { i, ac };
  try {
    await align(m.key, m.entry, prov, settings.stt.model, ac.signal); // onCached sets the times
    if (g === gen) player.stt = freshStt();
  } catch (err) {
    if (ac.signal.aborted || g !== gen) return;
    const e = toError(err);
    const st = player.stt;
    st.fails++;
    st.failing = true;
    st.paused = st.fails >= 3;
    st.message = `${prov.name} failed on ${st.fails} segment${st.fails > 1 ? "s" : ""} (${e.status ? "HTTP " + e.status : e.message})`;
  } finally {
    if (sttJob?.ac === ac) sttJob = null;
    if (g === gen) pumpStt();
  }
}

// ---------- watchers ----------

// The open chapter is ui.currentId (open() sets it); a new doc for it (text edited, quote rule
// toggled) reloads in place.
let opening: { id: string; seg?: number; autoplay?: boolean } | null = null;
const takeOpening = (id: string | null) => {
  const o = opening?.id === id ? opening : {};
  opening = null;
  return o;
};
watch(
  [() => ui.currentId, currentDoc],
  ([id, d]) => {
    if (id !== chId) load(id, takeOpening(id));
    else if (d !== doc) load(id, { seg: player.seg, autoplay: wantPlay, keepStarted: true });
  },
  { immediate: true },
);
// Another device moved on (seen when you come back to this one): follow it unless playing here.
watch(
  () => [library.currentId, library.positions[library.currentId ?? ""]] as const,
  ([id, seg]) => {
    if (!id || wantPlay || !library.chapters.some((c) => c.id === id)) return;
    if (id !== chId) open(id);
    else if (seg != null && seg !== player.seg) seek(seg, 0, { play: false });
  },
);
// Voices or spoken text changed: cache keys changed. The segment already playing finishes as it is.
watch(audioSig, () => rescan());
watch(
  () => settings.speed,
  (v) => audio && (audio.defaultPlaybackRate = audio.playbackRate = v),
);
watch(
  () => settings.prefetch,
  () => (prune(), kick()),
);
watch(
  () => [settings.stt.enabled, settings.stt.providerId, settings.stt.model].join("|"),
  () => {
    sttJob?.ac.abort();
    sttJob = null;
    sttTried.clear();
    player.stt = freshStt();
    pumpStt();
  },
);

/** Cache keys changed or audio was deleted: look at the cache again. */
export function rescan() {
  stopAhead();
  if (!doc) return;
  resetWork(loaded);
  void scan();
  kick();
}

// ---------- sleep timer ----------

/** mode "time": `left` ms of listening remain (it only counts while playing); "chapter": stop at its end. */
export const sleepTimer = reactive({ mode: null as null | "chapter" | "time", left: 0 });
const FADE_MS = 8000;
let sleepTick: ReturnType<typeof setInterval> | undefined;

/** null = off, "chapter" = at the end of this chapter, a number = minutes of listening. */
export function setSleep(mode: null | "chapter" | number) {
  clearInterval(sleepTick);
  if (audio) audio.volume = 1;
  sleepTimer.mode = mode === null ? null : mode === "chapter" ? "chapter" : "time";
  sleepTimer.left = typeof mode === "number" ? mode * 60_000 : 0;
  if (typeof mode !== "number") return;
  sleepTick = setInterval(() => {
    if (player.status !== "playing" && player.status !== "buffering") return;
    sleepTimer.left -= 1000;
    if (audio) audio.volume = clamp(sleepTimer.left / FADE_MS, 0, 1); // fade out at the end
    if (sleepTimer.left > 0) return;
    pause();
    setSleep(null);
    toast({ title: "Sleep timer: paused", sub: "Press play to continue" });
  }, 1000);
}

/** At a chapter's end: true when the sleep timer says stop here (it turns itself off). */
function stopAtChapterEnd() {
  if (sleepTimer.mode !== "chapter") return false;
  setSleep(null);
  return true;
}

// ---------- public API ----------

/** Play. Does nothing without a TTS provider (the caller shows where to add one). */
export function play() {
  if (!doc || !hasTts.value) return;
  if (ended) {
    ended = false;
    const next = upNext.value; // pasted since we stopped
    return next ? open(next.id, { autoplay: true, seg: 0 }) : seek(0);
  }
  if (fails[player.seg]) return retry();
  wantPlay = true;
  player.started = true;
  if (loaded === player.seg) el().play().catch(noop);
  kick();
}

export function pause() {
  endGap(true); // paused during a gap: land on the next segment, not replay the last one
  wantPlay = false;
  audio?.pause();
  savePos();
  refreshStatus();
}

/** play/pause; retry when stopped on an error */
export function toggle() {
  if (player.status === "error") retry();
  else if (wantPlay) pause();
  else play();
}

/** Jump to a segment (and word within it). play:false keeps the current play/pause state. */
export function seek(seg: number, word = 0, { play: autoplay = true }: { play?: boolean } = {}) {
  if (!doc) return;
  go(clamp(seg, 0, segs().length - 1), Math.max(0, word));
  if (autoplay && !wantPlay) play();
}

/** Jump to the segment playing `t` seconds into the chapter (at 1.0x). */
export function seekTime(t: number) {
  let i = 0;
  while (i < segs().length - 1 && t >= estDur(i)) t -= estDur(i++);
  seek(i, 0, { play: false });
}

export function next() {
  if (player.seg + 1 < segs().length) seek(player.seg + 1, 0, { play: false });
  else nextChapter();
}

/** restarts the current segment if > 1.5 s in */
export function prev() {
  if (loaded === player.seg && audio && audio.currentTime > 1.5)
    seek(player.seg, 0, { play: false });
  else seek(Math.max(0, player.seg - 1), 0, { play: false });
}

export function nextPara() {
  if (!doc) return;
  const p = doc.paras[segs()[player.seg]!.para + 1];
  if (p) seek(p[0]!, 0, { play: false });
}

/** start of this paragraph, or the previous one when already at its start */
export function prevPara() {
  if (!doc) return;
  const pi = segs()[player.seg]!.para;
  const here = doc.paras[pi]![0]!;
  const atStart = player.seg === here && !(loaded === here && audio && audio.currentTime > 1.5);
  seek(atStart && pi > 0 ? doc.paras[pi - 1]![0]! : here, 0, { play: false });
}

export function nextChapter() {
  const c = upNext.value;
  if (c) open(c.id, { autoplay: wantPlay });
}
export function prevChapter() {
  const c = chapterAfter(ui.currentId, -1);
  if (c) open(c.id, { autoplay: wantPlay });
}

/** Open a chapter (at its saved position, or `seg`): it becomes ui.currentId. */
export function open(
  id: string,
  { autoplay = false, seg }: { autoplay?: boolean; seg?: number } = {},
) {
  if (id === chId && doc) {
    if (seg != null) seek(seg, 0, { play: autoplay });
    else if (autoplay) play();
    return;
  }
  opening = { id, seg, autoplay };
  if (ui.currentId === id) load(id, takeOpening(id));
  else ui.currentId = id; // the watcher above loads it
}

/** retry the failed segment now */
export function retry() {
  const i = player.seg;
  const f = fails[i];
  if (!f) return;
  jobs.get(i)?.abort();
  jobs.delete(i);
  Object.assign(f, { attempt: 0, gaveUp: false }); // a manual retry restarts the automatic schedule
  wantPlay = true;
  player.started = true;
  ended = false;
  fetchSeg(i);
}

/** skip the failed segment */
export function skip() {
  const i = player.seg;
  const f = fails[i];
  if (f) {
    jobs.get(i)?.abort();
    jobs.delete(i);
    Object.assign(f, { retryAt: null, retrying: false });
    player.segState[i] = "failed";
    player.skipped[i] = true;
  }
  wantPlay = true;
  player.started = true;
  advance();
}

export function retryAlignment() {
  player.stt = freshStt();
  sttTried.clear();
  pumpStt();
}

/** 0.5..3.0, step 0.1, persisted in settings.speed */
export function setSpeed(v: number) {
  settings.speed = Math.round(clamp(v, 0.5, 3) * 10) / 10;
}
