// /api calls to the murmur dev server (dev/server.ts). Other devices get in with a cookie the
// phone link sets; this Mac needs none.
import { reactive } from "vue";

/** error: the last save failed (shown in Settings › Storage); cleared by the next one that works */
export const sync = reactive({ error: "" });

/** fetch /api/<path>; throws on a non-2xx answer. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch("/api/" + path, init);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}
export const getJson = async <T>(path: string): Promise<T> => (await apiFetch(path)).json();
export const sendJson = (path: string, body: unknown, method = "PUT") =>
  apiFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
