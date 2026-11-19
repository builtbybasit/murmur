<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { Moon, Play, Pause, SkipBack, SkipForward, TriangleAlert } from "@lucide/vue";
import { settings, voiceFor, providerById, hasTts } from "../settings";
import { current, currentDoc, CHARS_PER_SEC } from "../library";
import { ui, openSettings, placePopover } from "../ui";
import { MOD, clock, minutes, plural } from "../lib/format";
import {
  player,
  toggle,
  prev,
  next,
  seek,
  retry,
  skip,
  retryAlignment,
  setSpeed,
  sleepTimer,
  setSleep,
  upNext,
} from "../engine";

const doc = computed(() => currentDoc.value || null);
const seg = computed(() => doc.value?.segs[player.seg] ?? null);
const nSegs = computed(() => doc.value?.segs.length ?? 0);
const kind = computed(() => seg.value?.kind ?? "narr");
const voice = computed(() => voiceFor(kind.value));

const host = (url = "") => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "the provider";

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

// ---------- error strip ----------
// ticks only while an automatic retry is pending, for the countdown
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
watch(
  () => player.error?.retryAt,
  (at) => {
    clearInterval(tick);
    now.value = Date.now();
    if (at) tick = setInterval(() => (now.value = Date.now()), 250);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(tick));
const err = computed(() => {
  const e = player.error;
  if (!e) return null;
  const p = providerById(e.providerId);
  const name = p?.name || "The provider";
  let code: string, msg: string;
  if (e.code === "auth") {
    code = `${e.status || 401} ${e.status === 403 ? "Forbidden" : "Unauthorized"}`;
    msg = `${name} rejected the API key. Nothing is retried until the key is fixed.`;
  } else {
    if (e.code === "rate") {
      code = "429 Too Many Requests";
      msg = `${name} is rate limiting.`;
    } else if (e.code === "network") {
      code = "Network error";
      msg = `Can't reach ${host(p?.baseUrl)}. Is the server running?`;
    } else {
      code = `HTTP ${e.status}`;
      msg = e.message || `${name} returned an error.`;
    }
    if (e.gaveUp) msg += ` Gave up after ${e.maxAttempts} attempts.`;
    else if (e.retryAt) {
      const secs = Math.max(0, Math.ceil((e.retryAt - now.value) / 1000));
      msg += ` Retrying in ${secs} s (attempt ${e.attempt} of ${e.maxAttempts}).`;
    }
  }
  return {
    code,
    msg,
    auth: e.code === "auth",
    auto: !!e.retryAt && !e.gaveUp,
    openProv: e.code === "network" || e.code === "http",
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

// ---------- timing chip ----------
const timing = computed(() => {
  const stt = settings.stt;
  const p = providerById(stt.providerId);
  if (!stt.enabled || !p)
    return {
      label: "Estimated",
      cls: "",
      body: "Word alignment is off, so the highlight is timed from character positions. It drifts a little on long sentences.",
      act: stt.enabled
        ? { label: "Alignment settings", run: () => openSettings("segments") }
        : { label: "Turn on", run: () => (settings.stt.enabled = true) },
    };
  if (player.stt.failing)
    return {
      label: "Estimated",
      cls: "warn",
      body:
        `${p.name} failed on ${plural(player.stt.fails, "segment")}${player.stt.message ? ` (${player.stt.message})` : ""}` +
        `${player.stt.paused ? ", so alignment is paused for this chapter" : ""}. Audio is not affected.`,
      act: { label: "Retry alignment", run: retryAlignment },
      act2: { label: "Turn off", run: () => (settings.stt.enabled = false) },
    };
  if (player.timing === "aligned")
    return {
      label: "Aligned",
      cls: "al",
      body: `Word timestamps from ${p.name} (${stt.model}). The underlined highlight means the word is timed from the real audio.`,
    };
  return {
    label: "Estimated",
    cls: "",
    body: "The transcript for this segment has not arrived yet. The highlight is estimated until it does, then switches over without a jump.",
  };
});
const timingPop = ref<HTMLElement | null>(null);
const sleepPop = ref<HTMLElement | null>(null);
const SLEEP: [string, null | "chapter" | number][] = [
  ["Off", null],
  ["End of chapter", "chapter"],
  ["15 minutes", 15],
  ["30 minutes", 30],
  ["45 minutes", 45],
  ["1 hour", 60],
];
const sleepLabel = computed(() =>
  sleepTimer.mode === "chapter"
    ? "end of chapter"
    : sleepTimer.mode === "time"
      ? Math.ceil(sleepTimer.left / 60_000) + "m"
      : "",
);
const sleepMins = ref(0); // the duration picked, to mark it in the menu
function pickSleep(v: null | "chapter" | number) {
  setSleep(v);
  if (typeof v === "number") sleepMins.value = v;
  sleepPop.value?.hidePopover();
}

function runTiming(run: () => unknown) {
  run();
  timingPop.value?.hidePopover();
}

const step = (d: number) => setSpeed(Math.round((settings.speed + d) * 10) / 10);
</script>

<template>
  <div class="pb">
    <div v-if="err" class="errbar" role="status">
      <span class="code"><TriangleAlert :size="16" :stroke-width="1.75" />{{ err.code }}</span>
      <span class="msg">{{ err.msg }}</span>
      <button
        v-if="err.auth"
        class="btn pri"
        @click="openSettings('providers', player.error!.providerId, true)"
      >
        Fix key
      </button>
      <button class="btn" :class="{ pri: !err.auth }" @click="retry()">
        {{ err.auto ? "Retry now" : "Retry" }} <kbd>R</kbd>
      </button>
      <button
        v-if="err.openProv && !player.error!.gaveUp"
        class="btn"
        @click="openSettings('providers', player.error!.providerId)"
      >
        Open provider
      </button>
      <button class="btn ghost" @click="skip()">Skip segment</button>
    </div>

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
          <button class="chip timing" :class="timing.cls" popovertarget="lectern-timing">
            <i class="ring" /><span>{{ timing.label }}</span>
          </button>
          <button
            class="chip sleep"
            :class="{ on: sleepTimer.mode }"
            :title="sleepTimer.mode ? `Sleep timer: ${sleepLabel}` : 'Sleep timer'"
            aria-label="Sleep timer"
            popovertarget="lectern-sleep"
          >
            <Moon :size="13" /><span v-if="sleepTimer.mode">{{ sleepLabel }}</span>
          </button>
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

    <div
      id="lectern-sleep"
      ref="sleepPop"
      popover
      class="pop menu"
      @beforetoggle="placePopover($event, 'above')"
    >
      <h4>Sleep timer</h4>
      <button
        v-for="[label, v] in SLEEP"
        :key="label"
        :class="{
          on:
            (v === null && !sleepTimer.mode) ||
            (v === 'chapter' && sleepTimer.mode === 'chapter') ||
            (v === sleepMins && sleepTimer.mode === 'time'),
        }"
        @click="pickSleep(v)"
      >
        {{ label }}
      </button>
      <p class="note">Counts only while playing, and fades out over the last few seconds.</p>
    </div>
    <div
      id="lectern-timing"
      ref="timingPop"
      popover
      class="pop"
      @beforetoggle="placePopover($event, 'above')"
    >
      <h4>Highlight timing · {{ timing.label }}</h4>
      <p>{{ timing.body }}</p>
      <div v-if="timing.act" class="acts">
        <button class="btn" @click="runTiming(timing.act.run)">{{ timing.act.label }}</button>
        <button v-if="timing.act2" class="btn" @click="runTiming(timing.act2.run)">
          {{ timing.act2.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.errbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--err) 11%, var(--surface));
  border-top: 1px solid color-mix(in srgb, var(--err) 45%, var(--line));
  color: var(--ink);
}
.errbar .code {
  font: 600 12px var(--mono);
  color: var(--err);
  display: flex;
  gap: 6px;
  align-items: center;
}
.errbar .msg {
  flex: 1;
  min-width: 220px;
}

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

.chip {
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
.chip:hover {
  border-color: var(--line2);
  color: var(--ink);
}
.chip b {
  font: 500 11.5px var(--mono);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip .ring {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--ink3);
  flex: none;
}
.chip.al .ring {
  background: var(--acc);
  border-color: var(--acc);
}
.chip.sleep.on {
  color: var(--acc);
  border-color: color-mix(in srgb, var(--acc) 45%, var(--line));
}
.pop.menu {
  width: 200px;
  padding: 8px;
}
.pop.menu:popover-open {
  display: grid; /* only while open: a plain display would override the closed popover's none */
}
.pop.menu h4 {
  margin: 4px 8px 6px;
}
.pop.menu button {
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--r2);
  font-size: 13px;
}
.pop.menu button:hover {
  background: var(--hover);
}
.pop.menu button.on {
  color: var(--acc);
  font-weight: 600;
}
.pop.menu .note {
  margin: 6px 8px 2px;
  font-size: 11.5px;
  color: var(--ink3);
}
.chip.warn .ring {
  border-color: var(--warn);
  background: var(--warn);
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

.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  .chip.timing span {
    display: none;
  }
  .speed button {
    display: none;
  }
  .speed {
    border: 0;
  }
}
</style>
