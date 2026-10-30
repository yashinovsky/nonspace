# NONSPACE

A browser WebGL2 game set in the cyberspace of William Gibson's _Neuromancer_. The design and implementation plan is [`docs/plan.md`](docs/plan.md); sections 8–10 are the technical source of truth.

## Requirements

- Node.js 22.12+ and npm
- A WebGL2 browser (current Chrome, Edge, Firefox, Safari 15+)

## Commands

| Command               | What it does                                                               |
| --------------------- | -------------------------------------------------------------------------- |
| `npm install`         | Install dependencies                                                       |
| `npm run dev`         | Vite dev server at http://localhost:5173 (add `?debug` for the perf panel) |
| `npm run build`       | Typecheck, build to `dist/`, and fail if `dist/` exceeds 1 MB              |
| `npm run preview`     | Serve the built `dist/` at http://localhost:4173                           |
| `npm test`            | Vitest unit tests (`tests/unit`)                                           |
| `npm run e2e:install` | One-time: install Playwright's Chromium and system deps                    |
| `npm run e2e`         | Build, serve, and run Playwright smoke tests in headless Chromium (WebGL2) |
| `npm run lint`        | ESLint + Prettier check                                                    |
| `npm run format`      | Prettier write                                                             |
| `npm run typecheck`   | `tsc` for app code and for configs/e2e/scripts                             |

CI (`.github/workflows/ci.yml`) runs lint, unit tests, build (with the size check) and the e2e smoke on every PR.

### Auto-merge for agent branches

`.github/workflows/auto-merge.yml` squash-merges a PR into `main` when the CI workflow finishes successfully, but only if all of these hold:

- the PR's head branch is in this repository (never a fork) and starts with `cursor/`;
- the PR is open and not a draft;
- the PR's head commit is still the one CI tested (`--match-head-commit`), so a later push waits for its own CI run.

It runs on `workflow_run`, so it only takes effect from the copy on `main`, and its token has only `contents: write` and `pull-requests: write`. Marking a draft ready for review re-runs CI, which then lets it merge. To keep a `cursor/*` PR open, mark it as a draft. Merges made with the workflow token don't trigger further workflow runs, so CI doesn't re-run on `main` after an auto-merge.

## Debug

- `?debug` opens a Tweakpane panel with FPS, frame time and GPU time. GPU time needs `EXT_disjoint_timer_query_webgl2` and shows `n/a` without it (e.g. SwiftShader). Tweakpane is lazy-loaded, so it costs nothing without the flag.
- `?lab=input` overlays live action/axis states, a remap UI, and a text-capture probe. Click the canvas for pointer lock; Esc exits it.
- `?mission=<id>&checkpoint=<id>` (dev builds, or with `?debug`) loads a mock mission into the runner and optionally seeks a checkpoint. Mocks live in `src/narrative/mocks.ts`; `mock-triggers` exercises every trigger kind. Campaign content is a later task.
- `?lab=audio` is the M5.1 / M5.3 audio lab (click to unlock the AudioContext; 16 FM voices, HRTF motifs, ducking, adaptive music states, `pulse(t)` readout). It does not need WebGL2.
- `?lab=sfx` is the M5.2 SFX catalog (every §7.3 recipe, Bell 103 modem, Dixie barks/laugh, event-driven flatline stub). Click to unlock. It does not need WebGL2.
- `src/debug/gpuTimer.ts` is the reusable GPU timer for labs and render tasks.
- Without WebGL2 the app shows a friendly unsupported-browser page instead of the canvas.

## Layout

The folder skeleton follows plan §8.11. Empty directories hold a `.gitkeep` until their owning task lands.

Shared contracts from plan §9 are typed stubs other tasks build against:

| Contract                         | File                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Events + typed event bus         | `src/core/events.ts`                                                                          |
| Beam lines, points, palette      | `src/render/lines/BeamBatch.ts`, `src/render/points/PointBatch.ts`, `src/render/palette.ts`   |
| ICE + Phase Lock metric          | `src/breach/IceModel.ts`, `src/breach/PhaseLock.ts`, `src/content/ice/presets.ts`             |
| Softs                            | `src/content/softs.ts`                                                                        |
| Missions (zod)                   | `src/narrative/schema.ts`                                                                     |
| Mission runner + triggers        | `src/narrative/MissionRunner.ts`, `src/narrative/triggers.ts`                                 |
| Simstim timelines                | `src/content/simstim/types.ts`                                                                |
| Audio API + no-op engine         | `src/audio/AudioEngine.ts`                                                                    |
| Web Audio engine (M5.1)          | `src/audio/{AudioEngine,engine,buses,spatial}.ts`, `src/audio/worklets/`, `src/audio/voices/` |
| SFX catalog, modem, Dixie (M5.2) | `src/audio/sfx/`, `src/audio/modem.ts`, `src/audio/dixieVoice.ts`                             |
| Adaptive music (M5.3)            | `src/audio/music/{Sequencer,Harmony,player,motifs}.ts`, `src/audio/music/patterns/`           |

Test doubles (recording beam/point batches, event recorder, recording audio engine) and valid sample data are in `src/testing/`. Notes on how the stubs differ from the plan's literal TypeScript are in plan §9.8.

## Core runtime

| Piece                                                                    | File                                       |
| ------------------------------------------------------------------------ | ------------------------------------------ |
| Fixed 60 Hz sim loop with render interpolation                           | `src/core/loop.ts`                         |
| Mode stack (`Mode`, `ModeContext`)                                       | `src/app/ModeStack.ts`                     |
| Deferred events (`post` / `flush`)                                       | `src/core/events.ts`                       |
| PCG32 RNG and integer hashing                                            | `src/core/rng.ts`, `src/core/hash.ts`      |
| Versioned localStorage save with migrations; settings                    | `src/core/save.ts`, `src/core/settings.ts` |
| Input service (`InputFrame`, remap, pointer lock, gamepad, text capture) | `src/input/Input.ts`                       |
| Mission runner (triggers, objectives, checkpoints)                       | `src/narrative/MissionRunner.ts`           |

The App flushes posted events after every sim step. Under `?debug` (and `?lab=input`), the running app is exposed as `window.__nonspace`, and the debug panel shows sim ticks, steps per frame and dropped time. Contract notes are in plan §9.9–9.14. Mouse sensitivity, invert-Y and gamepad dead zone live in `settings.input`; key bindings persist separately in `localStorage` key `nonspace.bindings`.

`prototypes/` holds standalone experiments with their own tooling; root lint, format and typecheck skip it.
