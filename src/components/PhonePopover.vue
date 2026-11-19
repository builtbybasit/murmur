<script setup lang="ts">
// "Listen on your phone": a QR code of the phone link (with the access key). Shown on this Mac only.
import { computed, ref } from "vue";
import { renderSVG } from "uqr";
import { getJson } from "../lib/server";
import { toast } from "../ui";

const el = ref<HTMLElement>();
const links = ref<string[]>([]);
const link = computed(() => links.value[0] ?? "");
const svg = computed(() => (link.value ? renderSVG(link.value, { border: 2 }) : ""));

async function onToggle(e: Event) {
  if ((e as ToggleEvent).newState !== "open") return;
  const btn = document.querySelector('[popovertarget="phone"]');
  if (btn && el.value) {
    const b = btn.getBoundingClientRect();
    el.value.style.right = Math.max(8, innerWidth - b.right) + "px";
    el.value.style.top = b.bottom + 6 + "px";
  }
  links.value = await getJson<{ links: string[] }>("phone").then(
    (j) => j.links,
    () => [],
  );
}
async function copy() {
  await navigator.clipboard.writeText(link.value);
  toast({ title: "Phone link copied" }, 2000);
}
</script>

<template>
  <div id="phone" ref="el" popover class="pop" @beforetoggle="onToggle">
    <h4>Listen on your phone</h4>
    <template v-if="link">
      <div class="qr" v-html="svg" />
      <ol>
        <li>Phone on the same Wi-Fi as this Mac.</li>
        <li>Point the camera at the code and open the link.</li>
        <li>
          Accept the certificate warning once (Safari: <i>Show Details › visit this website</i>;
          Chrome: <i>Advanced › Proceed</i>).
        </li>
      </ol>
      <p class="note">
        Same library and reading position on both. The link carries this Mac's access key; keep it
        to yourself.
        <button class="lnk" @click="copy">Copy link</button>
      </p>
    </template>
    <p v-else class="note">
      Not on a network right now. Start lectern with <code>bun run dev</code> while this Mac is on
      Wi-Fi.
    </p>
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
  width: 280px;
  max-width: calc(100vw - 16px);
}
h4 {
  margin: 0 0 10px;
  font: 600 11px var(--ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink2);
}
.qr {
  width: 180px;
  margin: 0 auto 10px;
  padding: 6px;
  border-radius: var(--r2);
  background: #fff; /* QR codes need a light background in dark mode too */
}
.qr :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
ol {
  margin: 0 0 10px;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--ink);
  display: grid;
  gap: 4px;
}
.note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink3);
}
.lnk {
  font: inherit;
  color: var(--acc);
  padding: 0;
}
code {
  font: 11px var(--mono);
}
</style>
