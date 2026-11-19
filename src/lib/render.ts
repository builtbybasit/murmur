// A chapter as one HTML string: 30k word spans would be too heavy as reactive vnodes.
import type { Doc, Seg, Word } from "./segment";

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

const attr = (s: string) => esc(s).replace(/"/g, "&quot;");
const wordHtml = (w: Word, k: number) =>
  `<span class="w${w.m ? " " + w.m : ""}" data-w="${k}">${esc(w.t)}</span>`;

/** One segment's words with the text between them; a table row renders one part per cell. */
function segHtml(s: Seg, cell?: number) {
  let out = `<span class="seg ${s.kind}" data-s="${s.i}">`;
  let at = cell === undefined ? 0 : -1; // a cell shows only the text between its own words
  s.words.forEach((w, k) => {
    if (cell !== undefined && w.cell !== cell) return;
    if (at >= 0) out += esc(s.core.slice(at, w.c));
    out += wordHtml(w, k);
    at = w.c + w.t.length;
  });
  if (cell === undefined) out += esc(s.core.slice(at));
  return out + "</span>";
}

/** A chapter as HTML: paragraphs of .seg spans of .w word spans (see Reader). */
export function docHtml(d: Doc): string {
  let out = "";
  let quote = false;
  let table = 0;
  d.paras.forEach((idx, pi) => {
    const b = d.blocks[pi]!;
    if (table && table !== b.table) {
      out += "</table>";
      table = 0;
    }
    if (!!b.quote !== quote) {
      quote = !quote;
      out += quote ? "<blockquote>" : "</blockquote>";
    }
    if (b.rule) out += "<hr>";
    if (b.tag === "img") {
      // book images come from the lectern server; web images load directly
      const s = d.segs[idx[0]!]!;
      const src = s.img!.src.replace(/^img:/, "/api/images/");
      out += `<p class="fig"><span class="seg narr" data-s="${s.i}"><img src="${attr(src)}" alt="${attr(s.img!.alt)}" loading="lazy"></span></p>`;
      return;
    }
    if (b.tag === "tr") {
      if (!table) out += "<table>";
      table = b.table!;
      const s = d.segs[idx[0]!]!;
      const c = b.head ? "th" : "td";
      out += "<tr>";
      for (let k = 0; k < b.cells!; k++) out += `<${c}>${segHtml(s, k)}</${c}>`;
      out += "</tr>";
      return;
    }
    const cls = [b.tag === "h" && "hd", b.tag === "li" && "li", b.center && "ctr"].filter(Boolean);
    out += `<p${cls.length ? ` class="${cls.join(" ")}"` : ""}${b.n ? ` data-n="${attr(b.n)}"` : ""}>`;
    for (const si of idx) {
      const s = d.segs[si]!;
      out += esc(s.lead) + segHtml(s) + esc(s.trail);
    }
    out += "</p>";
  });
  if (table) out += "</table>";
  if (quote) out += "</blockquote>";
  return out;
}
