// Run: bun src/lib/speech.test.ts
import assert from "node:assert/strict";
import { compileRules, stripFaces, makeSpeaker, describeImage } from "./speech";
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

// defaults: label + suffix for listed faces/emoji, silent skip for the rest
const say = makeSpeaker({ auto: true, rules: DEFAULT_RULES, suffix: "emoji" });
assert.equal(
  say("Hi (^_^)/ there ┐(￣ヘ￣)┌ friend"),
  "Hi waving emoji there shrugging emoji friend",
);
assert.equal(say("thanks(￣▽￣)ノ bye"), "thanks waving emoji bye"); // padded, not glued
assert.equal(
  say("Okay! (￣▽￣)ノ See you. ♡(>ᴗ•)"),
  "Okay! waving emoji See you. heart wink emoji",
);
assert.equal(say("(╯°□°)╯︵ ┻━┻ fine"), "table flip emoji fine"); // longest match wins over parts
// emoji with and without VS16, with a skin tone
assert.equal(
  say("Great 😂👍🏽 job ❤️ and ❤ ok"),
  "Great laughing crying emoji thumbs up emoji job heart emoji and heart emoji ok",
);
assert.equal(say("Unknown face (ᗒᗣᗕ)՞ here 🫠"), "Unknown face here"); // not listed: skipped
// suffix only on face rules; empty suffix says only the label
const mixed = [...DEFAULT_RULES, { find: "Xianxia", replace: "Shee-en-shah" }];
assert.equal(
  makeSpeaker({ auto: true, rules: mixed, suffix: "emoji" })("Xianxia (T_T)"),
  "Shee-en-shah crying emoji",
);
assert.equal(makeSpeaker({ auto: true, rules: DEFAULT_RULES, suffix: "" })("(T_T)"), "crying");
assert.equal(makeSpeaker({ auto: false, rules: [] })("a ♡ b"), "a ♡ b");
assert.ok(DEFAULT_RULES.length > 400, "kaomoji + emoji");
assert.ok(
  DEFAULT_RULES.every((r) => r.replace && r.face),
  "every default has a label and the suffix",
);
console.log("speech ok");

// illustrations
assert.equal(describeImage(""), "Illustration.");
assert.equal(describeImage("cover.jpg"), "Illustration.");
assert.equal(describeImage("image 3"), "Illustration.");
assert.equal(
  describeImage("A dragon circling the tower."),
  "Illustration: A dragon circling the tower.",
);
console.log("illustrations ok");
