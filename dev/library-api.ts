// Shared library for every device on your network: chapters, order, settings and images live on
// this machine in ~/.lectern (LECTERN_DATA), outside the project folder the dev server serves.
// Requests from other devices need the access key printed at startup; this machine needs none.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";

// Paths are resolved on first use, so loading the config (lint, format) touches nothing.
const DATA = () => process.env.LECTERN_DATA ?? join(homedir(), ".lectern");
const IMAGES = () => {
  const dir = join(DATA(), "images");
  mkdirSync(dir, { recursive: true });
  return dir;
};
let key: string | undefined;
function getKey() {
  if (key) return key;
  const file = join(DATA(), "key.txt");
  mkdirSync(DATA(), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(12).toString("hex"), { mode: 0o600 });
  return (key = readFileSync(file, "utf8").trim());
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const allowed = (req: IncomingMessage) =>
  LOOPBACK.has(req.socket.remoteAddress ?? "") || req.headers["x-lectern-key"] === getKey();

export async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Write via a temp file, so a crash never leaves half a library. */
function writeAtomic(file: string, data: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".tmp", data);
  renameSync(file + ".tmp", file);
}
const readJson = <T>(file: string): T | null =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;

type Chapter = { id: string } & Record<string, unknown>;
interface Library {
  order: string[];
  chapters: Record<string, Chapter>;
}
const LIB = () => join(DATA(), "library.json");
const SETTINGS = () => join(DATA(), "settings.json");
let lib: Library | null | undefined; // undefined: not read yet
let saveT: ReturnType<typeof setTimeout> | undefined;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      if (lib) writeAtomic(LIB(), JSON.stringify(lib));
    } catch (e) {
      console.error("lectern: could not save the library:", (e as Error).message); // never crash the server
    }
  }, 400);
};

const send = (res: ServerResponse, status: number, body?: unknown) => {
  res.statusCode = status;
  if (body === undefined) return void res.end();
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};
const ID = /^[\w-]{1,80}$/;

export async function api(req: IncomingMessage, res: ServerResponse) {
  if (!allowed(req))
    return send(res, 401, { error: "Open the phone link printed by the dev server" });
  if (lib === undefined) lib = readJson<Library>(LIB());
  const [, kind, id] = (req.url ?? "").split("?")[0]!.split("/");
  const m = req.method ?? "GET";
  try {
    if (kind === "library" && m === "GET")
      return send(res, 200, {
        initialized: !!lib,
        chapters: lib ? lib.order.map((i) => lib!.chapters[i]).filter(Boolean) : [],
      });
    if (kind === "library" && m === "PUT") {
      const chapters = JSON.parse(String(await readBody(req))) as Chapter[];
      lib = {
        order: chapters.map((c) => c.id),
        chapters: Object.fromEntries(chapters.map((c) => [c.id, c])),
      };
      save();
      return send(res, 204);
    }
    if (kind === "order" && m === "PUT") {
      lib ??= { order: [], chapters: {} };
      const order = JSON.parse(String(await readBody(req))) as string[];
      lib.order = order.filter((i) => lib!.chapters[i]);
      save();
      return send(res, 204);
    }
    if (kind === "chapters" && id && ID.test(id)) {
      lib ??= { order: [], chapters: {} };
      if (m === "PUT") {
        lib.chapters[id] = { ...(JSON.parse(String(await readBody(req))) as Chapter), id };
        if (!lib.order.includes(id)) lib.order.push(id);
      } else if (m === "DELETE") {
        delete lib.chapters[id];
        lib.order = lib.order.filter((i) => i !== id);
      } else return send(res, 405);
      save();
      return send(res, 204);
    }
    if (kind === "settings" && m === "GET") return send(res, 200, readJson(SETTINGS()));
    if (kind === "settings" && m === "PUT") {
      writeAtomic(SETTINGS(), await readBody(req));
      return send(res, 204);
    }
    if (kind === "images" && id && ID.test(id)) {
      const file = join(IMAGES(), id);
      if (m === "GET") {
        if (!existsSync(file)) return send(res, 404);
        res.setHeader("content-type", readFileSync(file + ".type", "utf8"));
        res.setHeader("cache-control", "private, max-age=31536000, immutable");
        return void res.end(readFileSync(file));
      }
      if (m === "PUT") {
        writeAtomic(file, await readBody(req));
        writeFileSync(file + ".type", req.headers["content-type"] ?? "application/octet-stream");
        return send(res, 204);
      }
      if (m === "DELETE") {
        rmSync(file, { force: true });
        rmSync(file + ".type", { force: true });
        return send(res, 204);
      }
    }
    send(res, 404);
  } catch (e) {
    send(res, 400, { error: String((e as Error).message) });
  }
}

/** The links a phone on the same network opens (with the key, which the app then remembers). */
export function phoneLinks(https: boolean, port: number) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `${https ? "https" : "http"}://${a!.address}:${port}/?key=${getKey()}`);
}
