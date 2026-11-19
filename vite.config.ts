import vue from "@vitejs/plugin-vue";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { allowed, api, phoneLinks, readBody } from "./dev/library-api";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";

// Streaming: a request with x-stream-id also copies the provider's audio, as it arrives, to
// GET /relay/stream/<id>, which an <audio> element plays before generation has finished.
// Either side may come first; a listener that arrives late gets the chunks so far.
interface Stream {
  type: string | null; // content-type, once the provider answered 2xx
  chunks: Buffer[];
  done: boolean;
  subs: Set<ServerResponse>;
  at: number;
}
const streams = new Map<string, Stream>();
function streamOf(id: string) {
  let s = streams.get(id);
  if (!s)
    streams.set(id, (s = { type: null, chunks: [], done: false, subs: new Set(), at: Date.now() }));
  return s;
}
const head = (s: Stream, o: ServerResponse) =>
  o.writeHead(200, { "content-type": s.type!, "cache-control": "no-store" });
function finish(s: Stream) {
  s.done = true;
  for (const o of s.subs) o.end();
  s.subs.clear();
}
// ponytail: streams are kept 2 minutes, plenty for one segment; a few MB at most
setInterval(() => {
  for (const [id, s] of streams)
    if (Date.now() - s.at > 120_000) {
      finish(s);
      streams.delete(id);
    }
}, 30_000).unref();

function listen(id: string, res: ServerResponse) {
  const s = streamOf(id);
  if (s.type) {
    head(s, res);
    for (const c of s.chunks) res.write(c);
  }
  if (s.done) return void res.end();
  s.subs.add(res);
  res.on("close", () => s.subs.delete(res));
}

// Browser -> /relay (x-target: full provider URL) -> provider. Avoids CORS on every provider.
// Other devices need the access key (see dev/library-api.ts); this machine needs none.
async function relay(req: IncomingMessage, res: ServerResponse) {
  const sm = /^\/stream\/([\w-]+)/.exec(req.url ?? "");
  if (sm) return listen(sm[1]!, res); // unguessable id, and <audio> cannot send the key header
  if (!allowed(req)) {
    res.statusCode = 401;
    return res.end("Open the phone link printed by the dev server");
  }
  const target = req.headers["x-target"];
  if (typeof target !== "string" || !/^https?:\/\//.test(target)) {
    res.statusCode = 400;
    return res.end("x-target header required");
  }
  const headers: Record<string, string> = {};
  for (const k of ["authorization", "content-type", "accept"] as const) {
    const v = req.headers[k];
    if (typeof v === "string") headers[k] = v;
  }
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  try {
    const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
    const r = await fetch(target, {
      method: req.method ?? "GET",
      headers,
      // buffered, not streamed: some servers (phonon) reject chunked request bodies
      body: hasBody ? await readBody(req) : undefined,
      signal: ac.signal,
    });
    res.statusCode = r.status;
    for (const k of ["content-type", "retry-after"]) {
      const v = r.headers.get(k);
      if (v) res.setHeader(k, v);
    }
    const sid = req.headers["x-stream-id"];
    // a failed attempt (4xx before a retry with other options) leaves the stream waiting
    const s = typeof sid === "string" && r.ok && r.body ? streamOf(sid) : null;
    if (s) {
      s.type = r.headers.get("content-type") ?? "audio/mpeg";
      for (const o of s.subs) head(s, o);
    }
    if (!r.body) return void res.end();
    Readable.fromWeb(r.body as NodeReadableStream)
      .on("data", (c: Buffer) => {
        res.write(c);
        if (!s) return;
        s.chunks.push(c);
        for (const o of s.subs) o.write(c);
      })
      .on("end", () => {
        res.end();
        if (s) finish(s);
      })
      .on("error", () => {
        res.destroy();
        if (s) finish(s);
      });
  } catch (e: any) {
    if (ac.signal.aborted) return;
    res.statusCode = 502;
    res.setHeader("x-relay-error", "1"); // network failure, not a provider response
    res.end(String(e.cause?.message ?? e.message));
  }
}
const PHONE = !!process.env.LECTERN_PHONE; // `bun run phone`: on the network, over HTTPS

const relayPlugin: Plugin = {
  name: "lectern-relay",
  configureServer(s) {
    s.middlewares.use("/relay", relay);
    s.middlewares.use("/api", api);
    if (PHONE)
      s.httpServer?.once("listening", () =>
        setTimeout(() => {
          const port = (s.httpServer!.address() as AddressInfo).port;
          console.log("\n  Phone (same Wi-Fi; accept the certificate warning once):");
          for (const l of phoneLinks(true, port)) console.log("  ➜  " + l);
          console.log();
        }, 50),
      );
  },
  configurePreviewServer(s) {
    s.middlewares.use("/relay", relay);
    s.middlewares.use("/api", api);
  },
};

// https://vite.dev/config/
export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  server: PHONE ? { host: true } : {},
  plugins: lazyPlugins(() => [vue(), relayPlugin, ...(PHONE ? [basicSsl()] : [])]),
});
