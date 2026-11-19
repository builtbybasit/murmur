<script setup lang="ts">
// The sidebar's foot: paste the next chapter, or import an EPUB.
import { MOD } from "../lib/format";
import { ui } from "../ui";
import { pasteFromClipboard } from "../paste";

function pickEpub(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) ui.epubFile = input.files[0];
  input.value = ""; // the same file can be picked again
}
</script>

<template>
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
</template>

<style scoped>
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
</style>
