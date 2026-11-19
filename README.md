# murmur

Paste a webnovel chapter, press play, and listen. murmur reads it aloud through any OpenAI-compatible text-to-speech server and highlights each word as it's spoken.

It runs on your own computer, for one person, and works from your phone over Wi-Fi.

## What it does

- **Paste to add.** Press ⌘V (Ctrl+V) anywhere. Each paste becomes one chapter, titled from its first line. EPUB files can be imported too, and their chapters are grouped under the book in the sidebar.
- **Any TTS server you like.** Local ones like [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), or hosted ones like OpenAI. Anything that speaks the OpenAI `/audio/speech` API works.
- **Word-by-word highlighting.** An optional speech-to-text server (anything with OpenAI's `/audio/transcriptions`, such as Whisper) times every word. Without one, timings are estimated.
- **Separate voices.** Narration, dialogue and system messages (the `[bracketed]` boxes of LitRPG) can each have their own voice.
- **Listens ahead.** Upcoming segments are generated while you listen, and whole chapters can be generated in the background. Audio is cached, so replaying costs nothing.
- **Phone access.** Scan a QR code and your phone gets the same library, picks up where your computer left off, and gets lock-screen and headphone controls.
- **Cleans up the text.** Kaomoji like `(￣▽￣)` and emoji are spoken as a short label or skipped, with rules you can edit.

## Getting started

You need [Bun](https://bun.sh) and a TTS server.

```sh
git clone https://github.com/builtbybasit/murmur.git
cd murmur
bun install
bun run dev
```

Open http://localhost:5173. The first screen asks for a speech provider: pick a preset (local Kokoro or OpenAI) or enter any OpenAI-compatible base URL. Then paste a chapter and press Space.

Add more providers in Settings (⌘, or Ctrl+,). Each provider is either **TTS**, used for the voices, or **STT**, used for word timing. Voices are fetched from the server when it lists them; otherwise type the voice IDs yourself.

### No TTS server yet?

```sh
bun dev/fake-provider.ts
```

This serves a fake TTS and STT at `http://localhost:8899/v1`. Add it in Settings as "Other TTS" and again as "Other STT". The voices `slow`, `flaky`, `fail401`, `fail429`, `fail500` and `sttfail` simulate a slow server, random failures, specific HTTP errors and a failing transcription.

## On your phone

When `bun run dev` starts, it prints a QR code; the phone button in the top bar shows the same code. Scan it with your phone's camera on the same Wi-Fi and accept the certificate warning once.

How it works:

- **Connection.** Phones connect through an HTTPS door on port 6173 (the dev server's port + 1000). HTTPS is what lets the phone show lock-screen and headphone controls. Your computer stays on plain `http://localhost:5173`.
- **Access.** The QR code contains an access key, which the phone keeps as a cookie. Other devices on the network can't get in without it.
- **What's shared.** Chapters, reading positions and most settings are shared, so switching devices continues where you were.
- **What's per device.** Audio is cached separately on each device, and the reading look and sidebar state stay per device. The phone's audio is generated through your computer.

To keep murmur to your computer only, start it with `MURMUR_LOCAL=1 bun run dev`.

## Your data

Everything is stored in `~/.murmur`: the library, reading positions, settings, book images and the phone certificate.

Your provider API keys are kept there in plain text. The server adds them to requests itself, so no browser, not even your own, ever receives them.

murmur needs `bun run dev` running; there is no hosted or static version.

## Configuration

Copy `.env.example` to `.env` and uncomment what you need. Variables set in the shell take priority over `.env`.

| Variable       | Default     | What it does                              |
| -------------- | ----------- | ----------------------------------------- |
| `MURMUR_DATA`  | `~/.murmur` | Where the library, settings and keys live |
| `MURMUR_LOCAL` | unset       | Set to `1` to turn off phone access       |
| `PORT`         | `8899`      | Port for the fake provider                |

## Keyboard

| Keys  | Action                               |
| ----- | ------------------------------------ |
| Space | Play / pause                         |
| ← →   | Previous / next segment              |
| J K   | Next / previous chapter              |
| [ ]   | Slower / faster                      |
| F     | Back to the current word             |
| R     | Retry a failed segment               |
| ⌘V    | Add a chapter from the clipboard     |
| ⌘Z    | Undo the last add or delete          |
| E     | Edit the chapter's text              |
| B     | Toggle the chapter list              |
| A     | Reading settings (font, size, theme) |
| ⌘,    | Settings                             |
| ?     | All shortcuts                        |

On Windows and Linux, use Ctrl where this table says ⌘.

## Development

Vue 3 and TypeScript on Vite+ (`vite-plus`). The dev server doubles as the backend: a Vite plugin in `dev/server.ts` stores the library and relays provider requests (which also avoids CORS).

| Path                               | What's there                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `src/engine.ts`                    | Playback: the audio element, prefetch, seeking, sleep timer                             |
| `src/synth.ts`                     | Getting a segment's audio: cache or TTS, retries, STT alignment                         |
| `src/generate.ts`                  | Background generation of whole chapters                                                 |
| `src/library.ts`, `src/lib/ops.ts` | Chapters and positions; each change is an op that the browser and the server both apply |
| `src/settings.ts`                  | Shared settings and per-device settings                                                 |
| `src/lib/`                         | Pure logic: segmenting, alignment, speech rules, rendering, the API client              |
| `dev/server.ts`                    | The data API, the provider relay, and access control                                    |
| `dev/phone-door.ts`                | The HTTPS door for phones                                                               |

Checks:

```sh
bun run test       # unit tests (src/lib/*.test.ts)
bun run typecheck  # vue-tsc
bun run check      # format, lint and types (vp check)
```

The design spec is in [`design/DESIGN.md`](design/DESIGN.md).
