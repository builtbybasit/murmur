// What the TTS hears: user replace rules, then (optionally) emoji and kaomoji removed.
// The reader always shows the original text; only the request text changes.

export interface Rule {
  find: string;
  replace: string;
  /** a face or emoji: spoken as `replace` + the suffix ("waving emoji") */
  face?: boolean;
}

const VS = /\uFE0E|\uFE0F/g; // variation selectors: invisible, present or not at random

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORDISH = /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u;

/**
 * One pass over the text, longest match first, so `(￣▽￣)ノ` wins over `(￣▽￣)`. Case-insensitive.
 * Word-like and ASCII finds (`Xianxia`, `:P`) need a non-letter on both sides, so `:/` leaves
 * `https://` alone; other finds (`(￣▽￣)ノ`) match anywhere, even glued to a word.
 * Face rules with a "speak as" label get the suffix appended; an empty label skips the face.
 */
export function compileRules(rules: Rule[], suffix = ""): (text: string) => string {
  const list = rules
    .map((r) => ({ ...r, find: r.find.replace(VS, "").trim() }))
    .filter((r) => r.find);
  if (!list.length) return (t) => t.replace(VS, "");
  const map = new Map<string, string>();
  for (const r of list) {
    const say = r.replace.trim();
    map.set(r.find.toLowerCase(), r.face && say && suffix.trim() ? `${say} ${suffix.trim()}` : say);
  }
  const bounded = (f: string) => WORDISH.test(f) || /^[\x20-\x7e]+$/.test(f);
  const alts = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map((f) => (bounded(f) ? `(?<![\\p{L}\\p{N}])${esc(f)}(?![\\p{L}\\p{N}])` : esc(f)));
  const re = new RegExp(alts.join("|"), "giu");
  return (t) =>
    t.replace(VS, "").replace(re, (m) => {
      const r = map.get(m.toLowerCase()) ?? "";
      return r && !bounded(m) ? ` ${r} ` : r; // a face glued to a word must not merge into it
    });
}

// ---------- automatic emoji / kaomoji removal ----------

// alternation, not one class: lint rejects joiner / variation selectors inside a character class
const EMOJI =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0E|\uFE0F|\u200D|\u20E3/gu;
/** Two ordinary letters/digits in a row: the token contains a real word. */
const WORD_RUN = /[A-Za-zÀ-ɏ0-9]{2,}/;
/**
 * A character that does not belong in prose: symbols, combining marks, kaomoji punctuation,
 * and letters from scripts other than Latin (ノ ω ಠ 益 in an English chapter are face parts).
 * ponytail: assumes Latin-script prose. Turn auto-cleanup off for Chinese/Japanese text.
 */
const DECOR =
  /[\p{So}\p{Sk}\p{Mn}\p{Me}¦‿⁀•・·°ﾟ゜˘´`¨~^_|\\¬♡]|[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]/u;
/** ASCII faces with no decor characters: :) ;-) :D =P :'( */
const ASCII_FACE = /^[:;=8][-'^o]?[)(\][DPpOo3|\\/*$@]+[.,!?]*$|^[)(\][][-']?[:;=]$/;
/** Bracket group with no word inside: (◕‿◕) ( ˘ω˘ ) [>_<] */
const FACE_GROUP = /[(（[［{｛][^()（）[\]［］{}｛｝]{0,24}?[)）\]］}｝]/gu;

/** Prose punctuation a token may consist of alone (it carries a pause): — … " ( */
const PAUSE_ONLY = /^[—–\-…,.;:!?"'“”‘’()]+$/;

function cleanToken(t: string): string {
  if (ASCII_FACE.test(t)) return "";
  if (!/[\p{L}\p{N}]/u.test(t)) return PAUSE_ONLY.test(t) ? t : ""; // *** ~~~ ◇◇◇ ♡
  if (!DECOR.test(t)) return t;
  if (!WORD_RUN.test(t)) return ""; // all face, no word
  // a word with a face glued on: "thanks~(￣▽￣)ノ" -> "thanks"
  return t
    .replace(FACE_GROUP, (g) => (WORD_RUN.test(g) ? g : ""))
    .replace(/[\p{So}\p{Sk}\p{Mn}\p{Me}¦‿⁀•・·°ﾟ゜˘´`¨~^_|\\¬♡]/gu, "")
    .replace(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]/gu, "");
}

/** Remove emoji and kaomoji; leaves words, numbers and normal punctuation alone. */
export function stripFaces(text: string): string {
  const out = text
    .replace(EMOJI, "")
    .replace(FACE_GROUP, (g) => (WORD_RUN.test(g) || !DECOR.test(g) ? g : " "))
    .replace(/\S+/g, cleanToken)
    .replace(/[(（[]\s*[)）\]]/g, ""); // brackets emptied by the steps above
  return tidy(out);
}

const tidy = (t: string) =>
  t
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .trim();

/** Build the request-text function for a settings snapshot. */
export function makeSpeaker(o: {
  auto: boolean;
  rules: Rule[];
  suffix?: string;
}): (text: string) => string {
  const rules = compileRules(o.rules, o.suffix);
  return o.auto ? (t) => stripFaces(rules(t)) : (t) => tidy(rules(t));
}

/**
 * What an illustration is read as: "Illustration." or, when the book describes it,
 * "Illustration: a dragon over the city." File names and placeholder alt texts are ignored.
 */
export function describeImage(alt: string): string {
  const a = alt
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/, "");
  const real =
    /\p{L}{3}/u.test(a) &&
    !/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(a) &&
    !/^(image|img|picture|pic|figure|fig|illustration|cover|photo|untitled)[\s_-]*\d*$/i.test(a);
  return real ? `Illustration: ${a}.` : "Illustration.";
}

/** What the TTS is sent for a segment; "" = nothing to say (it plays a short silence). */
export const spokenText = (
  seg: { core: string; img?: { alt: string } },
  say: (text: string) => string,
  images: boolean,
) => (seg.img ? (images ? describeImage(seg.img.alt) : "") : say(seg.core));
