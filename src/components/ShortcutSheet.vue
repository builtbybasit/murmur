<script setup lang="ts">
import { SHORTCUTS } from "../shortcuts";
</script>

<template>
  <!-- opened by showShortcuts() -->
  <dialog
    id="shortcuts"
    aria-label="Keyboard shortcuts"
    @click="$event.target === $event.currentTarget && ($event.target as HTMLDialogElement).close()"
  >
    <h3>
      Keyboard
      <form method="dialog">
        <button class="btn ghost">Close <kbd>Esc</kbd></button>
      </form>
    </h3>
    <div class="keys">
      <div v-for="s in SHORTCUTS" :key="s.label">
        {{ s.label }}
        <span
          ><template v-for="(x, i) in s.keys" :key="x.shown"
            >{{ i ? " " : "" }}<kbd>{{ x.shown }}</kbd></template
          ></span
        >
      </div>
    </div>
  </dialog>
</template>

<style scoped>
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
