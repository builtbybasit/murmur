// Formatted chapters: pasted HTML -> Markdown (stored, editable) -> lines with per-character marks.
import markdownit, { type Token } from "markdown-it";
import TurndownService from "turndown";

// ---------- HTML -> Markdown (at paste time) ----------

const td = new TurndownService({
  headingStyle: "atx",
  hr: "***",
  emDelimiter: "*",
  strongDelimiter: "**",
  bulletListMarker: "-",
  br: "", // <br> becomes a plain newline: every line is its own paragraph, like plain text
});
td.remove(["script", "style", "noscript", "iframe", "button", "input"]);
// An image is its own paragraph. Only stored book images, web images and inline data images.
td.addRule("img", {
  filter: "img",
  replacement: (_, n) => {
    const src = (n as HTMLElement).getAttribute("src") ?? "";
    const alt = ((n as HTMLElement).getAttribute("alt") ?? "").replace(/[[\]\n]/g, " ").trim();
    return /^(img:|https?:|data:image\/)/.test(src) ? `\n\n![${alt}](${src})\n\n` : "";
  },
});
td.addRule("link", { filter: "a", replacement: (c) => c }); // keep the words, drop the URL
// Emphasis per line: Royal Road titles put a <br> inside <strong>, and "**a\n**" is not bold.
const wrap = (d: string) => (c: string) =>
  c
    .split("\n")
    .map((l) => (l.trim() ? d + l + d : l))
    .join("\n");
td.addRule("strong", { filter: ["strong", "b"], replacement: wrap("**") });
td.addRule("em", { filter: ["em", "i"], replacement: wrap("*") });
td.addRule("strike", {
  filter: ["s", "del", "strike"] as (keyof HTMLElementTagNameMap)[],
  replacement: wrap("~~"),
});

// Centred lines (Chrome copies text-align inline): "-> text <-", each line of the paragraph.
const centred = (n: HTMLElement) =>
  /text-align:\s*center/i.test(n.getAttribute("style") ?? "") ||
  /^center$/i.test(n.getAttribute("align") ?? "");
const centre = (c: string) =>
  c
    .split("\n")
    .map((l) => (l.trim() ? `-> ${l.trim()} <-` : l))
    .join("\n");
td.addRule("centred", {
  filter: (n) => /^(P|H[1-6])$/.test(n.nodeName) && centred(n),
  replacement: (c, n) =>
    n.nodeName === "P"
      ? `\n\n${centre(c)}\n\n`
      : `\n\n${"#".repeat(+n.nodeName[1]!)} ${centre(c.replace(/\s*\n\s*/g, " "))}\n\n`,
});

// Tables: one-column tables (Royal Road "system boxes") become quotes, others GFM tables.
type El = HTMLElement;
const tableOf = (n: El) => {
  let p: El | null = n;
  while (p && p.nodeName !== "TABLE") p = p.parentNode as El | null;
  return p;
};
const rowsOf = (t: El) => Array.from(t.querySelectorAll("tr")).filter((r) => tableOf(r) === t);
const cellsOf = (r: El) => Array.from(r.children).filter((c) => /^T[DH]$/.test(c.nodeName));
const cols = (t: El) => Math.max(0, ...rowsOf(t).map((r) => cellsOf(r).length));
const boxy = (n: El) => cols(tableOf(n)!) <= 1;

td.addRule("tableSection", {
  filter: ["thead", "tbody", "tfoot"],
  replacement: (c) => c,
});
td.addRule("cell", {
  filter: ["td", "th"],
  replacement: (c, n) =>
    boxy(n as El)
      ? `\n\n${c}\n\n`
      : ` ${
          c
            .replace(/\s*\n+\s*/g, " ")
            .trim()
            .replace(/\|/g, "\\|") || " "
        } |`,
});
td.addRule("row", {
  filter: "tr",
  replacement: (c, n) => {
    const t = tableOf(n as El)!;
    if (boxy(n as El)) return c;
    const width = cols(t);
    const line = `|${c}${" |".repeat(width - cellsOf(n as El).length)}\n`;
    return rowsOf(t)[0] === n ? line + "|" + " --- |".repeat(width) + "\n" : line;
  },
});
td.addRule("table", {
  filter: "table",
  replacement: (c, n) =>
    boxy(n as El)
      ? "\n\n" +
        c
          .trim()
          .split("\n")
          .map((l) => ("> " + l).trimEnd())
          .join("\n") +
        "\n\n"
      : `\n\n${c.trim()}\n\n`,
});

/** Clipboard HTML -> Markdown. Hidden anti-copy text is already gone: Chrome skips display:none. */
export const htmlToMarkdown = (html: string) =>
  td
    .turndown(html)
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "") // trailing spaces
    .replace(/\n\n[ \t]+/g, "\n\n"); // ponytail: no paragraph starts indented (flattens a nested list after a blank line)

// ---------- Markdown -> lines ----------

export interface Block {
  tag: "p" | "h" | "li" | "tr" | "img";
  /** image source and description, for tag "img" */
  src?: string;
  alt?: string;
  quote?: boolean;
  /** horizontal rule before this block (scene break) */
  rule?: boolean;
  /** list marker: "•" or "3." */
  n?: string;
  /** table number (1-based) and row info */
  table?: number;
  head?: boolean;
  cells?: number;
  center?: boolean;
}
/** Text with one mark string per UTF-16 unit: "", "b", "b i", "s", "c"… */
export interface Span {
  text: string;
  marks: string[];
}
export interface Line {
  block: Block;
  /** one span, or one per table cell */
  parts: Span[];
}

const md = markdownit({ html: false, linkify: false, typographer: false }).disable([
  "code", // indented text is just text in a novel
]);
md.validateLink = (url) => /^(img:|https?:|data:image\/)/i.test(url);

const MARK: Record<string, string> = { strong: "b", em: "i", s: "s" };

/** Inline tokens -> spans, split on line breaks. */
function inline(children: Token[]): Span[] {
  const out: Span[] = [{ text: "", marks: [] }];
  const on: string[] = [];
  const put = (s: string, extra = "") => {
    const l = out.at(-1)!;
    const m = [...on, extra].filter(Boolean).join(" ");
    l.text += s;
    for (let i = 0; i < s.length; i++) l.marks.push(m);
  };
  for (const t of children) {
    const base = t.type.replace(/_(open|close)$/, "");
    if (t.type === "text") put(t.content);
    else if (t.type === "code_inline") put(t.content, "c");
    else if (t.type === "softbreak" || t.type === "hardbreak") out.push({ text: "", marks: [] });
    else if (MARK[base]) {
      if (t.nesting > 0) on.push(MARK[base]);
      else on.splice(on.lastIndexOf(MARK[base]), 1);
    }
  }
  return out;
}

/** "-> text <-" -> the text, or the same span when it is not centred. */
function unCentre(s: Span): Span {
  const m = /^(\s*->\s*)(.*?)\s*<-\s*$/.exec(s.text);
  if (!m) return s;
  const a = m[1]!.length;
  return { text: m[2]!, marks: s.marks.slice(a, a + m[2]!.length) };
}

export function markdownLines(src: string): Line[] {
  const out: Line[] = [];
  let quote = 0;
  let tag: Block["tag"] = "p";
  let n: string | undefined;
  let rule = false;
  let table = 0;
  let head = false;
  let row: Span[] | null = null;
  const emit = (b: Block, parts: Span[]) => {
    out.push({
      block: { ...b, ...(quote && { quote: true }), ...(rule && { rule: true }) },
      parts,
    });
    rule = false;
    n = undefined;
  };
  const lines = (kids: Token[]) => {
    for (const s of inline(kids)) {
      const c = unCentre(s);
      if (c.text.trim())
        emit({ tag: n ? "li" : tag, ...(n && { n }), ...(c !== s && { center: true }) }, [c]);
    }
  };
  for (const t of md.parse(src, {})) {
    switch (t.type) {
      case "blockquote_open":
        quote++;
        break;
      case "blockquote_close":
        quote--;
        break;
      case "list_item_open":
        n = t.info ? t.info + t.markup : "•";
        break;
      case "heading_open":
        tag = "h";
        break;
      case "heading_close":
        tag = "p";
        break;
      case "hr":
        rule = true;
        break;
      case "table_open":
        table++;
        break;
      case "thead_open":
        head = true;
        break;
      case "thead_close":
        head = false;
        break;
      case "tr_open":
        row = [];
        break;
      case "tr_close":
        if (row!.some((c) => c.text.trim()))
          emit({ tag: "tr", table, cells: row!.length, ...(head && { head }) }, row!);
        row = null;
        break;
      case "fence":
      case "code_block":
        for (const l of t.content.split("\n"))
          if (l.trim()) emit({ tag: "p" }, [{ text: l, marks: Array(l.length).fill("c") }]);
        break;
      case "inline": {
        const kids = t.children ?? [];
        if (!row && kids.some((k) => k.type === "image")) {
          // text, image, text: the image becomes a block of its own
          let from = 0;
          kids.forEach((k, j) => {
            if (k.type !== "image") return;
            lines(kids.slice(from, j));
            emit({ tag: "img", src: String(k.attrGet("src") ?? ""), alt: k.content }, []);
            from = j + 1;
          });
          lines(kids.slice(from));
          break;
        }
        const spans = inline(kids);
        if (row) {
          row.push({
            text: spans.map((s) => s.text).join(" "),
            marks: spans.flatMap((s, i) => (i ? ["", ...s.marks] : s.marks)),
          });
          break;
        }
        lines(kids);
      }
    }
  }
  return out;
}

/** Markdown -> the words a title should show: "# **Chapter 1**" -> "Chapter 1". */
export const plainTitle = (line: string) =>
  inline(md.parseInline(line.replace(/^#{1,6}\s+/, ""), {})[0]?.children ?? [])
    .map((s) => s.text)
    .join(" ")
    .trim();

// ---------- pasted text ----------

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
