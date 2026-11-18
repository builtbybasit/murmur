<script setup lang="ts">
import { ref, watch } from "vue";
import { ui } from "../store";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const M = MAC ? "⌘" : "Ctrl+";
const ALT = MAC ? "⌥" : "Alt+";
const KEYS: [string, string[]][] = [
  ["Play / pause", ["Space"]],
  ["Previous / next segment", ["←", "→"]],
  ["Previous / next paragraph", ["⇧←", "⇧→"]],
  ["Previous / next chapter", ["K", "J"]],
  ["Slower / faster", ["[", "]"]],
  ["Back to current word", ["F"]],
  ["Retry failed segment", ["R"]],
  ["Add chapter from clipboard", [M + "V"]],
  ["Undo last add or delete", [M + "Z"]],
  ["Toggle chapter list", ["B"]],
  ["Reading settings", ["A"]],
  ["Settings", [M + ","]],
  ["Rename focused chapter", ["F2"]],
  ["Edit chapter text", ["E"]],
  ["Move focused chapter", [ALT + "↑", ALT + "↓"]],
  ["Delete focused chapter", [MAC ? "⌫" : "Del"]],
  ["This sheet", ["?"]],
];

const dlg = ref<HTMLDialogElement>();
watch(
  () => ui.shortcutsOpen,
  (open) => (open ? dlg.value?.showModal() : dlg.value?.close()),
);
</script>

<template>
  <dialog
    ref="dlg"
    aria-label="Keyboard shortcuts"
    @close="ui.shortcutsOpen = false"
    @click="$event.target === dlg && dlg?.close()"
  >
    <h3>
      Keyboard <button class="btn ghost" @click="dlg?.close()">Close <kbd>Esc</kbd></button>
    </h3>
    <div class="keys">
      <div v-for="[label, ks] in KEYS" :key="label">
        {{ label }}
        <span
          ><template v-for="(k, i) in ks" :key="k"
            >{{ i ? " " : "" }}<kbd>{{ k }}</kbd></template
          ></span
        >
      </div>
    </div>
  </dialog>
</template>

<style scoped>
dialog {
  border: 1px solid var(--line2);
  border-radius: var(--r3);
  background: var(--raised);
  color: var(--ink);
  box-shadow: var(--shadow);
  padding: 18px 20px;
  width: min(620px, calc(100vw - 24px));
}
dialog::backdrop {
  background: rgba(5, 8, 12, 0.55);
}
h3 {
  margin: 0 0 12px;
  font: 600 15px var(--ui);
  color: var(--ink-hi);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.keys {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 4px 24px;
}
.keys div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink2);
}
</style>
