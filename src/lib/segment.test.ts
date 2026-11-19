// Run: bun src/lib/segment.test.ts
import assert from "node:assert/strict";
import { segmentPara, buildDoc } from "./segment";
import { autoTitle } from "./markdown";

const kinds = (p: string, smart = true) =>
  segmentPara(p, smart)
    .map((s) => s.kind[0] + ":" + s.text.trim())
    .join(" | ");

const cases: [string, boolean, string][] = [
  [`"Hi," she said. "Go."`, true, `d:"Hi," | n:she said. | d:"Go."`],
  [`“Curly,” he said.`, true, `d:“Curly,” | n:he said.`],
  [`I don't want the boys' rope.`, true, `n:I don't want the boys' rope.`],
  [`'I'm the tide,' it said. 'Wait.'`, true, `d:'I'm the tide,' | n:it said. | d:'Wait.'`],
  [`‘Don't touch it,’ said a voice.`, true, `d:‘Don't touch it,’ | n:said a voice.`],
  [`'I'm the tide,' it said.`, false, `n:'I'm the tide,' it said.`],
  [`"He said 'no' twice."`, true, `d:"He said 'no' twice."`],
  [`"It went on`, true, `d:"It went on`],
  [`"One." "Two."`, true, `d:"One." | d:"Two."`],
];
for (const [p, smart, want] of cases) {
  assert.equal(kinds(p, smart), want, p);
  assert.equal(
    segmentPara(p, smart)
      .map((x) => x.text)
      .join(""),
    p,
    "lossy: " + p,
  );
}

assert.deepEqual(autoTitle("Chapter 3: Rain\n\nBody."), {
  title: "Chapter 3: Rain",
  body: "Body.",
});
assert.equal(autoTitle("She ran. Fast.\nMore.", ["Chapter 4"]).title, "Chapter 5");

const doc = buildDoc(`"Hi," she said.\n\nThe end.`);
assert.deepEqual(doc.paras, [[0, 1], [2]]);
assert.equal(doc.segs[1]!.core, "she said.");
assert.deepEqual(doc.segs[1]!.words, [
  { t: "she", c: 0 },
  { t: "said.", c: 4 },
]);
console.log("segment ok");
