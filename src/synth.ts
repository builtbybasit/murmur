// Audio for one segment: from the cache, or synthesized and cached. Playback, the next-chapter
// prefetch and background generation all come through here, so a segment asked for twice at
// once is one request.
import { computed } from "vue";
import { settings, voiceFor, providerById, type Provider } from "./settings";
import { CHARS_PER_SEC } from "./library";
import type { Seg } from "./lib/segment";
import { ApiError, retryDelay, stt, toError, tts, type ProviderError } from "./lib/api";
import * as cache from "./lib/cache";
import { makeSpeaker, spokenText } from "./lib/speech";

export type { CacheEntry } from "./lib/cache";
type CacheEntry = cache.CacheEntry;

const speaker = computed(() => makeSpeaker(settings.speech));
/** What the TTS is sent for a segment; "" plays a short silence. */
export const spoken = (seg: Seg) => spokenText(seg, speaker.value, settings.speech.images);

/** Cache key of a segment of any chapter: provider, model, voice and spoken text. */
export function keyOf(seg: Seg) {
  const v = voiceFor(seg.kind);
  return cache.cacheKey(v.provider?.baseUrl ?? "", v.model, v.voice, spoken(seg));
}

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

/** The STT provider when word alignment is on. */
export const sttProvider = () =>
  (settings.stt.enabled && providerById(settings.stt.providerId)) || null;

// ---------- cache writes ----------

const listeners = new Set<(key: string, e: CacheEntry) => void>();
/** Hear about every entry cached here: new audio, or word timings added to it. */
export const onCached = (f: (key: string, e: CacheEntry) => void) => void listeners.add(f);
async function save(key: string, e: CacheEntry) {
  await cache.putEntry(key, e).catch(() => {}); // quota errors: still playable from memory
  for (const f of listeners) f(key, e);
}

// ---------- audio ----------

export const SILENCE = 0.3; // seconds played for a segment with nothing to say
const inflight = new Map<string, { p: Promise<CacheEntry>; ac: AbortController; users: number }>();

/**
 * A segment's audio. Callers asking for the same audio share one request, which stops once all
 * of them have aborted. onStream: play it while it is generated (see the relay in dev/server.ts);
 * called with the stream id only when this call starts the request.
 */
export function getAudio(
  seg: Seg,
  signal: AbortSignal,
  onStream?: (id: string) => void,
): Promise<CacheEntry> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (!spoken(seg)) return Promise.resolve({ blob: silence(SILENCE), duration: SILENCE, stt: [] });
  const key = keyOf(seg);
  let job = inflight.get(key);
  if (!job) {
    const ac = new AbortController();
    const p = make(seg, key, ac.signal, onStream);
    inflight.set(key, (job = { p, ac, users: 0 }));
    const done = () => inflight.get(key) === job && inflight.delete(key);
    p.then(done, done);
  }
  const j = job;
  j.users++;
  return new Promise((res, rej) => {
    const quit = () => {
      rej(signal.reason);
      if (--j.users) return;
      j.ac.abort();
      if (inflight.get(key) === j) inflight.delete(key);
    };
    signal.addEventListener("abort", quit, { once: true });
    j.p.then(res, rej).finally(() => signal.removeEventListener("abort", quit));
  });
}

async function make(
  seg: Seg,
  key: string,
  signal: AbortSignal,
  onStream?: (id: string) => void,
): Promise<CacheEntry> {
  const hit = await cache.getEntry(key).catch(() => undefined);
  if (hit) return hit;
  const v = voiceFor(seg.kind);
  if (!v.provider)
    throw new ApiError({
      code: "http",
      status: 0,
      message: `No provider is set for ${v.role}`,
      retryAfter: null,
    });
  signal.throwIfAborted();
  const say = spoken(seg);
  const streamId = onStream && crypto.randomUUID();
  const pending = tts({ ...v, provider: v.provider, input: say, signal, streamId });
  if (streamId) onStream!(streamId);
  const blob = await pending;
  const e = { blob, duration: (await durationOf(blob)) ?? say.length / CHARS_PER_SEC, stt: null };
  await save(key, e);
  return e;
}

/** Add STT word timings to an entry, and to the cache. Throws when there are none. */
export async function align(
  key: string,
  e: CacheEntry,
  provider: Provider,
  model: string,
  signal: AbortSignal,
) {
  const words = await stt({ provider, model, blob: e.blob, signal });
  if (!words.length)
    throw new ApiError({
      code: "http",
      status: 0,
      message: "no word timestamps",
      retryAfter: null,
    });
  e.stt = words;
  await save(key, e);
}

/** Run f, retrying rate limits, network errors and 5xx (see retryDelay). onWait hears each wait. */
export async function retrying<T>(
  f: () => Promise<T>,
  signal: AbortSignal,
  onWait?: (e: ProviderError, n: number, sec: number) => void,
): Promise<T> {
  for (let n = 0; ; n++)
    try {
      return await f();
    } catch (err) {
      const e = toError(err);
      const sec = retryDelay(e, n);
      if (signal.aborted || sec == null) throw err;
      onWait?.(e, n, sec);
      await sleep(sec * 1000, signal);
    }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(signal.reason);
      },
      { once: true },
    );
  });

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
