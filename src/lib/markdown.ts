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
td.remove(["script", "style", "noscript", "iframe", "img", "button", "input"]);
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
    .replace(/^[ \t]+$/gm, "");

// ---------- Markdown -> lines ----------

export interface Block {
  tag: "p" | "h" | "li" | "tr";
  quote?: boolean;
  /** horizontal rule before this block (scene break) */
  rule?: boolean;
  /** list marker: "•" or "3." */
  n?: string;
  /** table number (1-based) and row info */
  table?: number;
  head?: boolean;
  cells?: number;
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
  "image",
]);

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
        const spans = inline(t.children ?? []);
        if (row) {
          row.push({
            text: spans.map((s) => s.text).join(" "),
            marks: spans.flatMap((s, i) => (i ? ["", ...s.marks] : s.marks)),
          });
          break;
        }
        for (const s of spans)
          if (s.text.trim()) emit({ tag: n ? "li" : tag, ...(n && { n }) }, [s]);
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
