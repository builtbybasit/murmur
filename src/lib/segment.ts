// Text -> paragraphs -> narration/dialogue segments -> words. Pure, no Vue.
import { markdownLines, plainTitle, type Block, type Span } from "./markdown";
export type { Block };

export type Kind = "narr" | "dlg" | "sys";
export interface Word {
  t: string;
  c: number;
  /** formatting classes ("b i"), from Markdown chapters */
  m?: string;
  /** table cell index, for table rows */
  cell?: number;
}
export interface Seg {
  i: number;
  para: number;
  kind: Kind;
  text: string;
  core: string;
  lead: string;
  trail: string;
  words: Word[];
}
export interface Doc {
  paras: number[][];
  /** how each paragraph is shown (parallel to paras) */
  blocks: Block[];
  segs: Seg[];
  words: number;
  chars: number;
}

const isLetter = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const speakable = (t: string) => /[\p{L}\p{N}]/u.test(t);

/** One paragraph -> [{kind:'narr'|'dlg', text}]; the texts concatenate back to the paragraph. */
export function segmentPara(p: string, smart = true): { kind: Kind; text: string }[] {
  const raw: { kind: Kind; text: string }[] = [];
  let i = 0;
  let start = 0;
  const cut = (a: number, b: number, kind: Kind) => {
    if (b > a) raw.push({ kind, text: p.slice(a, b) });
  };
  while (i < p.length) {
    const c = p[i];
    let end = -1;
    if (c === '"' || c === "“") {
      end = p.indexOf(c === '"' ? '"' : "”", i + 1);
      if (end < 0) end = p.length - 1; // unclosed: speech runs on into the next paragraph
    } else if (
      smart &&
      (c === "'" || c === "‘") &&
      !isLetter(p[i - 1]) &&
      p[i + 1] &&
      !/\s/.test(p[i + 1]!)
    ) {
      // smart rule: opener has no letter on its left, closer has no letter on its right.
      // ponytail: first valid closer wins, so a possessive inside single-quoted speech
      // ('The boys' rope is gone,') closes early. Upgrade: prefer a closer after punctuation.
      for (let j = i + 2; j < p.length; j++)
        if ((p[j] === "'" || p[j] === "’") && !isLetter(p[j + 1]) && !/\s/.test(p[j - 1]!)) {
          end = j;
          break;
        }
    }
    if (end >= 0) {
      cut(start, i, "narr");
      cut(i, end + 1, "dlg");
      i = start = end + 1;
    } else i++;
  }
  cut(start, p.length, "narr");
  // a piece with nothing to say rides along with its neighbour: no empty TTS requests
  const out: typeof raw = [];
  for (const s of raw) {
    if (speakable(s.text) || !out.length) out.push(s);
    else out[out.length - 1]!.text += s.text;
  }
  if (out.length > 1 && !speakable(out[0]!.text)) {
    out[1]!.text = out[0]!.text + out[1]!.text;
    out.shift();
  }
  return out;
}

/**
 * Chapter body -> doc.
 * doc = { paras: number[][] (segment indexes per paragraph), blocks, segs, words, chars }
 * seg = { i, para, kind, text, core, lead, trail, words: [{ t, c, m?, cell? }] }
 *   core = trimmed text (what is sent to TTS), lead/trail = surrounding whitespace,
 *   word.c = char offset of the word inside core, word.m = formatting classes.
 * The body is Markdown; every line is its own paragraph.
 */
export function buildDoc(body: string, smart = true): Doc {
  const paras: number[][] = [];
  const blocks: Block[] = [];
  const segs: Seg[] = [];
  let words = 0;
  let chars = 0;
  const push = (kind: Kind, text: string, core: string, ws: Word[], idx: number[]) => {
    idx.push(segs.length);
    segs.push({
      i: segs.length,
      para: paras.length,
      kind,
      text,
      core,
      lead: text.match(/^\s*/)![0],
      trail: text.match(/\s*$/)![0],
      words: ws,
    });
    words += ws.length;
    chars += core.length;
  };
  const para = ({ text: p, marks }: Span, sys: boolean) => {
    const idx: number[] = [];
    let off = 0;
    // a system message is one segment: quotes inside it (Player 'Adam') are not dialogue
    for (const { kind, text } of sys ? [{ kind: "sys" as Kind, text: p }] : segmentPara(p, smart)) {
      const core = text.trim();
      const at = off + text.length - text.trimStart().length;
      const ws: Word[] = [];
      for (const m of core.matchAll(/\S+/g)) {
        const w: Word = { t: m[0], c: m.index! };
        if (marks[at + w.c]) w.m = marks[at + w.c];
        ws.push(w);
      }
      push(kind, text, core, ws, idx);
      off += text.length;
    }
    return idx;
  };
  // a table row is one system segment: "Strength, 12", words keep their cell
  const row = (cells: Span[]) => {
    let core = "";
    const ws: Word[] = [];
    cells.forEach(({ text, marks }, cell) => {
      const t = text.trim();
      if (!t) return;
      if (core) core += /[,.:;!?]$/.test(core) ? " " : ", ";
      const at = text.length - text.trimStart().length;
      for (const m of t.matchAll(/\S+/g)) {
        const w: Word = { t: m[0], c: core.length + m.index!, cell };
        if (marks[at + m.index!]) w.m = marks[at + m.index!];
        ws.push(w);
      }
      core += t;
    });
    const idx: number[] = [];
    push("sys", core, core, ws, idx);
    return idx;
  };

  for (const { block, parts } of markdownLines(body)) {
    if (block.tag === "tr") paras.push(row(parts));
    else {
      const s = parts[0]!;
      const lead = s.text.length - s.text.trimStart().length;
      const p = { text: s.text.trim(), marks: s.marks.slice(lead, lead + s.text.trim().length) };
      paras.push(para(p, !!block.quote || isSystem(p)));
    }
    blocks.push(block);
  }
  return { paras, blocks, segs, words, chars };
}

/** "[You gained a level.]" or a line in bold: a LitRPG system message. */
export function isSystem({ text, marks }: Span): boolean {
  if (/^\[[\s\S]*\][.!?…]*$/.test(text)) return true;
  const starts = [...text.matchAll(/\S+/g)].map((m) => m.index!);
  return !!starts.length && starts.every((i) => /\bb\b/.test(marks[i] ?? ""));
}

/** Normalise pasted text: line endings, trailing spaces, 3+ newlines. */
export const normalize = (raw: string) =>
  raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** First line becomes the title when it looks like a heading; else `Chapter N`. */
export function autoTitle(
  text: string,
  existingTitles: string[] = [],
): { title: string; body: string } {
  const nl = text.indexOf("\n");
  const line = (nl < 0 ? text : text.slice(0, nl)).trim();
  const first = plainTitle(line);
  const rest = nl < 0 ? "" : text.slice(nl + 1).trim();
  const heading =
    /^(chapter|ch\.?|episode|ep\.?|part|book|volume|vol\.?|prologue|epilogue|interlude|side story)\b/i.test(
      first,
    ) || /^\d+\s*[.:\-–—]/.test(first);
  const titleish = first.length <= 80 && !/[.!?…,;:"”'’]$/.test(first);
  if (rest && (heading || titleish)) return { title: first, body: rest };
  const top = Math.max(0, ...existingTitles.map((t) => +(t.match(/\d+/)?.[0] ?? 0)));
  return { title: "Chapter " + ((top || existingTitles.length) + 1), body: text };
}
