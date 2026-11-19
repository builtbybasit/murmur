<script setup lang="ts">
// Editing a chapter's text in place of the reading view. Esc cancels, ⌘/Ctrl+Enter saves.
import { onMounted, ref } from "vue";
import { setChapterBody, type Loaded } from "@/library";
import { MOD } from "@/lib/format";
import { ui, toast } from "@/ui";

const props = defineProps<{ chapter: Loaded }>();
const draft = ref(props.chapter.body);
const editor = ref<HTMLTextAreaElement>();
onMounted(() => {
  editor.value?.focus();
  editor.value?.setSelectionRange(0, 0);
});

const close = () => (ui.editingId = null);
function save() {
  if (!setChapterBody(props.chapter.id, draft.value))
    return toast({ title: "Chapter text can't be empty", warn: true });
  close();
  toast(
    {
      title: "Chapter updated",
      sub: "Changed paragraphs are generated again; the rest stay cached",
    },
    3500,
  );
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") close();
  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
  else return;
  e.preventDefault();
}
</script>

<template>
  <div class="edit">
    <textarea
      ref="editor"
      v-model="draft"
      spellcheck="false"
      aria-label="Chapter text"
      @keydown="onKey"
    />
    <div class="edit-bar">
      <span
        >Each line is a paragraph. <code>**bold**</code> <code>*italic*</code>
        <code>~~strike~~</code> <code>-&gt; centred &lt;-</code> <code>&gt; box</code> <code
          >***</code
        >
        scene break. Unchanged paragraphs keep their audio.</span
      >
      <span class="sp" />
      <button class="btn ghost" @click="close">Cancel <kbd>Esc</kbd></button>
      <button class="btn pri" @click="save">Save <kbd>{{ MOD }}↵</kbd></button>
    </div>
  </div>
</template>

<style scoped>
textarea {
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
textarea:focus {
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
</style>
