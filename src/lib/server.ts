// Talking to the lectern dev server: the access key (from the phone link) and /api calls.

/** The key arrives once as ?key=… in the phone link; it is remembered and removed from the URL. */
const key = (() => {
  try {
    const u = new URL(location.href);
    const k = u.searchParams.get("key");
    if (k) {
      localStorage.setItem("lectern.key", k);
      u.searchParams.delete("key");
      history.replaceState(null, "", u);
    }
    return localStorage.getItem("lectern.key") ?? "";
  } catch {
    return "";
  }
})();
export const keyHeaders = (): Record<string, string> => (key ? { "x-lectern-key": key } : {});

/** fetch /api/<path> with the key; throws on a non-2xx answer. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch("/api/" + path, {
    ...init,
    headers: { ...keyHeaders(), ...(init.headers as Record<string, string>) },
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}
export const putJson = (path: string, body: unknown) =>
  apiFetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
