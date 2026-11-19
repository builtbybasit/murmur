// Library changes as data. The browser applies an op to its copy at once and sends it to the
// server, which applies the same function to ~/.murmur. Ops say what to do, not the resulting
// list, so a device with a stale copy cannot drop or reorder chapters it never saw. Pure, no Vue.

export interface Chapter {
  id: string;
  title: string;
  body: string;
  addedAt: number;
  /** book it belongs to (EPUB title, or a group you dragged it into); none = a loose chapter */
  book?: string;
}
export interface Library {
  /** in list order */
  chapters: Chapter[];
  /** chapter id -> segment index to resume at */
  positions: Record<string, number>;
  /** the chapter last opened on any device */
  currentId: string | null;
}
export type Op =
  /** after[i]: id of the chapter chapters[i] goes after (null: the top); no after: the end */
  | { op: "add"; chapters: Chapter[]; after?: (string | null)[] }
  | { op: "delete"; ids: string[] }
  /** move ids (kept in list order) before or after target */
  | { op: "move"; ids: string[]; target: string; after: boolean }
  /** book: null takes the chapters out of their book */
  | { op: "set"; ids: string[]; title?: string; body?: string; book?: string | null }
  | { op: "renameBook"; from: string; to: string }
  | { op: "pos"; id: string; seg: number };

export function applyOp(lib: Library, o: Op): void {
  const cs = lib.chapters;
  switch (o.op) {
    case "add":
      o.chapters.forEach((c, i) => {
        if (cs.some((x) => x.id === c.id)) return;
        const a = o.after?.[i];
        const k = a ? cs.findIndex((x) => x.id === a) : -1;
        cs.splice(a === null ? 0 : k >= 0 ? k + 1 : cs.length, 0, c); // anchor gone: the end
      });
      return;
    case "delete": {
      const gone = new Set(o.ids);
      lib.chapters = cs.filter((c) => !gone.has(c.id));
      for (const id of o.ids) delete lib.positions[id];
      if (lib.currentId && gone.has(lib.currentId)) lib.currentId = null;
      return;
    }
    case "move": {
      if (o.ids.includes(o.target)) return;
      const set = new Set(o.ids);
      const rest = cs.filter((c) => !set.has(c.id));
      const t = rest.findIndex((c) => c.id === o.target);
      const moving = cs.filter((c) => set.has(c.id));
      if (t < 0 || !moving.length) return;
      rest.splice(t + (o.after ? 1 : 0), 0, ...moving);
      lib.chapters = rest;
      return;
    }
    case "set":
      for (const c of cs) {
        if (!o.ids.includes(c.id)) continue;
        if (o.title) c.title = o.title;
        if (o.body) c.body = o.body;
        if (o.book === null) delete c.book;
        else if (o.book) c.book = o.book;
      }
      return;
    case "renameBook":
      for (const c of cs) if (c.book === o.from) c.book = o.to;
      return;
    case "pos":
      lib.positions[o.id] = o.seg;
      lib.currentId = o.id;
      return;
  }
}
