<script setup lang="ts">
// "Listen on your phone": a QR code of the phone link (with the access key). Shown on this Mac only.
import { computed, ref } from "vue";
import { renderSVG } from "uqr";
import { getJson } from "@/lib/server";
import { placePopover, toast } from "@/ui";

const links = ref<string[]>([]);
const link = computed(() => links.value[0] ?? "");
const svg = computed(() => (link.value ? renderSVG(link.value, { border: 2 }) : ""));

async function onToggle(e: Event) {
  placePopover(e, "below");
  if ((e as ToggleEvent).newState !== "open") return;
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
  <div id="phone" popover class="pop" @beforetoggle="onToggle">
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
      Not on a network right now. Start murmur with <code>bun run dev</code> while this Mac is on
      Wi-Fi.
    </p>
  </div>
</template>

<style scoped>
.pop {
  width: 280px;
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
code {
  font: 11px var(--mono);
}
</style>
