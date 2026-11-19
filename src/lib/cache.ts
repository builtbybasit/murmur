// Audio cache in IndexedDB: one entry per (provider URL, model, voice, text), with duration and STT words.
import { createStore, get, getMany, set, del, delMany, entries, clear, keys } from "idb-keyval";
import type { SttWord } from "./align";

export interface CacheEntry {
  blob: Blob;
  duration: number; // seconds at 1.0x
  stt: SttWord[] | null; // raw STT word timestamps, aligned on load
}

const store = createStore("murmur-audio", "segments");

// ponytail: one-time copy of audio cached under the app's old name, one entry at a time (phones
// have little memory); delete with ~/.lectern's move
void (async () => {
  if (!(await indexedDB.databases()).some((d) => d.name === "lectern-audio")) return;
  const old = createStore("lectern-audio", "segments");
  for (const k of await keys(old)) {
    const e = await get(k, old);
    if (e) await set(k, e, store);
  }
  indexedDB.deleteDatabase("lectern-audio"); // finishes once this page closes the old store
})().catch(() => {});

// cyrb53, run twice with different seeds: ~106 bits, synchronous (crypto.subtle is async and
// missing outside secure contexts). ponytail: not cryptographic, collisions are astronomically unlikely here.
function cyrb53(str: string, seed: number) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function cacheKey(baseUrl: string, model: string, voice: string, text: string) {
  const s = JSON.stringify([baseUrl.trim().replace(/\/+$/, ""), model, voice, text]);
  return cyrb53(s, 1) + cyrb53(s, 2);
}

export const getEntry = (key: string) => get<CacheEntry>(key, store);
export const getEntries = (keys: string[]) => getMany<CacheEntry | undefined>(keys, store);
export const putEntry = (key: string, e: CacheEntry) => set(key, e, store);
export const dropEntry = (key: string) => del(key, store);
export const clearAll = () => clear(store);
export const dropEntries = (keys: string[]) => delMany(keys, store);
/** [key, bytes, has word timings] of every cached segment. */
export const sizes = async () =>
  (await entries<string, CacheEntry>(store)).map(
    ([k, e]) => [k, e.blob?.size ?? 0, !!e.stt] as const,
  );
