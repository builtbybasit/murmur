// Voice ids: blend strings (`af_heart:0.7,af_bella:0.3`) and grouping for the picker.

export interface BlendPart {
  id: string;
  w: number;
}

/** "a:0.7,b:0.3" -> parts; "a,b" -> equal weights; "a" -> one part. */
export function parseBlend(voice: string): BlendPart[] {
  return voice
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [id, w] = p.split(":");
      const n = Number(w);
      return { id: id!.trim(), w: w != null && Number.isFinite(n) && n > 0 ? n : 1 };
    });
}

/** Parts -> voice id with weights normalised to sum 1 (2 decimals). One part -> plain id. */
export function formatBlend(parts: BlendPart[]): string {
  const ok = parts.filter((p) => p.id && p.w > 0);
  if (ok.length === 1) return ok[0]!.id;
  const sum = ok.reduce((s, p) => s + p.w, 0);
  return ok.map((p) => `${p.id}:${+(p.w / sum).toFixed(2)}`).join(",");
}

export const isBlend = (voice: string) => parseBlend(voice).length > 1;

// Kokoro-style ids: first letter = language, second = f/m. Others fall into "Other".
const LANG: Record<string, string> = {
  a: "American",
  b: "British",
  e: "Spanish",
  f: "French",
  h: "Hindi",
  i: "Italian",
  j: "Japanese",
  p: "Portuguese",
  z: "Mandarin",
};

export function voiceGroup(id: string): string {
  if (isBlend(id)) return "Blends";
  const m = /^([a-z])([fm])_/.exec(id);
  if (!m || !LANG[m[1]!]) return "Other";
  return `${LANG[m[1]!]} ${m[2] === "f" ? "female" : "male"}`;
}

/** Group ids, keeping provider order inside groups; Blends first, Other last. */
export function groupVoices(ids: string[]): { name: string; ids: string[] }[] {
  const map = new Map<string, string[]>();
  for (const id of ids) {
    const g = voiceGroup(id);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(id);
  }
  const rank = (n: string) => (n === "Blends" ? 0 : n === "Other" ? 2 : 1);
  return [...map].map(([name, ids]) => ({ name, ids })).sort((a, b) => rank(a.name) - rank(b.name));
}
