// EPUB import: chapter files in reading order, titled from the table of contents, converted with
// the same HTML -> Markdown path as web pastes. Images are stored and referenced as img:<id>.
import { Book, type NavItem, type Section } from "@likecoin/epub-ts";
import { htmlToMarkdown, plainTitle } from "./markdown";
import { putImage } from "./images";

export interface EpubItem {
  title: string;
  words: number;
  images: number;
  /** ticked in the picker: not front/back matter, not a near-empty page */
  pick: boolean;
  section: Section;
}
export interface Epub {
  title: string;
  items: EpubItem[];
  /** Load, convert and store one item: chapter Markdown (without its title heading). */
  convert: (item: EpubItem) => Promise<string>;
}

const MATTER =
  /^(cover|title ?page|half ?title|copyright|contents|table of contents|toc|dedication|epigraph|acknowledge?ments?|about the author|about the publisher|also by|other books|information|afterword|author'?s? note|patreon|discord|newsletter|colophon|imprint|preview|glossary|index)\b/i;

const bodyOf = (root: Element) => root.querySelector("body") ?? root;

export async function openEpub(data: ArrayBuffer): Promise<Epub> {
  const book = new Book(data);
  await book.opened;
  const archive = book.archive;
  if (!archive) throw new Error("This file is not a packaged EPUB");
  const request = archive.request.bind(archive);

  // title of each chapter file: the first table-of-contents entry that points into it
  const titles = new Map<number, string>();
  const walk = (items: NavItem[]) => {
    for (const n of items) {
      const s = book.spine.get(n.href.split("#")[0]!);
      if (s?.index != null && !titles.has(s.index) && n.label.trim())
        titles.set(s.index, n.label.replace(/\s+/g, " ").trim());
      if (n.subitems) walk(n.subitems);
    }
  };
  walk(book.navigation?.toc ?? []);

  const items: EpubItem[] = [];
  for (const section of book.spine.spineItems) {
    const body = bodyOf(await section.load(request));
    const text = (body.textContent ?? "").replace(/\s+/g, " ").trim();
    const heading = body.querySelector("h1, h2, h3")?.textContent?.replace(/\s+/g, " ").trim();
    const words = text ? text.split(" ").length : 0;
    const images = body.querySelectorAll("img, image").length;
    const title =
      titles.get(section.index!) ??
      heading ??
      (!words && images
        ? items.length
          ? "Illustration"
          : "Cover"
        : `Section ${items.length + 1}`);
    items.push({
      title,
      words,
      images,
      pick: section.linear !== false && words >= 80 && !MATTER.test(title),
      section,
    });
    section.unload(); // big books: keep only the list in memory
  }

  const convert = async (item: EpubItem) => {
    const s = item.section;
    const body = bodyOf(await s.load(request));
    const doc = body.ownerDocument;
    // images (and SVG-wrapped images, common for full-page art) -> stored blobs
    for (const el of Array.from(body.querySelectorAll("img, image"))) {
      const href =
        el.getAttribute("src") ??
        el.getAttribute("href") ??
        el.getAttribute("xlink:href") ??
        el.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      const path = href && decodeURI(new URL(href, "http://epub" + s.url).pathname);
      const blob = path ? await archive.getBlob(path)?.catch(() => undefined) : undefined;
      const img = doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
      img.setAttribute("alt", el.getAttribute("alt") ?? "");
      if (blob) img.setAttribute("src", "img:" + (await putImage(blob)));
      (el.closest("svg") ?? el).replaceWith(img);
    }
    let md = htmlToMarkdown(body.innerHTML).trim();
    s.unload();
    // the page shows the title already: drop a first line that repeats it
    const nl = md.indexOf("\n");
    const first = nl < 0 ? md : md.slice(0, nl);
    if (same(plainTitle(first), item.title)) md = md.slice(first.length).trim();
    return md;
  };

  return { title: book.packaging?.metadata?.title ?? "", items, convert };
}

const same = (a: string, b: string) =>
  a.replace(/\W+/g, " ").trim().toLowerCase() === b.replace(/\W+/g, " ").trim().toLowerCase();
