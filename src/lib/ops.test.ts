// bun src/lib/ops.test.ts
import { applyOp, type Chapter, type Library } from "./ops";

const ch = (id: string): Chapter => ({ id, title: id, body: id, addedAt: 0 });
const lib = (...ids: string[]): Library => ({
  chapters: ids.map(ch),
  positions: {},
  currentId: null,
});
const ids = (l: Library) => l.chapters.map((c) => c.id).join("");
const eq = (a: unknown, b: unknown) => {
  if (a !== b) throw new Error(`expected ${String(b)}, got ${String(a)}`);
};

// a stale device moves a chapter: chapters it never saw stay in the list
let l = lib("a", "b", "c", "x");
applyOp(l, { op: "move", ids: ["a"], target: "c", after: true });
eq(ids(l), "bcax");

// undo a delete: back where they were, even after other changes
l = lib("a", "b", "c", "d");
applyOp(l, { op: "pos", id: "b", seg: 4 });
applyOp(l, { op: "delete", ids: ["b", "c"] });
eq(ids(l), "ad");
eq(l.positions.b, undefined);
applyOp(l, { op: "add", chapters: [ch("z")], after: [null] });
applyOp(l, { op: "add", chapters: [ch("b"), ch("c")], after: ["a", "b"] });
eq(ids(l), "zabcd");
// first chapter restored to the top; a gone anchor puts it at the end; no anchor: the end
applyOp(l, { op: "delete", ids: ["z", "a"] });
applyOp(l, { op: "add", chapters: [ch("z"), ch("q")], after: [null, "gone"] });
applyOp(l, { op: "add", chapters: [ch("r")] });
eq(ids(l), "zbcdqr");
// adding twice (a retried request) adds once
applyOp(l, { op: "add", chapters: [ch("r")] });
eq(ids(l), "zbcdqr");

// books
applyOp(l, { op: "set", ids: ["b", "c"], book: "B" });
applyOp(l, { op: "renameBook", from: "B", to: "C" });
eq(l.chapters[1]!.book, "C");
applyOp(l, { op: "set", ids: ["b"], book: null, title: "t" });
eq(l.chapters[1]!.book, undefined);
eq(l.chapters[1]!.title, "t");

console.log("ops ok");
