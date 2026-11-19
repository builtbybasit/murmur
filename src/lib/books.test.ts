// Run: bun src/lib/books.test.ts
import assert from "node:assert/strict";
import { groupBooks } from "./books";

const ch = (id: string, book?: string) => ({ id, title: id, body: "", addedAt: 0, book });
const list = [ch("a"), ch("b", "X"), ch("c", "X"), ch("d"), ch("e", "X"), ch("f", "Y")];
const show = (folded: string[]) =>
  groupBooks(
    list,
    (b) => folded.includes(b),
    () => 10,
  ).map((x) =>
    x.kind === "head" ? `[${x.book}:${x.ids.join("")}:${x.secs}]` : `${x.c.id}${x.n}@${x.i}`,
  );

// loose chapters number on their own; a book run restarts numbering; a later run of the same book is its own group
assert.deepEqual(show([]), [
  "a1@0",
  "[X:bc:20]",
  "b1@1",
  "c2@2",
  "d1@3",
  "[X:e:10]",
  "e1@4",
  "[Y:f:10]",
  "f1@5",
]);
// folding hides rows, keeps the header (and its ids)
assert.deepEqual(show(["X"]), ["a1@0", "[X:bc:20]", "d1@3", "[X:e:10]", "[Y:f:10]", "f1@5"]);
assert.deepEqual(
  groupBooks(
    [],
    () => false,
    () => 0,
  ),
  [],
);
console.log("books ok");
