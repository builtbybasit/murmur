<script setup lang="ts">
// Reading view. The chapter text is rendered once per doc as an HTML string (30k word spans
// would be too heavy as reactive vnodes); highlight classes are moved imperatively in paint().
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import {
  ui,
  settings,
  current,
  currentDoc,
  library,
  setChapterBody,
  toast,
  CHARS_PER_SEC,
} from "../store";
import { player, seek, nextChapter } from "../engine";

const scroller = ref<HTMLElement | null>(null);
const textEl = ref<HTMLElement | null>(null);
const doc = computed(() => currentDoc.value || null);

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

const html = computed(() => {
  const d = doc.value;
  if (!d) return "";
  let out = "";
  for (const idx of d.paras) {
    out += "<p>";
    for (const si of idx) {
      const s = d.segs[si]!;
      out += esc(s.lead) + `<span class="seg ${s.kind}" data-s="${si}">`;
      let at = 0;
      s.words.forEach((w, k) => {
        out += esc(s.core.slice(at, w.c)) + `<span class="w" data-w="${k}">${esc(w.t)}</span>`;
        at = w.c + w.t.length;
      });
      out += esc(s.core.slice(at)) + "</span>" + esc(s.trail);
    }
    out += "</p>";
  }
  return out;
});

// ---------- editing the chapter text ----------
const editing = computed(() => !!current.value && ui.editingId === current.value.id);
const draft = ref("");
const editor = ref<HTMLTextAreaElement | null>(null);
watch(editing, async (on) => {
  if (!on) return;
  draft.value = current.value!.body;
  await nextTick();
  scroller.value?.scrollTo({ top: 0 });
  editor.value?.focus();
  editor.value?.setSelectionRange(0, 0);
});
watch(
  () => ui.currentId,
  (id) => {
    if (ui.editingId && ui.editingId !== id) ui.editingId = null;
  },
);
function saveEdit() {
  if (!setChapterBody(current.value!.id, draft.value))
    return toast({ title: "Chapter text can't be empty", warn: true });
  ui.editingId = null;
  toast(
    {
      title: "Chapter updated",
      sub: "Changed paragraphs are generated again; the rest stay cached",
    },
    3500,
  );
}
function onEditKey(e: KeyboardEvent) {
  if (e.key === "Escape") ui.editingId = null;
  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
  else return;
  e.preventDefault();
}

// ---------- meta + end card ----------
const totalSec = computed(() => player.total || (doc.value ? doc.value.chars / CHARS_PER_SEC : 0));
const mins = computed(() => Math.max(1, Math.round(totalSec.value / settings.speed / 60)));
const cached = computed(() => {
  const n = player.cachedCount,
    all = doc.value?.segs.length ?? 0;
  return n === 0 ? "nothing generated yet" : n >= all ? "fully cached" : `${n} of ${all} cached`;
});
const nextCh = computed(() => {
  const i = library.chapters.findIndex((c) => c.id === ui.currentId);
  return i < 0 ? null : (library.chapters[i + 1] ?? null);
});

// ---------- highlight ----------
let segEls: HTMLElement[] = [];
let queriedFor = "";
let elSeg: HTMLElement | null = null;
let elWord: Element | null = null;
let elPara: Element | null = null;
let badEls: Element[] = [];

function els() {
  if (queriedFor !== html.value && textEl.value) {
    queriedFor = html.value;
    segEls = Array.from(textEl.value.querySelectorAll<HTMLElement>(".seg"));
    elSeg = elWord = elPara = null;
    badEls = [];
  }
  return segEls;
}

const badList = computed(() => {
  const out = new Set<string>();
  for (const k in player.segState) if (player.segState[k] === "failed") out.add(k);
  for (const k in player.skipped) if (player.skipped[k]) out.add(k);
  return [...out].join(",");
});

function paintBad() {
  const list = els();
  for (const e of badEls) e.classList.remove("bad");
  badEls = badList.value
    ? badList.value
        .split(",")
        .map((i) => list[+i]!)
        .filter(Boolean)
    : [];
  for (const e of badEls) e.classList.add("bad");
}

function paint() {
  const list = els();
  const d = doc.value;
  if (!d || !list.length) return;
  const on = player.started;
  const si = Math.min(list.length - 1, Math.max(0, on ? player.seg : (current.value?.pos ?? 0)));
  const se = list[si]!;
  const pe = se.parentElement;
  if (pe !== elPara) {
    elPara?.classList.remove("curp");
    pe?.classList.add("curp");
    elPara = pe;
  }
  let moved = false;
  if (se !== elSeg) {
    elSeg?.classList.remove("cur", "wait");
    elSeg = se;
    moved = true;
  }
  se.classList.toggle("cur", on);
  se.classList.toggle(
    "wait",
    on && player.status === "buffering" && player.segState[si] === "loading",
  );
  const we = on && player.word >= 0 ? (se.children[player.word] ?? null) : null;
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
    current.value?.pos,
  ],
  paint,
  { flush: "post" },
);
watch(badList, paintBad, { flush: "post" });

// ---------- follow ----------
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keep the current word between 12% and 72% of the view; when it leaves, put it at 30%. */
function reveal(instant = false) {
  const el = elWord ?? elSeg,
    sc = scroller.value;
  if (!el || !sc) return;
  const r = el.getBoundingClientRect(),
    b = sc.getBoundingClientRect(),
    y = r.top - b.top;
  if (y >= b.height * 0.12 && r.bottom - b.top <= b.height * 0.72) return;
  const d = y - b.height * 0.3;
  const jump = instant || reduced || Math.abs(d) > b.height * 1.5;
  sc.scrollTo({ top: sc.scrollTop + d, behavior: jump ? "auto" : "smooth" });
}

// new chapter: start at the top, or jump straight to the resume position
function onDoc() {
  if (scroller.value) scroller.value.scrollTop = 0;
  paint();
  paintBad();
  if (player.started ? ui.follow : (current.value?.pos ?? 0) > 0) reveal(true);
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
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (ui.view !== "reader" || !SCROLL_KEYS.has(e.key) || e.metaKey || e.ctrlKey) return;
  if (t?.closest?.("input,textarea,select,[contenteditable],.row")) return;
  unfollow();
}
onMounted(() => {
  window.addEventListener("keydown", onKey);
  onDoc();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

function backToCurrent() {
  ui.follow = true;
}

function onClick(e: MouseEvent) {
  const w = (e.target as Element).closest<HTMLElement>(".w");
  const s = w?.parentElement;
  if (!w || !s?.dataset.s) return;
  seek(+s.dataset.s, +w.dataset.w!);
}
</script>

<template>
  <div class="rd">
    <section
      ref="scroller"
      class="reader"
      :class="{ tint: settings.reading.tintDialogue }"
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
        </div>
        <div v-if="editing" class="edit">
          <textarea
            ref="editor"
            v-model="draft"
            spellcheck="false"
            aria-label="Chapter text"
            @keydown="onEditKey"
          />
          <div class="edit-bar">
            <span>Blank lines separate paragraphs. Unchanged paragraphs keep their audio.</span>
            <span class="sp" />
            <button class="btn ghost" @click="ui.editingId = null">Cancel <kbd>Esc</kbd></button>
            <button class="btn pri" @click="saveEdit">Save <kbd>⌘↵</kbd></button>
          </div>
        </div>
        <!-- v-show, not v-if: paint() keeps references into this element -->
        <div v-show="!editing" ref="textEl" class="text" @click="onClick" v-html="html" />
        <template v-if="editing" />
        <button v-else-if="nextCh" class="endcard" @click="nextChapter()">
          <span><small>Up next · plays automatically</small><b>{{ nextCh.title }}</b></span>
          <span class="sp" />
          <kbd>J</kbd>
        </button>
        <div v-else class="endcard">
          <span><small>End of the list</small><b>Paste the next chapter to keep listening</b></span>
          <span class="sp" />
          <kbd>⌘V</kbd>
        </div>
      </article>
    </section>
    <button
      v-if="!ui.follow && player.started && doc && !editing"
      class="follow"
      @click="backToCurrent"
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
.edit textarea {
  display: block;
  width: 100%;
  min-height: 60vh;
  field-sizing: content;
  resize: vertical;
  padding: 12px 14px;
  border: 1px solid var(--line2);
  border-radius: var(--r2);
  background: var(--raised);
  font: inherit;
  line-height: var(--rl);
  color: var(--ink);
}
.edit textarea:focus {
  outline: 2px solid var(--acc);
  outline-offset: 1px;
}
.edit-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  background: var(--page);
  font: 12px/1.45 var(--ui);
  color: var(--ink3);
}
.edit-bar kbd {
  margin-left: 2px;
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
.meta b {
  font-weight: 500;
  color: var(--ink2);
}

.text :deep(p) {
  margin: 0 0 0.85em;
  position: relative;
  text-wrap: pretty;
  hanging-punctuation: first;
}
.text :deep(p.curp)::before {
  content: "";
  position: absolute;
  left: -18px;
  top: 0.4em;
  bottom: 0.4em;
  width: 2px;
  border-radius: 2px;
  background: var(--line2);
}
.text :deep(.seg) {
  --k: var(--acc);
  border-radius: 3px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background-color 0.18s;
}
.text :deep(.seg.dlg) {
  --k: var(--dlg);
}
.tint .text :deep(.seg.dlg) {
  color: color-mix(in oklab, var(--ink) 62%, var(--dlg));
}
.text :deep(.seg.cur) {
  color: var(--ink-hi);
  background: color-mix(in srgb, var(--k) 11%, transparent);
  box-shadow: 0 0 0 0.13em color-mix(in srgb, var(--k) 11%, transparent);
}
.tint .text :deep(.seg.dlg.cur) {
  color: color-mix(in oklab, var(--ink-hi) 70%, var(--dlg));
}
.text :deep(.seg.wait) {
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
@keyframes sheen {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -150% 0;
  }
}
.text :deep(.seg.bad) {
  --k: var(--err);
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--err);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.32em;
}
.text :deep(.w) {
  border-radius: 3px;
  cursor: pointer;
}
.text :deep(.w:hover) {
  background: color-mix(in srgb, var(--k) 16%, transparent);
}
.text :deep(.w.now) {
  background: color-mix(in srgb, var(--k) 26%, transparent);
  box-shadow: 0 0 0 0.13em color-mix(in srgb, var(--k) 26%, transparent);
  color: var(--ink-hi);
}
.text :deep(.w.now.al) {
  background: color-mix(in srgb, var(--k) 36%, transparent);
  box-shadow: 0 0 0 0.13em color-mix(in srgb, var(--k) 36%, transparent);
  text-decoration-line: underline;
  text-decoration-style: solid;
  text-decoration-color: var(--k);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.3em;
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
.endcard small {
  font: 600 10.5px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink3);
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
  border-radius: 999px;
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
  .text :deep(p.curp)::before {
    left: -11px;
  }
}
</style>
