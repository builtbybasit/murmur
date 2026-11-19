<script setup lang="ts">
import { device, FONTS } from "../settings";
import { placePopover } from "../ui";

const r = device.reading;
const themes = ["light", "dark", "system"] as const;
</script>

<template>
  <div id="aa" popover class="pop" @beforetoggle="placePopover($event, 'below')">
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
  justify-self: start;
}
.sw {
  font-size: 12px;
  margin-top: 4px;
}
</style>
