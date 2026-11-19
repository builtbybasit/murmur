<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { library } from "@/library";
import { toast } from "@/ui";
import {
  alignMissing,
  clearCache,
  storageByBook,
  dropAudio,
  timing,
  type BookStorage,
} from "@/generate";
import { sttProvider } from "@/synth";
import { unusedImages, removeUnusedImages } from "@/lib/images";
import { sync } from "@/lib/server";
import { bytes, plural } from "@/lib/format";

const perBook = ref<Awaited<ReturnType<typeof storageByBook>> | null>(null);
const imgs = ref<Awaited<ReturnType<typeof unusedImages>> | null>(null);
const loadStats = async () => {
  [perBook.value, imgs.value] = await Promise.all([storageByBook(), unusedImages()]);
};
loadStats();
/** Everything in the audio cache. */
const stats = computed(() => {
  const p = perBook.value;
  if (!p) return null;
  const sum = (f: (b: BookStorage) => number) => p.books.reduce((n, b) => n + f(b), 0);
  return {
    segments: sum((b) => b.cached) + p.other.segments,
    bytes: sum((b) => b.bytes) + p.other.bytes,
  };
});
async function cleared(work: Promise<unknown>, title: string, sub?: string) {
  await work;
  await loadStats();
  toast({ title, sub }, 3000);
}
const clearBook = (b: BookStorage) =>
  cleared(
    dropAudio(b.keys, b.book),
    `Cleared audio for ${b.book || "loose chapters"}`,
    bytes(b.bytes),
  );
function clearOther() {
  const o = perBook.value!.other;
  return cleared(dropAudio(o.keys), "Removed audio nothing plays any more", bytes(o.bytes));
}
const clearImages = () =>
  cleared(removeUnusedImages(), `Removed ${plural(imgs.value!.count, "unused image")}`);
const alignAll = () => alignMissing(library.chapters.map((c) => c.id));
watch(
  () => timing.running,
  (on) => on || loadStats(),
);
const clear = () =>
  cleared(clearCache(), "Cache cleared", "Audio is generated again the next time you play.");
</script>

<template>
  <h2>Storage</h2>
  <p class="hint">
    Chapters, reading positions, images and settings are shared through the murmur server on your
    Mac (<code>~/.murmur</code>), so your phone sees the same library. Audio is cached in each
    browser. To listen on your phone, use the phone button in the top bar.
    <span v-if="sync.error" class="bad-t"
      ><br />Last save to the server failed ({{ sync.error }}); it is retried with your next
      change.</span
    >
  </p>
  <div class="box">
    <div class="kv">
      <span>Audio cache</span>
      <span
        >{{ stats ? `${stats.segments.toLocaleString()} segments · ${bytes(stats.bytes)}` : "…"
        }}<br /><small class="h"
          >Keyed by provider, model, voice and text. Replaying costs nothing.</small
        ></span
      >
      <button class="btn danger" :disabled="!stats?.segments" @click="clear">Clear cache</button>
      <span>Word timings</span>
      <span v-if="timing.running"
        >Aligning {{ timing.done.toLocaleString() }} of
        {{ timing.total.toLocaleString() }}…<br /><small class="h"
          >Pauses while playback is buffering.</small
        ></span
      >
      <span v-else-if="perBook?.untimed"
        >{{ plural(perBook.untimed, "segment") }} without word timings<br /><small
          class="h"
          :class="{ err: timing.error }"
          >{{
            timing.error
              ? `Stopped: ${timing.error}`
              : sttProvider()
                ? "Made while STT was off or failing; highlighting is estimated there."
                : "Set an STT provider in Segments & timing to align them."
          }}</small
        ></span
      >
      <span v-else
        >Stored next to the audio<br /><small class="h">Cleared with the audio cache.</small></span
      >
      <button v-if="timing.running" class="btn" @click="alignAll">Stop</button>
      <button v-else-if="perBook?.untimed" class="btn" :disabled="!sttProvider()" @click="alignAll">
        Align them
      </button>
      <span v-else />
      <span>Chapters</span>
      <span>{{ plural(library.chapters.length, "chapter") }}</span>
      <span />
      <span>Images</span>
      <span
        >{{ imgs ? `${imgs.total} from imported books` : "…" }}<br /><small
          v-if="imgs?.count"
          class="h"
          >{{ imgs.count }} no longer used by any chapter ({{ bytes(imgs.bytes) }})</small
        ></span
      >
      <button v-if="imgs?.count" class="btn" @click="clearImages">Remove unused</button>
      <span v-else />
      <span>API keys</span>
      <span
        >Stored unencrypted in <code>~/.murmur</code> on your Mac<br /><small class="h"
          >Only the Mac's relay uses them; no browser, phone included, ever gets them.</small
        ></span
      >
      <span />
    </div>
  </div>
  <h2>Audio by book</h2>
  <p class="hint">
    For the voices you use now. Clearing only removes audio; it is generated again when you play.
  </p>
  <div class="box">
    <p v-if="!perBook" class="h">Adding it up…</p>
    <div v-else class="kv">
      <template v-for="b in perBook.books" :key="b.book">
        <span>{{ b.book || "Loose chapters" }}</span>
        <span
          >{{ bytes(b.bytes) }}<br /><small class="h"
            >{{ plural(b.chapters, "chapter") }} · {{ b.cached.toLocaleString() }} of
            {{ b.segments.toLocaleString() }} segments cached</small
          ></span
        >
        <button class="btn" :disabled="!b.cached" @click="clearBook(b)">Clear</button>
      </template>
      <span>Other audio</span>
      <span
        >{{ bytes(perBook.other.bytes) }}<br /><small class="h"
          >{{ perBook.other.segments.toLocaleString() }} segments from old voices, old spoken-text
          rules or deleted chapters. Nothing in your library plays them.</small
        ></span
      >
      <button class="btn" :disabled="!perBook.other.segments" @click="clearOther">Remove</button>
    </div>
  </div>
</template>

<style scoped>
small.err {
  color: var(--err);
}
.kv {
  display: grid;
  grid-template-columns: 150px 1fr auto;
  gap: 10px 14px;
  align-items: center;
}
.kv > span:nth-child(3n + 1) {
  color: var(--ink2);
  font-weight: 500;
}
@media (max-width: 820px) {
  .kv {
    grid-template-columns: 1fr auto;
  }
  .kv > span:nth-child(3n + 2) {
    grid-column: 1;
  }
}
.bad-t {
  color: var(--err);
}
</style>
