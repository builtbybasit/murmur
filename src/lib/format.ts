// Small text formatting shared by the components.

export const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "");
/** Prefix for the platform's command key in key labels: ⌘V or Ctrl+V. */
export const MOD = MAC ? "⌘" : "Ctrl+";

/** "1 segment", "1,204 segments" */
export const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** 83 -> "1:23" */
export function clock(sec: number) {
  const s = Math.round(sec);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/** 1536 -> "1.5 KB" */
export function bytes(b: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** 12345 -> "12.3k" */
export const thousands = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));

/** Listening time in whole minutes (at least 1) for `secs` of audio played at `speed`. */
export const minutes = (secs: number, speed: number) => Math.max(1, Math.round(secs / speed / 60));
