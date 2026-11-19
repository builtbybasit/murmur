<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { onClickOutside, onKeyStroke, useMediaQuery } from "@vueuse/core";
import {
  ChevronRight,
  CircleCheck,
  Clock,
  Download,
  FilePenLine,
  GripVertical,
  Trash2,
  TriangleAlert,
  X,
} from "@lucide/vue";
import { settings, device } from "../settings";
import {
  library,
  docOf,
  isShort,
  CHARS_PER_SEC,
  renameChapter,
  moveChapters,
  deleteChapters,
  renameBook,
  setBook,
  type Chapter,
} from "../library";
import { ui, toast } from "../ui";
import { pasteFromClipboard, undoWithToast } from "../paste";
import { player, open, edit, generating, genState, toggleGenerate } from "../engine";

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
const narrow = useMediaQuery("(max-width: 820px)");
const side = ref<HTMLElement>();
const list = ref<HTMLElement>();

const kw = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
const meta = computed(() => {
  const n = library.chapters.length;
  return n
    ? `${n} · ${kw(library.chapters.reduce((s, c) => s + docOf(c).words, 0))} words`
    : "none yet";
});
const mins = (c: Chapter) =>
  Math.max(1, Math.round(docOf(c).chars / CHARS_PER_SEC / settings.speed / 60));
const pct = (c: Chapter) => {
  const n = docOf(c).segs.length;
  return n ? Math.min(100, Math.round((100 * (library.positions[c.id] ?? 0)) / n)) : 0;
};
const RING = 2 * Math.PI * 6; // progress ring circumference (r = 6)
function genTitle(c: Chapter) {
  const j = generating[c.id] ?? { done: 0, total: 0, error: "" };
  return {
    queued: "Waiting to generate audio. Click to cancel.",
    running: `Generating audio: ${j.done} of ${j.total} segments. Click to stop; finished segments stay.`,
    failed: `Audio generation stopped: ${j.error}. Click to try again.`,
    done: "Audio ready for the whole chapter. Click to check again.",
  }[genState(c)!];
}

const rowEl = (id: string) => list.value?.querySelector<HTMLElement>(`[data-id="${id}"]`);
const focusRow = (id?: string) => id && nextTick(() => rowEl(id)?.focus());

onClickOutside(side, () => (ui.sidebarDrawer = false), {
  ignore: ["[data-side-toggle]", ".toast"],
});

// ---- multi-select: Shift-click = range from the open (or last clicked) chapter, ⌘/Ctrl-click = toggle ----
const sel = reactive(new Set<string>());
let anchor: string | null = null;
// ---- books: consecutive chapters with the same `book` form a group under a folding header ----
interface Head {
  kind: "head";
  book: string;
  ids: string[];
  secs: number;
  key: string;
}
interface Row {
  kind: "row";
  c: Chapter;
  i: number; // index in library.chapters
  n: number; // number within its group
}
const folded = (b: string) => settings.collapsed.includes(b);
const items = computed(() => {
  const out: (Head | Row)[] = [];
  let prev: string | null = null;
  let head: Head | null = null;
  let n = 0;
  for (let i = 0; i < library.chapters.length; i++) {
    const c = library.chapters[i]!;
    const b = c.book ?? "";
    if (b !== prev) {
      prev = b;
      n = 0;
      head = b ? { kind: "head", book: b, ids: [], secs: 0, key: "h:" + c.id } : null;
      if (head) out.push(head);
    }
    n++;
    if (head) {
      head.ids.push(c.id);
      head.secs += docOf(c).chars / CHARS_PER_SEC;
    }
    if (!head || !folded(b)) out.push({ kind: "row", c, i, n });
  }
  return out;
});
function toggleFold(b: string) {
  settings.collapsed = folded(b)
    ? settings.collapsed.filter((x) => x !== b)
    : [...settings.collapsed, b];
}
const dur = (secs: number) => {
  const m = Math.max(1, Math.round(secs / settings.speed / 60));
  return m < 60 ? m + "m" : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const bookChapters = (h: Head) => library.chapters.filter((c) => h.ids.includes(c.id));
function bookGenerate(h: Head) {
  const list = bookChapters(h).filter(
    (c) => generating[c.id]?.state !== "queued" && generating[c.id]?.state !== "running",
  );
  for (const c of list) toggleGenerate(c.id);
  toast({ title: `Generating audio for ${list.length} chapters`, sub: h.book }, 3000);
}
const renamingBook = ref<string | null>(null);
watch(renamingBook, async (b) => {
  if (!b) return;
  await nextTick();
  const inp = list.value?.querySelector<HTMLInputElement>(".book input");
  inp?.focus();
  inp?.select();
});
function endBookRename(from: string, to: string | null) {
  if (renamingBook.value !== from) return;
  renamingBook.value = null;
  if (to !== null) renameBook(from, to);
}
function onHeadKey(e: KeyboardEvent, h: Head) {
  if (e.target !== e.currentTarget) return;
  const k = e.key,
    el = e.currentTarget as HTMLElement;
  if (k === "Enter" || k === " ") toggleFold(h.book);
  else if (k === "F2") renamingBook.value = h.book;
  else if (k === "ArrowUp" || k === "ArrowDown")
    ((k === "ArrowUp" ? el.previousElementSibling : el.nextElementSibling) as HTMLElement)?.focus();
  else return;
  e.preventDefault();
}

/** Visible chapter ids, top to bottom (folded books are skipped by Shift ranges). */
const ids = () => items.value.flatMap((x) => (x.kind === "row" ? [x.c.id] : []));
function onRowClick(e: MouseEvent, c: Chapter) {
  if (ui.renamingId === c.id) return;
  const from = anchor ?? ui.currentId;
  if (e.shiftKey && from) {
    const all = ids();
    const [a, b] = [all.indexOf(from), all.indexOf(c.id)].sort((x, y) => x - y);
    sel.clear();
    for (const id of all.slice(Math.max(0, a!), b! + 1)) sel.add(id);
    anchor = from;
  } else if (e.metaKey || e.ctrlKey) {
    if (!sel.size && ui.currentId && ui.currentId !== c.id) sel.add(ui.currentId);
    if (sel.has(c.id)) sel.delete(c.id);
    else sel.add(c.id);
    anchor = c.id;
  } else {
    sel.clear();
    anchor = null;
    openRow(c.id);
  }
}
onKeyStroke("Escape", () => sel.clear());
// selected chapters in list order (ids of deleted chapters drop out)
const picked = () => library.chapters.filter((c) => sel.has(c.id));

function bulkGenerate() {
  const list = picked().filter(
    (c) => generating[c.id]?.state !== "queued" && generating[c.id]?.state !== "running",
  );
  for (const c of list) toggleGenerate(c.id);
  sel.clear();
  toast(
    { title: `Generating audio for ${list.length} chapter${list.length === 1 ? "" : "s"}` },
    3000,
  );
}
function bulkDelete() {
  removeChapters(picked());
  sel.clear();
}

function openRow(id: string) {
  open(id);
  ui.view = "reader"; // clicking a chapter while Settings is open shows that chapter
  if (narrow.value) ui.sidebarDrawer = false;
}
function openEditor(id: string) {
  edit(id);
  if (narrow.value) ui.sidebarDrawer = false;
}

// ---- flash: copy ui.flashId locally so the same id can flash again ----
const flashing = ref<string | null>(null);
let flashT: ReturnType<typeof setTimeout>;
watch(
  () => ui.flashId,
  async (id) => {
    if (!id) return;
    ui.flashId = null;
    const book = library.chapters.find((c) => c.id === id)?.book;
    if (book && folded(book)) toggleFold(book); // show the row that should flash
    flashing.value = null;
    await nextTick();
    const el = rowEl(id);
    void el?.offsetWidth; // restart the animation
    flashing.value = id;
    el?.scrollIntoView({ block: "nearest" });
    clearTimeout(flashT);
    flashT = setTimeout(() => (flashing.value = null), 1400);
  },
);

// ---- rename (also started by the paste toast) ----
watch(
  () => ui.renamingId,
  async (id) => {
    if (!id) return;
    device.sidebarOpen = true;
    if (narrow.value) ui.sidebarDrawer = true;
    await nextTick();
    const inp = list.value?.querySelector("input");
    inp?.focus();
    inp?.select();
  },
);
function endRename(id: string, value: string | null) {
  if (ui.renamingId !== id) return; // Enter/Esc already ended it; this is the blur that follows
  if (value !== null) renameChapter(id, value);
  ui.renamingId = null;
  focusRow(id);
}

function removeChapters(cs: Chapter[]) {
  if (!cs.length) return;
  const wasCurrent = cs.some((c) => c.id === ui.currentId);
  for (const c of cs) {
    const s = generating[c.id]?.state;
    if (s === "queued" || s === "running") toggleGenerate(c.id); // stop its background job
  }
  deleteChapters(cs.map((c) => c.id));
  if (wasCurrent && ui.currentId) open(ui.currentId);
  toast({
    title: cs.length === 1 ? `Deleted “${cs[0]!.title}”` : `Deleted ${cs.length} chapters`,
    sub: "Cached audio is kept until you clear the cache.",
    actions: [{ label: "Undo", run: undoWithToast }],
  });
}
const del = (c: Chapter) => removeChapters([c]);

// ---- drag to reorder ----
const dragId = ref<string | null>(null);
const dragHead = ref<Head | null>(null); // dragging a whole book by its header
// head: dropping on a book header puts the chapters at the start of that book
const drop = ref<{ id: string; after: boolean; head?: boolean } | null>(null);
// dragging a selected row moves the whole selection
const dragging = () =>
  dragHead.value
    ? dragHead.value.ids
    : dragId.value && sel.has(dragId.value)
      ? picked().map((c) => c.id)
      : [dragId.value!];
function onHeadDragStart(e: DragEvent, h: Head) {
  dragHead.value = h;
  onDragStart(e, h.ids[0]!, h.book);
}
function onDragStart(e: DragEvent, id: string, label?: string) {
  dragId.value = id;
  const dt = e.dataTransfer!;
  dt.effectAllowed = "move";
  dt.setData("text/plain", id); // Firefox will not start a drag without data
  const n = dragging().length;
  if (n > 1 || label) {
    // one small label instead of the row's ghost: "3 chapters"
    const tag = Object.assign(document.createElement("div"), {
      className: "drag-tag",
      textContent: label ?? `${n} chapters`,
    });
    document.body.append(tag);
    dt.setDragImage(tag, 12, 12);
    setTimeout(() => tag.remove());
  }
}
function onDragOver(e: DragEvent, id: string) {
  if (!dragId.value) return;
  e.preventDefault();
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
  drop.value = { id, after: e.clientY > b.top + b.height / 2 };
}
function onHeadDragOver(e: DragEvent, h: Head) {
  if (!dragId.value) return;
  e.preventDefault();
  drop.value = { id: h.ids[0]!, after: false, head: true };
}
function onDrop(e: DragEvent) {
  const d = drop.value;
  const moving = dragging();
  if (!dragId.value || !d || moving.includes(d.id)) return onDragEnd();
  e.preventDefault();
  const target = library.chapters.find((c) => c.id === d.id);
  const h = dragHead.value;
  if (h) {
    // a whole book lands before or after another book, never inside it
    const run = target?.book && target.book !== h.book ? runOf(d.id) : [d.id];
    moveChapters(moving, d.after ? run.at(-1)! : run[0]!, d.after);
  } else {
    moveChapters(moving, d.id, d.after);
    setBook(moving, target?.book); // dropped among a book's chapters: it joins that book
  }
  onDragEnd();
}
const runOf = (id: string) =>
  items.value.find((x): x is Head => x.kind === "head" && x.ids.includes(id))?.ids ?? [id];
function onDragEnd() {
  dragId.value = null;
  dragHead.value = null;
  drop.value = null;
}

// ---- row keys; handled keys are preventDefault'ed so App's global map skips them ----
function onRowKey(e: KeyboardEvent, c: Chapter, i: number) {
  if (e.target !== e.currentTarget) return;
  const k = e.key,
    row = e.currentTarget as HTMLElement;
  if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
    const up = k === "ArrowUp";
    const n = library.chapters[i + (up ? -1 : 1)];
    if (n) moveChapters([c.id], n.id, !up);
    focusRow(c.id);
  } else if (k === "ArrowUp" || k === "ArrowDown") {
    (
      (k === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling) as HTMLElement | null
    )?.focus();
  } else if (k === "Enter") openRow(c.id);
  else if (k === "F2") ui.renamingId = c.id;
  else if ((k === "Delete" || k === "Backspace") && sel.has(c.id) && sel.size > 1) bulkDelete();
  else if (k === "Delete" || k === "Backspace") {
    del(c);
    focusRow((library.chapters[i] ?? library.chapters.at(-1))?.id);
  } else return;
  e.preventDefault();
}

function pickEpub(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) ui.epubFile = input.files[0];
  input.value = ""; // the same file can be picked again
}
</script>

<template>
  <aside
    ref="side"
    class="side"
    :class="{ closed: !device.sidebarOpen, open: ui.sidebarDrawer }"
    :inert="narrow && !ui.sidebarDrawer"
    aria-label="Chapters"
  >
    <div class="side-h"><span>Chapters</span><span class="num">{{ meta }}</span></div>
    <ol ref="list" class="list" @drop="onDrop">
      <template v-for="it in items" :key="it.kind === 'head' ? it.key : it.c.id">
        <li
          v-if="it.kind === 'head'"
          class="book"
          :class="{
            fold: folded(it.book),
            'drop-b': drop?.head && drop.id === it.ids[0],
          }"
          tabindex="0"
          :draggable="renamingBook !== it.book"
          :title="`${it.book} · ${it.ids.length} chapters. Click to fold, double-click the name to rename, drag to move the book.`"
          @click="toggleFold(it.book)"
          @keydown="onHeadKey($event, it)"
          @dragstart="onHeadDragStart($event, it)"
          @dragover="onHeadDragOver($event, it)"
          @dragend="onDragEnd"
        >
          <ChevronRight class="chev" :size="13" />
          <input
            v-if="renamingBook === it.book"
            class="t"
            type="text"
            :value="it.book"
            aria-label="Book name"
            @click.stop
            @keydown.stop="
              $event.key === 'Enter' &&
                endBookRename(it.book, ($event.target as HTMLInputElement).value);
              $event.key === 'Escape' && endBookRename(it.book, null);
            "
            @blur="endBookRename(it.book, ($event.target as HTMLInputElement).value)"
          />
          <span v-else class="t" @dblclick.stop="renamingBook = it.book">{{ it.book }}</span>
          <span class="m num">{{ it.ids.length }} · {{ dur(it.secs) }}</span>
          <span class="acts">
            <button
              class="ib"
              title="Generate audio for every chapter in this book"
              aria-label="Generate audio for the book"
              @click.stop="bookGenerate(it)"
            >
              <Download :size="14" :stroke-width="1.5" />
            </button>
            <button
              class="ib"
              title="Delete the whole book"
              aria-label="Delete book"
              @click.stop="removeChapters(bookChapters(it))"
            >
              <Trash2 :size="14" :stroke-width="1.5" />
            </button>
          </span>
        </li>
        <li
          v-else
          class="row"
          :class="{
            inb: !!it.c.book,
            on: it.c.id === ui.currentId,
            sel: sel.has(it.c.id),
            flash: it.c.id === flashing,
            'drop-a': drop?.id === it.c.id && drop.after,
            'drop-b': drop?.id === it.c.id && !drop.after,
          }"
          :data-id="it.c.id"
          tabindex="0"
          :draggable="ui.renamingId !== it.c.id"
          :title="`${it.c.title} · ${docOf(it.c).words.toLocaleString()} words`"
          @click="onRowClick($event, it.c)"
          @keydown="onRowKey($event, it.c, it.i)"
          @dragstart="onDragStart($event, it.c.id)"
          @dragover="onDragOver($event, it.c.id)"
          @dragend="onDragEnd"
        >
          <span class="grip"><GripVertical :size="12" :stroke-width="1.5" /></span>
          <span class="n">
            <i v-if="player.status === 'playing' && ui.currentId === it.c.id" class="eq"
              ><b></b><b></b><b></b
            ></i>
            <template v-else>{{ String(it.n).padStart(2, "0") }}</template>
          </span>
          <input
            v-if="ui.renamingId === it.c.id"
            class="t"
            type="text"
            :value="it.c.title"
            aria-label="Chapter title"
            @click.stop
            @keydown.stop="
              $event.key === 'Enter' &&
                endRename(it.c.id, ($event.target as HTMLInputElement).value);
              $event.key === 'Escape' && endRename(it.c.id, null);
            "
            @blur="endRename(it.c.id, ($event.target as HTMLInputElement).value)"
          />
          <span
            v-else
            class="t"
            title="Double-click to rename (F2)"
            @dblclick.stop="ui.renamingId = it.c.id"
            >{{ it.c.title }}</span
          >
          <span v-if="isShort(it.c)" class="short">short</span>
          <button
            v-if="genState(it.c)"
            class="gen"
            :class="genState(it.c)"
            :title="genTitle(it.c)"
            :aria-label="genTitle(it.c)"
            @click.stop="toggleGenerate(it.c.id)"
          >
            <svg v-if="genState(it.c) === 'running'" viewBox="0 0 16 16" width="14" height="14">
              <circle cx="8" cy="8" r="6" class="track" />
              <circle
                cx="8"
                cy="8"
                r="6"
                class="bar"
                :stroke-dasharray="`${(RING * generating[it.c.id]!.done) / Math.max(1, generating[it.c.id]!.total)} ${RING}`"
                transform="rotate(-90 8 8)"
              />
            </svg>
            <Clock v-else-if="genState(it.c) === 'queued'" :size="13" />
            <TriangleAlert v-else-if="genState(it.c) === 'failed'" :size="13" />
            <CircleCheck v-else :size="13" />
          </button>
          <span class="m num">{{ mins(it.c) }}m</span>
          <span class="acts">
            <button
              v-if="!genState(it.c)"
              class="ib"
              title="Generate audio for the whole chapter, in the background"
              aria-label="Generate audio"
              @click.stop="toggleGenerate(it.c.id)"
            >
              <Download :size="14" :stroke-width="1.5" />
            </button>
            <button
              class="ib"
              title="Edit text (E)"
              aria-label="Edit text"
              @click.stop="openEditor(it.c.id)"
            >
              <FilePenLine :size="14" :stroke-width="1.5" />
            </button>
            <button class="ib" title="Delete (⌫)" aria-label="Delete" @click.stop="del(it.c)">
              <Trash2 :size="14" :stroke-width="1.5" />
            </button>
          </span>
          <i class="prog" :style="{ width: pct(it.c) + '%' }"></i>
        </li>
      </template>
      <li v-if="!library.chapters.length" class="empty">
        Chapters you paste appear here, in the order you paste them.
      </li>
    </ol>
    <div v-if="sel.size" class="bulk" role="toolbar" aria-label="Selected chapters">
      <b class="num">{{ sel.size }} selected</b>
      <span class="sp" />
      <button class="btn" title="Generate audio for each, in list order" @click="bulkGenerate">
        <Download :size="13" /> Audio
      </button>
      <button class="btn" title="Delete the selected chapters (⌫)" @click="bulkDelete">
        <Trash2 :size="13" /> Delete
      </button>
      <button
        class="ib"
        title="Clear selection (Esc)"
        aria-label="Clear selection"
        @click="sel.clear()"
      >
        <X :size="14" />
      </button>
    </div>
    <div v-else class="slot">
      <div class="slot-t"><span>Paste next chapter</span><kbd>{{ MOD }}V</kbd></div>
      <div class="slot-s">
        Works anywhere in the app. One chapter per paste; the title comes from its first line.
      </div>
      <div class="slot-b">
        <button class="btn" @click="pasteFromClipboard">Paste from clipboard</button>
        <label class="btn" title="Import chapters from an EPUB book (or drop the file anywhere)"
          >Import EPUB<input
            type="file"
            accept=".epub,application/epub+zip"
            hidden
            @change="pickEpub"
        /></label>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--line);
}
.side.closed {
  display: none;
}
.side-h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 12px 8px;
  font: 600 11px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink2);
}
.side-h .num {
  text-transform: none;
  letter-spacing: 0;
}
.list {
  user-select: none; /* shift-click selects chapters, not text */
  list-style: none;
  margin: 0;
  padding: 0 6px;
  overflow: auto;
  flex: 1;
  min-height: 40px;
}
.empty {
  padding: 10px 8px;
  color: var(--ink3);
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px 0 2px;
  border-radius: var(--r2);
  cursor: pointer;
  overflow: hidden;
}
.row:hover {
  background: var(--hover);
}
.row.sel {
  background: color-mix(in srgb, var(--acc) 7%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--acc) 55%, transparent);
}
.bulk {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 6px;
  padding: 6px 4px 6px 10px;
  border: 1px solid color-mix(in srgb, var(--acc) 40%, var(--line));
  border-radius: var(--r3);
  background: color-mix(in srgb, var(--acc) 7%, var(--surface));
}
.bulk b {
  font: 600 12px var(--ui);
  color: var(--ink-hi);
  white-space: nowrap;
}
.bulk .btn {
  padding: 0 7px;
  gap: 4px;
  font-size: 12px;
}
.bulk .ib {
  flex: none;
  width: 24px;
  height: 24px;
}
.row.on {
  background: color-mix(in srgb, var(--acc) 13%, transparent);
  color: var(--ink-hi);
}
.grip {
  width: 12px;
  color: var(--ink3);
  opacity: 0;
  cursor: grab;
}
.row:hover .grip,
.row:focus-visible .grip {
  opacity: 1;
}
.n {
  font: 500 11px var(--mono);
  color: var(--ink3);
  width: 18px;
  text-align: right;
  flex: none;
  display: flex;
  justify-content: flex-end;
}
.row.on .n {
  color: var(--acc);
}
.t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
input.t {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--acc);
  border-radius: var(--r1);
  background: var(--page);
  outline: 0;
}
.acts {
  display: none;
  gap: 0;
}
.book {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  margin-top: 6px;
  padding: 0 6px 0 4px;
  border-radius: var(--r2);
  font: 600 12px var(--ui);
  color: var(--ink2);
  cursor: pointer;
  outline-offset: -2px;
}
.book:hover {
  background: var(--hover);
  color: var(--ink);
}
.book .chev {
  flex: none;
  color: var(--ink3);
  transform: rotate(90deg);
  transition: transform 0.15s;
}
.book.fold .chev {
  transform: none;
}
.book .t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.book input.t {
  font: inherit;
  color: var(--ink-hi);
  background: var(--raised);
  border: 1px solid var(--acc);
  border-radius: var(--r1, 4px);
  padding: 2px 4px;
}
.book .m {
  font: 500 11px var(--mono);
  color: var(--ink3);
  white-space: nowrap;
}
.book.drop-b {
  box-shadow: inset 0 2px 0 var(--acc);
}
.row.inb {
  margin-left: 10px;
}
.book:hover .acts,
.book:focus-within .acts,
.row:hover .acts,
.row:focus-within .acts {
  display: flex;
}
.book:hover .m,
.book:focus-within .m,
.row:hover .m,
.row:focus-within .m {
  display: none;
}
.gen {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--ink3);
}
.gen:hover {
  background: var(--raised);
}
.gen.running {
  color: var(--acc);
}
.gen.failed {
  color: var(--err);
}
.gen.done {
  color: var(--ok);
}
.gen circle {
  fill: none;
  stroke-width: 2.2;
}
.gen .track {
  stroke: var(--line2);
}
.gen .bar {
  stroke: currentColor;
  stroke-linecap: round;
  transition: stroke-dasharray 0.3s;
}
.acts .ib {
  width: 24px;
  height: 24px;
}
.prog {
  position: absolute;
  left: 28px;
  bottom: 2px;
  height: 2px;
  border-radius: 2px;
  background: var(--acc);
  opacity: 0.6;
  max-width: calc(100% - 36px);
}
.row.flash {
  animation: flash 1.4s ease-out;
}
.row.drop-b {
  box-shadow: inset 0 2px 0 var(--acc);
}
.row.drop-a {
  box-shadow: inset 0 -2px 0 var(--acc);
}
.short {
  font: 500 10px var(--mono);
  color: var(--warn);
  border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent);
  border-radius: 3px;
  padding: 0 4px;
}
@keyframes flash {
  0% {
    background: color-mix(in srgb, var(--dlg) 40%, transparent);
  }
  100% {
    background: transparent;
  }
}
.eq {
  display: inline-flex;
  gap: 2px;
  align-items: flex-end;
  height: 10px;
}
.eq b {
  width: 2px;
  background: var(--acc);
  border-radius: 1px;
  animation: eq 900ms ease-in-out infinite;
}
.eq b:nth-child(2) {
  animation-delay: -300ms;
}
.eq b:nth-child(3) {
  animation-delay: -600ms;
}
@keyframes eq {
  0%,
  100% {
    height: 3px;
  }
  50% {
    height: 10px;
  }
}
.slot {
  margin: 8px;
  padding: 10px;
  border: 1px dashed var(--line2);
  border-radius: var(--r3);
  background: var(--bg);
}
.slot-t {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
  color: var(--ink-hi);
}
.slot-s {
  color: var(--ink3);
  font-size: 11.5px;
  margin: 2px 0 8px;
}
.slot-b {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
@media (max-width: 820px) {
  .side,
  .side.closed {
    display: flex;
    position: absolute;
    z-index: 20;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(300px, 86vw);
    transform: translateX(-102%);
    transition: transform 0.18s;
    box-shadow: var(--shadow);
  }
  .side.open {
    transform: none;
  }
}
</style>
