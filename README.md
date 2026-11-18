# lectern

Paste webnovel chapters, listen to them through any OpenAI-compatible TTS, and follow along with word-level highlighting timed by OpenAI-compatible STT. Local, single-user.

```sh
bun install
vp dev            # app + /relay (forwards provider calls, so CORS never applies)
```

Paste a chapter with ⌘V anywhere. Add providers in Settings (⌘,).

- Your local servers: nano-edge-server TTS at `http://localhost:8020/v1`, phonon STT at `http://localhost:8010/v1` (model `FermionResearch/Phonon-2`).
- No real provider? `bun dev/fake-provider.ts` serves a fake TTS+STT at `http://localhost:8899/v1`. Voices `fail401`, `fail429`, `fail500`, `flaky`, `slow`, `sttfail` inject failures.

Checks: `bun run test`, `bun run typecheck`, `vp lint`, `vp fmt`.

Design spec and mockup: `design/`.
