// OpenAI-compatible provider calls, all through the /relay dev-server middleware (see vite.config.ts).
import type { Provider } from "../store";
import type { SttWord } from "./align";
import { keyHeaders } from "./server";

export type ErrorCode = "auth" | "rate" | "network" | "http";
export interface ProviderError {
  code: ErrorCode;
  status: number; // 0 when there was no HTTP response
  message: string;
  retryAfter: number | null; // seconds, from Retry-After on 429
}
export type TestResult =
  | { ok: true; ms: number; models: string[] }
  | { ok: false; error: ProviderError };
export type VoicesResult =
  | { ok: true; voices: string[] }
  | { ok: false; notFound?: boolean; error: ProviderError };

/** Thrown by tts/stt. An Error so stack traces survive; carries the ProviderError fields. */
export class ApiError extends Error implements ProviderError {
  code: ErrorCode;
  status: number;
  retryAfter: number | null;
  constructor(e: ProviderError) {
    super(e.message);
    this.code = e.code;
    this.status = e.status;
    this.retryAfter = e.retryAfter;
  }
  plain = (): ProviderError => ({
    code: this.code,
    status: this.status,
    message: this.message,
    retryAfter: this.retryAfter,
  });
}

const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

async function classify(r: Response, target: string): Promise<ApiError> {
  const text = await r.text().catch(() => "");
  let message = text;
  try {
    const j = JSON.parse(text);
    message = j.error?.message ?? j.error ?? j.detail?.[0]?.msg ?? j.detail ?? j.message ?? text;
  } catch {}
  message = String(message || r.statusText || "HTTP " + r.status).slice(0, 300);
  const ra = r.headers.get("retry-after");
  let retryAfter: number | null = null;
  if (ra) retryAfter = isNaN(+ra) ? Math.max(0, (Date.parse(ra) - Date.now()) / 1000) : +ra;
  const s = r.status;
  const code: ErrorCode =
    s === 401 || s === 403
      ? "auth"
      : s === 429
        ? "rate"
        : s === 502 && r.headers.get("x-relay-error")
          ? "network"
          : "http";
  if (code === "network")
    message = `Can't reach ${new URL(target).host}` + (text ? ` (${text.slice(0, 200)})` : "");
  return new ApiError({ code, status: code === "network" ? 0 : s, message, retryAfter });
}

/** fetch through the relay; throws ApiError (or the AbortError) unless 2xx. */
async function call(
  p: Provider,
  path: string,
  init: {
    method?: string;
    body?: BodyInit;
    json?: unknown;
    signal?: AbortSignal;
    accept?: string;
    streamId?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...keyHeaders(),
    "x-target": p.baseUrl.trim().replace(/\/+$/, "") + path,
  };
  if (p.apiKey) headers.authorization = "Bearer " + p.apiKey.trim();
  if (init.accept) headers.accept = init.accept;
  if (init.streamId) headers["x-stream-id"] = init.streamId;
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let r: Response;
  try {
    r = await fetch("/relay", {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: init.signal,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError({
      code: "network",
      status: 0,
      message: "Can't reach the app's relay: " + (e as Error).message,
      retryAfter: null,
    });
  }
  if (!r.ok) throw await classify(r, headers["x-target"]!);
  return r;
}

const toError = (e: unknown): ProviderError =>
  e instanceof ApiError
    ? e.plain()
    : { code: "network", status: 0, message: String((e as Error)?.message ?? e), retryAfter: null };

// Optional request fields, most wanted first. A server that rejects one with a 4xx gets the next;
// the first that works is remembered per base URL and mode. Audio someone is waiting for wants to
// stream; audio fetched ahead wants to be small. (nano-edge: no mp3, streams only WAV, FLAC is
// half the size of WAV. OpenAI: mp3, streams anyway, no `stream` field.)
const EXTRAS = {
  live: [
    { response_format: "mp3", stream: true },
    { response_format: "flac", stream: true },
    { stream: true },
    { response_format: "mp3" },
    {},
  ],
  ahead: [{ response_format: "mp3" }, { response_format: "flac" }, {}],
};
const accepted = new Map<string, number>();

/** A streamed WAV says "size unknown" (0xFFFFFFFF); fill in the real sizes so decoders and STT accept it. */
async function fixWav(blob: Blob): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(b.buffer);
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.length < 44 || tag(0) !== "RIFF" || v.getUint32(4, true) !== 0xffffffff) return blob;
  v.setUint32(4, b.length - 8, true);
  for (let o = 12; o + 8 <= b.length; o += 8 + v.getUint32(o + 4, true))
    if (tag(o) === "data") {
      v.setUint32(o + 4, b.length - o - 8, true);
      break;
    }
  return new Blob([b], { type: blob.type || "audio/wav" });
}

/**
 * POST /audio/speech -> audio Blob.
 * `streamId`: the relay also plays the audio at /relay/stream/<id> while it is being generated.
 */
export async function tts(o: {
  provider: Provider;
  model: string;
  voice: string;
  input: string;
  signal?: AbortSignal;
  streamId?: string;
}): Promise<Blob> {
  const base = { model: o.model, voice: o.voice, input: o.input };
  const list = o.streamId ? EXTRAS.live : EXTRAS.ahead;
  const memo = o.provider.baseUrl + (o.streamId ? "|live" : "|ahead");
  let i = accepted.get(memo) ?? 0;
  let r: Response;
  for (;;)
    try {
      r = await call(o.provider, "/audio/speech", {
        json: { ...base, ...list[i] },
        signal: o.signal,
        accept: "audio/*",
        streamId: o.streamId,
      });
      accepted.set(memo, i);
      break;
    } catch (e) {
      const bad = e instanceof ApiError && e.code === "http" && e.status >= 400 && e.status < 500;
      if (!bad || ++i >= list.length) throw e;
    }
  const blob = await fixWav(await r.blob());
  if (!blob.size)
    throw new ApiError({
      code: "http",
      status: r.status,
      message: "The server returned empty audio",
      retryAfter: null,
    });
  return blob;
}

/** POST /audio/transcriptions (verbose_json, word timestamps) -> { words, text } */
export async function stt(o: {
  provider: Provider;
  model: string;
  blob: Blob;
  signal?: AbortSignal;
}): Promise<{ words: SttWord[]; text: string }> {
  const ext = /wav/.test(o.blob.type)
    ? "wav"
    : /ogg|opus/.test(o.blob.type)
      ? "ogg"
      : /flac/.test(o.blob.type)
        ? "flac"
        : "mp3";
  const fd = new FormData();
  fd.append("file", o.blob, "segment." + ext);
  fd.append("model", o.model);
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word");
  const j = await (
    await call(o.provider, "/audio/transcriptions", { body: fd, signal: o.signal })
  ).json();
  // some servers only nest words inside segments
  const words: SttWord[] =
    j.words ?? j.segments?.flatMap((s: { words?: SttWord[] }) => s.words ?? []) ?? [];
  return { words, text: j.text ?? "" };
}

/** GET /models. */
export async function testConnection(provider: Provider): Promise<TestResult> {
  const t0 = performance.now();
  try {
    const j = await (await call(provider, "/models")).json();
    const list: unknown[] = Array.isArray(j) ? j : (j.data ?? j.models ?? []);
    const models = list
      .map((m) =>
        typeof m === "string"
          ? m
          : ((m as { id?: string; name?: string }).id ?? (m as { name?: string }).name ?? ""),
      )
      .filter(Boolean);
    return { ok: true, ms: Math.round(performance.now() - t0), models };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

/** GET /audio/voices (falls back to /voices). Accepts {voices:[...]} or a bare array, of strings or {id|name}. */
export async function fetchVoices(provider: Provider): Promise<VoicesResult> {
  try {
    // Kokoro-FastAPI serves /audio/voices; some servers (nano-edge-server) only /voices
    const r = await call(provider, "/audio/voices").catch((e) =>
      e instanceof ApiError && e.status === 404
        ? call(provider, "/voices").catch(() => Promise.reject(e))
        : Promise.reject(e),
    );
    const j = await r.json();
    const list: unknown[] = Array.isArray(j) ? j : (j.voices ?? j.data ?? []);
    const voices = list
      .map((v) =>
        typeof v === "string"
          ? v
          : ((v as { id?: string; name?: string }).id ?? (v as { name?: string }).name ?? ""),
      )
      .filter(Boolean);
    return { ok: true, voices };
  } catch (e) {
    const error = toError(e);
    return { ok: false, notFound: error.status === 404 || error.status === 405, error };
  }
}
