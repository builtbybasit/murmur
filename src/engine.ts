// Playback engine: TTS per segment with prefetch, audio cache, STT alignment, retries.
// CONTRACT: UI components only read `player` and call the exported functions below.
import { computed, reactive, watch } from "vue";
import {
  settings,
  ui,
  library,
  current,
  currentDoc,
  docOf,
  voiceFor,
  providerById,
  CHARS_PER_SEC,
  toast,
  type Chapter,
  type Provider,
  type Role,
} from "./store";
import type { Doc, Seg } from "./lib/segment";
import { tts, stt as transcribe, ApiError, type ErrorCode, type ProviderError } from "./lib/api";
import { alignWords, estimateTimes, type Span, type SttWord } from "./lib/align";
import * as cache from "./lib/cache";
import { describeImage, makeSpeaker } from "./lib/speech";

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
  /** voice id being auditioned in Settings, else null */
  previewing: string | null;
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
  previewing: null,
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
let streamed = false; // the element plays /relay/stream/<id>, the full blob may not be here yet
let streamTimes: Span[] = []; // estimated word times while streaming
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
/** What the TTS is sent for a segment (rules + emoji/kaomoji removal). Recompiled when settings change. */
const speaker = computed(() => makeSpeaker(settings.speech));
/** What the TTS is sent for a segment; "" plays a short silence. */
const spoken = (seg: Seg) =>
  seg.img ? (settings.speech.images ? describeImage(seg.img.alt) : "") : speaker.value(seg.core);
const sayOf = (i: number) => spoken(segs()[i]!);
const before = (i: number) => {
  let s = 0;
  for (let j = 0; j < i; j++) s += estDur(j);
  return s;
};
/** Cache key of a segment of any chapter: provider, model, voice and spoken text. */
const keyOf = (seg: Seg) => {
  const v = voiceFor(seg.kind);
  return cache.cacheKey(v.provider?.baseUrl ?? "", v.model, v.voice, spoken(seg));
};
const keyFor = (i: number) => keyOf(segs()[i]!);
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

/** A silent 16-bit mono WAV of `sec` seconds. */
function silence(sec: number, rate = 8000) {
  const n = Math.round(sec * rate);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, x: string) => {
    for (let k = 0; k < x.length; k++) v.setUint8(o + k, x.charCodeAt(k));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  return new Blob([v.buffer], { type: "audio/wav" });
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
  streamed = false;
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
  endGap(false);
  stopAhead(id); // opening the prefetched chapter lets it finish
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
  void prefetchNext();
}

// Next chapter: near the end of this one, its first segments go into the cache, one at a time,
// so it starts without a wait. They play from the cache when it opens.
let ahead: { id: string; ac: AbortController } | null = null;
async function prefetchNext() {
  const n = segs().length;
  const c = chapterAt(1);
  if (!wantPlay || !c || ahead?.id === c.id || player.seg + settings.prefetch < n - 1) return;
  const ac = new AbortController();
  ahead = { id: c.id, ac };
  for (const seg of docOf(c).segs.slice(0, Math.max(1, settings.prefetch))) {
    const say = spoken(seg);
    const v = voiceFor(seg.kind);
    const key = keyOf(seg);
    if (!say || !v.provider || (await cache.getEntry(key).catch(() => null))) continue;
    try {
      const blob = await tts({ ...v, provider: v.provider, input: say, signal: ac.signal });
      const duration = (await durationOf(blob)) ?? say.length / CHARS_PER_SEC;
      await cache.putEntry(key, { blob, duration, bytes: blob.size, stt: null, at: Date.now() });
    } catch {
      return; // aborted or failing: the chapter fetches (and reports) it itself when it opens
    }
  }
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

/** Play segment i while it is still being generated (see the relay in vite.config.ts). */
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

function fetchSeg(i: number) {
  const seg = segs()[i]!;
  const v = voiceFor(seg.kind);
  const key = keyFor(i);
  const g = gen;
  const ac = new AbortController();
  jobs.set(i, ac);
  (async () => {
    const say = sayOf(i);
    let e: cache.CacheEntry | undefined;
    // nothing speakable (a line that was only a kaomoji): a short silence, no request
    if (!say) e = { blob: silence(0.3), duration: 0.3, bytes: 0, stt: [], at: Date.now() };
    else e = await cache.getEntry(key).catch(() => undefined);
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
      // the segment is wanted right now and nothing plays: listen while it is generated
      const streamId =
        i === player.seg && wantPlay && !startWord && loaded < 0 && !gap
          ? crypto.randomUUID()
          : undefined;
      const pending = tts({
        provider: v.provider,
        model: v.model,
        voice: v.voice,
        input: say,
        signal: ac.signal,
        streamId,
      });
      if (streamId) startStream(i, streamId);
      const blob = await pending;
      const duration = (await durationOf(blob)) ?? say.length / CHARS_PER_SEC;
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
  if (i === loaded && streamed) stopAudio(); // its stream will never finish
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
  endGap(false);
  ended = false;
  const m = mem.get(i);
  // a stream cannot seek: once the blob is here, play that from the word instead
  if (loaded >= 0 && (loaded !== i || (streamed && m))) stopAudio();
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
    (["narr", "dlg", "sys"] as const)
      .map((k) => ((v) => [v.provider?.baseUrl, v.model, v.voice].join("|"))(voiceFor(k)))
      .join("#"),
  () => refresh(),
);
// Spoken-text rules changed: affected segments get new cache keys, like a voice change.
watch(
  () => JSON.stringify(settings.speech),
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
  stopAhead(); // voices or spoken text changed: the prefetched keys are stale
  restartGenerate(); // the running chapter job starts over with the new keys
  if (!doc) return;
  resetWork(loaded);
  void scan();
  kick();
}

// ---------- generate whole chapters in the background ----------

/** Everything that changes a chapter's cache keys: voices, spoken-text rules, quote rule. */
export const audioSig = computed(() =>
  cache.cacheKey(
    "sig",
    "",
    "",
    JSON.stringify([
      (["narr", "dlg", "sys"] as const).map((k) => {
        const v = voiceFor(k);
        return [v.provider?.baseUrl, v.model, v.voice];
      }),
      settings.speech,
      settings.smartQuotes,
    ]),
  ),
);
/** queued | running | failed | done, or null: "done" survives reloads via chapter.ready. */
export const genState = (c: Chapter) =>
  generating[c.id]?.state ?? (c.ready === audioSig.value ? "done" : null);

export interface GenJob {
  state: "queued" | "running" | "done" | "failed";
  done: number; // segments ready (audio, and word timings when alignment is on)
  total: number;
  error: string;
}
/** Chapter id -> background generation job. Chapters run one at a time, in click order. */
export const generating = reactive<Record<string, GenJob>>({});
const genQueue: string[] = [];
let genRunning: { id: string; ac: AbortController } | null = null;

/** Start (or queue) generating a chapter's audio; on a queued/running chapter, stop it. */
export function toggleGenerate(id: string) {
  const j = generating[id];
  if (j?.state === "queued" || j?.state === "running") {
    const q = genQueue.indexOf(id);
    if (q >= 0) genQueue.splice(q, 1);
    if (genRunning?.id === id) genRunning.ac.abort();
    delete generating[id];
    return;
  }
  generating[id] = { state: "queued", done: 0, total: 0, error: "" };
  genQueue.push(id);
  void genLoop();
}

function restartGenerate() {
  if (!genRunning) return;
  const { id, ac } = genRunning;
  ac.abort();
  generating[id] = { state: "queued", done: 0, total: 0, error: "" };
  genQueue.unshift(id);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new DOMException("stopped", "AbortError"));
      },
      { once: true },
    );
  });

async function genLoop() {
  if (genRunning) return;
  while (genQueue.length) {
    const id = genQueue.shift()!;
    const c = library.chapters.find((c) => c.id === id);
    const j = generating[id];
    if (!c || !j) {
      delete generating[id];
      continue;
    }
    const ac = new AbortController();
    genRunning = { id, ac };
    j.state = "running";
    try {
      await genChapter(c.id, docOf(c), j, ac.signal);
      j.state = "done";
      c.ready = audioSig.value;
    } catch (e) {
      if (!ac.signal.aborted) {
        Object.assign(j, { state: "failed", error: toPlain(e).message });
        ac.abort(); // stops the other worker
      }
    }
    genRunning = null;
  }
}

async function genChapter(id: string, d: Doc, j: GenJob, signal: AbortSignal) {
  const align = () => settings.stt.enabled && providerById(settings.stt.providerId);
  const keys = d.segs.map(keyOf);
  const have = await cache.getEntries(keys).catch(() => [] as (cache.CacheEntry | undefined)[]);
  j.total = d.segs.length;
  j.done = 0;
  const todo: number[] = [];
  d.segs.forEach((seg, i) => {
    const e = have[i];
    if (!spoken(seg) || (e && (e.stt || !align()))) j.done++;
    else todo.push(i);
  });
  let sttFails = 0;
  // two workers; the second rests while you listen, and both wait while playback is buffering
  const worker = async (k: number) => {
    while (todo.length) {
      while (player.status === "buffering" || (k && wantPlay)) await sleep(300, signal);
      const i = todo.shift();
      if (i === undefined) return;
      const seg = d.segs[i]!;
      let e = have[i];
      if (!e) {
        const v = voiceFor(seg.kind);
        if (!v.provider) throw new Error(`No provider is set for ${v.role}`);
        const say = spoken(seg);
        const blob = await retrying(
          () => tts({ provider: v.provider!, model: v.model, voice: v.voice, input: say, signal }),
          signal,
        );
        const duration = (await durationOf(blob)) ?? say.length / CHARS_PER_SEC;
        e = { blob, duration, bytes: blob.size, stt: null, at: Date.now() };
        await cache.putEntry(keys[i]!, e).catch(noop);
      }
      const sp = align();
      if (sp && !e.stt && sttFails < 3)
        try {
          const { words } = await transcribe({
            provider: sp,
            model: settings.stt.model,
            blob: e.blob,
            signal,
          });
          if (words.length) {
            e.stt = words;
            await cache.setStt(keys[i]!, words).catch(noop);
          }
          sttFails = 0;
        } catch (err) {
          if (signal.aborted) throw err;
          sttFails++; // alignment is a bonus: after 3 failures in a row, audio only
        }
      if (id === chId) noteCached(i, e);
      j.done++;
    }
  };
  await Promise.all([worker(0), worker(1)]);
}

/** Retry rate limits, network errors and 5xx like playback does. */
async function retrying<T>(f: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let n = 0; ; n++)
    try {
      return await f();
    } catch (err) {
      const e = toPlain(err);
      const again =
        e.code === "rate" || e.code === "network" || (e.code === "http" && e.status >= 500);
      if (signal.aborted || !again || n >= MAX_RETRIES) throw err;
      await sleep(
        1000 * (e.code === "rate" ? (e.retryAfter ?? RATE_DELAYS[n]!) : NET_DELAYS[n]!),
        signal,
      );
    }
}

/** A background job cached segment i of the open chapter: show it as ready. */
function noteCached(i: number, e: cache.CacheEntry) {
  if (!doc) return;
  cached.add(i);
  durs[i] = e.duration;
  player.segState[i] ??= "ready";
  const m = mem.get(i);
  if (e.stt) {
    player.aligned[i] = true;
    if (m && !m.stt) {
      m.stt = e.stt;
      m.times = alignWords(segs()[i]!.words, e.stt, m.duration);
    }
  }
  updateTotals();
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

/** Open a chapter's text in the editor (Reader). Pauses playback; saving re-segments in place. */
export function edit(id: string) {
  pause();
  if (ui.currentId !== id) open(id);
  ui.view = "reader";
  ui.editingId = id;
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
const previews = new Map<string, string>(); // provider|model|voice -> object URL

/** Speak PREVIEW_TEXT with a role's provider and model; `voice` overrides the role's voice (audition, blends). */
export async function preview(role: Role, voice?: string) {
  const v = { ...voiceFor(({ narration: "narr", dialogue: "dlg", system: "sys" } as const)[role]) };
  if (voice) v.voice = voice;
  if (!v.provider)
    throw new ApiError({
      code: "http",
      status: 0,
      message: "Pick a provider first",
      retryAfter: null,
    });
  const key = [v.provider.baseUrl, v.model, v.voice].join("|");
  stopPreview();
  player.previewing = v.voice;
  try {
    let url = previews.get(key);
    if (!url) {
      const blob = await tts({
        provider: v.provider,
        model: v.model,
        voice: v.voice,
        input: PREVIEW_TEXT,
      });
      previews.set(key, (url = URL.createObjectURL(blob)));
    }
    if (player.previewing !== v.voice) return; // another audition started meanwhile
    const a = (previewEl = new Audio(url));
    a.onended = a.onpause = () => {
      if (previewEl === a) player.previewing = null;
    };
    await a.play();
  } catch (e) {
    if (player.previewing === v.voice) player.previewing = null;
    throw e;
  }
}

export function stopPreview() {
  previewEl?.pause();
  previewEl = null;
  player.previewing = null;
}

/** { segments, bytes } across all chapters */
export async function cacheStats(): Promise<{ segments: number; bytes: number }> {
  return cache.stats().catch(() => ({ segments: 0, bytes: 0 }));
}

export async function clearCache() {
  await cache.clearAll();
  refresh();
}

// ---------- lock screen, media keys, headphones (Media Session API) ----------

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => play()],
    ["pause", () => pause()],
    ["stop", () => pause()],
    // track buttons (AirPods double tap, F7/F9) move by paragraph, seek buttons by segment
    ["previoustrack", () => prevPara()],
    ["nexttrack", () => nextPara()],
    ["seekbackward", () => prev()],
    ["seekforward", () => next()],
    [
      "seekto",
      (d) => {
        // the scrubber is in chapter seconds at the current speed; find that segment
        let t = (d.seekTime ?? 0) * settings.speed;
        let i = 0;
        while (i < segs().length - 1 && t >= estDur(i)) t -= estDur(i++);
        seek(i, 0, { play: false });
      },
    ],
  ];
  for (const [a, h] of actions)
    try {
      ms.setActionHandler(a, h);
    } catch {} // an action this browser does not know

  watch(
    () => [current.value?.title, player.seg, currentDoc.value?.segs.length] as const,
    ([title, seg, n]) => {
      ms.metadata = title
        ? new MediaMetadata({
            title,
            artist: n ? `Segment ${seg + 1} of ${n}` : "",
            album: "lectern",
          })
        : null;
    },
  );
  watch(
    () => [player.status, player.seg, player.total, settings.speed] as const,
    ([status]) => {
      ms.playbackState =
        status === "playing" || status === "buffering"
          ? "playing"
          : status === "idle"
            ? "none"
            : "paused";
      const duration = player.total / settings.speed;
      if (!duration) return;
      try {
        ms.setPositionState({
          duration,
          position: Math.min(duration, player.elapsed / settings.speed),
          playbackRate: settings.speed,
        });
      } catch {}
    },
  );
}
