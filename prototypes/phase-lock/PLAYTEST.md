# Phase Lock playtest note (M4.1 go/no-go)

**Recommendation: conditional GO.** Keep Phase Lock as the core breach mechanic; don't switch to
the Facet Sequence fallback (plan §11.2). Two conditions before M4.3 content work: adopt the
metric fixes and the tuning changes below, then confirm with at least 3 human testers × 10 tries
on the deployed lab.

## What was tested

- **Who:** no human testers yet. Every number here comes from a scripted human-proxy player
  (`src/bot/HumanProxy.ts`). It only reads what's on screen, through a reaction delay. Its limits
  are figure-recognition time, which grows with lobe count; mistaking neighbouring ratios (4:5 vs
  5:6); knob slew; aim error; fine corrections triggered by visible roll; and noisy proportional
  phase tracking. There are three profiles: novice, average, and skilled. Their parameters are
  assumptions, not measurements, so they model a player who already knows the rules. Real
  first-session times will be longer.
- **How much:** 200 tries per cell, covering 4 ICE presets × 3 difficulties × 3 profiles,
  plus three variants: no ghost preview, Purist (no detents), and proposed tuning. That's 16,800
  tries in about 5 s. Each try is one layer from engage to crack, flatline, or burn, starting
  from a random knob position. The run is deterministic: `npm run playtest`.
- **Full tables:** [`playtest/results.md`](playtest/results.md), with raw data in
  `playtest/results.json`.

## Time to lock, plan §12.3 tuning (median s, p90 in brackets; crack rate)

| ICE | Story | Normal | Hard |
|---|---|---|---|
| white-1, average | 3.3 (3.9) 100% | 3.3 (4.2) 100% | 3.4 (4.3) 100% |
| gray-2, average | 4.3 (5.5) 100% | 4.4 (5.8) 100% | 4.4 (6.5) 100% |
| gray-3, average | 4.8 (6.7) 100% | 4.9 (8.3) 100% | 4.9 (12.4) 100% |
| black-1, average | 5.7 (11.2) 100% | 8.2 (14.2) 99% | 9.7 (14.3) 98.5% |
| black-1, novice | 9.8 (15.0) 93.5% | 10.7 (15.9) 78.5% | 9.9 (13.3) 67.5% |
| black-1, skilled | 4.6 (5.8) 100% | 4.8 (8.2) 100% | 7.4 (13.6) 100% |

Re-key pressure (average profile, Normal), with the same columns as the results file:

| ICE | Tries that saw a re-key | Lost ≥ 25% of the meter to a re-key | Gripped |
|---|---|---|---|
| gray-2 | 1% | 1% | — |
| gray-3 | 11% | 7% | — |
| black-1 | 78% | 43% | 30% (58 of 60 survived) |
| black-1 Hard | 100% | 48% | 75% (146 of 149 survived) |

## Findings

1. **Re-key pressure only exists on black ICE.** A practiced player cracks gray ICE in 4–5 s, but
   the first re-key comes at 6–10 s. That makes gray a solve-once puzzle: recognise the figure,
   snap to the detent, nudge the phase. It's readable, but there's no pressure.
2. **Black-1 at Normal has the pressure profile we want.** 78% of tries see a re-key, 43% lose a
   quarter or more of the meter to one, and 99% still crack. The p10–p90 spread is 4.9–14.2 s,
   which reads as tension with recovery. Skill separates players cleanly: skilled 4.8 s, average
   8.2 s, novice 10.7 s with 21% flatlines. The 50% re-key reset reads as a setback, not a wipe.
3. **Grip is too common and makes things easier.** "Failed re-key below 30% lock" fires on the
   *first* re-key, before most players can reach 30%. That's 30% of Normal and 75% of Hard tries,
   so grip stops being the rare peak moment. And because grip stops re-keys (the plan doesn't say
   either way; the prototype stops them), the 8 s countdown is easier than the fight it replaces:
   98% of average-profile grips are survived.
4. **The difficulty presets barely change gray ICE.** Detents snap R exactly onto the ratio, so the
   `tolRatio` multiplier does nothing. Purist mode barely changes the results either: the visible
   roll lets players trim the ratio well inside tolerance. The real skill axes are lock time,
   phase drift, and re-key interval.
5. **The ghost preview during telegraphs changes little for the bot** (black Hard: 98.5% vs 97.5%
   cracked). The bot's recognition time is close to the 0.6–1.2 s telegraph, so it can't use the
   preview much. Humans who anticipate might use it more. Keep it as an accessibility parity cue
   for the audio tone-slide.

## Fixes to the §3.5 math (implemented here; the scaffold's `src/breach/PhaseLock.ts` stub still uses the raw form)

- **Figure phase.** With the plan's `x = sin(a·ωt + φ)`, the picture repeats every 2π/b of φ. So
  for 4:5 there are 5 phase values that look like a perfect fusion, and only one of them counts.
  The prototype uses `x = sin(a·θ + φ/b)`, so φ ∈ [0, 2π) maps to distinct pictures.
- **Reversal fold.** A figure traced backwards is the same picture at phase (b−a)·π − φ: that's −φ
  when a and b are both odd, π − φ otherwise. The metric accepts either.
- **Roll-integrated phase.** A ratio that's off by a tiny amount builds up visible phase over time.
  If the metric ignores that, it says "locked" while the figures visibly disagree; I caught this
  in the first screenshot. The breaker's scored phase is now `Φ + roll`, where roll integrates
  `−2π·a·(R·a − b)·scopeHz`. The metric scores what the player sees, and a near-miss ratio creeps
  like drift. The tests check this roll rate against the drawn figure.

## Proposed tuning (press `T` in the lab; `getIce(id, 'proposed')`)

- gray-2: lockTime 3.5, re-key every 5–7 s. gray-3: lockTime 3.5, re-key every 4.5–6.5 s.
- black-1: a failed re-key only grips after 7 s engaged; re-keys still stop during grip.
- Difficulty also scales drift (Story ×0.7, Hard ×1.2) and lock time (Story ×0.85).

Results (average profile): gray-3 Normal goes to 8.3 s median (15.0 p90), 66% see a re-key, 48%
lose a quarter of the meter to one, and 100% crack. gray-3 Hard is 11.6 s (28.2 p90) with 95.5%
cracked. Black-1 Normal: 8.3 s, 100% cracked, gripped 17.5%. Black-1 Hard: 11.8 s, 98% cracked,
gripped 64%, which is still high; grip needs another design pass. Novices on gray-3 Hard drop to
53% cracked, which is fine for Hard. Skilled players stay at 4.2–7.2 s on gray.

## Honest read on fun under re-key pressure

I can't feel fun, so this is a read from watching auto-play at 60 fps and from the distributions:

- **What works:** the scope figure carries the mechanic. Roll, then freeze, then fuse is a clear
  three-step progression, and you can see the next step coming. The frozen moment is satisfying,
  and the beating on the right channel tells you the same thing by ear. The REKEY flicker,
  double-beep, and countdown bar are easy to read, and the shatter gives a real payoff. Black ICE
  re-keys create a believable "hold it, hold it, lose half, get it back" rhythm.
- **What worries me:** once the figure is recognised and the detent clicks, the job is continuous
  phase tracking. Whether that stays fun over 3–5 layers per run, across a campaign, can only be
  answered by humans. With plan tuning, gray ICE is too quick to create any pressure. And
  recognising a high-lobe figure (4:5 vs 5:6) is a pass/fail moment the bot treats as a coin
  flip. People may find it either a great "read the ICE" skill or an annoying guess.
- **Kill criterion for the human test:** fall back to Facet Sequence if, with proposed tuning,
  human medians on gray-3 Normal stay above about 20 s, if testers can't tell 4:5 from 5:6 after
  10 tries, or if testers describe phase tracking as a chore rather than a hold.
