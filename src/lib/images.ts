// Book images (from EPUB imports) on the lectern server, keyed by content hash. Chapters reference
// them as ![alt](img:<id>) in their Markdown; the reader shows /api/images/<id>.
import { apiFetch, getJson } from "./server";

/** Store an image once (same bytes, same id) and return its id. */
export async function putImage(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const id = Array.from(new Uint8Array(hash).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  await apiFetch("images/" + id, {
    method: "PUT",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  });
  return id;
}

/** Images no chapter references any more (the server checks): how many, and their bytes. */
export const unusedImages = () =>
  getJson<{ total: number; count: number; bytes: number }>("images");
export const removeUnusedImages = () => apiFetch("images", { method: "DELETE" });
