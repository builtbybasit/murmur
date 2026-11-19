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

// centred paragraphs and headings survive as "-> text <-"
const c = htmlToMarkdown(
  `<p style="text-align: center;"><strong>Classes Available</strong><br>Brawler</p><h2 align="center">Status</h2><p style="text-align: start">Left</p>`,
);
assert.equal(c, "-> **Classes Available** <-\n-> Brawler <-\n\n## -> Status <-\n\nLeft");
const cd = buildDoc(c);
assert.deepEqual(
  cd.blocks.map((b) => b.tag + (b.center ? "C" : "")),
  ["pC", "pC", "hC", "p"],
);
assert.deepEqual(
  cd.segs.map((s) => s.core),
  ["Classes Available", "Brawler", "Status", "Left"],
);
assert.equal(cd.segs[0]!.words[0]!.m, "b");

// system messages: [bracketed] or fully bold lines, table rows, boxes; quotes inside stay put
const sys = buildDoc(
  `[Salutations, Player ‘Adam Fischer’.]\n**Classes Available**\n“Hi,” he said. **Bold** start.\n> boxed\n\n| a | b |\n| --- | --- |`,
);
assert.deepEqual(
  sys.segs.map((s) => s.kind[0] + ":" + s.core),
  [
    "s:[Salutations, Player ‘Adam Fischer’.]",
    "s:Classes Available",
    "d:“Hi,”",
    "n:he said. Bold start.",
    "s:boxed",
    "s:a, b",
  ],
);

// images: their own block, spoken via describeImage; unknown sources are dropped
assert.equal(
  htmlToMarkdown(`<p>Before <img src="img:ab12" alt="A map"> after</p><img src="x.png">`),
  "Before\n\n![A map](img:ab12)\n\nafter",
);
const im = buildDoc("Before ![A map](img:ab12) after");
assert.deepEqual(
  im.blocks.map((b) => b.tag),
  ["p", "img", "p"],
);
assert.deepEqual(im.segs[1]!.img, { src: "img:ab12", alt: "A map" });

// plain text is Markdown too: every line a paragraph
assert.equal(buildDoc("One.\nTwo *sighs*.\n\nThree.").paras.length, 3);
console.log("markdown ok");
