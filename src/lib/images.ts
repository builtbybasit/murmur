// Book images (from EPUB imports) in IndexedDB, keyed by content hash. Chapters reference them
// as ![alt](img:<id>) in their Markdown.
import { createStore, get, set } from "idb-keyval";

const store = createStore("lectern-images", "images");

/** Store an image once (same bytes, same id) and return its id. */
export async function putImage(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const id = Array.from(new Uint8Array(hash).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (!(await get(id, store))) await set(id, blob, store);
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
      (u = get<Blob>(id, store).then(
        (b) => (b ? URL.createObjectURL(b) : null),
        () => null,
      )),
    );
  return u;
}
