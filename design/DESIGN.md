# lectern: UI/UX design (v1)

Local, single-user reader that speaks webnovel chapters and highlights each word as it is spoken.
Vue 3 + Vite front end; the dev server (dev/server.ts) relays to OpenAI-compatible providers and keeps the shared library.

Design principles, in priority order:

1. **The text is the interface.** The reading column is never covered by a modal and never replaced by a spinner.
2. **Nothing blocks listening that does not have to.** STT failures, slow providers and missing voice lists degrade quietly.
3. **No modes for common actions.** Pasting a chapter, seeking and retrying are one keystroke or one click from anywhere.
4. Dense, cool-toned chrome around a generous, calm reading column.

---

## 1. Layout and regions

```
┌──────────────────────────────────────────────────────────────────────────┐
│ top bar 44px   [☰] lectern │ Chapter title            [Aa] [⌨] [settings]│
├───────────────┬──────────────────────────────────────────────────────────┤
│ sidebar 264px │ main (one of: reader · settings · onboarding)            │
│               │                                                          │
│ CHAPTERS 4·6k │            Chapter 1: The Tide Clock                     │
│ 01 Title   1m │            261 words · 19 segments · ~1 min · 9 cached   │
│ 02 Title   1m │                                                          │
│ 03 …          │            reading column, max-width = Width setting     │
│               │                                                          │
│ ┌ paste slot ┐│                         [Back to current  F]             │
│ └────────────┘│                                                          │
├───────────────┴──────────────────────────────────────────────────────────┤
│ error strip (only while a segment has failed)                            │
├══════ progress track: played ▓▓▓ buffered ▒▒▒ rest ░░░ ══════════════════┤
│ ⏮ (▶) ⏭  Segment 5 of 19          [● Narration af_heart] [● Aligned] [− 1.0× +]│
│          0:33 / ~1:19                                    player bar 56px │
└──────────────────────────────────────────────────────────────────────────┘
```

| Region      | Size                             | Contents                                                                                   | Persistence                        |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| Top bar     | 44px                             | sidebar toggle, wordmark, current chapter title, `Aa` reading popover, shortcuts, settings | always                             |
| Sidebar     | 264px, collapsible (`B`)         | chapter list, paste slot pinned at the bottom                                              | always; overlay drawer under 820px |
| Main        | rest                             | reader, or settings, or onboarding when the library is empty                               | swaps                              |
| Error strip | auto                             | one failed-segment message with actions                                                    | only in error state                |
| Player bar  | 56px + 3px track on its top edge | transport, status, voice chip, timing chip, speed                                          | always, including in settings      |

The player bar stays visible in Settings so playback continues while you change a voice or fix a key.

**Narrow window (under 820px):** sidebar becomes an overlay drawer; reader padding drops from 32px to 20px; settings nav becomes a horizontal tab strip; the player hides the time line and collapses the voice chip to its colored dot. Under 520px the timing chip is a dot and the speed control is tap-to-reset only.

---

## 2. Adding chapters

Decision: **there is no add dialog and no text box.** Paste is a global action.

Step by step:

1. Copy a chapter in the browser tab where you read.
2. Switch to lectern and press `⌘V` / `Ctrl+V` anywhere (any screen, as long as focus is not in a text field).
3. The chapter is appended to the end of the list. Its row flashes teal and scrolls into view.
4. A toast confirms what was understood: `Added "Chapter 5: Low Water"` · `144 words · 10 segments · ready for the next paste`, with **Rename** and **Undo** buttons (`⌘Z` also undoes).
5. Nothing else changes. Playback is not interrupted and the selected chapter does not change, so step 1 to 4 can be repeated as fast as you can alt-tab. The only exception: the very first chapter is opened automatically.

Rules applied on paste:

- **Title.** The first non-empty line becomes the title, and is removed from the body, when it looks like a heading: it starts with `Chapter / Ch. / Episode / Part / Volume / Prologue / Epilogue / Interlude` or a number followed by `. : -`, or it is 80 characters or shorter and does not end in sentence punctuation or a quote. Otherwise the body is kept whole and the title is `Chapter N`, where N is the highest number in existing titles plus one.
- **Duplicate guard.** If the pasted text is identical to an existing chapter, nothing is added; the existing row flashes and the toast says `Already in the list`. This catches the most likely mistake in a fast loop, which is forgetting to copy the next chapter.
- **Short paste.** Under 40 words the chapter is still added, but the toast asks `short paste, is this the right text?` and the row carries a small amber `short` tag. No confirm dialog.
- **Empty clipboard.** Toast only: `Nothing to add`.
- Line endings are normalised; blank lines separate paragraphs.

Visible affordances for the same action (for discoverability and mouse use):

- **Paste slot** pinned at the bottom of the sidebar: `Paste next chapter ⌘V`, plus a `Paste from clipboard` button (uses the async clipboard API; if the browser blocks it, the toast says to press `⌘V`).
- **Empty library screen** in the main region with a large `Press ⌘V anywhere` zone.
- **End-of-chapter card** under the last paragraph of the last chapter: `End of the list · Paste the next chapter to keep listening`.

Managing chapters (all in the sidebar, each row 32px):

| Action  | Mouse                                                    | Keyboard (row focused)                      |
| ------- | -------------------------------------------------------- | ------------------------------------------- |
| Open    | click row                                                | `Enter`                                     |
| Rename  | pencil on hover, or Rename in the toast                  | `F2`, then `Enter` to save, `Esc` to cancel |
| Reorder | drag by the grip; an accent line shows the drop position | `⌥↑` / `⌥↓`                                 |
| Delete  | trash on hover                                           | `⌫` / `Delete`                              |

Delete is immediate with an Undo toast, never a confirm dialog. Cached audio of a deleted chapter is kept until the cache is cleared, so Undo is free.

Row anatomy: index (replaced by animated bars while that chapter is playing), title, estimated minutes at the current speed, and a 2px progress line under the title showing how far you have listened.

**Auto-advance.** When the last segment of a chapter ends, the next chapter opens and plays from its start. The card under the chapter text announces it in advance: `Up next · plays automatically · <title>`. At the end of the list playback stops and the toast points at `⌘V`.

---

## 3. Reader view

- One centered column. Chapter title (reading font, 1.55em, weight 600), then a single meta line in UI type: `261 words · 19 segments · about 1 min at 1.0× · 9 of 19 cached`.
- Paragraph spacing 0.85em, no first-line indent, `text-wrap: pretty`.
- Every word is a click target. Every segment is an inline span, so highlights follow the text across line breaks.

### Highlighting

| Layer                   | Look                                                                                      | Meaning                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Current paragraph       | 2px vertical bar in the left gutter (18px outside the column)                             | where you are, even when scrolled quickly               |
| Current segment         | soft band behind the text, 11% of the segment color, text raised to the high-contrast ink | the unit being spoken; also the unit of one TTS request |
| Current word, aligned   | 36% wash of the segment color plus a 2px underline in that color                          | timed from real word timestamps                         |
| Current word, estimated | 26% wash, no underline                                                                    | timed by character position                             |
| Word hover              | 16% wash, pointer cursor                                                                  | click to play from here                                 |
| Waiting segment         | the band gets a slow moving sheen                                                         | audio for this segment is being generated               |
| Failed segment          | red wavy underline, red-tinted band                                                       | generation failed here                                  |

Notes:

- The wash never inverts the text color and never changes layout (it is a background plus a spread shadow), so a moving highlight stays calm to read through.
- **Narration vs dialogue.** Narration uses the neutral ink and the blue accent. Dialogue text is tinted toward teal (38% teal mixed into the ink) and its band, word wash and voice chip are teal. The same two colors mark narration and dialogue everywhere: reader, player chip, settings. `Tint dialogue text` can be turned off in the `Aa` popover; the band and word colors still switch.
- **Estimated vs aligned is deliberately quiet:** the only differences are the underline under the current word and the timing chip in the player. When a transcript arrives mid-segment the highlight keeps its position and gains the underline.
- Played text is not dimmed. Re-reading a line you just heard should not be harder than reading ahead.
- Before playback has started in a chapter there is no band and no word highlight, only the gutter bar on the first paragraph.

### Follow and scrolling

- While playing, the reader keeps the current word between 12% and 72% of the viewport height. When the word leaves that zone the view scrolls smoothly to put it at 30%. Jumps longer than 1.5 screens (resume, seeking) are instant.
- Any manual scroll (wheel, touch, scroll keys, scrollbar) pauses following and shows a pill, `Back to current  F`, centered above the player. Clicking it, pressing `F`, or any seek re-enables following.

### Reading settings (`Aa` popover, top right, key `A`)

Changes apply live to the text behind the popover.

| Setting            | Options                                                     | Default        |
| ------------------ | ----------------------------------------------------------- | -------------- |
| Font               | Source Serif 4, Literata, Atkinson Hyperlegible, Geist Sans | Source Serif 4 |
| Size               | 15 to 26px                                                  | 19px           |
| Line height        | 1.40 to 2.00                                                | 1.70           |
| Width              | 48 to 88ch                                                  | 66ch           |
| Theme              | Light, Dark, System                                         | System         |
| Tint dialogue text | on / off                                                    | on             |

### Segmentation rules as the reader shows them

- Double quotes (`"…"`, `“…”`) are always dialogue. An opening double quote with no closer runs to the end of the paragraph (multi-paragraph speech).
- Single quotes (`'…'`, `‘…’`) are dialogue under the smart rule: the opener must have no letter on its left, the closer no letter on its right, and both must be in the same paragraph. `don't`, `boys'`, `'em` with no closer are left alone. Single quotes inside double-quoted speech are part of that speech.
- A fragment with nothing speakable (a space or a stray full stop between two quotes) is attached to the previous segment, so there are no empty requests.
- Known limit: a possessive inside single-quoted speech (`'The boys' rope is gone,'`) closes the quote early. The effect is a voice change mid-sentence, not lost text.
- Assumption to confirm: turning the smart rule **off** means "double quotes only", not "every apostrophe toggles".

---

## 4. Player bar

Left to right:

1. **Transport:** previous segment, play/pause (36px round, accent fill), next segment. Previous restarts the current segment if more than 1.5s in, otherwise goes back one.
2. **Status, two lines:** `Segment 5 of 19` and `0:33 / ~1:19` (mono, tabular; total is an estimate until the whole chapter is cached, hence the `~`). This block is also where state messages appear, see section 6.
3. **Voice chip:** colored dot + `Narration` or `Dialogue` + the voice id of the segment being spoken. It flips as the speaker changes. Click opens Settings, Voices.
4. **Timing chip:** `Aligned` (filled dot), `Estimated` (hollow dot), or `Estimated` with an amber dot when STT is failing. Click opens a small popover that explains the current state in one sentence and offers the relevant action.
5. **Speed:** `−  1.0×  +`, 0.5 to 3.0 in 0.1 steps, click the number to reset. Speed changes the audio element's playback rate with pitch preserved. It does not change the TTS request, so cached audio stays valid at any speed and the change is instant.

**Progress track** on the top edge of the bar, full width, 3px (6px on hover):

- accent = played, lighter accent = buffered ahead of the playhead, track color = not generated, red notch = failed segment.
- Position is weighted by characters, so a long narration paragraph takes its fair share.
- Click anywhere to jump to that segment.

---

## 5. Settings

Full main-region screen (`⌘,`, `Esc` returns), left nav with four sections. Everything saves on change; there is no Save button.

### Providers

A list of rows: status dot, name, base URL, role tags showing where the provider is used (`narration`, `dialogue`, `alignment`), voice count. Click a row to expand it in place.

| Field    | Notes                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Name     | free text                                                                                                   |
| Base URL | e.g. `https://api.openai.com/v1`, `http://localhost:8880/v1`                                                |
| API key  | password field; `Optional for local servers`                                                                |
| Voices   | textarea, **one id per line** (blend ids contain commas). Suggestions only; the voice field stays free text |

Buttons: **Test connection** (calls `GET /models` through the relay; result inline: `Connected in 212 ms · 3 models`; model ids become suggestions), **Fetch voices** (`GET /audio/voices`; on 404: `this server has no /audio/voices. Type voice ids by hand.`), **Remove**.

Under the list: `Add` with presets `Local Kokoro`, `OpenAI`, `Local STT`, `Blank`. A preset fills name, URL and known voices; a provider has no "type", any provider can be picked for any role.

### Voices

Two cards with the same three fields:

- **Narration:** Provider (select), Model (text with suggestions), Voice (text). Under the voice field the provider's voice list is shown as clickable chips; clicking one fills the field. Helper text shows the blend syntax `af_heart:0.7,af_bella:0.3`. `Preview` speaks one fixed sentence.
- **Dialogue:** a two-way switch in the card header, `Same as narration` / `Separate voice`. The fields appear only for `Separate voice`.

Changing a voice never deletes audio. The cache key includes provider, model and voice, so new segments are generated on demand and switching back reuses the old ones.

### Segments & timing

- `Treat single quotes as dialogue (smart rule)`, on by default, with a live preview sentence that re-segments as you toggle.
- `Align the highlight with speech-to-text`, on/off, plus STT provider and model.
- `Segments to prefetch ahead`, 1 to 8, default 3.

### Storage

Audio cache (segment count, size, **Clear cache**), word timings (cleared with audio), chapter count, and a plain statement that settings and keys are stored unencrypted in this browser.

---

## 6. States

| State                                       | What the user sees                                                                                                                                                                                                                                                                                            | What they can do                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **First run, no providers, no chapters**    | Main region shows `Two things, then you can listen` with two cards side by side. Card 1 is an inline provider form with presets (Local Kokoro preselected, URL filled in) and `Test and save`. Card 2 is the paste zone. The sidebar and player are present but quiet.                                        | Do either first. Saving a provider sets narration to its first voice. |
| **Chapters but no provider**                | Reader works normally. Player play button is grey; status reads `No TTS provider · Reading works. Listening needs one. Add a provider`.                                                                                                                                                                       | Read; click the link or play to open Providers.                       |
| **Empty library, provider set**             | Same screen with card 1 ticked green and the title `Add your first chapter`.                                                                                                                                                                                                                                  | Paste.                                                                |
| **Chapter with nothing generated**          | Full text, no highlight, gutter bar on paragraph one. Meta line ends `nothing generated yet`. Player: `Ready to play · 19 segments · about 1 min · generated as you listen`. Track empty.                                                                                                                     | Play, or click any word to start there.                               |
| **Buffering, first segment or mid-chapter** | Play button shows a spinner. The waiting segment has the moving sheen. Status: `Generating segment 1…` with provider and model beneath. Text stays readable; no overlay.                                                                                                                                      | Pause, or click another word.                                         |
| **Provider error mid-chapter**              | Playback continues through whatever is already buffered and stops **at** the failed segment, which gets the red wavy underline. A red strip appears above the player; the play button turns red; status: `Stopped at segment 6 · 5 segments before it are cached`; red notch on the track.                    | See below.                                                            |
| **STT failing, TTS fine**                   | Nothing interrupts. The word highlight loses its underline; the timing chip shows `Estimated` with an amber dot. Its popover: `Local STT failed on 3 segments (HTTP 500), so alignment is paused for this chapter. Audio is not affected.`                                                                    | `Retry alignment` or `Turn off`.                                      |
| **Long chapter (5k+ words)**                | Only the current segment and the prefetch window are requested, never the whole chapter. Meta line shows `96 of 433 cached`. Resuming jumps straight to the saved position. Follow keeps the word in view; the pill returns you after free scrolling. Track shows played, buffered and remaining at a glance. | Click the track or any word to seek. `⇧←` / `⇧→` move by paragraph.   |

### Provider errors in detail

| Error                   | Strip text                                                                                             | Automatic behaviour                      | Actions                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 401 / 403               | `401 Unauthorized · <provider> rejected the API key. Nothing is retried until the key is fixed.`       | none                                     | **Fix key** (opens that provider expanded, key field marked, Test button primary), Retry `R`, Skip segment |
| 429                     | `429 Too Many Requests · <provider> is rate limiting. Retrying in 6 s (attempt 1 of 3).`               | honours `Retry-After`, else 6s, 12s, 24s | **Retry now** `R`, Skip segment                                                                            |
| Network / 5xx           | `Network error · Can't reach localhost:8880. Is the server running? Retrying in 4 s (attempt 1 of 3).` | 4s, 8s, 16s                              | **Retry now** `R`, Open provider, Skip segment                                                             |
| after 3 failed attempts | same text ending `Gave up after 3 attempts.`                                                           | none                                     | Retry, Skip segment                                                                                        |

Rules: the strip is not a modal and does not steal focus. `Space` and `R` both retry. A successful Test connection on the failing provider resumes playback from the failed segment and says so in a toast. A skipped segment keeps its red underline; clicking it later brings the strip back so it can be retried.

STT rules: alignment requests never retry automatically; after 3 failures in a row alignment pauses for the current chapter and resumes on the next chapter or on `Retry alignment`.

---

## 7. Keyboard map

Active everywhere except inside text fields.

| Key                          | Action                                       |
| ---------------------------- | -------------------------------------------- |
| `Space`                      | play / pause; retry when stopped on an error |
| `←` / `→`                    | previous / next segment                      |
| `⇧←` / `⇧→`                  | previous / next paragraph                    |
| `K` / `J`                    | previous / next chapter                      |
| `[` / `]`                    | slower / faster by 0.1×                      |
| `F`                          | back to the current word, resume following   |
| `R`                          | retry the failed segment                     |
| `⌘V`                         | add a chapter from the clipboard             |
| `⌘Z`                         | undo the last add or delete                  |
| `B`                          | toggle the chapter list                      |
| `A`                          | reading settings popover                     |
| `⌘,`                         | settings; `Esc` returns to the reader        |
| `?`                          | shortcut sheet                               |
| `↑` / `↓` on a chapter row   | move focus through the list                  |
| `Enter` on a chapter row     | open it                                      |
| `F2` on a chapter row        | rename                                       |
| `⌥↑` / `⌥↓` on a chapter row | move the chapter                             |
| `⌫` on a chapter row         | delete, with Undo toast                      |

`Ctrl` replaces `⌘` on Windows and Linux.

---

## 8. Visual tokens

### Color

| Token       | Dark      | Light     | Use                                 |
| ----------- | --------- | --------- | ----------------------------------- |
| `--bg`      | `#0b0f15` | `#e9edf3` | app background, inset wells         |
| `--surface` | `#11161e` | `#f4f6fa` | top bar, sidebar, player, cards     |
| `--raised`  | `#171e28` | `#ffffff` | buttons, inputs, popovers, toasts   |
| `--hover`   | `#1c2531` | `#e3e8ef` | hover fill                          |
| `--line`    | `#222b38` | `#d5dce6` | hairlines, track                    |
| `--line2`   | `#324054` | `#b9c4d2` | control borders, gutter bar         |
| `--page`    | `#0e131a` | `#fbfcfe` | reading surface (cool, never cream) |
| `--ink`     | `#d3dbe8` | `#1c2532` | body and reading text               |
| `--ink-hi`  | `#f1f5fb` | `#0a111c` | headings, current segment           |
| `--ink2`    | `#93a1b5` | `#506076` | secondary text                      |
| `--ink3`    | `#66758b` | `#728096` | meta, placeholders                  |
| `--acc`     | `#7da5ff` | `#2d5bdb` | primary action, narration, progress |
| `--on-acc`  | `#0a1222` | `#ffffff` | text on accent                      |
| `--dlg`     | `#58d0be` | `#0a7d70` | dialogue                            |
| `--warn`    | `#e2b25e` | `#9a6207` | STT failing, short paste            |
| `--err`     | `#f27981` | `#c5303c` | provider errors                     |
| `--ok`      | `#62cf98` | `#1c8551` | connected, done                     |

Derived fills use `color-mix` of the segment color into transparent: segment band 11%, hover word 16%, estimated word 26%, aligned word 36%. Selected rows are 13% accent. The error strip is 11% `--err` over `--surface`.

### Type

| Role                          | Font                             | Size / line      | Weight     |
| ----------------------------- | -------------------------------- | ---------------- | ---------- |
| UI base                       | Geist                            | 13 / 1.45        | 400        |
| UI emphasis, buttons          | Geist                            | 12.5 to 13       | 500        |
| Section label (caps, +0.06em) | Geist                            | 11               | 600        |
| Settings heading              | Geist                            | 16               | 600        |
| Numerals, ids, URLs, kbd      | Geist Mono, tabular              | 11.5 to 12       | 400 to 500 |
| Reading body                  | Source Serif 4 (user-selectable) | 19 / 1.7 default | 400        |
| Chapter title                 | reading font                     | 1.55em / 1.2     | 600        |
| Onboarding title              | reading font                     | 26 / 1.2         | 600        |

Reading measure defaults to 66ch. UI type inside the reading column (the meta line, the end card) does not scale with the reading size.

### Spacing, shape, motion

- Spacing scale: 2, 4, 6, 8, 12, 16, 24, 32, 44px. Reader column padding 44px top, 32px sides, 140px bottom so the last line clears the player.
- Heights: top bar 44, chapter row 32, controls 28, inputs 30, chips 26, play button 36, player 56.
- Radius: 4 (words, kbd, small chips), 6 (controls), 10 (cards, popovers, toasts), full (pills).
- Borders are 1px hairlines; only popovers, toasts and the follow pill cast a shadow.
- Motion: 120 to 180ms for fills and the track; the sheen and the spinner are the only loops. All of it is disabled under `prefers-reduced-motion`.
- Focus: 2px accent outline on every interactive element.

---

## 9. Notes for the build

- Storage: chapters, positions, images, settings and API keys on the server in `~/.lectern`; audio blobs and word timings in each browser's IndexedDB; reading look in `localStorage`.
- Cache key: `hash(provider base URL, model, voice, segment text)`. Renaming, reordering and re-segmenting do not invalidate unchanged segments.
- Popovers and the shortcut sheet use the native Popover API and `<dialog>`.

## Later (not in v1)

1. Split very long narration segments at sentence boundaries, to cut the wait for first audio on paragraph-length segments.
2. Stop-at-end-of-chapter / sleep timer.
3. Pre-generate a whole chapter in the background for fully offline listening.
