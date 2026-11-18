// Playback engine: TTS per segment with prefetch, audio cache, STT alignment, retries.
// CONTRACT: UI components only read `player` and call the exported functions below.
// The engine agent replaces the stub bodies; signatures and `player` fields must stay.
import { reactive } from "vue";

export const player = reactive({
  status: "idle", // 'idle' | 'buffering' | 'playing' | 'paused' | 'error' | 'ended'
  started: false, // playback has started in this chapter (reader shows band/word only then)
  seg: 0, // current segment index in currentDoc
  word: -1, // current word index in segs[seg].words, -1 = none
  timing: "estimated", // 'aligned' | 'estimated' for the current segment
  segState: {}, // { [segIndex]: 'loading' | 'ready' | 'failed' } for the current chapter
  aligned: {}, // { [segIndex]: true } segments that have STT word timings
  elapsed: 0, // seconds into the chapter (known durations + estimates), at 1.0x
  total: 0, // estimated chapter length in seconds at 1.0x
  totalExact: false, // true once every segment's duration is known
  cachedCount: 0, // segments of this chapter already in the cache
  // provider error that stopped playback, else null
  error: null, // { seg, code: 'auth'|'rate'|'network'|'http', status, message, providerId, attempt, maxAttempts, retryAt: ms|null, gaveUp }
  skipped: {}, // { [segIndex]: true } failed segments the user skipped
  stt: { failing: false, fails: 0, paused: false, message: "" },
});

/* eslint-disable no-unused-vars */
export function play() {}
export function pause() {}
export function toggle() {} // play/pause; retry when stopped on an error
/** Jump to a segment (and word within it). Re-enables follow. */
export function seek(seg, word = 0, { play: autoplay = true } = {}) {}
export function next() {}
export function prev() {} // restarts current segment if > 1.5 s in
export function nextPara() {}
export function prevPara() {}
export function nextChapter() {}
export function prevChapter() {}
/** Show a chapter in the reader and point the engine at it (at its saved position). */
export function open(id, { autoplay = false, seg } = {}) {}
export function retry() {} // retry the failed segment now
export function skip() {} // skip the failed segment
export function retryAlignment() {}
export function setSpeed(v) {} // 0.5..3.0, step 0.1, persisted in settings.speed
/** Speak a fixed sentence with a role's current voice. role: 'narration' | 'dialogue' */
export async function preview(role) {}
/** { segments, bytes } across all chapters */
export async function cacheStats() {
  return { segments: 0, bytes: 0 };
}
export async function clearCache() {}
