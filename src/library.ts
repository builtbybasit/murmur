// Chapters and reading positions. They live on the lectern server: every change is an op
// (lib/ops.ts) applied here at once and sent to the server in order. Ops that could not be sent
// stay queued and are applied again on top of whatever the server sends back (see `replaceLibrary`).
import { computed, reactive } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { buildDoc, normalize, autoTitle, type Doc } from "./lib/segment";
import { applyOp, type Chapter, type Library, type Op } from "./lib/ops";
import { sendJson, sync } from "./lib/server";
import { settings } from "./settings";
import { ui } from "./ui";

export type { Chapter };

export const library = reactive<Library>({ chapters: [], positions: {}, currentId: null });

/** Chapters whose audio is all generated, per device (its own cache): id -> engine's audioSig. */
export const readyMarks = useLocalStorage<Record<string, string>>("lectern.ready", {});

/** Rough audio length before anything is generated, at 1.0x. */
export const CHARS_PER_SEC = 15;

// ---------- talking to the server ----------

const queue: Op[] = [];
let sending: Promise<void> | null = null;

function commit(o: Op) {
  applyOp(library, o);
  const last = queue.at(-1);
  // positions move with every segment: only the newest one for a chapter needs to go
  if (o.op === "pos" && last?.op === "pos" && last.id === o.id && queue.length > 1) queue.pop();
  queue.push(o);
  void flush();
}

/** Send queued ops, oldest first. A failure leaves the rest queued for the next try. */
export function flush(): Promise<void> {
  // .finally runs after this assignment even when there is nothing to send
  sending ??= send().finally(() => (sending = null));
  return sending;
}
async function send() {
  try {
    while (queue.length) {
      await sendJson("library", queue[0], "POST");
      queue.shift();
    }
    sync.error = "";
  } catch (e) {
    sync.error = (e as Error).message;
  }
}

/** Take the server's library, then replay what it has not seen yet. */
export function replaceLibrary(lib: Library) {
  for (const o of queue) applyOp(lib, o);
  Object.assign(library, lib);
  if (!library.chapters.some((c) => c.id === ui.currentId))
    ui.currentId = library.chapters.some((c) => c.id === library.currentId)
      ? library.currentId
      : (library.chapters[0]?.id ?? null);
}

/** Remember where reading is (also: which chapter is open, for the other devices). */
export function setPosition(id: string, seg: number) {
  if (library.positions[id] !== seg || library.currentId !== id) commit({ op: "pos", id, seg });
}

// ---------- derived ----------

const docs = new Map<string, { key: string; doc: Doc }>();
/** Segmented chapter (see buildDoc in lib/segment.ts). Memoised on body + quote rule. */
export function docOf(ch: Chapter): Doc {
  const key = settings.smartQuotes + "|" + ch.body;
  const hit = docs.get(ch.id);
  if (hit?.key === key) return hit.doc;
  const doc = buildDoc(ch.body, settings.smartQuotes);
  docs.set(ch.id, { key, doc });
  return doc;
}

export const current = computed(() => library.chapters.find((c) => c.id === ui.currentId) ?? null);
export const currentDoc = computed(() => (current.value ? docOf(current.value) : null));

/** Under 40 words: probably not the text you meant to paste. */
export const isShort = (c: Chapter) => c.body.split(/\s+/).length < 40;

// ---------- changes ----------

type UndoKind = "add" | "import" | "delete";
let undoEntry: { kind: UndoKind; op: Op } | null = null;

const newChapter = (title: string, body: string, book?: string): Chapter => ({
  ...(book && { book }),
  id: "c" + crypto.randomUUID().slice(0, 8),
  title,
  body,
  addedAt: Date.now(),
});

/**
 * Add a pasted chapter at the end.
 * Toasts are the caller's job (it knows about Rename/Undo buttons).
 */
export function addChapter(rawIn: string | null | undefined): {
  status: "added" | "dup" | "empty";
  chapter?: Chapter;
} {
  const raw = normalize(rawIn ?? "");
  if (!raw) return { status: "empty" };
  const { title, body } = autoTitle(
    raw,
    library.chapters.map((c) => c.title),
  );
  const dup = library.chapters.find((c) => c.body === body);
  if (dup) {
    ui.flashId = dup.id;
    return { status: "dup", chapter: dup };
  }
  const ch = newChapter(title, body);
  commit({ op: "add", chapters: [ch] });
  undoEntry = { kind: "add", op: { op: "delete", ids: [ch.id] } };
  ui.flashId = ch.id;
  ui.currentId ??= ch.id; // the very first chapter opens itself
  return { status: "added", chapter: ch };
}

/** Add imported chapters (already titled) at the end, as one undo step. Returns them. */
export function addChapters(list: { title: string; body: string }[], book?: string): Chapter[] {
  const added = list.map(({ title, body }) => newChapter(title, body, book));
  if (!added.length) return [];
  commit({ op: "add", chapters: added });
  undoEntry = { kind: "import", op: { op: "delete", ids: added.map((c) => c.id) } };
  ui.flashId = added[0]!.id;
  ui.currentId ??= added[0]!.id;
  return added;
}

/** Replace a chapter's text. Unchanged segments keep their cached audio (cache keys are per text). */
export function setChapterBody(id: string, text: string): boolean {
  const body = normalize(text);
  if (!body || !library.chapters.some((c) => c.id === id)) return false;
  commit({ op: "set", ids: [id], body });
  delete readyMarks.value[id]; // changed text: some segments need audio again
  return true;
}

export function renameChapter(id: string, title: string) {
  if (title.trim()) commit({ op: "set", ids: [id], title: title.trim() });
}

/** Rename a book: every chapter in it, and its folded state. */
export function renameBook(from: string, to: string) {
  to = to.trim();
  if (!to || to === from) return;
  commit({ op: "renameBook", from, to });
  settings.collapsed = settings.collapsed.map((b) => (b === from ? to : b));
}

/** Put chapters in a book (or none). */
export function setBook(ids: string[], book: string | undefined) {
  commit({ op: "set", ids, book: book ?? null });
}

/** Move chapters (kept in list order) before or after another chapter. */
export function moveChapters(ids: string[], target: string, after: boolean) {
  commit({ op: "move", ids, target, after });
}

/** Delete chapters as one undo step; the open one moves to the next chapter left. */
export function deleteChapters(ids: string[]): Chapter[] {
  const gone = new Set(ids);
  const cs = library.chapters;
  const chapters = cs.filter((c) => gone.has(c.id));
  if (!chapters.length) return [];
  // undo puts each one back after the chapter that was before it
  const after = chapters.map((c) => cs[cs.indexOf(c) - 1]?.id ?? null);
  const cur = cs.findIndex((c) => c.id === ui.currentId);
  const next =
    cs.slice(cur + 1).find((c) => !gone.has(c.id)) ??
    cs
      .slice(0, Math.max(0, cur))
      .filter((c) => !gone.has(c.id))
      .at(-1);
  commit({ op: "delete", ids: chapters.map((c) => c.id) });
  undoEntry = { kind: "delete", op: { op: "add", chapters, after } };
  if (ui.currentId && gone.has(ui.currentId)) ui.currentId = next?.id ?? null;
  return chapters;
}

/** Undo the last add or delete. Returns the entry kind, or null if nothing to undo. */
export function undo(): UndoKind | null {
  const e = undoEntry;
  if (!e) return null;
  undoEntry = null;
  if (e.op.op === "delete") {
    const gone = new Set(e.op.ids);
    if (ui.currentId && gone.has(ui.currentId)) {
      const i = library.chapters.findIndex((c) => c.id === ui.currentId);
      const rest = library.chapters.filter((c) => !gone.has(c.id));
      ui.currentId = (rest[i - 1] ?? rest[0])?.id ?? null;
    }
  }
  commit(e.op);
  return e.kind;
}
