<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { onClickOutside, useMediaQuery } from "@vueuse/core";
import {
  CircleCheck,
  Clock,
  Download,
  FilePenLine,
  GripVertical,
  Trash2,
  TriangleAlert,
} from "@lucide/vue";
import {
  settings,
  ui,
  library,
  docOf,
  CHARS_PER_SEC,
  renameChapter,
  moveChapter,
  deleteChapter,
  toast,
  type Chapter,
} from "../store";
import { pasteFromClipboard, undoWithToast } from "../paste";
import { player, open, edit, generating, toggleGenerate } from "../engine";

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
  return n ? Math.min(100, Math.round((100 * c.pos) / n)) : 0;
};
const RING = 2 * Math.PI * 6; // progress ring circumference (r = 6)
function genTitle(id: string) {
  const j = generating[id]!;
  return {
    queued: "Waiting to generate audio. Click to cancel.",
    running: `Generating audio: ${j.done} of ${j.total} segments. Click to stop; finished segments stay.`,
    failed: `Audio generation stopped: ${j.error}. Click to try again.`,
    done: "Audio ready for the whole chapter.",
  }[j.state];
}

const rowEl = (id: string) => list.value?.querySelector<HTMLElement>(`[data-id="${id}"]`);
const focusRow = (id?: string) => id && nextTick(() => rowEl(id)?.focus());

onClickOutside(side, () => (ui.sidebarDrawer = false), {
  ignore: ["[data-side-toggle]", ".toast"],
});

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
    settings.sidebarOpen = true;
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

function del(c: Chapter) {
  const wasCurrent = ui.currentId === c.id;
  deleteChapter(c.id);
  if (wasCurrent && ui.currentId) open(ui.currentId);
  toast({
    title: `Deleted “${c.title}”`,
    sub: "Its cached audio is kept until you clear the cache.",
    actions: [{ label: "Undo", run: undoWithToast }],
  });
}

// ---- drag to reorder ----
const dragId = ref<string | null>(null);
const drop = ref<{ id: string; after: boolean } | null>(null);
function onDragStart(e: DragEvent, id: string) {
  dragId.value = id;
  e.dataTransfer!.effectAllowed = "move";
  e.dataTransfer!.setData("text/plain", id); // Firefox will not start a drag without data
}
function onDragOver(e: DragEvent, id: string) {
  if (!dragId.value) return;
  e.preventDefault();
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
  drop.value = { id, after: e.clientY > b.top + b.height / 2 };
}
function onDrop(e: DragEvent) {
  const id = dragId.value,
    d = drop.value;
  if (!id || !d) return;
  e.preventDefault();
  const idx = (x: string) => library.chapters.findIndex((c) => c.id === x);
  let to = idx(d.id) + (d.after ? 1 : 0);
  if (idx(id) < to) to--;
  moveChapter(id, to);
  onDragEnd();
}
function onDragEnd() {
  dragId.value = null;
  drop.value = null;
}

// ---- row keys; handled keys are preventDefault'ed so App's global map skips them ----
function onRowKey(e: KeyboardEvent, c: Chapter, i: number) {
  if (e.target !== e.currentTarget) return;
  const k = e.key,
    row = e.currentTarget as HTMLElement;
  if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
    moveChapter(c.id, i + (k === "ArrowUp" ? -1 : 1));
    focusRow(c.id);
  } else if (k === "ArrowUp" || k === "ArrowDown") {
    (
      (k === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling) as HTMLElement | null
    )?.focus();
  } else if (k === "Enter") openRow(c.id);
  else if (k === "F2") ui.renamingId = c.id;
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
    :class="{ closed: !settings.sidebarOpen, open: ui.sidebarDrawer }"
    :inert="narrow && !ui.sidebarDrawer"
    aria-label="Chapters"
  >
    <div class="side-h"><span>Chapters</span><span class="num">{{ meta }}</span></div>
    <ol ref="list" class="list" @drop="onDrop">
      <li
        v-for="(c, i) in library.chapters"
        :key="c.id"
        class="row"
        :class="{
          on: c.id === ui.currentId,
          flash: c.id === flashing,
          'drop-a': drop?.id === c.id && drop.after,
          'drop-b': drop?.id === c.id && !drop.after,
        }"
        :data-id="c.id"
        tabindex="0"
        :draggable="ui.renamingId !== c.id"
        :title="`${c.title} · ${docOf(c).words.toLocaleString()} words`"
        @click="ui.renamingId !== c.id && openRow(c.id)"
        @keydown="onRowKey($event, c, i)"
        @dragstart="onDragStart($event, c.id)"
        @dragover="onDragOver($event, c.id)"
        @dragend="onDragEnd"
      >
        <span class="grip"><GripVertical :size="12" :stroke-width="1.5" /></span>
        <span class="n">
          <i v-if="player.status === 'playing' && ui.currentId === c.id" class="eq"
            ><b></b><b></b><b></b
          ></i>
          <template v-else>{{ String(i + 1).padStart(2, "0") }}</template>
        </span>
        <input
          v-if="ui.renamingId === c.id"
          class="t"
          type="text"
          :value="c.title"
          aria-label="Chapter title"
          @click.stop
          @keydown.stop="
            $event.key === 'Enter' && endRename(c.id, ($event.target as HTMLInputElement).value);
            $event.key === 'Escape' && endRename(c.id, null);
          "
          @blur="endRename(c.id, ($event.target as HTMLInputElement).value)"
        />
        <span
          v-else
          class="t"
          title="Double-click to rename (F2)"
          @dblclick.stop="ui.renamingId = c.id"
          >{{ c.title }}</span
        >
        <span v-if="c.short" class="short">short</span>
        <button
          v-if="generating[c.id]"
          class="gen"
          :class="generating[c.id]!.state"
          :title="genTitle(c.id)"
          :aria-label="genTitle(c.id)"
          @click.stop="toggleGenerate(c.id)"
        >
          <svg
            v-if="generating[c.id]!.state === 'running'"
            viewBox="0 0 16 16"
            width="14"
            height="14"
          >
            <circle cx="8" cy="8" r="6" class="track" />
            <circle
              cx="8"
              cy="8"
              r="6"
              class="bar"
              :stroke-dasharray="`${(RING * generating[c.id]!.done) / Math.max(1, generating[c.id]!.total)} ${RING}`"
              transform="rotate(-90 8 8)"
            />
          </svg>
          <Clock v-else-if="generating[c.id]!.state === 'queued'" :size="13" />
          <TriangleAlert v-else-if="generating[c.id]!.state === 'failed'" :size="13" />
          <CircleCheck v-else :size="13" />
        </button>
        <span class="m num">{{ mins(c) }}m</span>
        <span class="acts">
          <button
            v-if="!generating[c.id]"
            class="ib"
            title="Generate audio for the whole chapter, in the background"
            aria-label="Generate audio"
            @click.stop="toggleGenerate(c.id)"
          >
            <Download :size="14" :stroke-width="1.5" />
          </button>
          <button
            class="ib"
            title="Edit text (E)"
            aria-label="Edit text"
            @click.stop="openEditor(c.id)"
          >
            <FilePenLine :size="14" :stroke-width="1.5" />
          </button>
          <button class="ib" title="Delete (⌫)" aria-label="Delete" @click.stop="del(c)">
            <Trash2 :size="14" :stroke-width="1.5" />
          </button>
        </span>
        <i class="prog" :style="{ width: pct(c) + '%' }"></i>
      </li>
      <li v-if="!library.chapters.length" class="empty">
        Chapters you paste appear here, in the order you paste them.
      </li>
    </ol>
    <div class="slot">
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
.row:hover .acts,
.row:focus-within .acts {
  display: flex;
}
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
