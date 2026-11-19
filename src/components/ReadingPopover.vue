<script setup lang="ts">
import { ref, watch } from "vue";
import { device, FONTS } from "../settings";
import { ui } from "../ui";

const el = ref<HTMLElement>();
const r = device.reading;
const themes = ["light", "dark", "system"] as const;

watch(
  () => ui.readingOpen,
  (open) => {
    if (el.value && el.value.matches(":popover-open") !== open) el.value.togglePopover(open);
  },
);

// Popover API owns light dismiss and Esc; mirror its state and pin it under the Aa button
// (beforetoggle, so it is placed before the first paint).
function onToggle(e: Event) {
  const open = (e as ToggleEvent).newState === "open";
  ui.readingOpen = open;
  const btn = document.querySelector('[popovertarget="aa"]');
  if (!open || !btn || !el.value) return;
  const b = btn.getBoundingClientRect();
  el.value.style.right = Math.max(8, innerWidth - b.right) + "px";
  el.value.style.top = b.bottom + 6 + "px";
}
</script>

<template>
  <div id="aa" ref="el" popover class="pop" @beforetoggle="onToggle">
    <h4>Reading</h4>
    <div class="fonts">
      <button
        v-for="(f, k) in FONTS"
        :key="k"
        :class="{ on: r.font === k }"
        :style="{ fontFamily: f.css }"
        @click="r.font = k"
      >
        Ag<small>{{ f.label }}</small>
      </button>
    </div>
    <label class="r"
      ><span>Size</span
      ><input v-model.number="r.size" type="range" min="15" max="26" step="1" /><output
        >{{ r.size }}px</output
      ></label
    >
    <label class="r"
      ><span>Line height</span
      ><input v-model.number="r.lineHeight" type="range" min="1.4" max="2" step="0.05" /><output>{{
        r.lineHeight.toFixed(2)
      }}</output></label
    >
    <label class="r"
      ><span>Width</span
      ><input v-model.number="r.width" type="range" min="48" max="88" step="2" /><output
        >{{ r.width }}ch</output
      ></label
    >
    <div class="r th">
      <span>Theme</span>
      <div class="segc">
        <button v-for="t in themes" :key="t" :class="{ on: r.theme === t }" @click="r.theme = t">
          {{ t[0]!.toUpperCase() + t.slice(1) }}
        </button>
      </div>
    </div>
    <label class="sw"><input v-model="r.tintDialogue" type="checkbox" /> Tint dialogue text</label>
  </div>
</template>

<style scoped>
.pop {
  margin: 0;
  inset: auto;
  position: fixed;
  border: 1px solid var(--line2);
  border-radius: var(--r3);
  background: var(--raised);
  color: var(--ink);
  box-shadow: var(--shadow);
  padding: 14px;
  width: 300px;
  max-width: calc(100vw - 16px);
}
h4 {
  margin: 0 0 10px;
  font: 600 11px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink2);
}
.r {
  display: grid;
  grid-template-columns: 74px 1fr 40px;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--ink2);
}
.r.th {
  grid-template-columns: 74px 1fr;
}
.r output {
  font: 12px var(--mono);
  text-align: right;
  color: var(--ink);
}
input[type="range"] {
  width: 100%;
  accent-color: var(--acc);
  margin: 0;
}
.fonts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 12px;
}
.fonts button {
  height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--r2);
  font-size: 15px;
  line-height: 1.1;
  background: var(--surface);
}
.fonts button small {
  display: block;
  font: 10.5px var(--ui);
  color: var(--ink3);
}
.fonts button.on {
  border-color: var(--acc);
  box-shadow: inset 0 0 0 1px var(--acc);
}
.segc {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--r2);
  background: var(--bg);
  border: 1px solid var(--line);
  gap: 2px;
  justify-self: start;
}
.segc button {
  height: 24px;
  padding: 0 10px;
  border-radius: var(--r1);
  color: var(--ink2);
  font-weight: 500;
  font-size: 12px;
}
.segc button.on {
  background: var(--raised);
  color: var(--ink-hi);
  box-shadow: 0 0 0 1px var(--line2);
}
.sw {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
  margin-top: 4px;
}
.sw input {
  appearance: none;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: var(--line2);
  position: relative;
  cursor: pointer;
  flex: none;
  margin: 0;
  transition: background 0.15s;
}
.sw input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.sw input:checked {
  background: var(--acc);
}
.sw input:checked::after {
  transform: translateX(12px);
}
</style>
