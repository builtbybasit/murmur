import vue from "@vitejs/plugin-vue";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";

// Browser -> /relay (x-target: full provider URL) -> provider. Avoids CORS on every provider.
// ponytail: open relay on the dev/preview server, fine while Vite binds localhost only.
async function relay(req: IncomingMessage, res: ServerResponse) {
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
      body: hasBody ? (Readable.toWeb(req) as unknown as BodyInit) : undefined,
      signal: ac.signal,
      // @ts-expect-error duplex is required by Node for streamed bodies but missing from lib.dom RequestInit
      duplex: "half",
    });
    res.statusCode = r.status;
    for (const k of ["content-type", "retry-after"]) {
      const v = r.headers.get(k);
      if (v) res.setHeader(k, v);
    }
    if (r.body) Readable.fromWeb(r.body as NodeReadableStream).on("error", () => res.destroy()).pipe(res);
    else res.end();
  } catch (e: any) {
    if (ac.signal.aborted) return;
    res.statusCode = 502;
    res.setHeader("x-relay-error", "1"); // network failure, not a provider response
    res.end(String(e.cause?.message ?? e.message));
  }
}
const relayPlugin: Plugin = {
  name: "lectern-relay",
  configureServer: (s) => void s.middlewares.use("/relay", relay),
  configurePreviewServer: (s) => void s.middlewares.use("/relay", relay),
};

// https://vite.dev/config/
export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [vue(), relayPlugin]),
});
