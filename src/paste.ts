// Adding chapters from the clipboard, with the toasts from DESIGN.md section 2.
import { addChapter, docOf, toast, ui, undo } from "./store";
import { htmlToMarkdown } from "./lib/markdown";

/** Web pages put HTML on the clipboard too: keep its bold, italics, tables and scene breaks. */
export function addFromText(text: string | null | undefined, html?: string | null) {
  const r = addChapter((html && htmlToMarkdown(html).trim()) || text);
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
    const [item] = await navigator.clipboard.read();
    const get = async (t: string) =>
      item?.types.includes(t) ? (await item.getType(t)).text() : null;
    addFromText(await get("text/plain"), await get("text/html"));
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
