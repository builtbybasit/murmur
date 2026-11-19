// Run: bun src/lib/render.test.ts
import assert from "node:assert/strict";
import { buildDoc } from "./segment";
import { docHtml } from "./render";

const h = docHtml(buildDoc(`"Hi," she said. a<b & c\n\n> quoted\n\n![A dragon](img:abc)`));
assert.match(
  h,
  /^<p><span class="seg dlg" data-s="0"><span class="w" data-w="0">"Hi,"<\/span><\/span> /,
);
assert.ok(
  h.includes(`<span class="w" data-w="2">a&lt;b</span> <span class="w" data-w="3">&amp;</span>`),
  h,
);
assert.ok(h.includes("<blockquote><p>"), h);
assert.ok(h.includes(`<img src="/api/images/abc" alt="A dragon" loading="lazy">`), h);
assert.equal(h.match(/<blockquote>/g)?.length, h.match(/<\/blockquote>/g)?.length);
console.log("render ok");
