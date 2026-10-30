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
- `?lab=flight` is the M2.5 first-person fly lab (grid, two hulls, grid-assist / banking / FOV toggles). Combine with `?debug` to edit the §3.3 parameter table.
- `?mission=<id>&checkpoint=<id>` (dev builds, or with `?debug`) loads a mock mission into the runner and optionally seeks a checkpoint. Mocks live in `src/narrative/mocks.ts`; `mock-triggers` exercises every trigger kind. Campaign content is a later task.
- `?lab=audio` is the M5.1 / M5.3 audio lab (click to unlock the AudioContext; 16 FM voices, HRTF motifs, ducking, adaptive music states, `pulse(t)` readout). It does not need WebGL2.
- `?lab=sfx` is the M5.2 SFX catalog (every §7.3 recipe, Bell 103 modem, Dixie barks/laugh, event-driven flatline stub). Click to unlock. It does not need WebGL2.
- `?lab=render` is the M0.4 HDR cube through the post chain. `?quality=low` (or `auto` / `medium` / `high`) is a session override of `settings.graphics.quality`.
- `?lab=persist` is the M1.4 P7 phosphor lab (radar sweep + orbiting GRID/ICE bars). Use `&quality=medium` or `high` — SwiftShader `auto` is Low and skips persistence.
- `?lab=points` is the M1.2 lightpoint / traffic lab (60k static points in one draw, Manhattan path-texture traffic). Screenshot: `docs/screenshots/m1-2-lightpoints.png`. Contract notes in plan §9.18.
- `?lab=raster` is the M1.7 SMPTE test card through the raster CRT / NTSC pass (chroma bleed, 240 scanlines, aperture grille, barrel). Screenshot: `docs/screenshots/m1-7-smpte-raster-crt.png`.
- `?lab=beam` is the M1.1 beam-line lab (palette, near-plane clip, sub-pixel width, vertex dwell, fog, 150k stress, dynamic batch). `&scene=` selects a fixture; `?debug` exposes σ / dwell / fog. Screenshot: `docs/screenshots/m1-1-beams.png`. Contract notes in plan §9.20.
- `?lab=grammar` is the M2.1 construct grammar (all §8.6 primitives, LOD far/mid/near, live param sliders). `?g=ziggurat` (or any primitive id) selects the shape; `?lod=` and `?seed=` are optional. Draws with a Three.js line fallback (does not require BeamBatch). Screenshot: `docs/screenshots/m2-1-grammar-ziggurat.png`. Contract notes in plan §9.21.
- `?lab=sky` is the M2.4 spiral-arm sky (40k MIL points in one draw, 0.1× parallax, far constellations). `1` ground / `2` ceiling / `3` fly. Screenshot: `docs/screenshots/m2-4-sky-arms.png`. Contract notes in plan §9.22.
- `?lab=beach` is M7.10 / M6 "The Beach": first-person walk, SDF raymarch (half-res), Linda, sun cycle, checkerboard tell, dub-bass exit. `window.__nonspace.beach` is the sim handle. Contract notes in plan §9.23.
- `?lab=grid` is the M1.3 ground grid + local lattice lab (analytic AA, checker, Wintermute warp, camera-centred 64 u lattice). `&scene=cruise|graze|high|warp|lattice`. Screenshot: `docs/screenshots/m1-3-grid.png`. Contract notes in plan §9.24.
- `?lab=heraldry` is the M2.2 corp heraldry set (nine authored landmarks, mock tempo clock, grayscale toggle). `?id=esfa` (or any landmark id) selects the construct; `?gray=1` forces grayscale. Screenshot: `docs/screenshots/m2-2-heraldry.png`. Contract notes in plan §9.25.
- `?lab=sector` is the M2.3 sector streamer (5×5 window, worker gen, budgeted upload, far-LOD landmarks always on). `?seed=` and `?autofly=1` (boost along +X) are optional. Screenshot: `docs/screenshots/m2-3-sector-stream.png`. Contract notes in plan §9.26.
- `src/debug/gpuTimer.ts` is the reusable GPU timer for labs and render tasks.
- Without WebGL2 the app shows a friendly unsupported-browser page instead of the canvas.

## Layout

The folder skeleton follows plan §8.11. Empty directories hold a `.gitkeep` until their owning task lands.

Shared contracts from plan §9 are typed stubs other tasks build against:

| Contract                           | File                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Events + typed event bus           | `src/core/events.ts`                                                                                  |
| Beam lines, points, palette        | `src/render/lines/BeamBatch.ts`, `src/render/points/PointBatch.ts`, `src/render/palette.ts`           |
| ICE + Phase Lock metric            | `src/breach/IceModel.ts`, `src/breach/PhaseLock.ts`, `src/content/ice/presets.ts`                     |
| Softs                              | `src/content/softs.ts`                                                                                |
| Missions (zod)                     | `src/narrative/schema.ts`                                                                             |
| Mission runner + triggers          | `src/narrative/MissionRunner.ts`, `src/narrative/triggers.ts`                                         |
| Simstim timelines                  | `src/content/simstim/types.ts`                                                                        |
| Audio API + no-op engine           | `src/audio/AudioEngine.ts`                                                                            |
| Web Audio engine (M5.1)            | `src/audio/{AudioEngine,engine,buses,spatial}.ts`, `src/audio/worklets/`, `src/audio/voices/`         |
| SFX catalog, modem, Dixie (M5.2)   | `src/audio/sfx/`, `src/audio/modem.ts`, `src/audio/dixieVoice.ts`                                     |
| Adaptive music (M5.3)              | `src/audio/music/{Sequencer,Harmony,player,motifs}.ts`, `src/audio/music/patterns/`                   |
| Flight, camera, hull collision     | `src/player/{FlightController,CameraRig,Collision}.ts`                                                |
| Construct grammar (M2.1)           | `src/world/constructs/{grammar,primitives,lod}.ts`                                                    |
| Sky (spiral arms + constellations) | `src/world/sky/{SpiralArms,FarConstellations,Sky}.ts`                                                 |
| Corp heraldry + landmarks (M2.2)   | `src/content/{corps,landmarks}.ts`                                                                    |
| Sector streaming (M2.3)            | `src/world/{coords,Sector,SectorStreamer,sectorWorker,densityMap,landmarks}.ts`, `traffic/routing.ts` |

Test doubles (recording beam/point batches, event recorder, recording audio engine) and valid sample data are in `src/testing/`. Notes on how the stubs differ from the plan's literal TypeScript are in plan §9.8.

## Core runtime

| Piece                                                                    | File                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Fixed 60 Hz sim loop with render interpolation                           | `src/core/loop.ts`                                     |
| Mode stack (`Mode`, `ModeContext`)                                       | `src/app/ModeStack.ts`                                 |
| Deferred events (`post` / `flush`)                                       | `src/core/events.ts`                                   |
| PCG32 RNG and integer hashing                                            | `src/core/rng.ts`, `src/core/hash.ts`                  |
| Versioned localStorage save with migrations; settings                    | `src/core/save.ts`, `src/core/settings.ts`             |
| Input service (`InputFrame`, remap, pointer lock, gamepad, text capture) | `src/input/Input.ts`                                   |
| Mission runner (triggers, objectives, checkpoints)                       | `src/narrative/MissionRunner.ts`                       |
| Flight controller, camera rig, soft hull collision                       | `src/player/{FlightController,CameraRig,Collision}.ts` |
| Renderer service (HDR targets, PostChain, quality)                       | `src/render/Renderer.ts`                               |
| Beach walk / SDF raymarch (M7.10)                                        | `src/render/beach/*`, `src/app/modes/Beach.ts`         |

The App flushes posted events after every sim step. Under `?debug` and `?lab=` (input, flight, render, persist, points, raster, beam, grammar, sky, beach, grid, heraldry, sector), the running app is exposed as `window.__nonspace`, and the debug panel shows sim ticks, steps per frame and dropped time. Contract notes are in plan §9.9–9.26. Mouse sensitivity, invert-Y and gamepad dead zone live in `settings.input`; key bindings persist separately in `localStorage` key `nonspace.bindings`.

## Render

M0.4's Renderer service owns the WebGL2 context, HDR targets and the post chain. Default boot is still a black canvas. Contract notes are in plan §9.16. M1.1 adds instanced beam lines (`createBeamBatch`, `beamLine.vert/.frag`); contract notes are in plan §9.20. M1.3 adds the infinite ground grid and local 3D lattice (`render/grid/`); contract notes are in plan §9.24.

| Piece                                          | File                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Renderer service, scenes, cameras              | `src/render/Renderer.ts`                                                       |
| HDR 16F targets + RGBA8 fallback, ping-pong    | `src/render/targets.ts`                                                        |
| Quality tiers from `settings.graphics.quality` | `src/render/quality.ts`                                                        |
| Dynamic resolution                             | `src/render/dynamicRes.ts`                                                     |
| Pass interface + chain                         | `src/render/post/pass.ts`, `PostChain.ts`                                      |
| Phosphor persistence (M1.4)                    | `PersistencePass.ts`, `post/shaders/persistence.frag`                          |
| Remaining M1 slots (identity stubs)            | `BloomPass.ts`, `BlackIceComposite.ts`, `VectorCrtPass.ts`, `RasterCrtPass.ts` |
| Tonemap blit                                   | `FinalComposite.ts`                                                            |
| Beam lines (M1.1)                              | `render/lines/BeamBatch.ts`, `beamLine.vert/.frag`, `render/palette.ts`        |
| Ground grid + lattice (M1.3)                   | `render/grid/GroundGrid.ts`, `LocalLattice.ts`, `groundGrid.vert/.frag`        |

- `?lab=render` — two amber cubes (HDR intensity 4 vs 0.55) through the HDR target and Reinhard tonemap. Screenshot: `docs/screenshots/m0-4-hdr-cube.png`.
- `?lab=persist` — GRID radar arm + orbiting bars through PersistencePass. Trails shift blue-white → yellow-green. Screenshot: `docs/screenshots/m1-4-phosphor-trails.png`.
- `?lab=points` — 60k static lightpoints + path-texture traffic. Screenshot: `docs/screenshots/m1-2-lightpoints.png`.
- `?lab=beach` — Neuromancer's construct (M7.10): half-res SDF raymarch, walk, Linda CSG, sun cycle, checkerboard bleed-through. Screenshot: `docs/screenshots/beach.png`.
- `?quality=low` (or `auto` / `medium` / `high`) — session override of `settings.graphics.quality` (not persisted).
- `?debug` adds a graphics folder: quality, internal size, dynres, a GPU-load slider, and inject-20 ms buttons. Persistence tunables live in the `phosphor` folder.
- `?lab=beam` — eight palette cubes plus a grid, through the same HDR target and Reinhard tonemap. Screenshot: `docs/screenshots/m1-1-beams.png`.
- `?lab=grid` — infinite ground grid (8/64/1024 u, analytic AA, checker, warp) plus the 64 u local lattice. Screenshot: `docs/screenshots/m1-3-grid.png`.
- M1.5–M1.8 each own one pass file and should not edit sibling passes or `PostChain.ts`. Persistence notes are plan §9.17. Points notes are plan §9.18. Raster CRT notes are plan §9.19. Beam notes are plan §9.20. Grammar notes are plan §9.21. Sky notes are plan §9.22. Beach notes are plan §9.23. Grid notes are plan §9.24. Heraldry notes are plan §9.25. Sector notes are plan §9.26. M1.2 must not edit `render/lines/*`.
- M1.7 `RasterCrtPass` (`?lab=raster`) is the simstim/interlude CRT: NTSC YIQ chroma bleed, 240 scanlines, aperture grille, H-hold / static / tracking transition. Contract notes are in plan §9.19.

`prototypes/` holds standalone experiments with their own tooling; root lint, format and typecheck skip it.
