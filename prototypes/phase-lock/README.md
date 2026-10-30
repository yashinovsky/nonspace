# Phase Lock lab (M4.1)

Standalone 2D prototype of the NONSPACE breach mechanic (plan §3.5): match your amber breaker
Lissajous to the ICE's figure, hold the lock through telegraphed re-keys, crack the layer.
Self-contained: its own `package.json`, no dependency on the main game in `src/`.

**Play:** https://yashinovsky.github.io/nonspace/prototypes/phase-lock/ (published by
`.github/workflows/phase-lock.yml` on pushes to `main`, once Settings → Pages → Source is set to
"GitHub Actions"), or locally:

```bash
cd prototypes/phase-lock
npm install
npm run dev        # http://localhost:5174
```

## Controls

| Input | Action |
|---|---|
| Click / Space | Engage (click also grabs the pointer; Esc releases it) |
| Mouse X, ← → | Ratio knob R (log scale 0.25–4, soft detents at simple ratios) |
| Mouse Y, ↑ ↓ | Phase knob Φ (wraps) |
| Shift | Fine adjust |
| 1 2 3 4 | ICE preset: white-1, gray-2, gray-3, black-1 |
| Z X C | Difficulty: Story, Normal, Hard |
| T | Tuning: plan §12.3 values vs. the playtest proposal ("TUNED") |
| B | Auto-play with the scripted player |
| G | Ghost preview of the incoming figure during a re-key telegraph |
| P | Purist (no detents) |
| F | Calm: replaces flicker with a slow pulse |
| M | Mute |
| Delete | Clear the recorded tries |

How to read it: an off ratio makes your figure **roll** (faster the further off, like a real scope)
and the right channel **beats**. At the right ratio it freezes; turn the phase until the two figures
**fuse** into one brighter figure. The SYNC bar shows the match, with marks at 0.85 (lock fills)
and 0.3 (dissonance damage). Your time-to-lock per preset is kept in `localStorage` (YOU/AUTO lines).

URL parameters: `?ice=black-1&diff=hard&tuning=proposed&bot=1&ghost=0&purist=1&calm=1&seed=42&skipTitle=1`.

## Code

| Path | What | Destination in the game |
|---|---|---|
| `src/breach/PhaseLock.ts` | Pure math: match metric, lock meter, re-key reset, roll, figures, detents | `src/breach/PhaseLock.ts` |
| `src/breach/LayerSim.ts` | Seeded layer engagement: drift, telegraphed re-keys, trace, neural, grip | splits into `breach/IceModel.ts` + `BreachController`/`Grip` |
| `src/breach/presets.ts` | Plan §12.3 ICE presets and difficulty multipliers, plus the proposed tuning | `content/ice/*.ts` |
| `src/bot/` | Scripted human-proxy player for self-tests and auto-play | `src/testing/` |
| `src/lab/` | Canvas2D vector-phosphor renderer, 14-segment VFD text, Web Audio tones | throwaway |

```bash
npm test           # Vitest unit tests
npm run playtest   # scripted self-test → playtest/results.{md,json}
npm run build      # typecheck + static build in dist/
```

Results and the go/no-go read are in [PLAYTEST.md](PLAYTEST.md).
