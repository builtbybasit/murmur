# lectern

Paste webnovel chapters, listen to them through any OpenAI-compatible TTS, and follow along with word-level highlighting timed by OpenAI-compatible STT. Local, single-user.

```sh
bun install
vp dev            # app + /relay (forwards provider calls, so CORS never applies)
```

Paste a chapter with ⌘V anywhere. Add providers in Settings (⌘,).

- Your local servers: nano-edge-server TTS at `http://localhost:8020/v1`, phonon STT at `http://localhost:8010/v1` (model `FermionResearch/Phonon-2`).
- No real provider? `bun dev/fake-provider.ts` serves a fake TTS+STT at `http://localhost:8899/v1`. Voices `fail401`, `fail429`, `fail500`, `flaky`, `slow`, `sttfail` inject failures.

## On your phone

```sh
bun run phone     # same app, on your Wi-Fi, over HTTPS (self-signed certificate)
```

Open the `Phone:` link it prints on the phone and accept the certificate warning once. The link carries an access key; the phone remembers it. Other devices on the network get nothing without it, and this Mac never needs it.

Chapters, reading positions, books and most settings are shared through `~/.lectern` (set `LECTERN_DATA` to move it), so the phone and the Mac show the same library and each picks up where the other left off when you switch to it. Audio is cached per device; the phone's audio is generated through your Mac. Reading look and sidebar state stay per device. `~/.lectern` holds your provider API keys in plain text, like the browser did.

Checks: `bun run test`, `bun run typecheck`, `vp lint`, `vp fmt`.

Design spec and mockup: `design/`.
