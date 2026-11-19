<script setup lang="ts">
// EPUB import: pick chapters (front/back matter unticked), convert, add as one undo step.
import { computed, onMounted, ref, shallowRef } from "vue";
import { addChapters } from "../library";
import { toast, ui } from "../ui";
import { undoWithToast } from "../paste";
import { openEpub, type Epub } from "../lib/epub";
import { plural } from "../lib/format";

const dlg = ref<HTMLDialogElement>();
const book = shallowRef<Epub | null>(null); // epub-ts objects stay raw, not reactive proxies
const picks = ref<boolean[]>([]);
const error = ref("");
const progress = ref<{ done: number; total: number } | null>(null);
let last = -1;
let stopped = false;

const chosen = computed(() => picks.value.filter(Boolean).length);
const words = computed(
  () => book.value?.items.reduce((n, it, i) => n + (picks.value[i] ? it.words : 0), 0) ?? 0,
);

onMounted(async () => {
  dlg.value?.showModal();
  try {
    const b = await openEpub(await ui.epubFile!.arrayBuffer());
    if (!b.items.some((it) => it.words))
      throw new Error("It has no readable text; it may be protected by DRM (Kindle, Adobe).");
    book.value = b;
    picks.value = b.items.map((it) => it.pick);
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e);
  }
});

/** Click toggles a row; shift-click sets the whole range to the same state. */
function tick(i: number, e: MouseEvent) {
  const on = (e.target as HTMLInputElement).checked;
  if (e.shiftKey && last >= 0)
    for (let k = Math.min(last, i); k <= Math.max(last, i); k++) picks.value[k] = on;
  else picks.value[i] = on;
  last = i;
}
const all = (on: boolean) => (picks.value = picks.value.map(() => on));
const suggested = () => (picks.value = book.value!.items.map((it) => it.pick));

async function run() {
  const b = book.value!;
  const list = b.items.filter((_, i) => picks.value[i]);
  progress.value = { done: 0, total: list.length };
  const out: { title: string; body: string }[] = [];
  try {
    for (const it of list) {
      if (stopped) return;
      const body = await b.convert(it);
      if (body) out.push({ title: it.title, body });
      progress.value.done++;
    }
  } catch (e) {
    progress.value = null;
    error.value = "Import failed: " + ((e as Error)?.message ?? String(e));
    return;
  }
  const added = addChapters(out, b.title.trim() || ui.epubFile?.name.replace(/\.epub$/i, ""));
  close();
  toast({
    title: `Imported ${plural(added.length, "chapter")}`,
    sub: b.title,
    actions: [{ label: "Undo", run: undoWithToast }],
  });
}

function close() {
  stopped = true;
  dlg.value?.close();
}
</script>

<template>
  <dialog ref="dlg" aria-label="Import EPUB" @close="((stopped = true), (ui.epubFile = null))">
    <h3>
      <span class="t">{{ book?.title || ui.epubFile?.name }}</span>
      <button class="btn ghost" @click="close">Close <kbd>Esc</kbd></button>
    </h3>

    <p v-if="error" class="err">Can't import this file. {{ error }}</p>
    <p v-else-if="!book" class="muted">Reading the book…</p>
    <template v-else>
      <div class="bar">
        <span class="muted"
          >{{ chosen }} of {{ book.items.length }} chapters ·
          {{ words.toLocaleString() }} words</span
        >
        <span class="sp" />
        <button class="btn ghost" @click="suggested">Suggested</button>
        <button class="btn ghost" @click="all(true)">All</button>
        <button class="btn ghost" @click="all(false)">None</button>
      </div>
      <div class="list">
        <label v-for="(it, i) in book.items" :key="i" class="row" :class="{ off: !picks[i] }">
          <input type="checkbox" :checked="picks[i]" @click="tick(i, $event)" />
          <span class="name">{{ it.title }}</span>
          <span class="n">{{
            it.words ? it.words.toLocaleString() + " words" : it.images ? "image" : "empty"
          }}</span>
        </label>
      </div>
      <p class="muted small">
        Shift-click to tick a range. Cover, contents, copyright and author pages start unticked.
        Images are kept; the voice says “Illustration” for each (Settings › Spoken text).
      </p>
      <div class="foot">
        <div v-if="progress" class="prog">
          <i :style="{ width: (100 * progress.done) / Math.max(1, progress.total) + '%' }" />
        </div>
        <span class="sp" />
        <button class="btn ghost" @click="close">Cancel</button>
        <button class="btn pri" :disabled="!chosen || !!progress" @click="run">
          {{
            progress
              ? `Importing ${progress.done} of ${progress.total}…`
              : `Import ${plural(chosen, "chapter")}`
          }}
        </button>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.t {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar,
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
}
.list {
  margin: 8px 0;
  max-height: 52vh;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--r2);
  background: var(--surface);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  user-select: none;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover {
  background: var(--hover);
}
.row input {
  accent-color: var(--acc);
}
.row.off .name {
  color: var(--ink3);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-hi);
}
.n {
  font: 11.5px var(--mono);
  color: var(--ink3);
  white-space: nowrap;
}
.small {
  font-size: 12px;
  margin: 0 0 12px;
}
.err {
  color: var(--err);
}
.prog {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}
.prog i {
  display: block;
  height: 100%;
  background: var(--acc);
  transition: width 0.15s;
}
</style>
