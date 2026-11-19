<script setup lang="ts">
// Reading view. The chapter text is rendered once per doc as an HTML string (30k word spans
// would be too heavy as reactive vnodes); highlight classes are moved imperatively in paint().
import { computed, ref, watch, onMounted } from "vue";
import { useEventListener, useMediaQuery } from "@vueuse/core";
import { settings, device } from "@/settings";
import { current, currentDoc, hasBody, library, CHARS_PER_SEC } from "@/library";
import { MOD, minutes } from "@/lib/format";
import { ui } from "@/ui";
import { docHtml } from "@/lib/render";
import { player, seek, pause, nextChapter, upNext } from "@/engine";
import { genState, toggleGenerate } from "@/generate";
import ChapterEditor from "./ChapterEditor.vue";

const scroller = ref<HTMLElement | null>(null);
const textEl = ref<HTMLElement | null>(null);
const doc = computed(() => currentDoc.value || null);

const html = computed(() => (doc.value ? docHtml(doc.value) : ""));

// ---------- editing the chapter text (ChapterEditor) ----------
const editing = computed(() => !!current.value && ui.editingId === current.value.id);
watch(editing, (on) => {
  if (!on) return;
  pause();
  scroller.value?.scrollTo({ top: 0 });
});
watch(
  () => ui.currentId,
  (id) => {
    if (ui.editingId && ui.editingId !== id) ui.editingId = null;
  },
);

// ---------- meta + end card ----------
const totalSec = computed(() => player.total || (doc.value ? doc.value.chars / CHARS_PER_SEC : 0));
const mins = computed(() => minutes(totalSec.value, settings.speed));
const cached = computed(() => {
  const n = player.cachedCount,
    all = player.spokenCount;
  return n === 0 ? "nothing generated yet" : n >= all ? "fully cached" : `${n} of ${all} cached`;
});
const job = computed(() => (current.value ? genState(current.value) : null));

// ---------- highlight ----------
// a segment is one element, or one per table cell; words are listed across its parts
let segEls: HTMLElement[][] = [];
let wordEls: Element[][] = [];
let queriedFor = "";
let elSeg: HTMLElement[] | null = null;
let elWord: Element | null = null;
let elPara: Element | null = null;
let badEls: Element[] = [];

function els() {
  if (queriedFor !== html.value && textEl.value) {
    queriedFor = html.value;
    segEls = [];
    wordEls = [];
    for (const e of textEl.value.querySelectorAll<HTMLElement>(".seg")) {
      const i = +e.dataset.s!;
      (segEls[i] ??= []).push(e);
      (wordEls[i] ??= []).push(...e.children);
    }
    elSeg = elWord = elPara = null;
    badEls = [];
  }
  return segEls;
}

/** Failed or skipped segments, ascending; the same array while nothing changes (no repaint). */
const badList = computed<number[]>((old) => {
  const out = new Set<number>();
  for (const k in player.segState) if (player.segState[k] === "failed") out.add(+k);
  for (const k in player.skipped) if (player.skipped[k]) out.add(+k);
  const now = [...out].sort((a, b) => a - b);
  return old?.length === now.length && old.every((v, i) => v === now[i]) ? old : now;
});

function paintBad() {
  const list = els();
  for (const e of badEls) e.classList.remove("bad");
  badEls = badList.value.flatMap((i) => list[i] ?? []);
  for (const e of badEls) e.classList.add("bad");
}

function paint() {
  const list = els();
  const d = doc.value;
  if (!d || !list.length) return;
  const on = player.started;
  const si = Math.min(
    list.length - 1,
    Math.max(0, on ? player.seg : (library.positions[ui.currentId ?? ""] ?? 0)),
  );
  const parts = list[si] ?? [];
  const se = parts[0];
  if (!se) return;
  const pe = se.closest("tr") ?? se.parentElement;
  if (pe !== elPara) {
    elPara?.classList.remove("curp");
    pe?.classList.add("curp");
    elPara = pe;
  }
  let moved = false;
  if (parts !== elSeg) {
    for (const e of elSeg ?? []) e.classList.remove("cur", "wait");
    elSeg = parts;
    moved = true;
  }
  const wait = on && player.status === "buffering" && player.segState[si] === "loading";
  for (const e of parts) {
    e.classList.toggle("cur", on);
    e.classList.toggle("wait", wait);
  }
  const we = on && player.word >= 0 ? (wordEls[si]?.[player.word] ?? null) : null;
  if (we !== elWord) {
    elWord?.classList.remove("now", "al");
    we?.classList.add("now");
    elWord = we;
    moved = true;
  }
  we?.classList.toggle("al", player.timing === "aligned");
  if (moved && on && ui.follow) reveal();
}

watch(
  () => [
    player.started,
    player.seg,
    player.word,
    player.timing,
    player.status,
    player.segState[player.seg],
    library.positions[ui.currentId ?? ""],
  ],
  paint,
  { flush: "post" },
);
watch(badList, paintBad, { flush: "post" });

// ---------- follow ----------
const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");

/** Keep the current word between 12% and 72% of the view; when it leaves, put it at 30%. */
function reveal(instant = false) {
  const el = elWord ?? elSeg?.[0],
    sc = scroller.value;
  if (!el || !sc) return;
  const r = el.getBoundingClientRect(),
    b = sc.getBoundingClientRect(),
    y = r.top - b.top;
  if (y >= b.height * 0.12 && r.bottom - b.top <= b.height * 0.72) return;
  const d = y - b.height * 0.3;
  const jump = instant || reduced.value || Math.abs(d) > b.height * 1.5;
  sc.scrollTo({ top: sc.scrollTop + d, behavior: jump ? "auto" : "smooth" });
}

// new chapter: start at the top, or jump straight to the resume position
function onDoc() {
  if (scroller.value) scroller.value.scrollTop = 0;
  paint();
  paintBad();
  if (player.started ? ui.follow : (library.positions[ui.currentId ?? ""] ?? 0) > 0) reveal(true);
}
watch(html, onDoc, { flush: "post" });

watch(
  () => ui.follow,
  (on) => on && reveal(),
);

// Only a real gesture leaves follow mode; programmatic scrollTo never fires these events.
function unfollow() {
  if (player.started && ui.follow) ui.follow = false;
}
function onMouseDown(e: MouseEvent) {
  const sc = scroller.value;
  if (sc && e.target === sc && e.offsetX >= sc.clientWidth) unfollow(); // scrollbar drag
}
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);
useEventListener(window, "keydown", (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  if (ui.view !== "reader" || !SCROLL_KEYS.has(e.key) || e.metaKey || e.ctrlKey) return;
  if (t?.closest?.("input,textarea,select,[contenteditable],.row")) return;
  unfollow();
});
onMounted(onDoc);

function onClick(e: MouseEvent) {
  const t = e.target as Element;
  const w = t.closest<HTMLElement>(".w");
  if (!w && !t.closest(".fig")) return; // words and images seek; gaps between words do not
  const s = t.closest<HTMLElement>(".seg");
  if (!s?.dataset.s) return;
  ui.follow = true;
  seek(+s.dataset.s, w ? +w.dataset.w! : 0);
}
</script>

<template>
  <div class="rd">
    <section
      ref="scroller"
      class="reader"
      :class="{ tint: device.reading.tintDialogue }"
      @wheel.passive="unfollow"
      @touchmove.passive="unfollow"
      @mousedown="onMouseDown"
    >
      <article v-if="doc && current" class="page">
        <h1>{{ current.title }}</h1>
        <div class="meta">
          <b>{{ doc.words.toLocaleString() }} words</b>
          <span>{{ doc.segs.length }} segments</span>
          <span>about {{ mins }} min at {{ settings.speed.toFixed(1) }}×</span>
          <span>{{ cached }}</span>
          <button
            v-if="job === 'running' || job === 'queued'"
            class="lnk"
            @click="toggleGenerate(current.id)"
          >
            {{ job === "queued" ? "waiting to generate · cancel" : "generating · stop" }}
          </button>
          <button
            v-else-if="job !== 'done' && player.cachedCount < player.spokenCount"
            class="lnk"
            title="Generate audio for every segment in the background"
            @click="toggleGenerate(current.id)"
          >
            {{ player.cachedCount ? "generate the rest" : "generate all" }}
          </button>
        </div>
        <ChapterEditor v-if="editing && hasBody(current)" :chapter="current" />
        <!-- v-show, not v-if: paint() keeps references into this element -->
        <div v-show="!editing" ref="textEl" class="chapter" @click="onClick" v-html="html" />
        <template v-if="!editing">
          <button v-if="upNext" class="endcard" @click="nextChapter()">
            <span
              ><small class="label dim">Up next · plays automatically</small
              ><b>{{ upNext.title }}</b></span
            >
            <span class="sp" />
            <kbd>J</kbd>
          </button>
          <div v-else class="endcard">
            <span
              ><small class="label dim">End of the list</small
              ><b>Paste the next chapter to keep listening</b></span
            >
            <span class="sp" />
            <kbd>{{ MOD }}V</kbd>
          </div>
        </template>
      </article>
      <article v-else-if="current" class="page">
        <h1>{{ current.title }}</h1>
        <div class="meta"><span class="loading">Loading chapter…</span></div>
      </article>
    </section>
    <button
      v-if="!ui.follow && player.started && doc && !editing"
      class="follow"
      @click="ui.follow = true"
    >
      Back to current <kbd>F</kbd>
    </button>
  </div>
</template>

<style scoped>
.rd {
  position: relative;
  height: 100%;
  min-height: 0;
  display: grid;
}
.reader {
  min-height: 0;
  overflow: auto;
  outline: 0;
  background: var(--page);
  scroll-behavior: auto;
}
.page {
  max-width: calc(var(--rw) + 64px);
  margin: 0 auto;
  padding: 44px 32px 140px;
  font: var(--rs) / var(--rl) var(--read);
  color: var(--ink);
  font-optical-sizing: auto;
}
.page h1 {
  font: 600 1.55em/1.2 var(--read);
  letter-spacing: -0.012em;
  color: var(--ink-hi);
  margin: 0 0 6px;
}
.meta {
  font: 12px var(--ui);
  color: var(--ink3);
  margin-bottom: 2.2em;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
}
.loading {
  animation: breathe 1.2s ease-in-out infinite alternate;
}
@keyframes breathe {
  to {
    opacity: 0.4;
  }
}
.meta b {
  font-weight: 500;
  color: var(--ink2);
}

.endcard {
  margin-top: 2.6em;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--r3);
  font: 13px var(--ui);
  color: var(--ink2);
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  width: 100%;
  text-align: left;
}
button.endcard:hover {
  border-color: var(--line2);
  background: var(--hover);
}
.endcard b {
  display: block;
  color: var(--ink-hi);
  font-weight: 500;
  font-size: 14px;
}

.follow {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  height: 30px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--r-pill);
  background: var(--raised);
  border: 1px solid var(--line2);
  box-shadow: var(--shadow);
  font-weight: 500;
  font-size: 12.5px;
  z-index: 5;
  white-space: nowrap;
}

@media (max-width: 820px) {
  .page {
    padding: 28px 20px 120px;
  }
}
</style>

<style>
/* the chapter text is v-html, so it is styled unscoped, under .chapter */
@keyframes sheen {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -150% 0;
  }
}
.chapter p {
  margin: 0 0 0.85em;
  position: relative;
  text-wrap: pretty;
  hanging-punctuation: first;
}
.chapter p.hd {
  margin-top: 1.3em;
  font-size: 1.15em;
  font-weight: 700;
  color: var(--ink-hi);
}
.chapter p.fig {
  margin: 1.4em 0;
  text-align: center;
}
.chapter p.fig .seg {
  display: inline-block;
  padding: 4px;
  border-radius: var(--r3);
  cursor: pointer;
}
.chapter p.fig img {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  border-radius: var(--r2);
}
.chapter p.fig .seg.cur {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--k) 45%, transparent);
}
.chapter p.ctr {
  text-align: center;
}
.chapter p.li {
  padding-left: 1.6em;
}
.chapter p.li::after {
  content: attr(data-n);
  position: absolute;
  left: 0.2em;
  top: 0;
  color: var(--ink3);
}
.chapter blockquote {
  margin: 0 0 0.85em;
  padding: 0.7em 1em 0.1em;
  border: 1px solid var(--line);
  border-left: 3px solid var(--line2);
  border-radius: var(--r2);
  background: var(--surface);
}
.chapter hr {
  width: 30%;
  margin: 1.8em auto;
  border: 0;
  border-top: 1px solid var(--line2);
}
.chapter table {
  margin: 0 0 1em;
  border-collapse: collapse;
  font-size: 0.92em;
}
.chapter td,
.chapter th {
  padding: 0.25em 0.8em;
  border: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
.chapter th {
  background: var(--surface);
}
.chapter .w.b,
.chapter th .w {
  font-weight: 700;
}
.chapter .w.i {
  font-style: italic;
}
.chapter .w.s {
  text-decoration: line-through;
}
.chapter .w.c {
  font-family: var(--mono);
  font-size: 0.9em;
}
.chapter p.curp::before {
  content: "";
  position: absolute;
  left: -18px;
  top: 0.4em;
  bottom: 0.4em;
  width: 2px;
  border-radius: 2px;
  background: var(--line2);
}
.chapter .seg {
  --k: var(--acc);
  border-radius: 3px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background-color 0.18s;
}
.chapter .seg.dlg {
  --k: var(--dlg);
}
.chapter .seg.sys {
  --k: var(--sys);
}
.tint .chapter .seg.dlg {
  color: color-mix(in oklab, var(--ink) 62%, var(--dlg));
}
.chapter .seg.cur {
  color: var(--ink-hi);
  background: color-mix(in srgb, var(--k) 11%, transparent);
  box-shadow: 0 0 0 0.13em color-mix(in srgb, var(--k) 11%, transparent);
}
.tint .chapter .seg.dlg.cur {
  color: color-mix(in oklab, var(--ink-hi) 70%, var(--dlg));
}
.chapter .seg.wait {
  background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--k) 6%, transparent) 20%,
      color-mix(in srgb, var(--k) 26%, transparent) 50%,
      color-mix(in srgb, var(--k) 6%, transparent) 80%
    )
    0 0 / 250% 100%;
  box-shadow: none;
  animation: sheen 1.3s linear infinite;
}
.chapter .seg.bad {
  --k: var(--err);
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--err);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.32em;
}
.chapter .w {
  border-radius: 3px;
  cursor: pointer;
}
.chapter .w:hover {
  background: color-mix(in srgb, var(--k) 16%, transparent);
}
.chapter .w.now {
  background: color-mix(in srgb, var(--k) 26%, transparent);
  box-shadow: 0 0 0 0.13em color-mix(in srgb, var(--k) 26%, transparent);
  color: var(--ink-hi);
}
.chapter .w.now.al {
  background: color-mix(in srgb, var(--k) 36%, transparent);
  box-shadow: 0 0 0 0.13em color-mix(in srgb, var(--k) 36%, transparent);
  text-decoration-line: underline;
  text-decoration-style: solid;
  text-decoration-color: var(--k);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.3em;
}
@media (max-width: 820px) {
  .chapter p.curp::before {
    left: -11px;
  }
}
</style>
