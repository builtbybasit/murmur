// Every keyboard shortcut: App runs them, the shortcut sheet lists them.
import { settings, hasTts } from "./settings";
import { ui, edit, openSettings, toggleSettings, toggleSide } from "./ui";
import { undoWithToast } from "./paste";
import { MAC, MOD } from "./lib/format";
import * as engine from "./engine";

const ALT = MAC ? "⌥" : "Alt+";
const speed = (d: number) => engine.setSpeed(Math.round((settings.speed + d) * 10) / 10);
// arrow keys move the playhead only in the reader (Settings uses them for its controls)
const inReader = (f: () => void) => () => {
  if (ui.view !== "reader") return false;
  ui.follow = true;
  f();
};

/** shown: the key cap; combo: what `combo(e)` returns for it; run: absent when another part of
 *  the app handles the key (the paste event, the chapter rows). run returning false = not handled. */
interface Key {
  shown: string;
  combo?: string;
  run?: () => unknown;
}
const k = (shown: string, combo?: string, run?: () => unknown): Key => ({ shown, combo, run });

export const SHORTCUTS: { label: string; keys: Key[] }[] = [
  {
    label: "Play / pause",
    keys: [k("Space", " ", () => (hasTts.value ? engine.toggle() : openSettings("providers")))],
  },
  {
    label: "Previous / next segment",
    keys: [k("←", "ArrowLeft", inReader(engine.prev)), k("→", "ArrowRight", inReader(engine.next))],
  },
  {
    label: "Previous / next paragraph",
    keys: [
      k("⇧←", "Shift+ArrowLeft", inReader(engine.prevPara)),
      k("⇧→", "Shift+ArrowRight", inReader(engine.nextPara)),
    ],
  },
  {
    label: "Previous / next chapter",
    keys: [k("K", "k", engine.prevChapter), k("J", "j", engine.nextChapter)],
  },
  {
    label: "Slower / faster",
    keys: [k("[", "[", () => speed(-0.1)), k("]", "]", () => speed(0.1))],
  },
  { label: "Back to current word", keys: [k("F", "f", () => (ui.follow = true))] },
  { label: "Retry failed segment", keys: [k("R", "r", engine.retry)] },
  { label: "Add chapter from clipboard", keys: [k(MOD + "V")] },
  { label: "Undo last add or delete", keys: [k(MOD + "Z", "Mod+z", undoWithToast)] },
  { label: "Toggle chapter list", keys: [k("B", "b", toggleSide)] },
  {
    label: "Reading settings",
    keys: [k("A", "a", () => document.getElementById("aa")?.togglePopover())],
  },
  { label: "Settings", keys: [k(MOD + ",", "Mod+,", toggleSettings)] },
  { label: "Rename focused chapter", keys: [k("F2")] },
  { label: "Edit chapter text", keys: [k("E", "e", () => ui.currentId && edit(ui.currentId))] },
  { label: "Move focused chapter", keys: [k(ALT + "↑"), k(ALT + "↓")] },
  { label: "Delete focused chapter", keys: [k(MAC ? "⌫" : "Del")] },
  { label: "This sheet", keys: [k("?", "?", () => showShortcuts())] },
];

const RUN = new Map(
  SHORTCUTS.flatMap((s) => s.keys.filter((x) => x.combo && x.run).map((x) => [x.combo!, x.run!])),
);

/** "Mod+z", "Shift+ArrowLeft", "j" (letters lowercased), or null for other modifier combos. */
export function combo(e: KeyboardEvent) {
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (e.altKey || (MAC ? e.ctrlKey : e.metaKey)) return null;
  let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.shiftKey && (e.key.length > 1 || mod)) key = "Shift+" + key;
  return (mod ? "Mod+" : "") + key;
}

/** Run the shortcut for this key; true when one handled it. */
export function runShortcut(e: KeyboardEvent) {
  const run = RUN.get(combo(e) ?? "");
  return !!run && run() !== false;
}

export const showShortcuts = () =>
  (document.getElementById("shortcuts") as HTMLDialogElement | null)?.showModal();
