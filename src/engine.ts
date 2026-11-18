// Playback engine: TTS per segment with prefetch, audio cache, STT alignment, retries.
// CONTRACT: UI components only read `player` and call the exported functions below.
import { reactive, watch } from "vue";
import {
  settings,
  ui,
  library,
  currentDoc,
  docOf,
  voiceFor,
  providerById,
  CHARS_PER_SEC,
  toast,
  type Provider,
  type Role,
} from "./store";
import type { Doc } from "./lib/segment";
import { tts, stt as transcribe, ApiError, type ErrorCode, type ProviderError } from "./lib/api";
import { alignWords, estimateTimes, type Span, type SttWord } from "./lib/align";
import * as cache from "./lib/cache";

export type Status = "idle" | "buffering" | "playing" | "paused" | "error" | "ended";
export type SegState = "loading" | "ready" | "failed";
export interface PlayerError {
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
export interface SttState {
  failing: boolean;
  fails: number; // failures in a row
  paused: boolean; // alignment paused for this chapter
  message: string; // e.g. "Local STT failed on 3 segments (HTTP 500)"
}
export interface Player {
  status: Status;
  started: boolean; // playback has started in this chapter (reader shows band/word only then)
  seg: number; // current segment index in currentDoc
  word: number; // current word index in segs[seg].words, -1 = none
  timing: "aligned" | "estimated"; // for the current segment
  segState: Record<number, SegState>; // current chapter; 'ready' = audio cached
  aligned: Record<number, true>; // segments that have STT word timings
  elapsed: number; // seconds into the chapter (known durations + estimates), at 1.0x
  total: number; // estimated chapter length in seconds at 1.0x
  totalExact: boolean; // true once every segment's duration is known
  cachedCount: number; // segments of this chapter already in the cache
  error: PlayerError | null; // provider error at the current segment, else null
  skipped: Record<number, true>; // failed segments the user skipped
  stt: SttState;
}
export type { ProviderError };
export { ApiError };

const freshStt = (): SttState => ({ failing: false, fails: 0, paused: false, message: "" });
export const player = reactive<Player>({
  status: "idle",
  started: false,
  seg: 0,
  word: -1,
  timing: "estimated",
  segState: {},
  aligned: {},
  elapsed: 0,
  total: 0,
  totalExact: false,
  cachedCount: 0,
  error: null,
  skipped: {},
  stt: freshStt(),
});

const MAX_JOBS = 2; // concurrent segment requests (cache reads included, they are quick)
const MAX_RETRIES = 3;
const RATE_DELAYS = [6, 12, 24];
const NET_DELAYS = [4, 8, 16];
export const PREVIEW_TEXT = "The tide came in twice that night, and only one of us noticed.";

interface Mem {
  key: string;
  blob: Blob;
  url: string;
  duration: number;
  stt: SttWord[] | null;
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
let startWord = 0; // word to start from when the current segment's audio arrives
let raf = 0;
const mem = new Map<number, Mem>(); // decoded-ready audio around the playhead
const jobs = new Map<number, AbortController>(); // in-flight cache reads / TTS
const fails: Record<number, PlayerError> = {};
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const cached = new Set<number>(); // segments known to be in the cache
let durs: (number | undefined)[] = [];
let sttJob: { i: number; ac: AbortController } | null = null;
const sttTried = new Set<number>(); // STT never retries a segment on its own

const noop = () => {};
const segs = () => doc?.segs ?? [];
const chapter = () => library.chapters.find((c) => c.id === chId) ?? null;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v || 0));
const estDur = (i: number) => durs[i] ?? segs()[i]!.core.length / CHARS_PER_SEC;
const before = (i: number) => {
  let s = 0;
  for (let j = 0; j < i; j++) s += estDur(j);
  return s;
};
const keyFor = (i: number) => {
  const seg = segs()[i]!;
  const v = voiceFor(seg.kind);
  return cache.cacheKey(v.provider?.baseUrl ?? "", v.model, v.voice, seg.core);
};
const timesOf = (i: number, m: Mem) => m.times ?? (m.est ??= estimateTimes(segs()[i]!, m.duration));
const toPlain = (e: unknown): ProviderError =>
  e instanceof ApiError
    ? e.plain()
    : { code: "network", status: 0, message: String((e as Error)?.message ?? e), retryAfter: null };

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
    const m = mem.get(i);
    stopAudio();
    if (m) {
      cache.dropEntry(m.key).catch(noop);
      URL.revokeObjectURL(m.url);
      mem.delete(i);
      cached.delete(i);
      durs[i] = undefined;
    }
    fail(
      i,
      new ApiError({
        code: "http",
        status: 0,
        message: "The audio for this segment could not be played",
        retryAfter: null,
      }),
    );
  });
  return a;
}

let actx: OfflineAudioContext | null = null;
async function durationOf(blob: Blob) {
  try {
    actx ??= new OfflineAudioContext(1, 1, 44100);
    return (await actx.decodeAudioData(await blob.arrayBuffer())).duration;
  } catch {
    return null;
  }
}

function stopAudio() {
  loaded = -1;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function savePos() {
  const c = chapter();
  if (c && doc && c.pos !== player.seg) c.pos = player.seg;
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
  player.cachedCount = cached.size;
}

function refreshStatus() {
  const f = fails[player.seg];
  player.error = f ? { ...f } : null;
  if (!doc) player.status = "idle";
  else if (f) player.status = "error";
  else if (ended) player.status = "ended";
  else if (wantPlay)
    player.status = loaded === player.seg && audio && !audio.paused ? "playing" : "buffering";
  else player.status = player.started ? "paused" : "idle";
}

function update() {
  const i = player.seg;
  const m = mem.get(i);
  const t = loaded === i && audio ? audio.currentTime : 0;
  if (m && loaded === i) {
    const ts = timesOf(i, m);
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
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
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
  cached.clear();
  player.segState = {};
  player.aligned = {};
  player.skipped = {};
}

/** Read which segments are cached (and their durations) for the current chapter and voices. */
async function scan() {
  const g = gen;
  const n = segs().length;
  const keys = Array.from({ length: n }, (_, i) => keyFor(i));
  const es = await cache.getEntries(keys).catch(() => [] as (cache.CacheEntry | undefined)[]);
  if (g !== gen) return;
  es.forEach((e, i) => {
    if (!e) return;
    cached.add(i);
    durs[i] = e.duration;
    player.segState[i] ??= "ready";
    if (e.stt) player.aligned[i] = true;
  });
  updateTotals();
  kick();
}

function load(
  id: string | null,
  o: { seg?: number; autoplay?: boolean; keepStarted?: boolean } = {},
) {
  const same = id === chId;
  wantPlay = false;
  ended = false;
  stopAudio();
  resetWork();
  chId = id;
  const c = chapter();
  doc = c ? docOf(c) : null;
  const n = segs().length;
  Object.assign(player, {
    started: !!o.keepStarted && player.started,
    seg: clamp(o.seg ?? c?.pos ?? 0, 0, Math.max(0, n - 1)),
    word: -1,
    timing: "estimated",
    elapsed: 0,
  });
  if (!same) player.stt = freshStt();
  startWord = 0;
  updateTotals();
  player.elapsed = doc ? before(player.seg) : 0;
  refreshStatus();
  if (!doc) return;
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
      clearTimeout(timers.get(i));
      timers.delete(i);
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
    if (mem.has(i) || jobs.has(i)) continue;
    const skip = player.skipped[i] && i !== player.seg;
    if (fails[i]) {
      if (skip) continue;
      break;
    }
    if (!skip) fetchSeg(i);
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
}

function startAudio(i: number, m: Mem) {
  const a = el();
  loaded = i;
  a.src = m.url;
  a.defaultPlaybackRate = a.playbackRate = settings.speed; // load() resets playbackRate
  a.preservesPitch = true;
  a.currentTime = timesOf(i, m)[startWord]?.start ?? 0;
  startWord = 0;
  a.play().catch((e: Error) => {
    if (e.name !== "NotAllowedError") return; // AbortError: src changed under us
    wantPlay = false;
    refreshStatus();
  });
}

function fetchSeg(i: number) {
  const seg = segs()[i]!;
  const v = voiceFor(seg.kind);
  const key = keyFor(i);
  const g = gen;
  const ac = new AbortController();
  jobs.set(i, ac);
  (async () => {
    let e = await cache.getEntry(key).catch(() => undefined);
    if (!e) {
      if (!v.provider)
        throw new ApiError({
          code: "http",
          status: 0,
          message: `No provider is set for ${v.role}`,
          retryAfter: null,
        });
      if (ac.signal.aborted) return;
      player.segState[i] = "loading";
      const blob = await tts({
        provider: v.provider,
        model: v.model,
        voice: v.voice,
        input: seg.core,
        signal: ac.signal,
      });
      const duration = (await durationOf(blob)) ?? seg.core.length / CHARS_PER_SEC;
      e = { blob, duration, bytes: blob.size, stt: null, at: Date.now() };
      cache.putEntry(key, e).catch(noop); // quota errors: still playable from memory
    }
    if (ac.signal.aborted || g !== gen) return;
    jobs.delete(i);
    remember(i, key, e);
    kick();
  })().catch((err) => {
    if (ac.signal.aborted || g !== gen) return;
    jobs.delete(i);
    fail(i, err);
    kick();
  });
}

function remember(i: number, key: string, e: cache.CacheEntry) {
  const old = mem.get(i);
  if (old) URL.revokeObjectURL(old.url);
  const seg = segs()[i]!;
  mem.set(i, {
    key,
    blob: e.blob,
    url: URL.createObjectURL(e.blob),
    duration: e.duration,
    stt: e.stt,
    times: e.stt ? alignWords(seg.words, e.stt, e.duration) : null,
  });
  durs[i] = e.duration;
  cached.add(i);
  player.segState[i] = "ready";
  if (e.stt) player.aligned[i] = true;
  if (fails[i]) {
    delete fails[i];
    delete player.skipped[i];
  }
  updateTotals();
}

function fail(i: number, err: unknown) {
  const e = toPlain(err);
  const retryable =
    e.code === "rate" || e.code === "network" || (e.code === "http" && e.status >= 500);
  const done = fails[i]?.attempt ?? 0; // automatic retries already used
  const f: PlayerError = {
    seg: i,
    code: e.code,
    status: e.status,
    message: e.message,
    providerId: voiceFor(segs()[i]!.kind).provider?.id ?? null,
    attempt: done,
    maxAttempts: MAX_RETRIES,
    retryAt: null,
    gaveUp: false,
    retrying: false,
  };
  if (retryable && done < MAX_RETRIES) {
    const s = e.code === "rate" ? (e.retryAfter ?? RATE_DELAYS[done]!) : NET_DELAYS[done]!;
    f.attempt = done + 1;
    f.retryAt = Date.now() + s * 1000;
    timers.set(
      i,
      setTimeout(() => {
        timers.delete(i);
        runRetry(i);
      }, s * 1000),
    );
  } else f.gaveUp = retryable;
  fails[i] = f;
  player.segState[i] = "failed";
  refreshStatus();
}

function runRetry(i: number) {
  const f = fails[i];
  if (!f || jobs.has(i)) return;
  clearTimeout(timers.get(i));
  timers.delete(i);
  f.retryAt = null;
  f.retrying = true;
  fetchSeg(i);
  refreshStatus();
}

/** Move the playhead to segment i, word w. Keeps the play/pause intent. */
function go(i: number, w = 0) {
  ended = false;
  if (loaded >= 0 && loaded !== i) stopAudio();
  player.seg = i;
  player.word = w;
  startWord = w;
  const m = mem.get(i);
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

function advance() {
  const n = segs().length;
  let i = player.seg + 1;
  while (i < n && player.skipped[i]) i++;
  if (i < n) return go(i);
  const next = chapterAt(1);
  if (next) return open(next.id, { autoplay: true, seg: 0 });
  stopAudio();
  wantPlay = false;
  ended = true;
  savePos();
  refreshStatus();
  toast({ title: "End of the list", sub: "Paste the next chapter with ⌘V to keep listening" });
}

function chapterAt(delta: number) {
  const i = library.chapters.findIndex((c) => c.id === chId);
  return i < 0 ? null : (library.chapters[i + delta] ?? null);
}

// ---------- STT ----------

function pumpStt() {
  if (sttJob || !doc || !player.started) return;
  const s = settings.stt;
  const prov = providerById(s.providerId);
  if (!s.enabled || !prov || player.stt.paused) return;
  const hi = Math.min(segs().length - 1, player.seg + settings.prefetch);
  for (let i = player.seg; i <= hi; i++) {
    const m = mem.get(i);
    if (m && !m.stt && !sttTried.has(i)) return void runStt(i, m, prov, s.model);
  }
}

async function runStt(i: number, m: Mem, prov: Provider, model: string) {
  sttTried.add(i);
  const g = gen;
  const ac = new AbortController();
  sttJob = { i, ac };
  try {
    const { words } = await transcribe({ provider: prov, model, blob: m.blob, signal: ac.signal });
    if (!words.length)
      throw new ApiError({
        code: "http",
        status: 0,
        message: "no word timestamps",
        retryAfter: null,
      });
    if (g !== gen) return;
    m.stt = words;
    m.times = alignWords(segs()[i]!.words, words, m.duration);
    player.aligned[i] = true;
    if (i === player.seg) player.timing = "aligned";
    player.stt = freshStt();
    cache.setStt(m.key, words).catch(noop);
  } catch (err) {
    if (ac.signal.aborted || g !== gen) return;
    const e = toPlain(err);
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

// Chapter switched from outside (deleted, store init) or re-segmented (quote rule toggled).
watch(
  [() => ui.currentId, currentDoc],
  ([id, d]) => {
    if (id === chId && d === doc) return; // our own open()
    if (id === chId) load(id, { seg: player.seg, autoplay: wantPlay, keepStarted: true });
    else load(id);
  },
  { immediate: true },
);
// Voice changed: cache keys changed. The segment already playing finishes in the old voice.
watch(
  () =>
    (["narr", "dlg"] as const)
      .map((k) => ((v) => [v.provider?.baseUrl, v.model, v.voice].join("|"))(voiceFor(k)))
      .join("#"),
  () => refresh(),
);
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

function refresh() {
  if (!doc) return;
  resetWork(loaded);
  void scan();
  kick();
}

// ---------- public API ----------

export function play() {
  if (!voiceFor("narr").provider) {
    ui.view = "settings";
    ui.settingsTab = "providers";
    return;
  }
  if (!doc) return;
  if (ended) {
    ended = false;
    const next = chapterAt(1); // pasted since we stopped
    return next ? open(next.id, { autoplay: true, seg: 0 }) : seek(0);
  }
  if (fails[player.seg]) return retry();
  wantPlay = true;
  player.started = true;
  if (loaded === player.seg) el().play().catch(noop);
  kick();
}

export function pause() {
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

/** Jump to a segment (and word within it). Re-enables follow. play:false keeps the current play/pause state. */
export function seek(seg: number, word = 0, { play: autoplay = true }: { play?: boolean } = {}) {
  if (!doc) return;
  ui.follow = true;
  go(clamp(seg, 0, segs().length - 1), Math.max(0, word));
  if (autoplay && !wantPlay) play();
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
  const c = chapterAt(1);
  if (c) open(c.id, { autoplay: wantPlay });
}
export function prevChapter() {
  const c = chapterAt(-1);
  if (c) open(c.id, { autoplay: wantPlay });
}

/** Show a chapter in the reader and point the engine at it (at its saved position). */
export function open(
  id: string,
  { autoplay = false, seg }: { autoplay?: boolean; seg?: number } = {},
) {
  ui.follow = true;
  if (id === chId && doc) {
    if (seg != null) seek(seg, 0, { play: autoplay });
    else if (autoplay) play();
    return;
  }
  load(id, { seg, autoplay });
  ui.currentId = id;
}

/** retry the failed segment now */
export function retry() {
  const i = player.seg;
  const f = fails[i];
  if (!f) return;
  f.attempt = 0; // a manual retry restarts the automatic schedule
  f.gaveUp = false;
  wantPlay = true;
  player.started = true;
  ended = false;
  runRetry(i);
}

/** skip the failed segment */
export function skip() {
  const i = player.seg;
  const f = fails[i];
  if (f) {
    clearTimeout(timers.get(i));
    timers.delete(i);
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

let previewEl: HTMLAudioElement | null = null;
/** Speak a fixed sentence with a role's current voice. Throws ApiError on failure. */
export async function preview(role: Role) {
  const v = voiceFor(role === "dialogue" ? "dlg" : "narr");
  if (!v.provider)
    throw new ApiError({
      code: "http",
      status: 0,
      message: "Pick a provider first",
      retryAfter: null,
    });
  const blob = await tts({
    provider: v.provider,
    model: v.model,
    voice: v.voice,
    input: PREVIEW_TEXT,
  });
  if (previewEl) {
    previewEl.pause();
    URL.revokeObjectURL(previewEl.src);
  }
  previewEl = new Audio(URL.createObjectURL(blob));
  await previewEl.play();
}

/** { segments, bytes } across all chapters */
export async function cacheStats(): Promise<{ segments: number; bytes: number }> {
  return cache.stats().catch(() => ({ segments: 0, bytes: 0 }));
}

export async function clearCache() {
  await cache.clearAll();
  refresh();
}
