// Text -> paragraphs -> narration/dialogue segments -> words. Pure, no Vue.

const isLetter = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
const speakable = (t) => /[\p{L}\p{N}]/u.test(t);

/** One paragraph -> [{kind:'narr'|'dlg', text}]; the texts concatenate back to the paragraph. */
export function segmentPara(p, smart = true) {
  const raw = [];
  let i = 0;
  let start = 0;
  const cut = (a, b, kind) => {
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
      !/\s/.test(p[i + 1])
    ) {
      // smart rule: opener has no letter on its left, closer has no letter on its right.
      // ponytail: first valid closer wins, so a possessive inside single-quoted speech
      // ('The boys' rope is gone,') closes early. Upgrade: prefer a closer after punctuation.
      for (let j = i + 2; j < p.length; j++)
        if ((p[j] === "'" || p[j] === "’") && !isLetter(p[j + 1]) && !/\s/.test(p[j - 1])) {
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
  const out = [];
  for (const s of raw)
    speakable(s.text) || !out.length ? out.push(s) : (out[out.length - 1].text += s.text);
  if (out.length > 1 && !speakable(out[0].text)) {
    out[1].text = out[0].text + out[1].text;
    out.shift();
  }
  return out;
}

/**
 * Chapter body -> doc.
 * doc = { paras: number[][] (segment indexes per paragraph), segs, words, chars }
 * seg = { i, para, kind, text, core, lead, trail, words: [{ t, c }] }
 *   core = trimmed text (what is sent to TTS), lead/trail = surrounding whitespace,
 *   word.c = char offset of the word inside core.
 */
export function buildDoc(body, smart = true) {
  const paras = [];
  const segs = [];
  let words = 0;
  let chars = 0;
  for (const p of body
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const idx = [];
    for (const { kind, text } of segmentPara(p, smart)) {
      const core = text.trim();
      const ws = [];
      for (const m of core.matchAll(/\S+/g)) ws.push({ t: m[0], c: m.index });
      idx.push(segs.length);
      segs.push({
        i: segs.length,
        para: paras.length,
        kind,
        text,
        core,
        lead: text.match(/^\s*/)[0],
        trail: text.match(/\s*$/)[0],
        words: ws,
      });
      words += ws.length;
      chars += core.length;
    }
    paras.push(idx);
  }
  return { paras, segs, words, chars };
}

/** Normalise pasted text: line endings, trailing spaces, 3+ newlines. */
export const normalize = (raw) =>
  raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** First line becomes the title when it looks like a heading; else `Chapter N`. */
export function autoTitle(text, existingTitles = []) {
  const nl = text.indexOf("\n");
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  const rest = nl < 0 ? "" : text.slice(nl + 1).trim();
  const heading =
    /^(chapter|ch\.?|episode|ep\.?|part|book|volume|vol\.?|prologue|epilogue|interlude|side story)\b/i.test(
      first,
    ) || /^\d+\s*[.:\-–—]/.test(first);
  const titleish = first.length <= 80 && !/[.!?…,;:"”'’]$/.test(first);
  if (rest && (heading || titleish)) return { title: first, body: rest };
  const top = Math.max(0, ...existingTitles.map((t) => +(t.match(/\d+/) || [0])[0]));
  return { title: "Chapter " + ((top || existingTitles.length) + 1), body: text };
}
