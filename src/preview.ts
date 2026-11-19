// Auditioning a voice in Settings: a fixed sentence, spoken with a role's provider and model.
import { ref } from "vue";
import { voiceFor, type Role } from "./settings";
import { ApiError, tts } from "./lib/api";

const TEXT = "The tide came in twice that night, and only one of us noticed.";

/** voice id being auditioned, else null */
export const previewing = ref<string | null>(null);

const blobs = new Map<string, Blob>(); // provider|model|voice -> audio
let el: HTMLAudioElement | null = null;
let token = 0; // bumped by every new audition and every stop

/** `voice` overrides the role's voice (audition, blends). Throws ApiError on failure. */
export async function preview(role: Role, voice?: string) {
  const v = { ...voiceFor(({ narration: "narr", dialogue: "dlg", system: "sys" } as const)[role]) };
  if (voice) v.voice = voice;
  if (!v.provider)
    throw new ApiError({
      code: "http",
      status: 0,
      message: "Pick a provider first",
      retryAfter: null,
    });
  stopPreview();
  const t = token;
  previewing.value = v.voice;
  const key = [v.provider.baseUrl, v.model, v.voice].join("|");
  try {
    let blob = blobs.get(key);
    if (!blob) blobs.set(key, (blob = await tts({ ...v, provider: v.provider, input: TEXT })));
    if (t !== token) return; // stopped, or another audition started meanwhile
    const url = URL.createObjectURL(blob);
    const a = (el = new Audio(url));
    a.onended = a.onpause = () => {
      URL.revokeObjectURL(url);
      if (t === token) previewing.value = null;
    };
    await a.play();
  } catch (e) {
    if (t === token) previewing.value = null;
    throw e;
  }
}

export function stopPreview() {
  token++;
  el?.pause();
  el = null;
  previewing.value = null;
}
