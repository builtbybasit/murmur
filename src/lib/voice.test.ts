// Run: bun src/lib/voice.test.ts
import assert from "node:assert/strict";
import { parseBlend, formatBlend, voiceGroup, groupVoices } from "./voice";

assert.deepEqual(parseBlend("af_heart:0.7, af_bella:0.3"), [
  { id: "af_heart", w: 0.7 },
  { id: "af_bella", w: 0.3 },
]);
assert.deepEqual(parseBlend("a,b"), [
  { id: "a", w: 1 },
  { id: "b", w: 1 },
]);
assert.equal(
  formatBlend([
    { id: "a", w: 3 },
    { id: "b", w: 1 },
  ]),
  "a:0.75,b:0.25",
);
assert.equal(
  formatBlend([
    { id: "a", w: 5 },
    { id: "b", w: 0 },
  ]),
  "a",
);
assert.equal(formatBlend(parseBlend("af_heart:0.7,af_bella:0.3")), "af_heart:0.7,af_bella:0.3");

assert.equal(voiceGroup("af_heart"), "American female");
assert.equal(voiceGroup("bm_george"), "British male");
assert.equal(voiceGroup("alloy"), "Other");
assert.equal(voiceGroup("af_heart:0.7,af_bella:0.3"), "Blends");
assert.deepEqual(
  groupVoices(["alloy", "am_onyx", "a:0.5,b:0.5"]).map((g) => g.name),
  ["Blends", "American male", "Other"],
);
console.log("voice ok");
