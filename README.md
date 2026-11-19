# lectern

Paste webnovel chapters, listen to them through any OpenAI-compatible TTS, and follow along with word-level highlighting timed by OpenAI-compatible STT. Local, single-user.

```sh
bun install
bun run dev       # http://localhost:5173 on this Mac; your phone gets in too (see below)
```

`LECTERN_LOCAL=1 bun run dev` keeps lectern to this Mac.

Paste a chapter with ⌘V anywhere. Add providers in Settings (⌘,).

- Your local servers: nano-edge-server TTS at `http://localhost:8020/v1`, phonon STT at `http://localhost:8010/v1` (model `FermionResearch/Phonon-2`).
- No real provider? `bun dev/fake-provider.ts` serves a fake TTS+STT at `http://localhost:8899/v1`. Voices `fail401`, `fail429`, `fail500`, `flaky`, `slow`, `sttfail` inject failures.

## On your phone

Click the phone button in the top bar (or use the QR code printed in the terminal), scan it with your phone's camera on the same Wi-Fi, and accept the certificate warning once. The phone goes through `https://<this Mac>:6173`, an HTTPS door (dev server port + 1000) that passes everything to the dev server; HTTPS is what lets the phone show lock-screen and headphone controls. The Mac itself stays on plain `http://localhost:5173`. The code carries an access key the phone keeps as a cookie; other devices on the network get nothing without it.

Chapters, reading positions, books and most settings are shared through `~/.lectern` (set `LECTERN_DATA` to move it), so the phone and the Mac show the same library and each picks up where the other left off when you switch to it. Audio is cached per device; the phone's audio is generated through your Mac. Reading look and sidebar state stay per device. `~/.lectern` holds your provider API keys in plain text; the relay adds them to provider requests, so no browser ever sees them. The app needs the dev server running: there is no static build.

Checks: `bun run test`, `bun run typecheck`, `bun run check` (format, lint).

Design spec: `design/DESIGN.md`.
