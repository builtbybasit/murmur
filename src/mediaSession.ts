// Lock screen, media keys and headphones (Media Session API).
import { watch } from "vue";
import { settings } from "./settings";
import { current, currentDoc } from "./library";
import { player, play, pause, prev, next, prevPara, nextPara, seekTime } from "./engine";

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => play()],
    ["pause", () => pause()],
    ["stop", () => pause()],
    // track buttons (AirPods double tap, F7/F9) move by paragraph, seek buttons by segment
    ["previoustrack", () => prevPara()],
    ["nexttrack", () => nextPara()],
    ["seekbackward", () => prev()],
    ["seekforward", () => next()],
    // the scrubber is in chapter seconds at the current speed
    ["seekto", (d) => seekTime((d.seekTime ?? 0) * settings.speed)],
  ];
  for (const [a, h] of actions)
    try {
      ms.setActionHandler(a, h);
    } catch {} // an action this browser does not know

  watch(
    () => [current.value?.title, player.seg, currentDoc.value?.segs.length] as const,
    ([title, seg, n]) => {
      ms.metadata = title
        ? new MediaMetadata({
            title,
            artist: n ? `Segment ${seg + 1} of ${n}` : "",
            album: "murmur",
          })
        : null;
    },
  );
  watch(
    () => [player.status, player.seg, player.total, settings.speed] as const,
    ([status]) => {
      ms.playbackState =
        status === "playing" || status === "buffering"
          ? "playing"
          : status === "idle"
            ? "none"
            : "paused";
      const duration = player.total / settings.speed;
      if (!duration) return;
      try {
        ms.setPositionState({
          duration,
          position: Math.min(duration, player.elapsed / settings.speed),
          playbackRate: settings.speed,
        });
      } catch {}
    },
  );
}
