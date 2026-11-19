<script setup lang="ts">
// A name being edited in place: focused and selected on arrival; Enter or leaving saves, Esc cancels.
import { onMounted, ref } from "vue";

defineProps<{ value: string; label: string }>();
const emit = defineEmits<{ done: [value: string | null] }>();
const el = ref<HTMLInputElement>();
let over = false; // Enter/Esc ends it; the blur that follows must not end it again
function end(v: string | null) {
  if (over) return;
  over = true;
  emit("done", v);
}
onMounted(() => {
  el.value?.focus();
  el.value?.select();
});
</script>

<template>
  <input
    ref="el"
    class="t"
    type="text"
    :value="value"
    :aria-label="label"
    @click.stop
    @keydown.stop="
      $event.key === 'Enter' && end(($event.target as HTMLInputElement).value);
      $event.key === 'Escape' && end(null);
    "
    @blur="end(($event.target as HTMLInputElement).value)"
  />
</template>
