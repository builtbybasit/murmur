// Adding chapters from the clipboard, with their toasts.
import { addChapter, docOf, isShort, undo, type Loaded } from "./library";
import { toast, ui } from "./ui";
import { htmlToMarkdown } from "./lib/markdown";
import { MOD } from "./lib/format";

/** Web pages put HTML on the clipboard too: keep its bold, italics, tables and scene breaks. */
export function addFromText(text: string | null | undefined, html?: string | null) {
  const r = addChapter((html && htmlToMarkdown(html).trim()) || text);
  if (r.status === "empty")
    return toast({ title: "Nothing to add", sub: "The clipboard is empty" });
  if (r.status === "dup") return toast({ title: "Already in the list", sub: r.chapter!.title });
  const ch = r.chapter!;
  const d = docOf(ch as Loaded); // just added: its text is here
  const short = isShort(ch);
  toast({
    title: `Added "${ch.title}"`,
    sub: short
      ? `${d.words} words · short paste, is this the right text?`
      : `${d.words} words · ${d.segs.length} segments · ready for the next paste`,
    warn: short,
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
    toast({ title: "The browser blocked clipboard access", sub: `Press ${MOD}V instead` });
  }
}

export function undoWithToast() {
  const k = undo();
  toast(
    k
      ? {
          title:
            k === "add"
              ? "Chapter removed"
              : k === "import"
                ? "Import removed"
                : "Chapter restored",
        }
      : { title: "Nothing to undo" },
    3000,
  );
}
