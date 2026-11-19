// The lectern server, as a Vite plugin: the shared library (/api) and the provider relay (/relay).
// Everything lives in ~/.lectern (LECTERN_DATA), outside the folder Vite serves.
//
// Who gets in: this Mac on localhost, and devices that opened the phone link once (its ?key=
// becomes a cookie). Hostnames other than localhost and IP addresses are refused, so a web page
// cannot reach this server by pointing its own domain at 127.0.0.1 (DNS rebinding), and requests
// that change something must come from this app's own origin.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Connect, Plugin } from "vite-plus";
import { renderUnicodeCompact } from "uqr";
import { openPhoneDoor, VIA } from "./phone-door";
import { applyOp, type Chapter, type Library, type Op } from "../src/lib/ops";

// Paths are resolved on first use, so loading the config (lint, format) touches nothing.
export const DATA = () => process.env.LECTERN_DATA ?? join(homedir(), ".lectern");
const file = (name: string) => join(DATA(), name);

// ---------- files ----------

/** Write via a temp file, so a crash never leaves half a library. Synchronous on purpose: a
 * config reload loads this module again, and the new copy must read what the old one wrote. */
function writeAtomic(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", data);
  renameSync(path + ".tmp", path);
}
const readJson = <T>(path: string): T | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
const send = (res: ServerResponse, status: number, body?: unknown) => {
  res.statusCode = status;
  if (body === undefined) return void res.end();
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

// ---------- access ----------

let key: string | undefined;
function getKey() {
  if (key) return key;
  const f = file("key.txt");
  mkdirSync(DATA(), { recursive: true });
  if (!existsSync(f)) writeFileSync(f, randomBytes(12).toString("hex"), { mode: 0o600 });
  return (key = readFileSync(f, "utf8").trim());
}
const COOKIE = "lectern";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const hostOk = (host = "") => {
  const name = host.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  return name === "localhost" || isIP(name) !== 0;
};
const cookieKey = (req: IncomingMessage) =>
  /(?:^|;\s*)lectern=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];

/** Every request: the Host and Origin checks, then the key (from the link or the cookie). */
const guard: Connect.NextHandleFunction = (req, res, next) => {
  if (!hostOk(req.headers.host)) return send(res, 403, { error: "Unknown host" });
  const origin = req.headers.origin;
  const safe = req.method === "GET" || req.method === "HEAD";
  if (!safe && origin && new URL(origin).host !== req.headers.host)
    return send(res, 403, { error: "Cross-origin request" });

  const u = new URL(req.url ?? "/", "http://x");
  const k = u.searchParams.get("key");
  if (k && k === getKey()) {
    // the phone link: remember the key as a cookie and drop it from the address bar
    u.searchParams.delete("key");
    res.setHeader(
      "set-cookie",
      `${COOKIE}=${k}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax; Secure`,
    );
    res.statusCode = 302;
    res.setHeader("location", u.pathname + u.search);
    return void res.end();
  }
  const local = LOOPBACK.has(req.socket.remoteAddress ?? "") && !req.headers[VIA];
  if (local || cookieKey(req) === getKey()) return next();
  res.statusCode = 401;
  res.end("Open the phone link from the lectern app on your Mac");
};

// ---------- library ----------

let lib: Library | undefined;
function loadLib(): Library {
  if (lib) return lib;
  const raw = readJson<{ chapters?: unknown; order?: string[] }>(file("library.json"));
  const state = readJson<Pick<Library, "positions" | "currentId">>(file("state.json"));
  lib = { chapters: [], positions: {}, currentId: null, ...state };
  if (Array.isArray(raw?.chapters)) lib.chapters = raw.chapters as Chapter[];
  else if (raw?.order) {
    // the old format: {order, chapters: {id: chapter with pos}}; converted once
    const old = raw.chapters as Record<
      string,
      Chapter & { pos?: number; raw?: string; short?: boolean }
    >;
    const settings = readJson<{ lastChapterId?: string }>(file("settings.json"));
    lib.currentId = settings?.lastChapterId ?? null;
    for (const id of raw.order) {
      const c = old[id];
      if (!c) continue;
      const { pos, raw: _r, short: _s, ...rest } = c;
      lib.chapters.push(rest);
      if (pos) lib.positions[id] = pos;
    }
    saveLib(true);
  }
  return lib;
}
function saveLib(chapters: boolean) {
  const l = lib!;
  if (chapters) writeAtomic(file("library.json"), JSON.stringify({ chapters: l.chapters }));
  writeAtomic(
    file("state.json"),
    JSON.stringify({ positions: l.positions, currentId: l.currentId }),
  );
}

// ---------- settings: API keys stay here ----------

interface Provider {
  id: string;
  baseUrl: string;
  apiKey?: string;
  hasKey?: boolean;
}
type Settings = { providers?: Provider[] } & Record<string, unknown>;
let settings: Settings | null | undefined;
const loadSettings = () =>
  settings === undefined ? (settings = readJson<Settings>(file("settings.json"))) : settings;
const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

/** What browsers see: providers without their keys. */
const masked = (s: Settings | null) =>
  s && {
    ...s,
    providers: (s.providers ?? []).map(({ apiKey, ...p }) => ({
      ...p,
      apiKey: "",
      hasKey: !!apiKey,
    })),
  };

/** A browser sends "" for a key it did not change: keep the saved one. */
function saveSettings(next: Settings) {
  if (typeof next !== "object" || !next || !Array.isArray(next.providers ?? []))
    throw new Error("settings must be an object with a providers list");
  const old = new Map((loadSettings()?.providers ?? []).map((p) => [p.id, p.apiKey]));
  next.providers = (next.providers ?? []).map(({ hasKey: _h, ...p }) => ({
    ...p,
    apiKey: p.apiKey || old.get(p.id) || "",
  }));
  delete next.lastChapterId; // from the old format
  writeAtomic(file("settings.json"), JSON.stringify(next));
  settings = next;
}

// ---------- images ----------

const IMAGES = () => file("images");
function unusedImages() {
  const dir = IMAGES();
  const ids = existsSync(dir) ? readdirSync(dir).filter((f) => !f.includes(".")) : [];
  const used = new Set(
    loadLib().chapters.flatMap((c) =>
      [...c.body.matchAll(/\(img:([0-9a-f]+)\)/g)].map((m) => m[1]!),
    ),
  );
  const unused = ids.filter((id) => !used.has(id));
  return {
    total: ids.length,
    unused,
    bytes: unused.reduce((n, id) => n + statSync(join(dir, id)).size, 0),
  };
}

// ---------- /api ----------

const ID = /^[\w-]{1,80}$/;

async function api(req: IncomingMessage, res: ServerResponse) {
  const [, kind, id] = (req.url ?? "").split("?")[0]!.split("/");
  const m = req.method ?? "GET";
  try {
    if (kind === "library" && m === "GET") return send(res, 200, loadLib());
    if (kind === "library" && m === "POST") {
      const o = JSON.parse(String(await readBody(req))) as Op;
      applyOp(loadLib(), o);
      saveLib(o.op !== "pos");
      return send(res, 204);
    }
    if (kind === "settings" && m === "GET") return send(res, 200, masked(loadSettings()));
    if (kind === "settings" && m === "PUT") {
      saveSettings(JSON.parse(String(await readBody(req))) as Settings);
      return send(res, 204);
    }
    // the phone link for the app's "Listen on your phone" QR code (empty: not on the network)
    if (kind === "phone" && m === "GET") return send(res, 200, { links });
    if (kind === "images" && !id) {
      const u = unusedImages();
      if (m === "GET")
        return send(res, 200, { total: u.total, count: u.unused.length, bytes: u.bytes });
      if (m === "DELETE") {
        for (const i of u.unused)
          for (const f of [i, i + ".type"]) rmSync(join(IMAGES(), f), { force: true });
        return send(res, 204);
      }
    }
    if (kind === "images" && id && ID.test(id)) {
      const f = join(IMAGES(), id);
      if (m === "GET") {
        if (!existsSync(f)) return send(res, 404);
        res.setHeader("content-type", readFileSync(f + ".type", "utf8"));
        res.setHeader("cache-control", "private, max-age=31536000, immutable");
        return void res.end(readFileSync(f));
      }
      if (m === "PUT") {
        const body = await readBody(req); // same id, same bytes: written once
        if (!existsSync(f)) {
          writeAtomic(f, body);
          writeFileSync(f + ".type", req.headers["content-type"] ?? "application/octet-stream");
        }
        return send(res, 204);
      }
    }
    send(res, 404);
  } catch (e) {
    send(res, 400, { error: String((e as Error).message) });
  }
}

/** The links a phone on the same network opens (with the key, which becomes a cookie). */
let links: string[] = [];
function phoneLinks(port: number) {
  return (links = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `https://${a!.address}:${port}/?key=${getKey()}`));
}

// ---------- /relay ----------

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

// Browser -> /relay (x-target: full provider URL, x-provider: its id) -> provider. Avoids CORS on
// every provider, and adds the saved API key, which no browser has.
async function relay(req: IncomingMessage, res: ServerResponse) {
  const sm = /^\/stream\/([\w-]+)/.exec(req.url ?? "");
  if (sm) return listen(sm[1]!, res);
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
  // the key only goes to the provider's own address
  const p = loadSettings()?.providers?.find((p) => p.id === req.headers["x-provider"]);
  if (
    !headers.authorization &&
    p?.apiKey &&
    p.baseUrl &&
    target.startsWith(trimUrl(p.baseUrl) + "/")
  )
    headers.authorization = "Bearer " + p.apiKey.trim();
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

// ---------- the plugin ----------

// The dev server is always reachable from your phone: on the network, over HTTPS (phones only
// allow lock-screen controls on secure pages). LECTERN_LOCAL=1 keeps it to this Mac.
const PHONE = !process.env.LECTERN_LOCAL;

function mount(m: Connect.Server) {
  m.use(guard);
  m.use("/relay", relay);
  m.use("/api", api);
}

export const lectern: Plugin = {
  name: "lectern",
  configureServer(s) {
    mount(s.middlewares);
    if (PHONE)
      s.httpServer?.once("listening", async () => {
        const door = await openPhoneDoor(
          (s.httpServer!.address() as AddressInfo).port,
          file("cert"),
        );
        if (!door) return;
        s.httpServer!.once("close", door.close); // Vite restarts on config changes
        const [link] = phoneLinks(door.port);
        setTimeout(() => {
          if (!link) return;
          console.log(
            "\n  On your phone (same Wi-Fi): scan, then accept the certificate warning once",
          );
          // black on white whatever the terminal theme: phone cameras read dark-on-light codes
          const qr = renderUnicodeCompact(link, { border: 1 });
          console.log(qr.replace(/^.*$/gm, (l) => `  \x1b[30;107m${l}\x1b[0m`));
          console.log("  ➜  " + link + "\n");
        }, 50);
      });
  },
  configurePreviewServer: (s) => mount(s.middlewares),
};
