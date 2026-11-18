// Run: bun src/lib/align.test.ts
import assert from "node:assert/strict";
import { alignWords, estimateTimes, type Span, type SttWord } from "./align";
import { buildDoc } from "./segment";

const seg = (t: string) => buildDoc(t).segs[0]!;
const stt = (s: string, step = 0.5): SttWord[] =>
  s.split(" ").map((word, i) => ({ word, start: i * step, end: i * step + step * 0.8 }));
const starts = (ts: Span[]) => ts.map((t) => +t.start.toFixed(2));
const valid = (ts: Span[], n: number, dur: number) => {
  assert.equal(ts.length, n);
  ts.forEach((t, i) => {
    assert.ok(t.start >= 0 && t.end <= dur + 1e-9 && t.end >= t.start, `range ${i}`);
    if (i) assert.ok(t.start >= ts[i - 1]!.start, `monotonic ${i}`);
  });
};

// estimate: proportional to char offset
{
  const s = seg("aaa bbb ccc");
  const ts = estimateTimes(s, 11);
  assert.deepEqual(starts(ts), [0, 4, 8]);
  assert.equal(ts[2]!.end, 11);
}

// exact match, case and punctuation ignored
{
  const s = seg(`Hello, World! She said.`);
  const ts = alignWords(s.words, stt("hello world She said"), 3);
  valid(ts, 4, 3);
  assert.deepEqual(starts(ts), [0, 0.5, 1, 1.5]);
}

// STT splits a word: "don't" -> "do" "n't"
{
  const s = seg("I don't know.");
  const ts = alignWords(s.words, stt("I do n't know"), 3);
  valid(ts, 3, 3);
  assert.deepEqual(starts(ts), [0, 0.5, 1.5]);
  assert.equal(ts[1]!.end, 1 + 0.4); // end of "n't"
}

// STT merges words: "well known" -> "well-known"
{
  const s = seg("a well known fact");
  const ts = alignWords(s.words, stt("a well-known fact"), 3);
  valid(ts, 4, 3);
  assert.equal(ts[1]!.start, 0.5);
  assert.ok(ts[2]!.start > 0.5 && ts[2]!.start < 0.9);
  assert.equal(ts[3]!.start, 1);
}

// numbers spoken as words: unmatched, interpolated between neighbours
{
  const s = seg("It was 1984 and cold.");
  const ts = alignWords(s.words, stt("it was nineteen eighty four and cold"), 4);
  valid(ts, 5, 4);
  assert.equal(ts[1]!.start, 0.5);
  assert.equal(ts[3]!.start, 2.5); // "and" matched past the number words
  assert.ok(ts[2]!.start >= ts[1]!.end && ts[2]!.end <= 2.5);
}

// words missing from the transcript, and extra words in it
{
  const s = seg("one two three four five six");
  const ts = alignWords(s.words, stt("one three um four six"), 3);
  valid(ts, 6, 3);
  assert.deepEqual(starts([ts[0]!, ts[2]!, ts[3]!, ts[5]!]), [0, 0.5, 1.5, 2]);
  assert.ok(ts[1]!.start > 0 && ts[1]!.start < 0.5);
  assert.ok(ts[4]!.start > 1.5 && ts[4]!.start < 2);
}

// nothing usable: falls back to spreading over the whole duration
{
  const s = seg("alpha beta gamma");
  valid(alignWords(s.words, [], 6), 3, 6);
  valid(alignWords(s.words, stt("zzz qqq"), 6), 3, 6);
}

// out-of-range and backwards timestamps are clamped and stay monotonic
{
  const s = seg("a b c");
  const ts = alignWords(
    s.words,
    [
      { word: "a", start: -1, end: 0.5 },
      { word: "b", start: 2, end: 9 },
      { word: "c", start: 1, end: 1.2 },
    ],
    3,
  );
  valid(ts, 3, 3);
}

// punctuation-only source word ("—") gets interpolated
{
  const s = seg("wait — what");
  const ts = alignWords(s.words, stt("wait what"), 2);
  valid(ts, 3, 2);
}
console.log("align ok");
