# NONSPACE

A browser WebGL2 game set in the cyberspace of William Gibson's _Neuromancer_. The design and implementation plan is [`docs/plan.md`](docs/plan.md); sections 8–10 are the technical source of truth.

## Requirements

- Node.js 22.12+ and npm
- A WebGL2 browser (current Chrome, Edge, Firefox, Safari 15+)

## Commands

| Command               | What it does                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `npm install`         | Install dependencies                                                         |
| `npm run dev`         | Vite dev server at http://localhost:5173 (add `?debug` for the perf panel)   |
| `npm run build`       | Typecheck, build to `dist/`, and fail if the default-boot graph exceeds 1 MB |
| `npm run preview`     | Serve the built `dist/` at http://localhost:4173                             |
| `npm test`            | Vitest unit tests (`tests/unit`)                                             |
| `npm run e2e:install` | One-time: install Playwright's Chromium and system deps                      |
| `npm run e2e`         | Build, serve, and run Playwright smoke tests in headless Chromium (WebGL2)   |
| `npm run lint`        | ESLint + Prettier check                                                      |
| `npm run format`      | Prettier write                                                               |
| `npm run typecheck`   | `tsc` for app code and for configs/e2e/scripts                               |

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
- `?mission=<id>&checkpoint=<id>` (dev builds, or with `?debug`) loads a mock mission into the runner and optionally seeks a checkpoint. Mocks live in `src/narrative/mocks.ts`; `mock-triggers` exercises every trigger kind. `?mission=m2` is the M6.2 Sense/Net simstim stub (also enabled in the production preview). Campaign content is a later task.
- `?lab=audio` is the M5.1 / M5.3 audio lab (click to unlock the AudioContext; 16 FM voices, HRTF motifs, ducking, adaptive music states, `pulse(t)` readout). It does not need WebGL2.
- `?lab=sfx` is the M5.2 SFX catalog (every §7.3 recipe, Bell 103 modem, Dixie barks/laugh, event-driven flatline stub). Click to unlock. It does not need WebGL2.
- `?lab=render` is the M0.4 HDR cube through the post chain. `?quality=low` (or `auto` / `medium` / `high`) is a session override of `settings.graphics.quality`.
- `?lab=persist` is the M1.4 P7 phosphor lab (radar sweep + orbiting GRID/ICE bars). Use `&quality=medium` or `high` — SwiftShader `auto` is Low and skips persistence.
- `?lab=points` is the M1.2 lightpoint / traffic lab (60k static points in one draw, Manhattan path-texture traffic). Screenshot: `docs/screenshots/m1-2-lightpoints.png`. Contract notes in plan §9.18.
- `?lab=raster` is the M1.7 SMPTE test card through the raster CRT / NTSC pass (chroma bleed, 240 scanlines, aperture grille, barrel). Screenshot: `docs/screenshots/m1-7-smpte-raster-crt.png`.
- `?lab=vector` is the M1.6 vector CRT composite (barrel, beam jitter, load-tied flicker, vignette, glass, grain, true black). `?debug` toggles each effect. Screenshot: `docs/screenshots/m1-6-vector-crt.png`. Contract notes in plan §9.32.
- `?lab=beam` is the M1.1 beam-line lab (palette, near-plane clip, sub-pixel width, vertex dwell, fog, 150k stress, dynamic batch). `&scene=` selects a fixture; `?debug` exposes σ / dwell / fog. Screenshot: `docs/screenshots/m1-1-beams.png`. Contract notes in plan §9.20.
- `?lab=grammar` is the M2.1 construct grammar (all §8.6 primitives, LOD far/mid/near, live param sliders). `?g=ziggurat` (or any primitive id) selects the shape; `?lod=` and `?seed=` are optional. Draws with a Three.js line fallback (does not require BeamBatch). Screenshot: `docs/screenshots/m2-1-grammar-ziggurat.png`. Contract notes in plan §9.21.
- `?lab=sky` is the M2.4 spiral-arm sky (40k MIL points in one draw, 0.1× parallax, far constellations). `1` ground / `2` ceiling / `3` fly. Screenshot: `docs/screenshots/m2-4-sky-arms.png`. Contract notes in plan §9.22.
- `?lab=beach` is M7.10 / M6 "The Beach": first-person walk, SDF raymarch (half-res), Linda, sun cycle, checkerboard tell, dub-bass exit. `window.__nonspace.beach` is the sim handle. Contract notes in plan §9.23.
- `?lab=grid` is the M1.3 ground grid + local lattice lab (analytic AA, checker, Wintermute warp, camera-centred 64 u lattice). `&scene=cruise|graze|high|warp|lattice`. Screenshot: `docs/screenshots/m1-3-grid.png`. Contract notes in plan §9.24.
- `?lab=heraldry` is the M2.2 corp heraldry set (nine authored landmarks, mock tempo clock, grayscale toggle). `?id=esfa` (or any landmark id) selects the construct; `?gray=1` forces grayscale. Screenshot: `docs/screenshots/m2-2-heraldry.png`. Contract notes in plan §9.25.
- `?lab=sector` is the M2.3 sector streamer (5×5 window, worker gen, budgeted upload, far-LOD landmarks always on). `?seed=` and `?autofly=1` (boost along +X) are optional. Screenshot: `docs/screenshots/m2-3-sector-stream.png`. Contract notes in plan §9.26.
- `?lab=simstim` is the M6.1 simstim feed plus M6.2 Sense/Net content (flat-dither lobby / corridor / vault at 320×240 through the raster CRT, three gates, guard mannequins, Moderns panic, Molly lines). `&scene=lab` is the original one-gate lobby. `&t=` seeks meat time. `?mission=m2` is the structural stub. Screenshots: `docs/screenshots/m6-1-simstim-crt.png`, `docs/screenshots/m6-2-sensenet-crt.png`. Contract notes in plan §9.27 and §9.38.
- `?lab=teletext` is the M6.4 teletext test card (40×24, 8 colours, mosaics, double height) through the same raster CRT. Keys 1–4 are Ink choices; click to unlock the payphone ring. Screenshot: `docs/screenshots/m6-4-teletext-test.png`. Contract notes in plan §9.28.
- `?lab=text` is the M3.1 text lab (Hershey simplex/duplex via BeamBatch, Px437 bitmap, 7/14-seg VFD with 6% ghosts). `&scene=all|hershey|bitmap|vfd`. Screenshot: `docs/screenshots/m3-1-text.png`. Font credits: [`docs/CREDITS.md`](docs/CREDITS.md). Contract notes in plan §9.30.
- `?lab=blackice` is the M1.8 black ICE lab (subtractive shard that eats bloom, crawling ultraviolet edges, screen-edge grip tendrils). `&scene=shard|grip`. Screenshot: `docs/screenshots/m1-8-black-ice.png`. Contract notes in plan §9.33.
- `?lab=look` is the M1.9 art-integration scene (grid, lattice, ESFA ziggurat, Mitsubishi cubes, T-A slabs, white ICE, black ICE shard, traffic, placeholder spiral arms, free-fly). `?gray=1` for grayscale. Screenshot: `docs/screenshots/m1-9-look-lab.png`. Contract notes in plan §9.34.
- `?lab=jack` is the M2.7 jack-in / jack-out lab (5.5 s full, 1.2 s short, skippable after first viewing; 0.6 s CRT collapse). `&seq=full|short`, `&scene=in|out`, `&first=1`. Screenshot: `docs/screenshots/m2-7-jack-in.png`. Contract notes in plan §9.35.
- `?lab=ice` is the M4.2 ICE model + visuals (white / gray / black shells, moiré hatch, Lissajous, 1.2 s shatter, re-key telegraph, black-ICE grip tendrils). `&scene=trio|white|gray|black|shatter|telegraph|grip`, `&gray=1`. Screenshot: `docs/screenshots/m4-2-ice.png`. Contract notes in plan §9.36.
- `?lab=hud` is the M3.2 Ono-Sendai overlay (radar, EEG, VFD strip, trace bargraph, 1200-baud terminal, PIP, reticle) composited after the vector CRT so barrel does not warp it. Screenshot: `docs/screenshots/m3-2-hud.png`. Contract notes in plan §9.37.
- `src/debug/gpuTimer.ts` is the reusable GPU timer for labs and render tasks.
- Without WebGL2 the app shows a friendly unsupported-browser page instead of the canvas.

## Layout

The folder skeleton follows plan §8.11. Empty directories hold a `.gitkeep` until their owning task lands.

Shared contracts from plan §9 are typed stubs other tasks build against:

| Contract                           | File                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Events + typed event bus           | `src/core/events.ts`                                                                                  |
| Beam lines, points, palette        | `src/render/lines/BeamBatch.ts`, `src/render/points/PointBatch.ts`, `src/render/palette.ts`           |
| ICE + Phase Lock metric            | `src/breach/{IceModel,IceVisuals,PhaseLock}.ts`, `src/content/ice/{white,gray,black,presets}.ts`      |
| Softs                              | `src/content/softs.ts`                                                                                |
| Missions (zod)                     | `src/narrative/schema.ts`                                                                             |
| Mission runner + triggers          | `src/narrative/MissionRunner.ts`, `src/narrative/triggers.ts`                                         |
| Simstim timelines                  | `src/content/simstim/types.ts`                                                                        |
| Simstim feed + renderer (M6.1)     | `src/simstim/{SimstimFeed,MollyTimeline,Gates,Pain,flip,clock}.ts`, `src/render/simstim/`             |
| Sense/Net interiors (M6.2)         | `src/content/simstim/{senseNet,senseNetScene}.ts`, `src/render/simstim/kit.ts`                        |
| Audio API + no-op engine           | `src/audio/AudioEngine.ts`                                                                            |
| Web Audio engine (M5.1)            | `src/audio/{AudioEngine,engine,buses,spatial}.ts`, `src/audio/worklets/`, `src/audio/voices/`         |
| SFX catalog, modem, Dixie (M5.2)   | `src/audio/sfx/`, `src/audio/modem.ts`, `src/audio/dixieVoice.ts`                                     |
| Adaptive music (M5.3)              | `src/audio/music/{Sequencer,Harmony,player,motifs}.ts`, `src/audio/music/patterns/`                   |
| Flight, camera, hull collision     | `src/player/{FlightController,CameraRig,Collision}.ts`                                                |
| Construct grammar (M2.1)           | `src/world/constructs/{grammar,primitives,lod}.ts`                                                    |
| Sky (spiral arms + constellations) | `src/world/sky/{SpiralArms,FarConstellations,Sky}.ts`                                                 |
| Corp heraldry + landmarks (M2.2)   | `src/content/{corps,landmarks}.ts`                                                                    |
| Sector streaming (M2.3)            | `src/world/{coords,Sector,SectorStreamer,sectorWorker,densityMap,landmarks}.ts`, `traffic/routing.ts` |
| Teletext + Ink interludes (M6.4)   | `src/meat/{Teletext,TeletextPage,Interlude}.ts`, `src/narrative/InkRuntime.ts`                        |

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
| Simstim feed, flip, gates, pain (M6.1)                                   | `src/simstim/*`, `src/app/modes/Simstim.ts`            |

The App flushes posted events after every sim step. Under `?debug` and `?lab=` (input, flight, render, persist, points, raster, vector, beam, grammar, sky, beach, grid, heraldry, sector, simstim, teletext, text, blackice, look, jack, ice, hud), the running app is exposed as `window.__nonspace`, and the debug panel shows sim ticks, steps per frame and dropped time. Contract notes are in plan §9.9–9.38. Mouse sensitivity, invert-Y and gamepad dead zone live in `settings.input`; key bindings persist separately in `localStorage` key `nonspace.bindings`.

## Render

M0.4's Renderer service owns the WebGL2 context, HDR targets and the post chain. Default boot is still a black canvas. Contract notes are in plan §9.16. M1.1 adds instanced beam lines (`createBeamBatch`, `beamLine.vert/.frag`); contract notes are in plan §9.20. M1.3 adds the infinite ground grid and local 3D lattice (`render/grid/`); contract notes are in plan §9.24.

| Piece                                          | File                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Renderer service, scenes, cameras              | `src/render/Renderer.ts`                                                                     |
| HDR 16F targets + RGBA8 fallback, ping-pong    | `src/render/targets.ts`                                                                      |
| Quality tiers from `settings.graphics.quality` | `src/render/quality.ts`                                                                      |
| Dynamic resolution                             | `src/render/dynamicRes.ts`                                                                   |
| Pass interface + chain                         | `src/render/post/pass.ts`, `PostChain.ts`                                                    |
| Phosphor persistence (M1.4)                    | `PersistencePass.ts`, `post/shaders/persistence.frag`                                        |
| Bloom + halation (M1.5)                        | `BloomPass.ts`, `post/shaders/bloomDown.frag`, `bloomUp.frag`                                |
| Vector CRT composite (M1.6)                    | `VectorCrtPass.ts`, `post/shaders/vectorCrt.frag`, `tonemap.frag`                            |
| Raster CRT / NTSC (M1.7)                       | `RasterCrtPass.ts`, `post/shaders/rasterCrt.frag`                                            |
| Black ICE mask (M1.8)                          | `BlackIceComposite.ts`, `faces/blackIce.*`, `faces/uvEdge.ts`                                |
| ICE facets + shatter (M4.2)                    | `faces/iceFacet.*`, `fx/Shatter.ts`, `breach/IceVisuals.ts`                                  |
| Tonemap blit + HUD overlay after CRT (M3.2)    | `FinalComposite.ts`                                                                          |
| HUD widgets (M3.2)                             | `hud/{Hud,Radar,EegTrace,VfdStrip,Bargraph,Terminal,Pip,Reticle}.ts`                         |
| Beam lines (M1.1)                              | `render/lines/BeamBatch.ts`, `beamLine.vert/.frag`, `render/palette.ts`                      |
| Ground grid + lattice (M1.3)                   | `render/grid/GroundGrid.ts`, `LocalLattice.ts`, `groundGrid.vert/.frag`                      |
| Text (M3.1)                                    | `render/text/{HersheyText,BitmapText,VfdText}.ts`, `vfd.vert/.frag`, `bitmapText.vert/.frag` |

- `?lab=render` — two amber cubes (HDR intensity 4 vs 0.55) through the HDR target and Reinhard tonemap. Screenshot: `docs/screenshots/m0-4-hdr-cube.png`.
- `?lab=persist` — GRID radar arm + orbiting bars through PersistencePass. Trails shift blue-white → yellow-green. Screenshot: `docs/screenshots/m1-4-phosphor-trails.png`.
- `?lab=points` — 60k static lightpoints + path-texture traffic. Screenshot: `docs/screenshots/m1-2-lightpoints.png`.
- `?lab=beach` — Neuromancer's construct (M7.10): half-res SDF raymarch, walk, Linda CSG, sun cycle, checkerboard bleed-through. Screenshot: `docs/screenshots/beach.png`.
- `?quality=low` (or `auto` / `medium` / `high`) — session override of `settings.graphics.quality` (not persisted).
- `?debug` adds a graphics folder: quality, internal size, dynres, a GPU-load slider, and inject-20 ms buttons. Persistence tunables live in the `phosphor` folder. Vector CRT toggles (barrel / jitter / flicker / vignette / glass / grain) live in the `vector CRT` folder. Black ICE strength / UV edge / grip live in the `black ice` folder.
- `?lab=beam` — eight palette cubes plus a grid, through the same HDR target and Reinhard tonemap. Screenshot: `docs/screenshots/m1-1-beams.png`.
- `?lab=grid` — infinite ground grid (8/64/1024 u, analytic AA, checker, warp) plus the 64 u local lattice. Screenshot: `docs/screenshots/m1-3-grid.png`.
- `?lab=text` — Hershey labels (world billboard + 16 px screen), Px437 ASCII, VFD 7/14-seg with 6% ghosts. Screenshot: `docs/screenshots/m3-1-text.png`.
- M1.5–M1.8 each own one pass file and should not edit sibling passes or `PostChain.ts`. Persistence notes are plan §9.17. Points notes are plan §9.18. Raster CRT notes are plan §9.19. Beam notes are plan §9.20. Grammar notes are plan §9.21. Sky notes are plan §9.22. Beach notes are plan §9.23. Grid notes are plan §9.24. Heraldry notes are plan §9.25. Sector notes are plan §9.26. Simstim notes are plan §9.27. Teletext notes are plan §9.28. Bloom notes are plan §9.29. Text notes are plan §9.30. Vector CRT notes are plan §9.32. Black ICE notes are plan §9.33. Look Lab notes are plan §9.34. Jack-in / jack-out notes are plan §9.35. ICE model/visuals notes are plan §9.36. HUD notes are plan §9.37. Sense/Net notes are plan §9.38. M1.2 must not edit `render/lines/*`.
- `?lab=hud` — M3.2 deck overlay through `targets.hud`, composited in FinalComposite after the vector CRT. Screenshot: `docs/screenshots/m3-2-hud.png`.
- `?lab=blackice` — black ICE shard in front of a hot construct: the solid is truly black (eats bloom), UV edges crawl, `?scene=grip` grows screen-edge tendrils. Screenshot: `docs/screenshots/m1-8-black-ice.png`.
- `?lab=look` — M1.9 art scene through the full vector CRT chain. Screenshot: `docs/screenshots/m1-9-look-lab.png`.
- M1.7 `RasterCrtPass` (`?lab=raster`) is the simstim/interlude CRT: NTSC YIQ chroma bleed, 240 scanlines, aperture grille, H-hold / static / tracking transition. Contract notes are in plan §9.19.
- M6.1 simstim feed (`?lab=simstim`) renders a flat-dithered 320×240 scene into `targets.simstim`, then through that raster CRT. Flip/peek/lag, gate windows, wait exposure and pain→neural echo live in `src/simstim/`. M6.2 Sense/Net interiors (`content/simstim/senseNet.ts`, procedural kit — no glTF) are the default lab walk. Contract notes are in plan §9.27 and §9.38.
- M6.4 hangs a 320×240 teletext `CanvasTexture` on `RasterCrtPass.source` with `postMode = 'interlude'`. Contract notes are in plan §9.28. `npm run build:ink` compiles `ink/*.ink` → `src/content/ink/*.json`.
- M1.5 bloom + halation (`BloomPass.ts`, 6-mip dual-filter, extra warm mip) writes `ctx.bloom` and leaves combined untouched. Tonemap lives in `VectorCrtPass` (`encoded = 'ldr'`). Wintermute radius hook: `bloomRadiusForWintermute`. Screenshot: `docs/screenshots/m1-5-bloom.png`.
- M1.6 vector CRT (`VectorCrtPass.ts`, `vectorCrt.frag`) layers barrel / jitter / flicker / vignette / glass / grain in front of that tonemap. Reduce flashing forces flicker amplitude to 0. Empty regions stay RGB (0,0,0). Screenshot: `docs/screenshots/m1-6-vector-crt.png`.

`prototypes/` holds standalone experiments with their own tooling; root lint, format and typecheck skip it.
