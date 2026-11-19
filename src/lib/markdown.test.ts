// Run: bun src/lib/markdown.test.ts
import assert from "node:assert/strict";
import { htmlToMarkdown } from "./markdown";
import { autoTitle, buildDoc } from "./segment";

// Royal Road title: <br> inside <strong>
const rr = htmlToMarkdown(
  `<p><strong>Chapter 001<br></strong><strong>Good Morning Brother</strong></p><p>“Hi,” she said. <em>Wow.</em> <a href="/x">link</a></p>`,
);
assert.equal(rr, "**Chapter 001**\n**Good Morning Brother**\n\n“Hi,” she said. *Wow.* link");
const { title, body } = autoTitle(rr);
assert.equal(title, "Chapter 001");
const d = buildDoc(body);
assert.deepEqual(
  d.segs.map((s) => s.core),
  ["Good Morning Brother", "“Hi,”", "she said. Wow. link"],
);
assert.deepEqual(
  d.segs[2]!.words.map((w) => w.m ?? ""),
  ["", "", "i", ""],
);

// tables: one column = box (quote), more = rows read as "a, b"; headerless first row is the head
const t = htmlToMarkdown(
  `<table><tr><td colspan=2><b>Status</b></td></tr><tr><td>Strength:</td><td>12</td></tr><tr><td>Agility</td><td>9</td></tr></table>` +
    `<table><tr><td><p>[Skill]</p><p>You learned <s>Fire</s>.</p></td></tr></table><hr><p>After</p>`,
);
const td = buildDoc(t);
assert.deepEqual(
  td.segs.map((s) => s.core),
  ["Status", "Strength: 12", "Agility, 9", "[Skill]", "You learned Fire.", "After"],
);
assert.deepEqual(
  td.blocks.map((b) => b.tag + (b.head ? "H" : "") + (b.quote ? "Q" : "") + (b.rule ? "R" : "")),
  ["trH", "tr", "tr", "pQ", "pQ", "pR"],
);
assert.deepEqual(
  td.segs[1]!.words.map((w) => w.cell),
  [0, 1],
);
assert.equal(td.segs[4]!.words[2]!.m, "s");

// plain text is Markdown too: every line a paragraph
assert.equal(buildDoc("One.\nTwo *sighs*.\n\nThree.").paras.length, 3);
console.log("markdown ok");
