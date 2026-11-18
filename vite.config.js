import vue from "@vitejs/plugin-vue";
import { Readable } from "node:stream";
import { defineConfig, lazyPlugins } from "vite-plus";

// Browser -> /relay (x-target: full provider URL) -> provider. Avoids CORS on every provider.
// ponytail: open relay on the dev/preview server, fine while Vite binds localhost only.
async function relay(req, res) {
  const target = req.headers["x-target"];
  if (!/^https?:\/\//.test(target ?? "")) {
    res.statusCode = 400;
    return res.end("x-target header required");
  }
  const headers = {};
  for (const k of ["authorization", "content-type", "accept"]) if (req.headers[k]) headers[k] = req.headers[k];
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  try {
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: "half",
      signal: ac.signal,
    });
    res.statusCode = r.status;
    for (const k of ["content-type", "retry-after"]) if (r.headers.get(k)) res.setHeader(k, r.headers.get(k));
    if (r.body) Readable.fromWeb(r.body).on("error", () => res.destroy()).pipe(res);
    else res.end();
  } catch (e) {
    if (ac.signal.aborted) return;
    res.statusCode = 502;
    res.setHeader("x-relay-error", "1"); // network failure, not a provider response
    res.end(String(e.cause?.message ?? e.message));
  }
}
const relayPlugin = {
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
