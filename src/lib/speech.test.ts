// Run: bun src/lib/speech.test.ts
import assert from "node:assert/strict";
import { compileRules, stripFaces, makeSpeaker } from "./speech";
import { DEFAULT_RULES } from "./kaomoji";

const eq = (a: string, b: string) => assert.equal(stripFaces(a), b, a);

// the user's examples
eq("Okay! (￣▽￣)ノ See you.", "Okay! See you.");
eq("♡(>ᴗ•) Thank you!", "Thank you!");
eq("thanks~(￣▽￣)ノ", "thanks");
// common faces
eq("He flipped it. (╯°□°)╯︵ ┻━┻", "He flipped it.");
eq("Seriously? (ಠ益ಠ)", "Seriously?");
eq("I see ( ˘ω˘ ) okay", "I see okay");
eq("T_T why", "why");
eq("Nice :) and ;-) fine", "Nice and fine");
eq("ʕ•ᴥ•ʔ bear", "bear");
eq("Great 😊👍🏽 job ❤️", "Great job");
eq("* * *", "");
eq("◇◇◇", "");
// prose is untouched
for (const t of [
  `"Don't," she said — then stopped… (quietly).`,
  "It cost $500, about 50% of 1/2 the price.",
  "UwU and XD stay; and/or too.",
  "Café naïve résumé, 3:00 p.m.",
  "Visit https://example.com today.",
])
  eq(t, t);

// rules: longest first, whole words for word-like finds, case-insensitive
const r = compileRules([
  { find: "(￣▽￣)", replace: "A" },
  { find: "(￣▽￣)ノ", replace: "B" },
  { find: "Xianxia", replace: "Shee-en-shah" },
  { find: ":/", replace: "meh" },
]);
assert.equal(r("x(￣▽￣)ノ y(￣▽￣)").replace(/\s+/g, " ").trim(), "x B y A");
assert.equal(r("xianxia, Xianxias"), "Shee-en-shah, Xianxias");
assert.equal(r("hmm :/ https://a.b"), "hmm meh https://a.b");

// defaults compile and clean a messy line; auto off keeps faces the list doesn't know
const say = makeSpeaker({ auto: true, rules: DEFAULT_RULES });
assert.equal(say("Hi (^_^)/ there ┐(￣ヘ￣)┌ friend"), "Hi hey! there meh friend");
assert.equal(say("thanks(￣▽￣)ノ bye"), "thanks hey! bye"); // padded, not "thankshey!"
assert.equal(say("Okay! (￣▽￣)ノ See you. ♡(>ᴗ•)"), "Okay! hey! See you. aww");
assert.equal(say("Unknown face (ᗒᗣᗕ)՞ here"), "Unknown face here"); // not in list: auto-skipped
assert.ok(
  DEFAULT_RULES.every((r) => r.replace),
  "every default face has a word",
);
assert.equal(makeSpeaker({ auto: false, rules: [] })("a ♡ b"), "a ♡ b");
assert.ok(DEFAULT_RULES.length > 150, "extensive list");
console.log("speech ok");
