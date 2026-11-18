// Word timing: estimate from character offsets, or align STT word timestamps onto source words. Pure.
import type { Seg, Word } from "./segment";

export interface Span {
  start: number;
  end: number;
}
export interface SttWord {
  word: string;
  start: number;
  end: number;
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** One {start,end} per word of seg, proportional to character offset in seg.core. */
export function estimateTimes(seg: Pick<Seg, "core" | "words">, duration: number): Span[] {
  const len = seg.core.length || 1;
  const ws = seg.words;
  return ws.map((w, i) => ({
    start: (w.c / len) * duration,
    end: i + 1 < ws.length ? (ws[i + 1]!.c / len) * duration : duration,
  }));
}

const WINDOW = 4; // STT words we may skip over looking for the next match
const MAXJOIN = 3; // words that may be joined on either side ("do n't", "twenty five")

/**
 * Map STT words ({word,start,end}, seconds) onto source words ({t,c}).
 * Returns one {start,end} per source word, starts monotonic, all within [0, duration].
 */
export function alignWords(srcWords: Word[], sttWords: SttWord[], duration: number): Span[] {
  const src = srcWords.map((w) => norm(w.t));
  const stt = sttWords
    .map((w) => ({ n: norm(w.word ?? ""), start: +w.start || 0, end: +w.end || 0 }))
    .filter((w) => w.n);
  const out: (Span | null)[] = Array.from({ length: src.length }, () => null);
  const join = <T>(arr: T[], a: number, b: number, f: (x: T) => string) =>
    arr.slice(a, b).map(f).join("");

  let j = 0;
  for (let i = 0; i < src.length && j < stt.length;) {
    if (!src[i]) {
      i++;
      continue;
    }
    let hit = false;
    for (let k = j; k < Math.min(stt.length, j + WINDOW + 1) && !hit; k++) {
      for (let m = 1; m <= MAXJOIN && !hit; m++) {
        // m STT words make one source word ("do" + "n't" = "don't")
        if (k + m <= stt.length && join(stt, k, k + m, (w) => w.n) === src[i]) {
          out[i] = { start: stt[k]!.start, end: stt[k + m - 1]!.end };
          i++;
          j = k + m;
          hit = true;
        }
        // m source words make one STT word ("well-known" vs "well known")
        else if (m > 1 && i + m <= src.length && join(src, i, i + m, (s) => s) === stt[k]!.n) {
          const { start, end } = stt[k]!;
          const total = src.slice(i, i + m).reduce((a, s) => a + s.length, 0);
          let t = start;
          for (let q = i; q < i + m; q++) {
            const d = ((end - start) * src[q]!.length) / total;
            out[q] = { start: t, end: t + d };
            t += d;
          }
          i += m;
          j = k + 1;
          hit = true;
        }
      }
    }
    if (!hit) i++; // source word missing from the transcript: interpolated below
  }

  // clamp and keep starts monotonic; a match that goes backwards is dropped
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (!w) continue;
    w.start = Math.min(Math.max(w.start, 0), duration);
    w.end = Math.min(Math.max(w.end, w.start), duration);
    if (w.start < last) out[i] = null;
    else last = w.start;
  }

  // unmatched runs share the gap between matched neighbours, weighted by length
  for (let i = 0; i < out.length;) {
    if (out[i]) {
      i++;
      continue;
    }
    let e = i;
    while (e < out.length && !out[e]) e++;
    const from = i > 0 ? out[i - 1]!.end : 0;
    const to = Math.max(from, e < out.length ? out[e]!.start : duration);
    const weights = srcWords.slice(i, e).map((w) => w.t.length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = from;
    for (let q = i; q < e; q++) {
      const d = ((to - from) * weights[q - i]!) / total;
      out[q] = { start: t, end: t + d };
      t += d;
    }
    i = e;
  }
  return out as Span[]; // every gap was filled above
}
