// Fake OpenAI-compatible TTS + STT server for testing murmur without real providers.
// Run: bun dev/fake-provider.ts   (port 8899, or PORT=...)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";

const PORT = +(process.env.PORT ?? 8899);
const RATE = 16000; // Hz, 16-bit mono WAV
const CPS = 15; // chars per second of "speech"
const VOICES = [
  "af_heart",
  "am_onyx",
  "bf_emma",
  "slow",
  "flaky",
  "fail401",
  "fail429",
  "fail500",
  "sttfail",
];

interface Word {
  word: string;
  start: number;
  end: number;
}
const spoken = new Map<string, { text: string; voice: string; words: Word[]; duration: number }>(); // sha1(wav) -> what it says

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");

/** A quiet tone per word, silence between: you can hear the rhythm the highlight should follow. */
function speak(text: string) {
  const duration = Math.max(0.6, text.length / CPS);
  const n = Math.round(duration * RATE);
  const pcm = new Int16Array(n);
  const words: Word[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const start = (m.index / text.length) * duration;
    const end = ((m.index + m[0].length) / text.length) * duration;
    const word = m[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (word) words.push({ word, start: +start.toFixed(3), end: +end.toFixed(3) });
    const f = 220 + (words.length % 5) * 55;
    for (let i = Math.round(start * RATE); i < Math.min(n, Math.round(end * RATE)); i++) {
      const fade = Math.min(1, (i - start * RATE) / 200, (end * RATE - i) / 200);
      pcm[i] = Math.sin((2 * Math.PI * f * i) / RATE) * 2500 * fade;
    }
  }
  const wav = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(wav.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  wav.set(new Uint8Array(pcm.buffer), 44);
  return { wav, words, duration };
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function send(
  res: ServerResponse,
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
) {
  const isBin = data instanceof Uint8Array;
  res.writeHead(status, { "content-type": isBin ? "audio/wav" : "application/json", ...headers });
  res.end(isBin ? data : JSON.stringify(data));
}
const err = (
  res: ServerResponse,
  status: number,
  message: string,
  headers?: Record<string, string>,
) => send(res, status, { error: { message, type: "fake_error" } }, headers);

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-expose-headers", "retry-after");
  const path = new URL(req.url ?? "/", "http://x").pathname;
  console.log(req.method, path);
  try {
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (req.method === "GET" && path === "/v1/models")
      return send(res, 200, {
        object: "list",
        data: ["fake-tts", "fake-stt", "sttfail"].map((id) => ({ id, object: "model" })),
      });
    if (req.method === "GET" && path === "/v1/audio/voices")
      return send(res, 200, { voices: VOICES });

    if (req.method === "POST" && path === "/v1/audio/speech") {
      const j = JSON.parse((await body(req)).toString() || "{}");
      const voice = String(j.voice ?? "");
      const input = String(j.input ?? "");
      await sleep(300 + Math.random() * 500 + (voice.includes("slow") ? 4000 : 0));
      if (voice.includes("fail401")) return err(res, 401, "Incorrect API key provided (fake)");
      if (voice.includes("fail429"))
        return err(res, 429, "Rate limit reached (fake)", { "retry-after": "3" });
      if (voice.includes("fail500") || (voice.includes("flaky") && Math.random() < 0.5))
        return err(res, 500, "Internal server error (fake)");
      if (!input.trim()) return err(res, 400, "input is empty");
      const { wav, words, duration } = speak(input);
      spoken.set(sha1(wav), { text: input, voice, words, duration });
      return send(res, 200, wav);
    }

    if (req.method === "POST" && path === "/v1/audio/transcriptions") {
      // parse multipart with the WHATWG Request parser
      const form = await new Request("http://x", {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "" },
        body: await body(req),
      }).formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) return err(res, 400, "file is required");
      await sleep(200 + Math.random() * 400);
      const hit = spoken.get(sha1(new Uint8Array(await file.arrayBuffer())));
      if (form.get("model") === "sttfail" || hit?.voice.includes("sttfail"))
        return err(res, 500, "Transcription failed (fake)");
      if (!hit) return send(res, 200, { text: "", language: "english", duration: 0, words: [] }); // unknown audio (server restarted?)
      // like Whisper: split contractions sometimes, jitter the times a little
      const words = hit.words.flatMap((w) => {
        const jit = (t: number) => +Math.max(0, t + (Math.random() - 0.5) * 0.04).toFixed(3);
        const m = w.word.match(/^(\w+?)(n't|'\w+)$/i);
        if (!m) return [{ word: w.word, start: jit(w.start), end: jit(w.end) }];
        const mid = w.start + ((w.end - w.start) * m[1]!.length) / w.word.length;
        return [
          { word: m[1]!, start: jit(w.start), end: +mid.toFixed(3) },
          { word: m[2]!, start: +mid.toFixed(3), end: jit(w.end) },
        ];
      });
      return send(res, 200, {
        task: "transcribe",
        language: "english",
        duration: hit.duration,
        text: hit.text,
        words,
      });
    }
    err(res, 404, `No route ${req.method} ${path}`);
  } catch (e) {
    err(res, 500, String((e as Error).message));
  }
});

server.listen(PORT, () =>
  console.log(`fake provider on http://localhost:${PORT}/v1
  GET  /v1/models, /v1/audio/voices
  POST /v1/audio/speech          -> WAV, ~${CPS} chars/s, 300-800 ms delay
  POST /v1/audio/transcriptions  -> verbose_json word timestamps for audio this server made
  failure voices: fail401, fail429 (Retry-After: 3), fail500, flaky (50% 500), slow (+4 s)
  STT failure: voice "sttfail" (its audio won't transcribe) or STT model "sttfail"
  In murmur: add a Blank provider with base URL http://localhost:${PORT}/v1`),
);
