// The sidebar list: consecutive chapters with the same `book` form a group under a folding header.
import type { Chapter } from "./ops";

export interface Head {
  kind: "head";
  book: string;
  ids: string[];
  secs: number;
  key: string;
}
export interface Row {
  kind: "row";
  c: Chapter;
  i: number; // index in the chapter list
  n: number; // number within its group
}

/** Headers and rows, top to bottom; a folded book shows its header only. */
export function groupBooks(
  chapters: Chapter[],
  folded: (book: string) => boolean,
  secsOf: (c: Chapter) => number,
): (Head | Row)[] {
  const out: (Head | Row)[] = [];
  let prev: string | null = null;
  let head: Head | null = null;
  let n = 0;
  chapters.forEach((c, i) => {
    const b = c.book ?? "";
    if (b !== prev) {
      prev = b;
      n = 0;
      head = b ? { kind: "head", book: b, ids: [], secs: 0, key: "h:" + c.id } : null;
      if (head) out.push(head);
    }
    n++;
    if (head) {
      head.ids.push(c.id);
      head.secs += secsOf(c);
    }
    if (!head || !folded(b)) out.push({ kind: "row", c, i, n });
  });
  return out;
}
