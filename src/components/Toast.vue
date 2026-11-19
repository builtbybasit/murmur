<script setup lang="ts">
import { TriangleAlert } from "@lucide/vue";
import { ui, type ToastAction } from "@/ui";

// Dismiss first: the action may raise its own toast (Undo does).
function run(a: ToastAction) {
  ui.toast = null;
  a.run();
}
</script>

<template>
  <div aria-live="polite">
    <Transition name="t">
      <div v-if="ui.toast" class="toast" role="status">
        <TriangleAlert v-if="ui.toast.warn" class="warn" :size="16" :stroke-width="1.5" />
        <div class="tm">
          <b>{{ ui.toast.title }}</b>
          <span v-if="ui.toast.sub">{{ ui.toast.sub }}</span>
        </div>
        <button v-for="a in ui.toast.actions" :key="a.label" class="btn" @click="run(a)">
          {{ a.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 14px;
  border-radius: var(--r3);
  background: var(--raised);
  border: 1px solid var(--line2);
  box-shadow: var(--shadow);
  max-width: calc(100vw - 24px);
  z-index: 50;
}
.toast:not(:has(.btn)) {
  padding-right: 14px;
}
.warn {
  color: var(--warn);
}
.tm {
  min-width: 0;
}
.tm b {
  color: var(--ink-hi);
  font-weight: 600;
}
.tm span {
  display: block;
  color: var(--ink3);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46ch;
}
.t-enter-active,
.t-leave-active {
  transition:
    opacity 0.16s,
    transform 0.16s;
}
.t-enter-from,
.t-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
