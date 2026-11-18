// Adding chapters from the clipboard, with the toasts from DESIGN.md section 2.
import { addChapter, docOf, toast, ui, undo } from "./store";

export function addFromText(text: string | null | undefined) {
  const r = addChapter(text);
  if (r.status === "empty")
    return toast({ title: "Nothing to add", sub: "The clipboard is empty" });
  if (r.status === "dup") return toast({ title: "Already in the list", sub: r.chapter!.title });
  const ch = r.chapter!;
  const d = docOf(ch);
  toast({
    title: `Added "${ch.title}"`,
    sub: ch.short
      ? `${d.words} words · short paste, is this the right text?`
      : `${d.words} words · ${d.segs.length} segments · ready for the next paste`,
    warn: ch.short,
    actions: [
      { label: "Rename", run: () => (ui.renamingId = ch.id) },
      { label: "Undo", run: undoWithToast },
    ],
  });
}

export async function pasteFromClipboard() {
  try {
    addFromText(await navigator.clipboard.readText());
  } catch {
    toast({ title: "The browser blocked clipboard access", sub: "Press ⌘V instead" });
  }
}

export function undoWithToast() {
  const k = undo();
  toast(
    k
      ? { title: k === "add" ? "Chapter removed" : "Chapter restored" }
      : { title: "Nothing to undo" },
    3000,
  );
}
