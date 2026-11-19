// Book images (from EPUB imports) in IndexedDB, keyed by content hash. Chapters reference them
// as ![alt](img:<id>) in their Markdown.
import { createStore, delMany, entries, get, set } from "idb-keyval";
import { apiFetch } from "./server";

const store = createStore("lectern-images", "images");

/** Store an image once (same bytes, same id) and return its id. */
export async function putImage(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const id = Array.from(new Uint8Array(hash).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (!(await get(id, store))) await set(id, blob, store);
  // the shared library (other devices) gets a copy; no server (a static build): local only
  await apiFetch("images/" + id, {
    method: "PUT",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  }).catch(() => {});
  return id;
}

// ponytail: images are never deleted with their chapters; add a sweep if storage ever matters
const urls = new Map<string, Promise<string | null>>();
/** Object URL for an image id, or null when it is missing. */
export function imageUrl(id: string): Promise<string | null> {
  let u = urls.get(id);
  if (!u)
    urls.set(
      id,
      (u = (async () => {
        let b = await get<Blob>(id, store).catch(() => undefined);
        if (!b) {
          // imported on another device: fetch it from the shared library once
          b = await apiFetch("images/" + id)
            .then((r) => r.blob())
            .catch(() => undefined);
          if (b) await set(id, b, store).catch(() => {});
        }
        return b ? URL.createObjectURL(b) : null;
      })()),
    );
  return u;
}

/** Images no chapter body references any more: count and bytes, plus a remover. */
export async function unusedImages(bodies: string[]) {
  const used = new Set(
    bodies.flatMap((b) => [...b.matchAll(/\(img:([0-9a-f]+)\)/g)].map((m) => m[1]!)),
  );
  const all = await entries<string, Blob>(store);
  const unused = all.filter(([id]) => !used.has(id));
  return {
    total: all.length,
    count: unused.length,
    bytes: unused.reduce((n, [, b]) => n + b.size, 0),
    remove: async () => {
      const ids = unused.map(([id]) => id);
      await delMany(ids, store);
      for (const id of ids) await apiFetch("images/" + id, { method: "DELETE" }).catch(() => {});
    },
  };
}
