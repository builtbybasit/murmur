<script setup lang="ts">
import { computed } from "vue";
import { Play, Pause, SkipBack, SkipForward } from "@lucide/vue";
import { settings, voiceFor, hasTts } from "@/settings";
import { current, currentDoc, CHARS_PER_SEC } from "@/library";
import { ui, openSettings } from "@/ui";
import { MOD, clock, minutes, plural } from "@/lib/format";
import { player, toggle, prev, next, seek, setSpeed, upNext } from "@/engine";
import ErrorBar from "./ErrorBar.vue";
import SleepChip from "./SleepChip.vue";
import TimingChip from "./TimingChip.vue";

const doc = computed(() => currentDoc.value || null);
const seg = computed(() => doc.value?.segs[player.seg] ?? null);
const nSegs = computed(() => doc.value?.segs.length ?? 0);
const kind = computed(() => seg.value?.kind ?? "narr");
const voice = computed(() => voiceFor(kind.value));

const phase = computed(() => {
  if (!current.value || !doc.value) return "empty";
  if (!hasTts.value) return "noprov";
  if (player.error) return "error";
  if (player.status === "buffering") return "buffering";
  if (player.status === "ended" && !upNext.value) return "end";
  return player.status === "playing" ? "playing" : "paused";
});

const totalSec = computed(() => player.total || (doc.value ? doc.value.chars / CHARS_PER_SEC : 0));
const mins = computed(() => minutes(totalSec.value, settings.speed));

// ---------- status two-liner ----------
const status = computed(() => {
  switch (phase.value) {
    case "empty":
      return { t: "No chapter yet", s: `Paste one with ${MOD}V` };
    case "noprov":
      return { t: "No TTS provider", s: "Reading works. Listening needs one.", link: true };
    case "buffering": {
      const v = voice.value;
      return {
        t: `Generating segment ${player.seg + 1}…`,
        s: [v.provider?.name, v.model].filter(Boolean).join(" · "),
      };
    }
    case "error": {
      const at = player.error!.seg;
      let n = 0;
      for (let i = 0; i < at; i++) if (player.segState[i] === "ready") n++;
      return {
        t: `Stopped at segment ${at + 1}`,
        s: `${plural(n, "segment")} before it ${n === 1 ? "is" : "are"} cached`,
      };
    }
    case "end":
      return { t: "End of the list", s: `Paste the next chapter with ${MOD}V` };
  }
  if (!player.started)
    return {
      t: "Ready to play",
      s: `${plural(nSegs.value, "segment")} · about ${mins.value} min · generated as you listen`,
    };
  const sp = settings.speed;
  return {
    t: `Segment ${player.seg + 1} of ${nSegs.value}`,
    s: `${clock(player.elapsed / sp)} / ${player.totalExact ? "" : "~"}${clock(player.total / sp)}`,
  };
});

// ---------- progress track (weighted by characters) ----------
const cum = computed(() => {
  const out = [0];
  for (const s of doc.value?.segs ?? []) out.push(out.at(-1)! + s.core.length);
  return out;
});
const pct = (k: number) => {
  const c = cum.value;
  return c.at(-1) ? (100 * c[Math.min(k, c.length - 1)]!) / c.at(-1)! : 0;
};
const track = computed(() => {
  const n = nSegs.value;
  let buf = player.seg;
  while (buf < n && player.segState[buf] === "ready") buf++;
  const s = seg.value;
  const inSeg = s && player.started && player.word >= 0 ? (s.words[player.word]?.c ?? 0) : 0;
  const total = cum.value.at(-1) || 1;
  const notches = Object.keys(player.segState)
    .filter((k) => player.segState[+k] === "failed")
    .map((k) => pct(+k));
  return { played: pct(player.seg) + (100 * inSeg) / total, buf: pct(buf), notches };
});
function onTrack(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const c = cum.value;
  if (!nSegs.value) return;
  const x = ((e.clientX - el.getBoundingClientRect().left) / el.clientWidth) * c.at(-1)!;
  const k = c.findIndex((v) => v > x);
  ui.follow = true;
  seek(k < 0 ? nSegs.value - 1 : Math.max(0, k - 1));
}

const step = (d: number) => setSpeed(Math.round((settings.speed + d) * 10) / 10);
</script>

<template>
  <div class="pb">
    <ErrorBar />

    <footer class="player" :data-ph="phase">
      <div class="track" title="Click to jump" @click="onTrack">
        <div class="rail">
          <i class="buf" :style="{ width: track.buf + '%' }" />
          <i class="played" :style="{ width: track.played + '%' }" />
          <i v-for="(x, i) in track.notches" :key="i" class="notch" :style="{ left: x + '%' }" />
        </div>
      </div>
      <div class="pl">
        <div class="ctl">
          <button
            class="ib"
            title="Previous segment (←)"
            aria-label="Previous segment"
            :disabled="!doc"
            @click="((ui.follow = true), prev())"
          >
            <SkipBack :size="16" :stroke-width="1.75" />
          </button>
          <button
            class="playb"
            title="Play / pause (Space)"
            aria-label="Play or pause"
            :disabled="!doc"
            @click="hasTts ? toggle() : openSettings('providers')"
          >
            <i v-if="phase === 'buffering'" class="spin" />
            <Pause
              v-else-if="phase === 'playing'"
              :size="16"
              fill="currentColor"
              :stroke-width="0"
            />
            <Play v-else :size="16" fill="currentColor" :stroke-width="0" />
          </button>
          <button
            class="ib"
            title="Next segment (→)"
            aria-label="Next segment"
            :disabled="!doc"
            @click="((ui.follow = true), next())"
          >
            <SkipForward :size="16" :stroke-width="1.75" />
          </button>
        </div>
        <div class="np">
          <div class="np-t">{{ status.t }}</div>
          <div class="np-s">
            {{ status.s }}
            <a v-if="status.link" href="#" @click.prevent="openSettings('providers')"
              >Add a provider</a
            >
          </div>
        </div>
        <div class="sp" />
        <template v-if="doc">
          <button
            class="chip voice"
            title="Voice for this segment. Click to change."
            @click="openSettings('voices')"
          >
            <i class="dot" :class="kind" /><span>{{
              { narr: "Narration", dlg: "Dialogue", sys: "System" }[kind]
            }}</span>
            <b>{{ voice.voice || "no voice set" }}</b>
          </button>
          <TimingChip />
          <SleepChip />
        </template>
        <div class="speed">
          <button title="Slower ([)" aria-label="Slower" @click="step(-0.1)">−</button>
          <output title="Click to reset" @click="setSpeed(1)"
            >{{ settings.speed.toFixed(1) }}×</output
          >
          <button title="Faster (])" aria-label="Faster" @click="step(0.1)">+</button>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.player {
  position: relative;
  background: var(--surface);
  border-top: 1px solid var(--line);
}
.track {
  position: absolute;
  left: 0;
  right: 0;
  top: -7px;
  height: 14px;
  cursor: pointer;
  z-index: 2;
}
.rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 5px;
  height: 3px;
  background: var(--line);
  transition:
    height 0.12s,
    top 0.12s;
}
.track:hover .rail {
  height: 6px;
  top: 3px;
}
.rail i {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  transition: width 0.18s;
}
.rail .buf {
  background: color-mix(in srgb, var(--acc) 34%, var(--line));
}
.rail .played {
  background: var(--acc);
}
.rail .notch {
  width: 3px;
  background: var(--err);
  margin-left: -1px;
  transition: none;
}
.player[data-ph="empty"] .track {
  pointer-events: none;
}

.pl {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 14px;
}
.ctl {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ctl .ib {
  width: 32px;
  height: 32px;
}
.playb {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--acc);
  color: var(--on-acc);
  margin: 0 4px;
}
.playb:hover {
  filter: brightness(1.08);
}
.player[data-ph="noprov"] .playb,
.player[data-ph="empty"] .playb {
  background: var(--hover);
  color: var(--ink3);
  filter: none;
}
.player[data-ph="error"] .playb {
  background: var(--err);
}
.spin {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: block;
  animation: spin 0.8s linear infinite;
  border: 2px solid color-mix(in srgb, var(--on-acc) 30%, transparent);
  border-top-color: var(--on-acc);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.np {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.np-t {
  font-weight: 500;
  color: var(--ink-hi);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.np-s {
  font: 11.5px var(--mono);
  color: var(--ink3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.np-s a {
  color: var(--acc);
  cursor: pointer;
  font-family: var(--ui);
  font-weight: 500;
  text-decoration: none;
}
.player[data-ph="empty"] .np-t {
  color: var(--ink3);
}

.pl :deep(.chip) {
  height: 26px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  font-size: 12px;
  color: var(--ink2);
  white-space: nowrap;
  max-width: 260px;
  min-width: 0;
}
.pl :deep(.chip:hover) {
  border-color: var(--line2);
  color: var(--ink);
}
.chip b {
  font: 500 11.5px var(--mono);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
}
.speed {
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--r2);
}
.speed button {
  width: 24px;
  height: 26px;
  color: var(--ink2);
  font-size: 14px;
}
.speed button:hover {
  color: var(--ink-hi);
  background: var(--hover);
}
.speed output {
  font: 500 12px var(--mono);
  width: 38px;
  text-align: center;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 820px) {
  .pl {
    gap: 8px;
    padding: 0 8px;
  }
  .chip.voice span,
  .chip.voice b,
  .np-s {
    display: none;
  }
  .chip.voice {
    padding: 0 8px;
  }
}
@media (max-width: 520px) {
  .speed button {
    display: none;
  }
  .speed {
    border: 0;
  }
}
</style>
