---
cursor:
  subagentId: "bc-22977e75-6f0b-5b3d-a497-5cb98e6781dd"
---

# NONSPACE — Design & Implementation Plan

*A 3D WebGL browser game set in the cyberspace of William Gibson's* Neuromancer *(1984).*
*Working title: **NONSPACE**, from the book's "nonspace of the mind."*

This document is the single source of truth for the agents building the game. Sections 1–7 define **what** to build and why. Sections 8–9 define **how** to build it. Section 10 is the **ordered, parallelizable task list**. Section 11 covers open questions and risks.

Conventions: **MUST** means required for acceptance; **SHOULD** means default unless a task says otherwise; numbers are starting values to tune, not dogma.

---

## Table of contents

1. Core concept and player fantasy
2. Design pillars, non-goals, anti-references
3. Gameplay: loops, runs, mechanics
4. Narrative and mission structure
5. Art direction
6. HUD and deck interface
7. Audio direction
8. Technical architecture
9. Data schemas and module contracts
10. Milestones and tasks
11. Open questions and risks
12. Appendix: glossary, reference list, tuning tables

---

## 1. Core concept and player fantasy

### 1.1 One-line pitch

You are a console cowboy jacked into the matrix of 1984's imagination. It is an endless transparent chessboard of light where corporations are glowing geometry and ICE can stop your heart. You fly through it, crack the ICE by tuning yourself to it, and ride a partner's senses through the physical world while the clock runs.

### 1.2 The fantasy, stated plainly

- **Bodiless exultation.** Case's tragedy is that he lives for the matrix and despises "the meat." The matrix MUST feel better than reality. It should be fast, vast, clean, beautiful and silent except for its own music. The first jack-in is the emotional thesis of the game.
- **Expertise, not violence.** A cowboy is a burglar and a technician. He doesn't shoot. He reads systems and gets inside them. The player's skill expression is perception, timing and nerve.
- **Mortal danger in an abstract place.** Black ICE kills the body through the mind. Flatlining is death. The prettiest thing in the game is also the thing most likely to kill you.
- **Two bodies, one clock.** Through simstim the player "flips" into Molly's sensorium. She is in a real building, in real danger, and she depends on what you do in the matrix. Your attention is the scarcest resource in the game.
- **Larger minds.** Wintermute and Neuromancer are not bosses. They are weather, gods and manipulators. You are being used. The game should make the player feel this slowly.

### 1.3 Why it's grounded in the book, not in later cyberpunk

The book gives us its own justification. Its in-world history says the matrix has roots in "primitive arcade games," in early graphics programs and in military experiments with cranial jacks. So the matrix of 1984 **literally looks like the arcade and graphics hardware of 1984**, taken to infinite resolution. That is the whole art thesis (Section 5).

### 1.4 Player character

The default is that the player **is Case**, following the book's arc in heavily condensed, interactive form. See Section 11 for the IP alternative of an original cowboy in the same world. The structure is built so that swapping the protagonist only changes content files, not systems.

---

## 2. Design pillars, non-goals, anti-references

### 2.1 Pillars (use these to break ties)

1. **Light is information.** Everything that glows is data. Nothing in the matrix is *lit*; everything *emits*.
2. **Every layer of reality is a different 1984 screen.** Matrix, simstim, meatspace and Neuromancer's construct are each rendered as a distinct display technology of the period (Section 5.2).
3. **No guns. You don't fight ICE, you persuade it.** Breaching is tuning, mimicry and timing.
4. **Attention is the resource.** The matrix, Molly's body and the AIs all compete for the player's eyes and ears.
5. **Rule-breaks signal power.** The visual and audio rules are strict so that when an AI or a military icebreaker breaks them, it is felt immediately.

### 2.2 Non-goals

- No open-world city, no walking around the Sprawl in 3D, no third-person avatar in the matrix.
- No combat system, no loot rarity tiers, no skill trees, no crafting.
- No multiplayer.
- No mobile/touch at launch (keyboard + mouse first, gamepad second).
- No photoreal rendering except where the fiction demands it, and even then it is *1984's* idea of photoreal (Section 5.8).

### 2.3 Anti-references (MUST avoid)

Agents should reject any design or asset that drifts toward these. They are later decades' ideas of cyberpunk, not 1984's.

| Avoid | Why |
|---|---|
| Cyberpunk 2077: neon rain streets, holographic ad clutter, "breach protocol" hex-code grid puzzle, quickhack menus, braindance, chrome-and-magenta UI | User directive; also a 2020 aesthetic |
| Synthwave/outrun: magenta-to-orange sunset gradients, chrome sun with slits, palm trees, glowing horizon line | That's a 2010s pastiche of the 80s, not the 80s |
| "Digital rain" of green glyphs (The Matrix, 1999) | 1999, and it's an icon of another work |
| Glitch art / datamosh / chromatic-aberration-on-everything | 2000s–2010s digital-artifact aesthetics |
| Holographic blue translucent UI panels with hexagons | Generic 2000s sci-fi |
| Shadowrun vocabulary ("dumpshock", "decker", "persona icon", "host") | Different IP; use the book's words |
| Tron's literal costumes, lightcycles, cyan/orange faction coding | Tron is a *technique* reference (Section 5.10), not a style to copy |

---

## 3. Gameplay

### 3.1 The three loops

| Loop | Timescale | Player activity |
|---|---|---|
| **Micro** | 1–10 s | Steer through the lattice, hold a phase lock, dodge a re-key, flip to Molly and back |
| **Run** | 6–20 min | Jack in, transit, approach, breach, take the data, get out (Section 3.2) |
| **Campaign** | 2.5–4 h | Book-inspired missions with interludes, a growing set of softs (programs), Dixie's arc, scars from flatlines, endings |

### 3.2 Run structure (the template every mission uses)

```
[Deck boot] → JACK IN → TRANSIT → APPROACH → BREACH (n layers) → CORE → EXFIL → JACK OUT → [Debrief]
                 │            ↑         ↑           ↑               ↑
                 └──── simstim flips and AI events can interrupt any phase ────┘
```

1. **Jack in.** A scripted 4–6 s sequence that is skippable after the first time (Section 5.9). The trodes go on, there's darkness, silver phosphenes, then the grid "unfolds" like origami and extends to infinity.
2. **Transit.** You fly the matrix to the target's coordinates. Long distances use the **coordinate jump** ("flip"). You type coordinates on the deck and the view streaks across thousands of sectors (Section 3.4). The transit phase is calm by design, but sysop sweeps and Turing watchers can raise trace.
3. **Approach.** The target construct grows from a lightpoint to a silhouette to full geometry. **Scan** (`F`) reveals its ICE shells, their class and the layer count, drawn as vector labels on the construct.
4. **Breach.** Crack each ICE layer with **Phase Lock** (Section 3.5) while managing **trace** and **neural load** (Section 3.6). Softs modify the puzzle.
5. **Core.** You enter the data interior, a vertical "cathedral" of translucent strata and record-constellations. Find the target constellation and hold **Download** (`E`). Download sounds like a 300-baud modem (Section 7.4). Trace accrues faster inside.
6. **Exfil.** Pick one of two exits:
   - **Jack out now** (hold `J` for 1 s). It's instant. If trace is above 50%, the run leaves **heat** that makes later missions harder.
   - **Route out** through your breach hole. It takes 20–40 s of flying while cracked layers slowly re-freeze, and it scrubs trace by 30%.
7. **Jack out.** A CRT power-off collapse: the image squashes to a line, then a dot, then black. The debrief is a teletext page (Section 5.7).

### 3.3 Navigation and flight

The matrix is a **transparent 3D chessboard**. There is a ground grid plane and a local 3D lattice that reveals itself around the player. Vertical axis rule: **altitude is privilege** (see Section 8.6).

**Flight model (`FlightController`):**

| Param | Value |
|---|---|
| Cruise max speed | 80 u/s (1 unit ≈ 1 m notional) |
| Boost max speed (`Shift`) | 600 u/s |
| Acceleration | 120 u/s² cruise, 900 u/s² boost |
| Drag | Exponential, half-life 0.6 s when no thrust |
| Turn | Mouse-look yaw/pitch, pitch clamp ±85°, no roll input |
| Banking | Visual-only roll up to 6° on yaw rate (toggleable) |
| Auto-level | Roll returns to 0 with half-life 0.3 s |
| FOV | 75° base, up to +12° with speed (toggleable) |

- **Grid assist** (on by default, toggleable). When flying within 15° of a grid axis, heading gently snaps to that axis, at a rate of 30°/s. This gives the "lanes of light" feeling and makes navigation readable. Inspiration: Battlezone and Tempest lane logic.
- **Soft collision.** Constructs have bounding volumes. You cannot enter one without breaching. Within 20 u of a hull you're pushed out with a spring force and the hull flares. Contact with an ICE hull adds trace.
- **Altitude ceiling.** Above 12,000 u controls get sluggish and you're pushed down gently. The military spiral arms are "forever beyond reach" (Section 5.6).

### 3.4 Coordinate jump ("the flip")

- Open the deck (`Tab`) and type coordinates on the real keyboard, for example `BAMA 0412.77 / 1180.03 / 0250`. Known coordinates come from contacts and missions, and are stored in the deck's **address book** for selection.
- Execute with `Enter`. The deck closes and the camera aligns to the target bearing over 0.4 s. A **streak** then runs for 1.5–3 s: grid lines stretch into longitudinal streaks, persistence trails lengthen, the FOV widens and pitch rises (Section 7.3). You arrive 300 u from the target, at rest.
- Jumping is disallowed while gripped by black ICE or inside a construct. It's also disallowed when trace is at 100%.

### 3.5 Breaching ICE: **Phase Lock** (the core mechanic)

**Fiction.** ICE (intrusion countermeasures electronics) is a living wall. Icebreakers don't smash it. They *mimic* it until it accepts them, which is how the book's Kuang is described: a slow virus that gets the ICE to treat it as its own. So breaching is **becoming the ICE's signal**.

**Period grounding.** Oscilloscope Lissajous figures, the purest image of 1950s–80s electronic graphics. See Ben Laposky's *Oscillons* (1950s) and the vector displays of Section 5.

**Rules:**

- Each ICE **layer** has a signature: an integer frequency ratio `a:b` from a set such as {1:1, 1:2, 2:3, 3:4, 3:5, 4:5, 5:6}, plus a phase `φ` that drifts over time.
- The facet of the layer facing the player shows the **target Lissajous** `x = sin(a·θ + φ/b)`, `y = sin(b·θ)` with `θ = 2π·scopeHz·t` (scopeHz = 1), drawn as beam lines on the facet in the ICE's color. `φ` is a **figure phase**: an integer Lissajous repeats whenever its x phase moves by 2π/b, so dividing by b makes every φ in 0–2π a different picture. With the original `x = sin(a·ωt + φ)`, a 4:5 layer showed five phases that looked like a perfect fusion, and only one of them scored.
- The player's breaker draws a second Lissajous in **warm white**, overlaid on the target. It's controlled by two knobs:
  - **Ratio knob R**: mouse X or left stick. It's continuous on a log scale from 0.25 to 4.0, with soft detents at simple ratios that the player can feel as a slight stickiness. `Shift` gives fine adjust.
  - **Phase knob Φ**: mouse Y or right stick, wrapping around 0–2π.
- **Visual feedback is physical.** When R is close to `b/a` but not exact, the player's figure *rolls* at a rate proportional to the frequency difference, exactly like a real scope. When R matches, the figure freezes. When the phase matches too, the two figures fuse into one brighter figure, because additive light doubles.
- **Breaker figure and observed phase.** The breaker's x oscillator rides the ICE carrier, and R sets the y/x ratio: `x = sin(a·θ + Φobs/b)`, with y running at `R·a` (locally `y = sin(b·θnow + R·a·(θ − θnow))`). The roll is integrated as `roll += −2π·a·(R·a − b)·scopeHz·dt`. The **observed phase** is `Φobs = Φ + roll`. The metric scores `Φobs`, not the knob, so it always scores what the player sees: a near-miss ratio makes the figure creep like drift, and the player has to correct it.
- **Audio feedback is physical.** The target tones play at `a·f0` (left) and `b·f0` (right), with `f0` between 110 and 220 Hz in the mission key. The breaker's tones play similarly. A mismatch produces audible **beating**, and a match produces consonance: 3:2 is a fifth, 4:3 a fourth. Visual feedback alone MUST be sufficient for deaf and hard-of-hearing players.
- **Match metric:**
  ```
  ratioErr = |ln(R) - ln(b/a)|
  mR = exp(-(ratioErr / tolRatio)^2)
  φ' = (b - a)·π - φ                // time-reversed twin: the identical picture
  Δ  = whichever of wrap(Φobs - φ), wrap(Φobs - φ') is smaller in magnitude   // wrap to (-π, π]
  mP = (0.5 + 0.5*cos(Δ))^4
  m  = mR * mP                      // 0..1
  ```
  A figure traced backwards (θ → c − θ) draws the same point set at `φ'`: that's `−φ` when a and b are both odd, and `π − φ` otherwise. A static scope picture can't tell the two apart, so both count as a match. As a result, mP bottoms out at 1/16, at 90° from both twins. The match is still well below the 0.3 dissonance threshold whenever the ratio is off. While `m ≥ 0.85` the lock meter fills at `1/lockTime` per second. Below that it drains at half that rate. A full meter cracks the layer. *(Corrected after the M4.1 prototype; reference implementation and tests: `src/breach/PhaseLock.ts`, `tests/unit/phaseLock.test.ts`.)*
- **Re-key.** At intervals the ICE changes its ratio and/or jumps its phase. It's always **telegraphed** 0.8–1.2 s ahead: the facet flickers at low amplitude, the ICE tone slides, and the HUD shows "REKEY". A re-key resets the lock meter to 50% if you were above 50%; otherwise it resets to 0.
- **Dissonance damage.** While engaged and `m < 0.3`, neural load rises at `feedbackDps` (white ICE: 0; gray: low; black: high).
- **Trace.** Engagement adds trace at `traceRate` per second, whatever `m` is. Speed matters.
- **Cracking.** The layer **shatters**. Its lines detach and fall away with persistence trails, and the tone resolves to a chord. The next layer's facet rotates into view.

**ICE classes:**

| Class | Look | Behavior |
|---|---|---|
| **White ICE** | Pale cyan-white, moiré hatching on facets, no hidden-line removal | Slow drift, no re-key or a rare one, no damage, trace only |
| **Gray ICE** | Denser hatching, counter-rotating nested shells | Re-keys every 6–10 s, low feedback |
| **Black ICE** | **Subtractive.** Black solids that occlude the grid, with a thin crawling ultraviolet edge (Section 5.5) | Fast re-keys, high feedback, **Grip** (below) |
| **T-A ICE** | Emerald, colossal, layered like geological strata, grows toward you | Unique; only Kuang can breach it (Section 4) |

**Grip (black ICE only).** If neural load passes 60% during black ICE engagement, or if you fail a re-key while below 30% lock, the ICE **grips**. Subtractive tendrils creep in from the screen edges, jack-out is disabled ("the deck won't let go"), and you get 8 seconds to reach a full lock, or you flatline. This is the game's highest-tension moment and MUST be readable: there's a countdown on the VFD and the EEG trace goes ragged.

**Softs (programs).** You slot up to 4 of them; they're data-driven (Section 9.4).

| Soft | Effect | Use limit |
|---|---|---|
| `PROBE` | Shows the target ratio as a numeral on the facet for 3 s | 3 charges per run |
| `CLAMP` | Freezes phase drift and delays the next re-key by 5 s | 15 s cooldown |
| `DAMPER` | Cuts dissonance feedback by 70% for 10 s | 30 s cooldown |
| `DECOY` | Drops a lightpoint that sysop sweeps and Turing watchers chase; trace gain ×0.5 for 8 s | 2 charges |
| `MIMIC` (a slow virus) | Auto-converges R and Φ toward the target at 0.15/s; you can let it work or help it | 1 per layer, unlocked in Act II |
| `KUANG GRADE MARK ELEVEN` | Story-only Chinese military icebreaker (Section 4.4) | Kuang run |

**Dixie's read.** Once the Flatline construct is aboard (Act II), `H` asks Dixie to read the ICE. After 4 s he speaks the ratio ("that's a three-two, kid"). It costs no charge but has a 20 s cooldown. He's also the in-fiction tutorial voice.

**Difficulty settings** scale `tolRatio`, re-key interval, telegraph time and feedback (Section 12.3). There's also an **Assist** mode, where MIMIC is always available, and a **Purist** mode, with no ratio detents.

> **Prototype gate.** Phase Lock is the riskiest mechanic. Task M4.1 builds it as a standalone 2D page first. If playtests say it isn't fun under pressure, fall back to the alternative in Section 11.2 before building more breach content.

### 3.6 Consequence systems

| Variable | Range | Rises from | Falls from | At max |
|---|---|---|---|---|
| **Neural load** | 0–100 | Dissonance during breach, black ICE contact, Neuromancer pull, Molly's pain feedback in simstim (small) | Regenerates 4/s when not engaged, after a 3 s delay | **Flatline** |
| **Trace** | 0–100% | ICE engagement, hull contact, sysop sweep exposure, Turing watchers, time inside a core | `DECOY`, routing out, some story events | **Burned**: the deck forces a jack-out; objective failed unless already downloaded |
| **Heat** (campaign) | 0–3 | Ending a run with trace > 50%, or getting burned | Lying low (skipping an optional contract), story events | Later missions get +15% re-key speed per heat level and more watchers |
| **Scars** (campaign) | count | Each flatline | Black clinic visit in an interlude (story-gated) | Each scar reduces max neural load by 5 and adds a permanent faint artifact to the EEG trace |

**Flatline.** The EEG trace goes perfectly flat and a continuous monitor tone plays. The image collapses to a single CRT dot that lingers for 2 s with the tone. Then there's silence and a black screen with only a dim, flat green line. The player retries from the last jack-in checkpoint with a scar added. Story flatlines (the Berne recon and the Kuang run) are scripted and don't add scars. The deck keeps a tally of flatlines as hash marks. Dixie, who flatlined three times in life, comments on yours.

### 3.7 Simstim (flipping to Molly)

**Fiction.** Case's deck has a simstim switch. Flipping puts him inside Molly's sensorium: he sees and feels what she does, with no control. She talks aloud knowing he may be riding along.

**Mechanic:**

- `T` toggles the flip; holding `T` peeks and releasing returns. A picture-in-picture CRT thumbnail of her feed sits in the HUD corner whenever a simstim link is live (Section 6).
- **The matrix keeps running while you're flipped.** The lock meter decays, re-keys still happen, black ICE can still grip you, and trace still climbs. In transit, the deck parks you, holding your position with velocity zeroed.
- **Flip-back lag.** When you return, the image takes 0.4 s to re-settle and the controls stay soft (horizontal-hold roll plus a little static).
- **Sync gates.** Mission scripts define **gate windows**: Molly reaches door/lock/elevator G at meat time `tG`. Its ICE (a node in the matrix) must be cracked inside the window `[tG − early, tG + late]`.
  - **Too early**: the open door gets noticed. Alert rises and Molly meets more resistance on her timeline.
  - **Too late**: Molly waits exposed. Her "exposure" accumulates; at the threshold she takes damage or the gate fails and the mission branches or fails.
  - **The only reliable source for `tG` is Molly's own feed**: her chip clock (red digits in the lower-left of her vision) and what she says. That forces flips, which is the core tension.
- **Pain transfer.** When Molly is hurt (her leg breaks in Straylight), the flipped view gets a red-shifted vignette, a tinnitus tone and a slowed frame rate. Flipping back carries a brief echo into the matrix: the EEG spikes and neural load rises a little.
- **Pings.** On the deck you can send Molly 1-word **pings** (`GO`, `WAIT`, `ABORT`) that appear in her chip display. This is design license, not in the book (see Section 11). She may comply, argue or ignore them, depending on the script.

### 3.8 AI encounters

AIs are never fought. They're scripted presences with **distinct rule-breaking signatures**.

**Wintermute** (the Berne AI) wants to get out from under its own restraints. It's manipulative, helpful and cold.

| Behavior | Implementation |
|---|---|
| **HUD hijack** | The VFD segments re-segment into its words. The terminal line types its messages at an impossible speed (instant, not at baud rate) |
| **Overexposure** | The global palette washes toward white, bloom radius ×2, and the beam palette "saturates" |
| **Freeze** | All ICE stops: drift and re-keys halt, persistence trails hang in the air |
| **Grid bend** | The ground grid warps into a guiding corridor (a warp field in the grid shader) |
| **Persona** | It appears as a vector line-portrait of someone Case knows (e.g., the Finn), drawn in white, its lines wobbling like an unstable Lissajous |
| **Ringing phones** | In meatspace interludes, payphones ring as Case passes. Teletext pages show the ringing, and the audio follows |
| **The bargain** | Some runs offer "Wintermute opens the door": skip a layer at once, at a hidden **debt** that changes the epilogue's text |

**Neuromancer** (the Rio AI) is personality and memory. It wants to keep you.

| Behavior | Implementation |
|---|---|
| **Softening** | Straight lines bend into curves (segment subdivision plus a vertex bend), warm colors leak into the palette, the music sinks into reverb |
| **Pull** | Flight drifts toward an invisible point and jack-out is disabled |
| **The beach** | A forced transition into the construct (Section 4.4, Mission 7; art in Section 5.8) |

### 3.9 Controls (default bindings, all remappable)

| Action | KB/M | Gamepad |
|---|---|---|
| Look | Mouse (pointer lock) | Right stick |
| Thrust / brake | W / S | RT / LT |
| Strafe | A / D | Left stick X |
| Rise / fall | Space / Ctrl | RB / LB |
| Boost | Shift (hold) | Left stick click |
| Scan | F | Y |
| Engage ICE (when facing a facet within 60 u) | Left mouse | A |
| Phase Lock knobs | Mouse X / Y | Left stick / right stick |
| Fine adjust | Shift | Hold LB |
| Softs 1–4 | 1–4 | D-pad |
| Ask Dixie | H | X |
| Download | E (hold) | A (hold) |
| Simstim flip | T (tap toggle / hold peek) | B |
| Deck panel (coordinates, softs, log, pings) | Tab | Back/View |
| Jack out | J (hold 1 s) | Start (hold 1 s) |
| Pause / settings | Esc | Menu |

---

## 4. Narrative and mission structure

### 4.1 Approach

- Follow the **book's spine** in five acts named after the book's parts. Each act compresses its part into 1–2 playable runs plus short interludes.
- Meatspace is told through **teletext/videotex pages** (Section 5.7) and **simstim**. The game never puts the player's body in a 3D street.
- Dialogue is written in **Ink** (inkle's narrative scripting language; runtime: inkjs). Keep lines short. Don't paste long passages from the novel: quote short phrases only and paraphrase everything else.
- **Fidelity note.** The plot beats below are paraphrased from memory of the novel. The narrative-content task (M7.0) MUST verify names, order of events and details against the text before writing final lines, and must flag anything invented. Design licenses (pings, the Wintermute debt, contract runs) are labeled.

### 4.2 Cast and their in-game functions

| Character | Function |
|---|---|
| **Case** | Player. A crippled cowboy, repaired at the start |
| **Molly** | Simstim partner. Razorgirl with mirrored lenses and a chip clock in her vision; the meat-side half of every major run |
| **Armitage** | Mission giver in Acts I–III; his fracture (Corto) surfaces in interludes |
| **Dixie Flatline** (McCoy Pauley's ROM construct) | Companion voice in the deck from Act II: hints, banter, the "erase me" arc |
| **The Finn** | Fence; one of Wintermute's personas |
| **Panther Moderns** (Lupus Yonderboy) | Engineered chaos during the Sense/Net run |
| **Wintermute / Neuromancer** | AI presences (Section 3.8) |
| **3Jane, Riviera, Hideo, Maelcum** | Appear via simstim (Straylight) and interludes; Maelcum's dub bass is the audio thread out of the beach |
| **Linda Lee** | Appears in Neuromancer's construct only |

### 4.3 Campaign flow

```
ACT I   Chiba City Blues          P0 Prologue (teletext) → M1 "Distanceless Home" (tutorial run)
ACT II  The Shopping Expedition   M2 "Sense/Net" (first simstim sync run) → M3 "The Construct" (Dixie + Berne recon)
ACT III Midnight in the Rue Jules Verne   Interludes (Istanbul, Freeside) → M4 "Turing" (stealth/trace run, optional-difficulty)
ACT IV  The Straylight Run        M5 "Kuang Grade Mark Eleven" → M6 "The Beach" → M7 "True Name"
ACT V   Coda: Departure and Arrival   Epilogue (teletext + final optional jack-in)
```

### 4.4 Missions (each is a content task in Section 10)

**P0 — Prologue: Night City** (teletext, ~4 min)
- Beats: Case washed up in Chiba; Molly finds him; Armitage's offer; surgery on his nervous system to restore it (and the toxin sacs, as narrative leverage).
- The opening line about the port's sky appears as a short phrase on the first teletext page, as a channel-ident image. Then it cuts to deck boot.
- Systems: Ink dialogue, teletext renderer, deck boot sequence.

**M1 — "Distanceless Home"** (tutorial run, ~8 min)
- Case's first jack-in in years. Show the full jack-in sequence, then a long beat of free flight with **no objective marker** for 20 s. Let the player look.
- The objective is a minor Chiba black-clinic records node with 1 layer of white ICE.
- It teaches flight, grid assist, scan, a coordinate jump (into the Chiba cluster), Phase Lock (with on-facet prompts), download and jack out.
- Fail states: none fatal. Trace can burn you, which ends in a retry.

**M2 — "Sense/Net"** (first sync run, ~12 min)
- Molly physically enters Sense/Net to steal the Flatline's ROM construct. The Panther Moderns stage a panic for cover. Case runs cover in the matrix.
- Introduces simstim flips, gate windows (3 gates) and gray ICE.
- The **Moderns' panic** is a scripted event at meat time `t = 4:00`. While it lasts (90 s), Sense/Net's ICE re-key rate halves. Planning around it is the skill.
- Win: Molly exits with the construct. Fail: Molly's exposure hits the threshold or Case flatlines.

**M3 — "The Construct"** (~12 min)
- Dixie comes aboard. His intro is a short exchange in which he's not sure he's real, and there's his laugh (Section 7.5).
- Part A: Dixie teaches the advanced techniques (`H` reads, `MIMIC`) on a mid-tier Hosaka node.
- Part B: **Berne recon.** You fly to the T-A Berne cluster to look at Wintermute's ICE from outside. A tendril reaches out, and a **scripted flatline** follows (no scar). Dixie talks you back. Then the first **Wintermute contact**, a HUD hijack with a short message.
- *Loosely inspired; verify against the book in M7.0.*

**Interludes (Act III)**: Istanbul and Freeside as teletext pages. Riviera can be glimpsed through a short simstim-only scene (optional, stretch). Wintermute's ringing phones. Turing Registry agents appear.

**M4 — "Turing"** (~10 min, a variant run)
- The Turing Registry is closing in. A **stealth/trace** run: reach a data drop through a field of Turing watchers and their rotating sweep beams, then wipe a record. It's light on breaching and heavy on DECOY and flight.
- If heat ≥ 2 it's harder. Wintermute intervenes in meat on the teletext page, matching the book's tone.
- It can be shortened on Easy.

**M5 — "Kuang Grade Mark Eleven"** (the set piece, ~20 min)
- **Phase A — Ascent.** Climb into the high orbital tier to the Tessier-Ashpool cluster, with its emerald rectangles in aristocratic symmetry. Straylight's core is colossal.
- **Phase B — Deploy Kuang.** Kuang materializes: a long sinuous polychrome body built from iridescent rib rings along a spline, the **only continuous-spectrum color in the game**. It "mimics": its colors gradually match the T-A ICE's emerald.
- **Phase C — The dive.** A tube flight through the ICE throat, as homage to Tempest's tube. The camera is fixed forward at constant speed. The player moves around the rim of a polygonal tube (8–16 lanes) to avoid T-A countermeasures crawling up the lanes. Kuang's body coils around the tube. There are 3 segments, each ending in a **gate**: a fast Phase Lock where Kuang's mimicry makes the tolerance generous.
- **Phase D — Straylight (interleaved simstim).** Molly is inside the villa. Gates sync with her, her leg breaks (pain transfer) and 3Jane appears. Wintermute interjects.
- **Phase E — Interception.** Neuromancer softens the world, pulls you in and disables jack-out. A forced flatline ends the mission and leads to M6.

**M6 — "The Beach"** (~8 min, unique mode)
- There's no deck, no HUD and no flight. This is the **only walking mode** in the game: first person at walking speed with simple collision on an SDF terrain.
- Neuromancer's construct is a beach at night/dawn, with a concrete shelter, Linda Lee and the boy. Time slides oddly; the sun cycles fast. It's rendered in 1984 "photoreal" CG (Section 5.8) and the **chessboard shows through the sand** when you look too closely.
- The exit is found by **sound**: a faint dub bassline (Maelcum's music from the real world) bleeding in. You follow it to the edge.
- **Choice.** Walk out (continue to M7), or **stay**: sit with Linda through one more sunset, which triggers Ending B.

**M7 — "True Name"** (finale, ~12 min)
- Back in, at the core with Kuang. Molly confronts 3Jane on the meat side. You must watch and listen to the simstim feed to learn **the word** (shown in subtitles as it's spoken). Then open the deck and **type it** within the window. It's the one diegetic typing climax.
- **The merge.** The palette rules break globally. Green rectangles fold, the grid reorganizes and Wintermute and Neuromancer become one. Five scripted minutes of the most ambitious visuals in the game.
- Dixie's request to be erased comes due here: a deck prompt, `ERASE CONSTRUCT? Y/N`. The choice is reflected in the epilogue.

**Epilogue (Act V)**: Teletext pages. Then an optional final jack-in: the matrix, changed. Far off there are distant figures and a laugh on the audio. Keep it ambiguous.

**Endings:**
- **A (canonical):** the merge completes.
- **B (stay):** you remain on the beach. Credits roll in the raytraced style over a looping sunset.
- **Failure:** in M7, if the word isn't entered in time, the ICE re-freezes; retry from checkpoint.

### 4.5 Post-launch / stretch: Contracts

Procedural side runs offered by fences between acts. They use the same systems, with targets drawn from procedural constructs. Rewards are softs and scar healing. Not in the vertical slice.

---

## 5. Art direction

### 5.1 Thesis

> **The matrix is the arcade and graphics hardware of 1984 at infinite resolution.**

In 1984, "computer graphics" in the popular imagination was a **beam of electrons drawing glowing lines on black glass**: Asteroids, Battlezone, Tempest, Star Wars arcade, the Vectrex. It was also Evans & Sutherland night-flight simulators made of points of light, and Tron. Gibson's own description is lines of light in the dark, clusters and constellations "like city lights, receding". That is a vector display. We commit to it completely, then push it with modern GPU power to *infinite* line counts, physically modeled phosphor and HDR glow, so it feels like a 1984 dream rather than a museum emulation.

### 5.2 Four screens of 1984 (the master rule)

Each layer of reality is rendered as a different display technology of the period. This makes every transition legible and thematic.

| Reality layer | Display technology | Rendering style |
|---|---|---|
| **The matrix** | Calligraphic color vector monitor (Atari Color-XY / Wells-Gardner 6100, E&S calligraphic) | Beam lines and lightpoints, phosphor persistence, true blacks, bloom |
| **Simstim (Molly)** | Broadcast NTSC raster TV (Trinitron era) | Flat-shaded low-poly scenes, ordered dither, interlace, scanlines, chroma bleed |
| **Meatspace (interludes)** | Videotex/teletext (Ceefax, Prestel, Minitel; Japan's CAPTAIN for Chiba pages) | 40×24 character pages, 8 colors, 2×3 mosaic graphics |
| **Neuromancer's construct** | Frame-rendered film CG (Whitted raytracing 1980, Lucasfilm 1983) | Raymarched "perfect" CG: hard shadows, mirror spheres, procedural noise textures, the checkerboard |

And on top, **rule-breakers**: Kuang (continuous spectrum), Wintermute (overexposure past white), black ICE (subtraction), Neuromancer (curves and warmth).

### 5.3 The beam palette

Color vector monitors produced a limited set of **beam colors** at variable intensity. We constrain the matrix to **8 named hues × continuous HDR intensity**. The palette is a uniform array (a 1D texture) so AIs can globally rewrite it.

| Index | Name | Linear-ish sRGB at nominal intensity | Role |
|---|---|---|---|
| 0 | `GRID` (P7 flash) | `#A8D8FF` | Grid, lattice, neutral structure |
| 1 | `AFTERGLOW` (P7 decay) | `#C6F03A` | Persistence tint (not used directly on geometry) |
| 2 | `MITSU` (P31 green) | `#4DFF5A` | Mitsubishi Bank of America; generic finance |
| 3 | `TA` (emerald) | `#14C77A` | Tessier-Ashpool |
| 4 | `ESFA` (scarlet) | `#FF3B1F` | Eastern Seaboard Fission Authority; energy/utility |
| 5 | `AMBER` (P3) | `#FFB000` | Sense/Net, media, the player's breaker figure (warm white = amber at hot intensity) |
| 6 | `ICE` (cold white) | `#E4FFFF` | White and gray ICE |
| 7 | `MIL` (violet) | `#B9A6FF` | Military spiral arms, Turing Registry accents |

Special (outside the palette, rule-breakers only):
- **Void**: `#000000` and truly black. No gradient skies, no horizon glow.
- **Black ICE edge**: ultraviolet `#8A2BFF` at low intensity, plus subtraction.
- **Kuang**: a thin-film interference spectrum (Section 8.5, `kuang.frag`).
- **Wintermute**: palette lerps toward `#FFFFFF`; exposure ×2.
- **HUD VFD**: `#3CF0D0` lit, `#3CF0D0` at 6% for ghost segments.
- **Molly's chip clock**: LED red `#FF2020`.

**Intensity semantics.** 1.0 = nominal beam. Hot elements (your breaker, active ICE facet, vertices) go up to 4.0. The tonemapper desaturates toward white at high intensity, as real phosphor does when saturated, so **hot = whiter**.

**Accessibility.** No information is carried by hue alone. Corporations differ by **shape and rhythm** first, hue second (Section 5.4).

### 5.4 Shape language

**Rules:**
- **Corporations are Euclidean**: cubes, slabs, pyramids, towers, platonic solids. Order and capital.
- **Military and AI are curved**: spirals, tori, splines. Power beyond ordinary ownership.
- **Data is points**: records are lightpoints, files are constellations.
- **ICE is shells**: nested polyhedra with hatched faces that produce moiré as they counter-rotate.
- **Rhythm**: every construct pulses on the music's tempo grid (Section 7.2). Each corp has a rhythm signature.

**Hidden-line policy.**
- Corporate constructs use **hidden-line removal**: faint face fills write depth, so they look solid and authoritative.
- ICE uses **no hidden-line removal**: you see through it to all its edges, which is vertiginous.
- Data uses no faces at all.

**Landmark heraldry** (authored in `content/corps.ts`):

| Corp | Shape grammar | Hue | Rhythm | Notes |
|---|---|---|---|---|
| Tessier-Ashpool S.A. | Long low rectangular slabs in symmetric terraces; Straylight core = towering stack of slabs | `TA` | Slow "breathing", 0.1 Hz, intensity ±15% | Old money: stillness. Its ICE is the most beautiful thing in the game |
| Mitsubishi Bank of America | Dense stacks of cubes on a strict grid | `MITSU` | Ledger ticks: random cubes blink in time with eighth notes | "Green cubes," per the book |
| Eastern Seaboard Fission Authority | 7-step scarlet ziggurat | `ESFA` | Reactor pulse, 1 Hz low throb, plus heat shimmer (vertex jitter at the apex) | "Stepped scarlet pyramid," per the book |
| Sense/Net | Cluster of lattice masts with rotating dishes and discs | `AMBER` | Broadcast sweep: dishes rotate and an amber ring emits outward every 2 bars | Media: it emits |
| Hosaka | Nested octahedra, rotating on different axes | `GRID` + `ICE` | Precise 4/4 ticks | Japanese electronics |
| Turing Registry (Geneva) | Geodesic sphere lattice with a sweep beam | `MIL` | Radar sweep, 0.25 Hz | The watcher: sweeps raise trace |
| Berne AI (Wintermute's core) | A T-A slab cluster with an over-white heart | `TA` + white | Irregular, as if listening | — |
| Military systems | Logarithmic spiral arms of points, "forever beyond reach" | `MIL` | Imperceptibly slow rotation | Skybox only (Section 5.6) |
| Minor procedural nodes | From the construct grammar (Section 8.6) | Any of `GRID`/`MITSU`/`AMBER`/`ESFA` | Random from the tempo set | City lights |

### 5.5 Key visual elements

- **The ground grid**: an infinite plane of fine lines (minor every 8 u, major every 64 u, super every 1024 u). It's analytically anti-aliased, fades to black with distance and never shows a horizon glow. Faint alternating cell fills at 2% intensity near the camera give the "chessboard."
- **Local 3D lattice**: vertical and horizontal lines at 64 u spacing, revealed only within ~200 u of the player with a spherical fade. It's the "transparent 3D chessboard" around you, and it makes speed and altitude readable.
- **Data traffic**: streams of lightpoints moving along grid lines between constructs. These are the book's "data exchange" made visible, in the visual register of Koyaanisqatsi's (1982) time-lapse freeway lights. Density follows the density map.
- **Constellations**: distant clusters collapse to lightpoints. E&S calligraphic night scenes are the reference: points of light read as a city from altitude.
- **Vertex dwell**: like real vector hardware, where the beam slows at vertices, line endpoints get a bright hotspot. It's a tiny detail that sells the physicality.
- **Phosphor persistence**: moving lines leave trails that decay **blue-white to yellow-green**, after P7 radar phosphor. Speed becomes visible as luminous smear.
- **Black ICE**: in a world made entirely of additive light, black ICE is the **one subtractive thing**. It's black solids that occlude the grid and *eat the glow* (Section 8.5 explains how it survives bloom), with a thin, crawling ultraviolet edge that moves like slow lightning. When it grips you, black tendrils grow inward from the screen edges.
- **Shatter**: a cracked ICE layer detaches into individual segments that fall and tumble, each leaving persistence trails.
- **Lissajous figures**: the breach visuals (Section 3.5). They're the most "oscilloscope" image in the game.

### 5.6 Composition and scale

- **Vastness first.** The camera's far plane is around 60,000 u. Distant landmarks are always visible as lightpoints, regardless of sector streaming.
- **Spiral arms**: ~40,000 violet points in 3 logarithmic spiral arms on a huge disc far above, with 0.1× parallax (it barely moves as you fly). It's the only "sky," and it's *unreachable* by design.
- **Horizon**: grid lines converge and fade into black. Never put a glow, gradient or sun there.
- **Density**: the Sprawl cluster (BAMA) is a sea of lights; Chiba is a tight bright knot; orbital T-A is high, sparse and regal.

### 5.7 Meatspace: teletext/videotex pages

- 40×24 character grid, 8 colors (black, red, green, yellow, blue, magenta, cyan, white), 2×3 mosaic block graphics, double-height titles, page numbers in the header (`P101  CHIBA   NITE CITY   23:14`).
- Pages are illustrated with mosaic art: a Chiba skyline as blocks, Molly's mirrored lenses as two cyan blocks, a ringing payphone.
- Pages are rendered with Canvas2D to a texture, then shown through the **raster CRT** pass (same as simstim, lighter settings).
- Choices are numbered: press `1`–`4`.
- Flashing text is allowed but limited to under 3 Hz, and never full-page.

### 5.8 Simstim and Neuromancer's construct

**Simstim (Molly's POV)**
- Low-poly, **flat-shaded** environments, in the tradition of Atari's *I, Robot* (1983, the first filled-polygon arcade game) and early broadcast 3D idents.
- The scene is rendered at **320×240** internally. Each face gets a single color quantized to a 16-color palette, with **4×4 Bayer ordered dithering** for gradients.
- The image then passes through the raster CRT pass: interlace, scanlines, aperture grille, NTSC-style chroma bleed (I/Q blurred more than Y) and slight barrel curvature.
- Molly's **chip clock** sits in the lower-left of her vision: red 7-segment `HH:MM:SS`, LED style.
- Her mirrored lenses mean the feed has a faint **silvered vignette** at the frame edges, and the image is slightly brighter than "real." It's an augmented eye.
- Figures (guards, 3Jane, Hideo) are rigid-part low-poly mannequins, never detailed faces. Animation is part-transform keyframes; no skinning.
- Movement is authored **camera paths with head-bob**, with Molly's hands occasionally in frame.

**Neuromancer's construct (the beach)**
- Inspirations: Turner Whitted's *The Compleat Angler* (1980: mirror spheres over a checkerboard), Lucasfilm's *The Road to Point Reyes* (1983: a photoreal beach road scene), Information International's *Adam Powers, the Juggler* (1981: an early CG human) and Ken Perlin's noise (developed in the wake of Tron).
- It's rendered by a **fullscreen SDF raymarcher**: noise-displaced sand plane, ocean plane with procedural normals, a concrete bunker built from boxes, a gradient sky with a low sun, hard shadows, one bounce of perfect mirror reflection, *no soft GI*. It should feel **too perfect and slightly wrong**.
- **The tell**: a Whitted checkerboard shows faintly through the sand, stronger when the player stands still and looks down. That links back to the "3D chessboard." It's the construct revealing itself.
- Linda Lee is a CSG-primitive figure (spheres, capsules, ellipsoids), soft and smooth like Adam Powers. She's seen mostly at mid-distance, and her voice is delivered as subtitles with a warm filtered tone.
- No HUD, no CRT pass. The image is **clean**: the only time the screen is clean in the whole game is when you're being seduced into staying.

### 5.9 Signature sequences

| Sequence | Description | Duration |
|---|---|---|
| **Jack-in** | 1. Black, plus the click of trodes. 2. Silver phosphenes boil in from the edges: point sprites driven by curl noise, low contrast. 3. Darkness folds open like neon origami: a set of hinged planes made of grid lines unfold (vertex shader with fold-angle uniforms). 4. The grid races outward to infinity (the grid shader's radius uniform grows exponentially). 5. Landmarks fade in at distance. 6. HUD boots last, VFD segments lighting in sequence | 5.5 s (1.2 s skip version) |
| **Flip (coordinate jump)** | Lines streak along the travel axis; persistence decay slows; FOV +25°; destination lightpoint grows | 1.5–3 s |
| **Simstim flip** | Channel change: horizontal-hold roll plus a soft static burst (low contrast), then the raster CRT image | 0.3 s |
| **Jack-out** | CRT power-off: image squashes vertically to a bright line, then horizontally to a dot, then the dot fades | 0.6 s |
| **Flatline** | EEG flatline, monitor tone, very slow collapse to a lingering dot, silence | 4 s |
| **Merge (finale)** | Palette rules break; every construct's lines unbind and re-flow; the grid becomes curved and then re-straightens on a new, different lattice | Scripted, ~2 min |

**Photosensitivity rule (MUST).** No sequence may produce more than 3 general flashes per second, and no saturated red flashing over large areas (WCAG 2.3.1). Phosphenes, static and flicker are low-contrast and localized. A "Reduce flashing" option clamps all flicker amplitude to 0.

### 5.10 Visual reference list (with what to take from each)

| Reference | Year | Take | Don't take |
|---|---|---|---|
| Atari *Battlezone* | 1980 | Periscope HUD frame, radar, wireframe solids on a black plane, distant volcano-as-landmark | Its green overlay filter |
| Atari *Tempest* | 1981 | Color vectors, the tube, lanes (Kuang dive) | Shooting |
| Atari *Star Wars* | 1983 | Color vector 3D at speed, trench flight sensation | Franchise imagery |
| Vectrex | 1982 | Bright vertex dwell, monochrome crispness | Overlays |
| Evans & Sutherland calligraphic sims | 1970s–80s | Lightpoints as cities; points-only distant LOD | — |
| *Tron* (MAGI SynthaVision, Triple-I, backlit animation) | 1982 | Solid geometric primitives, glow via backlighting, scale | Costumes, cycles, cyan/orange coding |
| *Escape from New York* glider display | 1981 | Wireframe flight-over-grid as diegetic display (it was physical models with reflective tape: a lesson in "fake it however") | — |
| Larry Cuba's Death Star briefing | 1977 | Vector trench readability | — |
| Ben Laposky's *Oscillons* | 1950s | Lissajous beauty (Phase Lock) | — |
| *Koyaanisqatsi* | 1982 | Data traffic as time-lapse light streams | — |
| Jim Blinn's JPL Voyager flybys | 1979–81 | Calm, cosmic camera moves for transit and jump arrivals | — |
| *I, Robot* (Atari) | 1983 | Flat-shaded polygon simstim scenes | — |
| Whitted 1980; Lucasfilm *Point Reyes* 1983; *Adam Powers* 1981 | — | Neuromancer's beach | — |
| Ceefax/Prestel/Minitel/CAPTAIN | 1974–84 | Meatspace pages | — |
| VFDs on VCRs, car dashes, synths | 1980s | Deck HUD readouts | — |
| Hershey vector fonts | 1967 | All in-matrix text | — |

---

## 6. HUD and deck interface

### 6.1 Principles

The matrix is **direct perception**: the HUD is not a screen but the **Ono-Sendai Cyberspace 7's sensorium overlay**, kept to the periphery. It mixes two period technologies:
- **Vector overlay** (same beam renderer, its own layer): the periscope frame, radar, labels and reticle.
- **VFD strip**: vacuum-fluorescent readouts along the bottom, with visible **ghost segments** (unlit segments at 6%) and a faint mesh grid over the glyphs, like real VFD glass.

The HUD is rendered into its own render target and composited **after** the vector CRT pass, so it isn't curved, jittered or heavily bloomed. It stays legible. It gets its own mild glow.

### 6.2 Layout (16:9; anchors scale with aspect)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ┌ DIXIE> that's a three-two, kid_                  ╭─radar─╮      [PIP]│
│ │ (terminal line, green P31, types at 1200 baud)   │  ·  · │  Molly CRT│
│ └                                                  ╰───────╯  thumbnail│
│                                                                        │
│  ⌐                                                                  ¬  │  ← periscope corner brackets
│                              ┼  (reticle)                              │
│  L                                                                  ┘  │
│                                                                        │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │EEG ∿∿∿∿∿∿∿∿∿∿  │ BAMA 0412.77/1180.03/0250 │ SPD 080 │ TRACE ▮▮▮▯▯▯▯▯▯▯│
│ │NEURAL 23        │ MODE TRANSIT              │ [1]PROBE [2]CLAMP [3]-- [4]--│
│ └──────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────┘
```

| Element | Tech | Behavior |
|---|---|---|
| **EEG trace** (neural load) | Vector polyline, scrolling | Calm alpha-wave sine at low load. Gets spiky, high-amplitude and irregular as load rises. Flatline = a literal flat line. Scars add a permanent tiny glitch |
| **Radar** | Vector PPI disc with a rotating sweep and P7 afterglow | Blips for target, ICE, watchers, Kuang. Sweep at 0.5 Hz |
| **Coordinates** | VFD 14-segment | Live position in matrix coordinates |
| **Speed / mode** | VFD 7- and 14-segment | `TRANSIT`, `APPROACH`, `BREACH`, `CORE`, `GRIP 07`, … |
| **Trace** | LED bargraph, 10 segments (green → amber → red) | Like a hi-fi VU meter. The last segment blinks at 2 Hz when at 90% or more |
| **Softs** | 4 "cartridge slots" in VFD | Cooldowns drawn as segment wipe |
| **Terminal line** | Bitmap font, green phosphor | Dixie, system and Wintermute messages. Prints at 1200 baud (~120 chars/s); Wintermute's print instantly |
| **PIP** | Small raster CRT thumbnail | Molly's live feed when a link is up. Flickers red on her pain spikes |
| **Reticle** | Vector | Center cross. In breach, it becomes the Phase Lock knob indicators (ratio arc, phase dial) and the lock meter ring |
| **World labels** | Hershey vector text, in world space, billboarded | Corp names, ICE class/layers after scan, record codes in the core |

### 6.3 Deck panel (`Tab`)

A full-screen overlay styled as the Ono-Sendai faceplate. The deck faceplate is drawn in vector line art, with a small monochrome CRT window in bitmap terminal style:
- **COORD**: coordinate entry and address book.
- **SOFTS**: slotting (between runs only; locked during a run).
- **LOG**: message history, which doubles as subtitles history.
- **PING**: Molly pings (when a link is up).
- **STATUS**: flatline tally (hash marks), scars and heat.

The matrix continues behind it, dimmed. Opening the deck does not pause the game. That's a deliberate tension source. The settings menu (`Esc`) does pause.

### 6.4 Boot and title

- The title screen is a deck **power-on self-test**: memory count, ROM checks, `ONO-SENDAI CYBERSPACE 7` in an extended-sans logotype rendered as vector strokes, then `PRESS ANY KEY TO JACK IN`. The key press also unlocks Web Audio (browser autoplay policy).
- Settings and menus use **DOM** overlays styled as the deck CRT, for accessibility: screen readers, text scaling and real form controls. Subtitles are also DOM.

### 6.5 Typography

| Use | Typeface | Source/License |
|---|---|---|
| In-matrix labels, HUD vector text, titles | **Hershey Simplex/Duplex** stroked as beam lines | Hershey fonts (public-domain-like; use a known permissive distribution, e.g. the `hershey-fonts` JSON data) |
| Terminal line, deck CRT, teletext | **Px437 IBM CGA / Px437 IBM BIOS** bitmap | The Ultimate Oldschool PC Font Pack (CC BY-SA 4.0: credit required) |
| VFD readouts | Custom **7- and 14-segment** glyphs generated procedurally | In-house |
| Brand logotypes (Ono-Sendai etc.) | Extended geometric sans, e.g. **Michroma** (OFL), stroked or rasterized | OFL |
| Molly's chip clock | 7-segment LED | In-house |

---

## 7. Audio direction

### 7.1 Principles

- **Synthesized, not sampled.** Almost all sound is generated live with Web Audio: oscillators, FM in an AudioWorklet, noise and filters. That's period-authentic and keeps the download tiny. A handful of short samples are allowed (CC0: a trode click, a few drum hits if the synthesized ones fall short).
- **The matrix is musical.** Constructs, ICE and data traffic are instruments in one key and tempo. Breaching is literally tuning (Section 3.5).
- **Silence is a weapon.** Black ICE ducks everything else. The flatline is a tone, then nothing.

### 7.2 Music

- **References**: Wendy Carlos's *Tron* score (1982), Kraftwerk's *Computer World* (1981), Yellow Magic Orchestra and Ryuichi Sakamoto (Chiba's Japanese electronics), Tangerine Dream (*Thief*, 1981), Laurie Spiegel's *The Expanding Universe* (1980) for algorithmic process, Brian Eno's ambient works, and Jean-Michel Jarre. Use Vangelis sparingly; he's too close to later cyberpunk shorthand.
- **Instruments** (built in-house as synth voices):
  - **FM** (DX7-style, 2–4 operators): bells, glassy keys, metallic ICE textures.
  - **Subtractive poly** (Jupiter-8/Juno style): saw/pulse into a resonant low-pass with a slow envelope. Pads and strings.
  - **Analog drums** (808/LinnDrum-like synthesis): kick (pitched sine with pitch envelope), snare (noise plus tone), hats (filtered noise or metallic FM).
  - **Bass**: square/saw mono with a filter envelope.
  - **"Orchestra hit"** (Fairlight-style): one synthesized or CC0 stab, reserved for the merge.
- **Adaptive system**: a step sequencer with **probabilistic patterns** at a global tempo (96 BPM default; it can shift per mission). Layers crossfade by game state:

| State | Layers |
|---|---|
| Transit | Pad drone + slow FM arpeggio, sparse; each nearby landmark adds its motif (positional) |
| Approach | Add pulse bass + hats; motif of target corp becomes dominant |
| Breach | Strip to drone + the ICE's Phase Lock tones (in key); percussion follows lock meter |
| Grip (black ICE) | All music ducks to -24 dB; sub-bass ring-mod growl; heartbeat |
| Core | Choir-like pad, tape-like wow; modem download sounds on top |
| Simstim | Music low-passed and distant (Molly's body is not a soundtrack); meat ambience leads |
| Kuang dive | Full drum pattern, 128 BPM, rising |
| Beach | No synth; procedural surf, wind, a distant dub bassline leaking in (the exit cue) |

- **Corporate motifs** (positional through PannerNode HRTF, attenuation by distance):
  - T-A: slow organ-like FM cluster, aristocratic and cold.
  - Mitsubishi: pentatonic FM bell arpeggio in eighths.
  - ESFA: low square throb at 1 Hz plus a filter sweep.
  - Sense/Net: bright "TV ident" chord stabs every 2 bars.
  - Turing: a high sine ping on each sweep.
  - Military: whale-like, slowly bending sines, barely audible.

### 7.3 Procedural SFX palette

| Event | Recipe |
|---|---|
| Trode click / jack-in | CC0 click → rising band-passed noise sweep (phosphenes = granular sine blips) → bloom chord (FM pad, sus2) |
| Flight wind | None. The matrix has no air. Speed is a soft filtered noise "hiss of the beam" rising with speed, plus grid "ticks" when crossing major lines (very subtle) |
| Boost | Low-pass opening on the hiss + low sine swell |
| Coordinate jump | Pitch-rising sine + noise riser, then a soft "arrival" chord |
| Scan | Expanding ring = descending FM ping with long delay |
| Hull contact | Dissonant FM buzz, pitch by corp |
| Lock meter | Rising arpeggio steps per 10% |
| Re-key telegraph | Pitch-slide of the ICE tones + soft alarm double-beep |
| Shatter | Many short FM tinks, randomized pitch in key, falling |
| Trace ticks | Telephone-exchange relay clicks, rate increasing with trace (the trace is a call being traced back) |
| Burned | Telephone off-hook howler tone (brief), then forced jack-out |
| CRT collapse (jack-out) | Descending sine "pew" + CRT degauss-like thunk |
| Flatline | EEG beeps → continuous 1 kHz monitor tone → hard silence |
| Simstim flip | Channel-change click + 200 ms of shaped static |
| Kuang | Shimmering chorus of detuned FM, a "sting" stab when it strikes |
| Wintermute hijack | All audio freezes into a held buffer (granular freeze), a pure sine at the top |
| Neuromancer softening | Reverb tail grows, pitch wobbles (tape wow), warm low-pass |

### 7.4 Download = modem

Data download plays **Bell 103-style FSK** (originate 1070/1270 Hz, answer 2025/2225 Hz) with random bit streams, mixed low and band-limited, plus handshake chirps at start. It's procedural, period-correct, and anyone who used a modem knows it.

### 7.5 Voices

- **Dixie Flatline**: text-first, with a short vocal **bark** per line: generated chirps through a formant filter bank, plus bitcrush and ring mod, in the spirit of SAM (1982) and Speak & Spell LPC. Full VO is optional; if recorded, process it the same way. His **laugh** is a dry, breathless rasp made of noise bursts gated in a rhythm. It should feel *wrong*: no inhale.
- **Molly**: when flipped, her voice is "inside the head": close, dry, mono. Subtitles are always available.
- **Meat ambience in simstim**: room tone, footsteps on hard floors, breathing, heartbeat (tempo rises with exposure). Pain is a tinnitus sine at 6–8 kHz, with level depending on settings.
- **Optional CRT whine**: a 15.734 kHz flyback whine during jack-in, very quiet and *off by default* (many people find it painful).

### 7.6 Mix and buses

`master ← [music, sfx, ui, voice, ambience]`, plus a sidechain/duck bus for black ICE and Wintermute freezes. There's a limiter on master, and loudness targets around −16 LUFS integrated.

---

## 8. Technical architecture

### 8.1 Stack (recommendation)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) | Multi-agent codebase needs types as contracts |
| Rendering | **Three.js** (pin a current release; `WebGLRenderer`, **WebGL2 only**) with **custom `ShaderMaterial`/`RawShaderMaterial`** for nearly everything | Three gives scene graph, cameras, buffers, instancing, render targets, glTF loading and math; we write our own shaders anyway. Raw WebGL2 would cost weeks of plumbing for little gain. Avoid Three's WebGPU/TSL path to keep shaders plain GLSL ES 3.00 that every agent can read |
| Post-processing | **Custom pass chain** (own `PostChain` over Three render targets) | The phosphor/black-ICE/CRT pipeline is unusual; library composers fight us |
| Audio | **Raw Web Audio API + AudioWorklet** (in-house FM voice, sequencer) | Tight control over procedural tuning and Phase Lock coupling; no heavy dependency |
| Narrative | **Ink** compiled to JSON (`inklecate`) + **inkjs** runtime | Proven branching dialogue; writers can work independently |
| Validation | **zod** schemas for content files | Fail fast on bad mission data |
| Build | **Vite** + `vite-plugin-glsl` (for `#include` in shaders) | Fast dev server, simple static build |
| Tests | **Vitest** (unit), **Playwright** (smoke and screenshot tests in headless Chromium with SwiftShader/WebGL2) | Deterministic logic tests + render sanity |
| Debug | **Tweakpane** (live tuning), `stats-gl` or a custom GPU timer (`EXT_disjoint_timer_query_webgl2`), Spector.js | Art tuning is constant |
| Lint/format | ESLint + Prettier | — |
| Hosting | Any static host; output is `dist/` | No server needed; saves in `localStorage` |

**Minimum browser:** WebGL2 with `EXT_color_buffer_half_float` or `EXT_color_buffer_float`, which covers current Chrome, Edge, Firefox and Safari 15+. If half-float render targets aren't available, use the Low tier with RGBA8 targets and pre-tonemapped intensities.

### 8.2 Runtime structure

```
App
 ├─ Loop (fixed-step sim @ 60 Hz, variable render, interpolation alpha)
 ├─ ModeStack (top mode receives input; lower modes may keep simulating)
 │    Boot → Title → Interlude(teletext) → JackIn → Matrix ⇄ Breach ⇄ Core
 │                                          ↘ Simstim (overlay mode; Matrix keeps simulating)
 │                                          ↘ DeckPanel (overlay; Matrix keeps simulating)
 │                                          ↘ Flatline → (retry) | Beach → Matrix
 │                                          → JackOut → Interlude(debrief)
 ├─ EventBus (typed events, Section 9.1)
 ├─ Services: Renderer, Audio, Input, Save, Settings, Content, MissionRunner
 └─ World: SectorStreamer, Constructs, Traffic, Sky, Player, Deck, Breach, Simstim, AI, Dixie
```

- **No ECS library.** Plain TypeScript classes with `update(dt)`. Hot data (lines, points, traffic) lives in typed arrays owned by renderer batches. Game logic never allocates per frame.
- **Modes** implement `{ enter(ctx), exit(), update(dt), render(alpha), handleInput(frame) , simulatesWhenCovered: boolean }`.
- **Determinism**: all procedural generation uses a seeded **PCG32** and integer hashing (`hash2i(x,z,seed)`). Never use `Math.random` in generation code; it's allowed only for cosmetic noise in shaders and SFX.

### 8.3 Scenes and render layers

| Scene / layer | Camera | Target | Content |
|---|---|---|---|
| `matrixScene` | Perspective (FOV 75, near 0.5, far 60,000; **logarithmic depth buffer on**, so all custom shaders must include Three's `logdepthbuf` chunks) | `hdrScene` (RGBA16F) + depth | Grid, lattice, constructs (depth-only face prepass then lines), points, traffic, ICE, Kuang, labels |
| `blackIceScene` | Same camera | `blackIceMask` (R8) + shared depth | Black ICE solids (mask = coverage), edge lines go to `hdrScene` |
| `skyScene` | Same rotation, 0.1× translation parallax | `hdrScene` (rendered first, no depth write) | Spiral arms, far constellations |
| `hudScene` | Orthographic, pixel units | `hudRT` (RGBA16F, half glow) | Vector HUD, VFD, terminal, PIP quad |
| `simstimScene` | Perspective, Molly's camera path | `simstimRT` 320×240 RGBA8 | Flat-shaded, dithered meat scenes |
| `teletextCanvas` | Canvas2D | Texture | Interlude pages |
| `beachPass` | Fullscreen | `hdrScene` (half res, upscaled) | SDF raymarcher |

### 8.4 Post-processing chain (matrix mode)

```
hdrScene ──► PersistencePass (ping-pong persistA/persistB) ──► combined
combined ──► BloomPass (6-mip dual-filter downsample/upsample, + wide faint halation)
combined + bloom ──► BlackIceComposite (multiply by 1 - mask*strength, then add UV edge glow)
         ──► VectorCrtPass (barrel, beam jitter, flicker, vignette, glass, grain, tonemap)
         ──► FinalComposite (+ hudRT, + PIP, + transitions: collapse/streak/static, + Wintermute exposure)
         ──► screen
```

Simstim/interlude mode replaces `VectorCrtPass` with `RasterCrtPass`. Beach mode skips CRT passes entirely and goes straight to a clean tonemap.

### 8.5 Shaders to write (each has an owner task in Section 10)

| Shader | Stage | Key details |
|---|---|---|
| `beamLine.vert/.frag` | Instanced segment quads | Per-instance `a: vec3, b: vec3, color: uint8 idx, intensity: f16, width: f16, flags`. **Clip the segment against the near plane in view space before projecting** (if one end is behind, move it to the near plane: `t = (near - za)/(zb - za)`). Expand to a screen-space quad of width `w + 3σ`. Fragment: distance `d` from pixel to segment, `I = intensity * exp(-d²/(2σ²))`, plus vertex-dwell term `dwell * exp(-dEnd²/(2σd²))`. **Width conservation**: if projected width < 1 px, clamp to 1 px and scale intensity by the ratio (prevents sub-pixel shimmer). Distance fade: `intensity *= fogFn(dist)`. Additive blending, depth test on, depth write off. Palette lookup from a uniform array so global palette effects apply |
| `lightPoint.vert/.frag` | Instanced points as quads | Gaussian dot, min size 1.5 px, size/intensity attenuation by distance, twinkle option (traffic) |
| `traffic.vert` | Instanced points | Path stored as a polyline in a `DataTexture`; `t = fract(time*speed/len + offset)`; position = path(t) |
| `groundGrid.frag` | Large plane following camera | "Pristine grid" style analytic AA via `fwidth`; minor/major/super line levels each fade out by screen-space density before they alias; distance fade to black; checker cells at 2% near camera; Wintermute warp field (up to 4 bend control points as uniforms) |
| `constructFace.vert/.frag` | Construct faces | Depth-only (color write off) prepass with polygon offset for hidden-line removal; optional faint additive fill (≤3%) |
| `iceFacet.frag` | ICE shell faces | Two hatching line sets at slightly different angles → moiré; counter-rotation; Lissajous drawn separately as beam lines on the active facet |
| `blackIce.frag` | Black ICE solids | Writes mask coverage; edge lines rendered via `beamLine` with UV color and a crawling noise offset |
| `kuang.frag` (variant of beamLine) | Kuang rib lines | Thin-film interference color: `rgb = spectrum(f(thickness(view·normal, time)))` — iridescent oil-on-water; the only continuous-spectrum material |
| `persistence.frag` | Fullscreen | `prev = texture(persistPrev)`; per-channel decay `decay = pow(vec3(0.90,0.93,0.78), dt*60)` (blue decays fastest); hue shift of the decayed energy toward `AFTERGLOW` by `shift`; `out = max(current, prev*decay)`; decay strengthens with camera angular velocity above a threshold (anti-smear, also a comfort option) |
| `bloomDown.frag` / `bloomUp.frag` | Mip chain | 13-tap downsample, 9-tap tent upsample (Call-of-Duty-style), no threshold (everything emits); halation = extra wide, low-weight, slightly warm-tinted mip |
| `blackIceComposite.frag` | Fullscreen | `col *= 1.0 - mask * k` after bloom, so black ICE eats glow; re-add its own edge lines |
| `vectorCrt.frag` | Fullscreen | Mild barrel (k ≈ 0.015), sub-pixel beam jitter (≤ 0.25 px, low-frequency noise), flicker (≤ 3% amplitude, tied to "vector load" metric, disabled by Reduce Flashing), vignette, glass reflection gradient and faint dust texture, phosphor grain, **true black floor** (no raster lift), tonemap: per-channel Reinhard on luminance + desaturate-to-white above 1.0 |
| `rasterCrt.frag` | Fullscreen | Input upsampled from 320×240; RGB→YIQ, horizontal blur I/Q (≈ 4 px) > Y (≈ 1 px), back to RGB; scanlines (240), aperture-grille mask, interlace field jitter, stronger barrel, raised black level, vignette, bloom; transition params: horizontal-hold roll, static amount, tracking noise |
| `flatDither.frag` | Simstim materials | Flat shading (face normal via derivatives), quantize to 16-color palette uniform, 4×4 Bayer ordered dither |
| `vfd.frag` | HUD | Segment mask atlas (7/14-seg), lit vs ghost intensity, fine mesh overlay, slight blue-green bloom |
| `phosphenes.frag` | Jack-in | Point sprites on curl-noise flow from screen edges inward, silver-white, low contrast |
| `origamiFold.vert` | Jack-in | Hinged grid panels with per-panel fold angle uniforms animating 0→180° |
| `beach.frag` | Fullscreen raymarch | SDF scene (sand heightfield via Perlin fBm, ocean plane w/ procedural normals, bunker boxes, Linda CSG), hard shadows (1 shadow ray), one mirror bounce for metal/wet surfaces, sky gradient with sun disc, checkerboard bleed-through `mix(sand, checker, reveal)` where `reveal` grows with stillness and downward gaze; half resolution + bilinear upscale; 64-step cap |
| `finalComposite.frag` | Fullscreen | HUD over, PIP over, CRT collapse transform (scale Y then X toward center, dot), streak (radial/axial blur for jumps), Wintermute exposure, global fade |

### 8.6 Procedural matrix generation

**Coordinates and scale:**

| Quantity | Value |
|---|---|
| Minor / major / super grid | 8 / 64 / 1024 u |
| Sector size | 1024 × 1024 u (columns extend vertically) |
| Active sectors | 5 × 5 around player (radius 2), streamed |
| World extent | 512 × 256 sectors (~524k × 262k u) — traverse long distances via coordinate jump |
| Altitude tiers | 0–200 public; 200–2,000 corporate; 2,000–8,000 high-security/orbital (T-A, Freeside); spiral arms skybox at 30,000+ (unreachable; soft ceiling at 12,000) |
| Display coords | Region code + `XXXX.XX / ZZZZ.ZZ / YYYY` (sector.fraction) |

**Density map.** `public/data/density.png` is a 512×256 grayscale image, authored by hand. It's an *abstracted* map of 1980s data-exchange density, with bright regions for the Sprawl (BAMA), Chiba/Tokyo, the European banking centers (Zurich, Geneva, Berne), Rio and an orbital band. **No coastlines or literal geography are drawn**: the map only drives density. A companion `regions.png` (indexed color) assigns region codes (`BAMA`, `CHBA`, `EURO`, `RIO`, `ORBT`, …).

**Per-sector generation** (`world/Sector.ts`, pure function of `(sx, sz, worldSeed)`):
1. `rng = pcg32(hash2i(sx, sz, seed))`.
2. `density = densityMap.sample(sx, sz)`; `nClusters = poisson(rng, density * 4)`.
3. For each cluster: center snapped to the 64 u grid; size 2–20 constructs; class mix weighted by region; heights by tier rules.
4. Each construct: pick a grammar from `minorGrammars`, parameters from the rng, heraldry hue from the region's allowed set, rhythm from the tempo set.
5. Traffic: connect constructs in the cluster with a minimum spanning tree plus 20% extra edges; route each edge **Manhattan-style along grid lines**; add inter-cluster trunk lines toward the nearest landmark.
6. Watchers (Turing/sysop sweeps): placed near high-value constructs per region rules.
7. Output: a `SectorData` (plain data, serializable) → `SectorView` builds GPU batches. Generation happens in a **Web Worker** to avoid frame hitches; batches are uploaded on the main thread over ≤ 2 frames.

**Landmarks** (`content/landmarks.ts`) are authored, at fixed coordinates, and always loaded globally as **far-LOD lightpoints**. Full geometry streams with sectors. Missions reference landmarks by `id`.

**Construct grammar** (`world/constructs/grammar.ts`): a small parametric grammar that outputs line segments, face triangles (for the depth prepass) and point sets.

| Primitive | Params | Output |
|---|---|---|
| `box` | w,h,d, subdivisions, hatch | 12 edges (+ subdivision lines) |
| `slabTerrace` | count, spacing, w/h/d, symmetry | T-A style slabs |
| `cubeStack` | grid n×m×k, gap, blinkMask | Mitsubishi |
| `ziggurat` | steps, base, stepH, inset | ESFA |
| `mast` | height, sections, dishes | Sense/Net |
| `nestedPoly` | solid (tetra/octa/icosa), shells, rotation axes | Hosaka, ICE shells |
| `geodesic` | frequency, radius | Turing |
| `tower` | sides, height, taper, rings | generic |
| `constellation` | n points, distribution | data, far LOD |
| `spiralArms` | arms, points, pitch | sky |

Each construct has 3 LODs: **far** = 1 lightpoint (size by importance); **mid** = bounding outline (12–24 edges); **near** = full detail. Hysteresis between LODs prevents popping, and LOD transitions crossfade intensity over 0.3 s.

**Core interiors** are generated per target from a seed. A vertical stack of 6–12 translucent strata planes (hatched outline only), each holding a grid of record lightpoints with Hershey catalog codes. The target file is a constellation whose points pulse in sync. Decoy constellations pulse off-beat.

### 8.7 Performance budget

**Targets**: 60 fps at 1080p on integrated GPUs (Apple M1, Intel Iris Xe class); 120 fps on discrete GPUs. 1440p/4K via dynamic resolution.

| Budget | Value |
|---|---|
| Frame (16.6 ms) | Sim ≤ 2 ms, scene ≤ 6 ms, post ≤ 4 ms, HUD ≤ 1 ms, headroom ≥ 3 ms |
| Draw calls | ≤ 150 (batch per material and LOD; instancing everywhere) |
| Visible line segments | ≤ 150k High, 80k Medium, 40k Low (lattice ≤ 6k, HUD ≤ 5k, rest constructs/ICE) |
| Visible points | ≤ 60k (sky 40k is one draw) |
| Overdraw | Beam quads are additive and wide: cap glow width at 3σ; bloom supplies the halo, not the line shader |
| Render targets @1080p | hdrScene 16F, persist A/B 16F, bloom chain (½ → 1/64), hud 16F, mask R8 ≈ 70 MB GPU |
| JS heap | ≤ 150 MB; zero per-frame allocations in hot loops (verify with Chrome heap timeline) |
| Download | ≤ 8 MB initial (code + fonts + density map + few samples); simstim glTF scenes lazy-loaded per mission |
| Sector gen | ≤ 4 ms per sector in worker; upload ≤ 1 ms/frame |

**Quality tiers** (`render/quality.ts`): Low (no persistence, 4-mip bloom, lattice radius 120, ⅔ resolution, RGBA8 fallback allowed), Medium, High (all on, full res). **Dynamic resolution**: if the GPU frame time stays over 15 ms for 30 frames, step render scale down by 0.1, to a minimum of 0.6; step it back up when headroom returns.

### 8.8 Input

- An `Input` service samples keyboard, mouse (pointer lock) and gamepad (Gamepad API) once per sim tick into an immutable `InputFrame`. Modes consume actions, never raw keys.
- Bindings live in data (`input/bindings.ts`) and are remappable in Settings. They're stored in `localStorage`.
- Mouse sensitivity, invert Y, and gamepad dead zones are configurable.
- Deck typing mode captures raw key text (coordinates, the final word) and suspends action bindings.

### 8.9 Save and settings

`localStorage` JSON, versioned with migrations: `{ version, campaign: { act, missionId, checkpoint, heat, scars, flatlines, softsOwned, softsSlotted, wintermuteDebt, dixieErased? }, settings: {...} }`. It autosaves at mission start and at jack-in checkpoints.

### 8.10 Accessibility (MUST)

- **Reduce flashing** (clamps flicker, removes static bursts, softens phosphenes). It's on during the first-boot prompt until the player chooses.
- **Reduce motion**: persistence trails off or shortened, no FOV kick, no banking, gentler jump streak.
- **Subtitles** (DOM) for all speech and important SFX cues ("[REKEY]"), with size and background options.
- **Phase Lock assists**: visual-only mode, wider tolerance, MIMIC always, slower re-key; **hold-to-toggle alternatives** for every hold input.
- **Colorblind safety**: shape/rhythm-first identity; trace bargraph uses position, not just color.
- Remappable controls; mouse-only and gamepad-only playable.

### 8.11 File and module layout

```
nonspace/
├─ index.html
├─ package.json  vite.config.ts  tsconfig.json  .eslintrc.cjs  playwright.config.ts
├─ public/
│  ├─ data/density.png  regions.png
│  ├─ fonts/hershey/*.json  px437/*.png  px437/*.json
│  ├─ audio/click.wav  (few CC0 samples)
│  └─ simstim/*.glb  (lazy-loaded meat scenes)
├─ ink/                      # .ink sources (compiled to src/content/ink/*.json by script)
├─ src/
│  ├─ main.ts
│  ├─ app/        App.ts  ModeStack.ts  modes/{Boot,Title,Interlude,JackIn,Matrix,Breach,Core,Simstim,DeckPanel,Flatline,Beach,JackOut}.ts
│  ├─ core/       loop.ts  events.ts  rng.ts  hash.ts  math/  time.ts  settings.ts  save.ts  assert.ts
│  ├─ input/      Input.ts  bindings.ts  gamepad.ts  pointerLock.ts  textCapture.ts
│  ├─ render/
│  │  ├─ Renderer.ts  targets.ts  palette.ts  quality.ts  dynamicRes.ts
│  │  ├─ lines/   BeamBatch.ts  beamLine.vert  beamLine.frag  kuang.frag
│  │  ├─ points/  PointBatch.ts  lightPoint.vert  lightPoint.frag  traffic.vert
│  │  ├─ grid/    GroundGrid.ts  LocalLattice.ts  groundGrid.frag
│  │  ├─ faces/   constructFace.*  iceFacet.frag  blackIce.frag
│  │  ├─ text/    HersheyText.ts  VfdText.ts  BitmapText.ts  vfd.frag
│  │  ├─ post/    PostChain.ts  PersistencePass.ts  BloomPass.ts  BlackIceComposite.ts  VectorCrtPass.ts  RasterCrtPass.ts  FinalComposite.ts  shaders/*.frag
│  │  ├─ fx/      JackInSequence.ts  JumpStreak.ts  CrtCollapse.ts  Shatter.ts  phosphenes.frag  origamiFold.vert
│  │  ├─ simstim/ SimstimRenderer.ts  flatDither.frag
│  │  └─ beach/   BeachRenderer.ts  beach.frag
│  ├─ world/
│  │  ├─ coords.ts  Sector.ts  SectorStreamer.ts  sectorWorker.ts  densityMap.ts  landmarks.ts
│  │  ├─ constructs/ grammar.ts  primitives.ts  lod.ts  Construct.ts  heraldry.ts
│  │  ├─ traffic/ Traffic.ts  routing.ts
│  │  ├─ watchers/ Watcher.ts
│  │  └─ sky/     SpiralArms.ts  FarConstellations.ts
│  ├─ player/     FlightController.ts  CoordinateJump.ts  CameraRig.ts  Collision.ts
│  ├─ deck/       Deck.ts  NeuralLoad.ts  Trace.ts  Heat.ts  softs/{registry.ts, effects.ts}
│  ├─ breach/     IceModel.ts  PhaseLock.ts  BreachController.ts  IceVisuals.ts  Grip.ts  CoreInterior.ts
│  ├─ simstim/    SimstimFeed.ts  MollyTimeline.ts  Gates.ts  Pain.ts
│  ├─ ai/         Wintermute.ts  Neuromancer.ts  Hijack.ts  Persona.ts
│  ├─ companion/  Dixie.ts  barks.ts
│  ├─ narrative/  MissionRunner.ts  schema.ts  triggers.ts  InkRuntime.ts
│  ├─ meat/       Teletext.ts  TeletextPage.ts  Interlude.ts
│  ├─ hud/        Hud.ts  Radar.ts  EegTrace.ts  VfdStrip.ts  Bargraph.ts  Terminal.ts  Pip.ts  Reticle.ts  DeckPanel.ts  dom/{Settings.ts, Subtitles.ts}
│  ├─ audio/      AudioEngine.ts  buses.ts  spatial.ts  worklets/{fm.worklet.ts, noise.worklet.ts}  voices/{FmVoice,SubVoice,Drums,Bass}.ts
│  │              music/{Sequencer.ts, patterns/*.ts, Harmony.ts}  sfx/{catalog.ts, recipes/*.ts}  modem.ts  dixieVoice.ts
│  ├─ content/    corps.ts  landmarks.ts  ice/*.ts  softs.ts  missions/{p0,m1..m7}.ts  ink/*.json  teletext/*.ts  simstim/*.ts
│  └─ debug/      DebugGui.ts  LookLab.ts  PhaseLockLab.ts  gpuTimer.ts  cheats.ts
└─ tests/
   ├─ unit/  rng.test.ts  sector.test.ts  phaseLock.test.ts  grammar.test.ts  schema.test.ts  missionRunner.test.ts
   └─ e2e/   boot.spec.ts  lookLab.spec.ts (screenshot)  m1.spec.ts (scripted input playthrough)
```

**Debug routes** (query params, dev builds only): `?lab=look` (art test scene), `?lab=phaselock` (2D prototype), `?lab=grammar&g=ziggurat`, `?mission=m2&checkpoint=gate2`, `?quality=low`, `?seed=1234`.

---

## 9. Data schemas and module contracts

These contracts let tasks proceed in parallel. Changing one requires updating this section in the same PR.

### 9.1 Events (`core/events.ts`)

```ts
export type GameEvent =
  | { type: 'jackIn'; missionId: string }
  | { type: 'jackOut'; reason: 'player' | 'burned' | 'script' }
  | { type: 'flatline'; scripted: boolean }
  | { type: 'modeChanged'; from: ModeId; to: ModeId }
  | { type: 'scanPulse'; origin: Vec3 }
  | { type: 'iceEngaged'; iceId: string; layer: number }
  | { type: 'iceRekeyTelegraph'; iceId: string; inSeconds: number }
  | { type: 'iceRekey'; iceId: string }
  | { type: 'iceLayerCracked'; iceId: string; layer: number }
  | { type: 'gripStart' | 'gripEnd'; iceId: string }
  | { type: 'traceChanged'; value: number }
  | { type: 'neuralChanged'; value: number }
  | { type: 'downloadProgress'; targetId: string; value: number }
  | { type: 'simstimFlip'; on: boolean }
  | { type: 'gateWindow'; gateId: string; state: 'open' | 'hit' | 'early' | 'late' | 'missed' }
  | { type: 'mollyPain'; amount: number }
  | { type: 'softUsed'; softId: string }
  | { type: 'dixieSay'; lineId: string }
  | { type: 'wintermute'; action: WintermuteAction }
  | { type: 'neuromancer'; action: NeuromancerAction }
  | { type: 'objective'; id: string; state: 'active' | 'done' | 'failed' };
```

### 9.2 Render contracts (`render/lines/BeamBatch.ts`, `render/points/PointBatch.ts`)

```ts
export const enum Beam { GRID, AFTERGLOW, MITSU, TA, ESFA, AMBER, ICE, MIL }

export interface LineSet {               // produced by grammar, HUD, effects
  positions: Float32Array;               // [ax,ay,az,bx,by,bz] * n
  color: Uint8Array;                     // Beam index * n
  intensity: Float32Array;               // * n
  width?: Float32Array;                  // px, default 1.5
  flags?: Uint8Array;                    // bit0 dwell, bit1 kuang, bit2 noFog
}

export interface BeamBatch {
  readonly capacity: number;
  setStatic(set: LineSet): void;                     // upload once
  beginDynamic(): void; push(a: Vec3, b: Vec3, c: Beam, i?: number, w?: number, f?: number): void; endDynamic(): void;
  transform: THREE.Matrix4;                         // per-batch model matrix
  visible: boolean;
}
export interface PointSet { positions: Float32Array; color: Uint8Array; intensity: Float32Array; size?: Float32Array }
```

`render/palette.ts` exports `Palette` with `set(index, rgb)`, `lerpAllTo(rgb, t)` (Wintermute) and `addWarmth(t)` (Neuromancer). These are uniforms shared by all beam/point materials.

### 9.3 ICE (`content/ice/*.ts`, `breach/IceModel.ts`)

```ts
export type IceClass = 'white' | 'gray' | 'black' | 'ta';
export interface IceLayerDef {
  ratios: Array<[number, number]>;        // allowed a:b
  tolRatio: number;                       // e.g. 0.06 (log units)
  phaseDrift: number;                     // rad/s
  rekeyEvery?: [number, number];          // seconds, random in range; undefined = never
  telegraph: number;                      // seconds
  lockTime: number;                       // seconds of m>=0.85 to crack
  traceRate: number;                      // %/s while engaged
  feedbackDps: number;                    // neural/s when m<0.3
  grip?: { neuralThreshold: number; seconds: number };
}
export interface IceDef {
  id: string; class: IceClass; shell: 'cube' | 'octa' | 'icosa' | 'slab';
  radius: number; layers: IceLayerDef[]; hue: Beam;
}
// PhaseLock is pure and unit-tested:
export function matchMetric(R: number, Phi: number, a: number, b: number, phi: number, tol: number): number;
```

### 9.4 Softs (`content/softs.ts`)

```ts
export type SoftEffect =
  | { kind: 'revealRatio'; seconds: number }
  | { kind: 'freezeDrift'; seconds: number; delayRekey: number }
  | { kind: 'damper'; seconds: number; feedbackMul: number }
  | { kind: 'decoy'; seconds: number; traceMul: number }
  | { kind: 'mimic'; rate: number }
  | { kind: 'kuang' };
export interface SoftDef { id: string; name: string; charges?: number; cooldown?: number; effect: SoftEffect; unlock: string }
```

### 9.5 Missions (`narrative/schema.ts`, zod-validated)

```ts
export interface MissionDef {
  id: string; act: 1 | 2 | 3 | 4 | 5; title: string;
  briefing: { ink: string; knot: string };              // teletext interlude before
  debrief: { ink: string; knot: string };
  start: { coords: MatrixCoord; jackInSequence: 'full' | 'short' };
  softsAvailable: string[];
  landmarks: string[];                                   // must be loaded
  targets: Array<{ id: string; landmark: string; ice: string; core: { seed: number; strata: number; targetRecord: string } }>;
  objectives: Array<{ id: string; text: string; when: Trigger; complete: Trigger; optional?: boolean }>;
  simstim?: { timeline: string; gates: Array<{ id: string; iceNode: string; tMeat: number; early: number; late: number; onEarly: Action[]; onLate: Action[] }> };
  timeline: Array<{ at: Trigger; do: Action[] }>;        // scripted events
  fail: Trigger[];
  checkpoints: Array<{ id: string; at: Trigger }>;
}
export type Trigger =
  | { t: 'time'; s: number } | { t: 'meatTime'; s: number } | { t: 'event'; type: GameEvent['type']; where?: Record<string, unknown> }
  | { t: 'near'; landmark: string; radius: number } | { t: 'all' | 'any'; of: Trigger[] } | { t: 'flag'; name: string };
export type Action =
  | { a: 'say'; who: 'dixie' | 'molly' | 'wintermute' | 'system'; line: string }
  | { a: 'ink'; knot: string } | { a: 'objective'; id: string; state: 'active' | 'done' | 'failed' }
  | { a: 'setFlag'; name: string; value: boolean } | { a: 'iceMod'; ice: string; patch: Partial<IceLayerDef> }
  | { a: 'wintermute'; action: WintermuteAction } | { a: 'neuromancer'; action: NeuromancerAction }
  | { a: 'forceMode'; mode: ModeId } | { a: 'music'; state: string } | { a: 'sfx'; id: string };
```

### 9.6 Simstim timelines (`content/simstim/*.ts`)

```ts
export interface SimstimTimeline {
  id: string; scene: string;                              // glb path
  cameraPath: Array<{ t: number; pos: Vec3; look: Vec3; bob?: number }>;
  figures: Array<{ id: string; rig: string; keys: Array<{ t: number; pose: string; pos: Vec3; yaw: number }> }>;
  lines: Array<{ t: number; who: 'molly' | string; text: string }>;
  branches: Array<{ atGate: string; onLate: { holdUntilOpen: boolean; exposurePerSec: number; injectSegment?: string } }>;
  clockStart: string;                                     // e.g. '02:14:07' for chip clock
}
```

The timeline is **driven by meat time**, which keeps running even when not flipped. If a gate is late, the timeline enters a "wait" segment (Molly holds position, exposure accrues) until the gate opens.

### 9.7 Audio API (`audio/AudioEngine.ts`)

```ts
interface AudioEngine {
  unlock(): Promise<void>;                                 // call on first user gesture
  sfx(id: SfxId, opts?: { pos?: Vec3; gain?: number; pitch?: number }): void;
  music: { setState(s: MusicState): void; setTempo(bpm: number): void; setKey(root: number, mode: 'minor'|'dorian'|'lydian'): void };
  motif: { attach(landmarkId: string, pos: Vec3, corp: CorpId): Handle; detach(h: Handle): void };
  phaseLock: { start(a: number, b: number, f0: number): void; setTarget(a: number, b: number, phi: number): void; setPlayer(R: number, Phi: number): void; stop(): void };
  modem: { start(): void; stop(): void };
  duck(bus: 'all'|'music', db: number, seconds: number): void;
  listener(pos: Vec3, forward: Vec3, up: Vec3): void;
}
```

### 9.8 Contract notes from M0.1 (repo copy only)

Typed stubs for 9.1–9.7 are committed at the paths above (under `src/`). Where this section names a type without defining it, or where its literal TypeScript doesn't build cleanly, M0.1 chose the following. Treat these as part of the contract:

- **`Vec3`** (`core/math/vec3.ts`): plain `{ x, y, z }`. `THREE.Vector3` satisfies it, so hot paths can pass reused vectors.
- **`Beam`** (`render/lines/BeamBatch.ts`): an `as const` object plus a same-named type instead of `const enum`, because const enums break under `isolatedModules`. `Beam.GRID` and `c: Beam` work unchanged. Flag bits are in `BeamFlag`.
- **`gripStart` / `gripEnd`** are two union members with the same shape, so `EventOf<'gripStart'>` resolves.
- **`ModeId`** (`app/ModeStack.ts`), **`CorpId`** (`content/corps.ts`), **`MatrixCoord`** (`world/coords.ts`), **`SfxId` / `MusicState` / `Handle`** (`audio/AudioEngine.ts`): runtime `as const` lists with derived types, so zod and tests can enumerate them.
- **`WintermuteAction`** (`ai/Wintermute.ts`) and **`NeuromancerAction`** (`ai/Neuromancer.ts`): provisional discriminated unions on `kind`, owned by M7.3.
- **`BeamBatch` / `PointBatch`** gain `dispose()`. `PointBatch` mirrors `BeamBatch`; 9.2 only defined `PointSet`.
- **`SimstimTimeline`** lives in `content/simstim/types.ts`. **`SoftDef.unlock`** is a campaign flag name, with `'start'` meaning owned from the first run.
- **Test doubles and fixtures** live in `src/testing/{mocks,fixtures}.ts` (recording beam/point batches, event recorder, recording audio engine, valid sample ICE/mission/timeline).
- **Tooling**: ESLint uses a flat `eslint.config.js` (ESLint 9+) rather than `.eslintrc.cjs`; TypeScript is pinned to 6.0.x, the newest version typescript-eslint supports.

### 9.9 Contract notes from M0.2 (repo copy only)

- **`EventBus`** gains deferred delivery: `post(event)` queues, `flush()` emits the queue in order (including events posted during the flush), `pendingCount()`. The App flushes after every sim step, so sim code should `post`; `emit` stays synchronous. `clear()` also drops queued events.
- **`Mode`** (`app/ModeStack.ts`) is 8.2's shape plus `readonly id: ModeId` and optional `covered(by)` / `uncovered()` hooks. `handleInput(frame: ModeInputFrame)`, where `ModeInputFrame` is `unknown` until M0.3's `InputFrame` replaces it.
- **`ModeContext`** = `{ events, modes, settings, save }`. Later tasks append their services to this interface and to the App's construction of it.
- **ModeStack rules**: the top mode gets input. Covered modes keep updating down to the first one with `simulatesWhenCovered: false`, which freezes along with everything below it. All modes render, bottom first. Transitions requested inside mode callbacks apply after the callback returns. `modeChanged` fires when the top changes between two modes (not on the first push or the last pop). Operations are `push`, `pop`, `replace` (swap top) and `reset(mode?)`.
- **Loop** (`core/loop.ts`): `SIM_DT = 1/60`; `update(dt)` always gets `SIM_DT`; frames longer than 0.25 s are clamped (counted in `stats.droppedTime`); `paused` stops the sim but keeps rendering (for the Esc menu).
- **RNG/hash**: `pcg32(seed, stream?)` returns a `Pcg32` (`nextU32`, `next`, `float`, `below`, `int` inclusive, `chance`, `pick`, `shuffle`, `normal`, `poisson`, `advance`, `getState`/`setState`). `hash2i(x, z, seed)` returns uint32 and truncates inputs to int32. Golden values are pinned in `tests/unit/hash.test.ts`.
- **Save** adds `campaign.flags: Record<string, boolean>` (mission `setFlag` and `SoftDef.unlock`). Storage key `nonspace.save`, `SAVE_VERSION = 1`, `MIGRATIONS[n]` upgrades n → n+1. Corrupt saves are backed up to `nonspace.save.corrupt`, and saves from newer builds to `nonspace.save.v<N>`.
- **Settings** live in the save blob, validated per field (defaults on bad values, numbers clamped): `reduceFlashing` (default on), `flashingPromptAnswered`, `reduceMotion`, `holdToToggle`, `difficulty` (`story|normal|hard`), `subtitles`, `phaseLock` assists (incl. `purist`), `audio` gains, `input` (sensitivity, invertY, deadzone), `graphics` (`quality: auto|low|medium|high`, `dynamicResolution`). Key bindings stay with `input/bindings.ts`. Use `settings.update(patch)` and `onChange`.

### 9.10 Contract notes from M7.1 (repo copy only)

- **`MissionRunner`** (`narrative/MissionRunner.ts`) is a factory on the EventBus. `update(dt)` runs each sim step (App calls it before modes, then `flush`). Consequence events (`objective`, `dixieSay`, `wintermute`, `neuromancer`) are `post`ed; `{ t: 'event' }` triggers latch from `onAny` and from the runner's own posts in the same pump, so `all`/`any` can mix an event with a level condition without waiting for the next flush.
- **Triggers** (`narrative/triggers.ts`): clocks are `>=`; events latch for the rest of the run; `where` is a shallow field match; `near` is Euclidean distance against `setLandmark` / `setPlayerPosition`. Timeline rows, fail checks and checkpoints fire once. Objective `when`/`complete` are edges inactive→active and active→done.
- **`MissionSnapshot`** is the checkpoint payload. `restore(snapshot)` / `restoreCheckpoint(id)` reproduce clocks, flags, objectives, event latches, fired script rows and ice patches. Save still only stores `campaign.{missionId,checkpoint,flags}` (full snapshots are in-memory; `serialize`/`deserialize` for tests).
- **`ModeContext.mission`** is the runner, optional so parallel tasks don't have to pass one. App always constructs it (idle until `load`/`start`).
- **`MissionEffects`** is the sink for `say` / `ink` / `iceMod` / `forceMode` / AI / audio actions, so this task does not own those systems. If an `AudioEngine` is passed, valid `music`/`sfx` ids also hit it.
- **Debug**: `?mission=<id>&checkpoint=<id>` (dev or `?debug`) loads a mock from `narrative/mocks.ts`. No story content here. `jumpToCheckpoint` restores a captured snapshot, or seeks by satisfying the checkpoint trigger. `?mission=mock-triggers` is the AC fixture (time, meatTime, event, near, flags, all/any).

### 9.11 Contract notes from M5.1 (repo copy only)

- **`createNoopAudioEngine()`** and **`createRecordingAudioEngine()`** are unchanged: silent, and a dotted-path recorder wrapping the silent engine. Tests that don't need a device should keep using them.
- **`createAudioEngine(opts?)`** is the Web Audio implementation of 9.7. Every method is still safe before `unlock()`. Optional `opts.settings` applies `audio.master/music/sfx/voice` linear gains. `disposeAudioEngine(engine)` and `getAudioDiagnostics(engine)` are helpers, not part of 9.7.
- **`music.setKey(root, mode)`**: `root` is a MIDI note number (default A2 = 45). Adaptive layers and corp motifs beyond HRTF drones are M5.3.
- **`sfx` / `modem` / `phaseLock`**: audible stubs so the engine is exercisable; recipes, Bell 103 FSK, and Phase Lock coupling stay M5.2 / M5.4.
- **Dev route:** `?lab=audio`.

### 9.12 Contract notes from M0.3 (repo copy only)

- **`InputFrame`** (`input/Input.ts`) replaces `Mode.handleInput`'s placeholder. `ModeInputFrame` is now an alias of `InputFrame`. The frame is reused (double-buffered); it is valid until the next `sample()` and must not be retained. Digital actions use `down` / `pressed` / `released` / `held(seconds)`. Analog: `lookX`/`lookY` (right stick, [-1, 1]), `thrust`/`strafe`/`vertical` (keys + triggers/sticks, [-1, 1]), `knobX`/`knobY` (left stick X / right stick Y, [-1, 1]), `mouseDx`/`mouseDy` (pointer-lock pixels this tick × `settings.input.mouseSensitivity`). Invert-Y from `settings.input.invertY` is applied to `lookY`, `knobY`, and `mouseDy` (default off: mouse-up is positive). Gamepad sticks use a radial dead zone from `settings.input.gamepadDeadzone`. Those three live in the save blob; the Input service reads them each tick and does not store copies.
- **`ModeContext.input`** is the `InputService` (optional on the type so parallel tasks don't have to construct one; the App always supplies it). The App samples once per sim step (`modes.handleInput(input.sample(dt))` then `update`).
- **Bindings** (`input/bindings.ts`) persist under `nonspace.bindings`, not the save blob. Defaults match §3.9. `rebind(target, source, slot)` steals a colliding physical control. `listenRebind` captures the next key/button/axis (Esc cancels). On the standard mapping, Menu and Start are the same button (index 9): pause is a tap, jack-out is a 1 s hold; keyboard keeps Esc vs J. Shift is boost and fine-adjust; A / LMB is engage (press) and download (hold).
- **Text capture** (`beginTextCapture` / `endTextCapture`) suspends action and axis bindings and records printable keys, Backspace, Enter, Escape. Pointer lock exits silently when capture starts.
- **Pointer lock**: click the canvas to enter; Esc exits. The browser swallows that Esc, so an unlock that we didn't request is reported as `pause` pressed for one tick.
- **`settings.holdToToggle`**: for hold actions (`boost`, `fineAdjust`, `download`, `jackOut`) a press latches `down` until the next press.
- **Lab**: `?lab=input` is the live action HUD (also exposes `window.__nonspace`). Gamepad-only and mouse-only are both playable from the default map.

### 9.13 Contract notes from M5.2 (repo copy only)

- **`audio/sfx/*`**: every §7.3 recipe is a real graph, dispatched from `AudioEngine.sfx`. Flight wind is a looping beam hiss (`catalog.setFlight(speed)` / lab handle `setFlight`); `gridTick` is the line-crossing click a later flight controller fires. `SfxId` is unchanged.
- **`audio/modem.ts`**: Bell 103 FSK (originate 1070/1270 Hz, answer 2025/2225 Hz, 300 baud) with handshake chirps, then full-duplex random bit streams, band-limited and mixed low. Replaces the M5.1 modem stub. `modem.start()` / `modem.stop()` on §9.7 are unchanged.
- **`audio/dixieVoice.ts`**: formant-bank barks (`bark(lineId)` is deterministic from the id via `hashString` + PCG32) and a gated-noise laugh (no inhale). Not added to the §9.7 interface — M7.2 imports the module. The lab handle exposes `dixie()`.
- **`bindSfxToEvents(bus, engine, dixie?)`**: maps §9.1 events onto sfx / modem / Dixie even when visuals are still stubs. Flatline is event-driven; `FLATLINE_TIMING` / `flatlinePhaseAt(elapsed)` are the shared clock so a visual stub (and later Flatline mode) can lock to the audio. §9.1 itself is unchanged.
- **`createNoopAudioEngine()` / `createRecordingAudioEngine()`**: unchanged.
- **Dev route:** `?lab=sfx`. Does not need WebGL2.

### 9.14 Contract notes from M5.3 (repo copy only)

- **§9.7 unchanged.** `createNoopAudioEngine` / `createRecordingAudioEngine` unchanged. SFX recipes stay M5.2; Phase Lock coupling beyond in-key tones stays M5.4.
- **`pulse(t, bpmOrClock?)`** (`audio/music/Sequencer.ts`, re-exported from `audio/AudioEngine.ts`): 0..1 raised-cosine envelope, **1 on each quarter-note beat**. Default 96 BPM / origin 0. Pass a live `TempoClock` (from `getTempoClock(engine)`) so constructs stay in sync with the sequencer (±10 ms).
- **`getTempoClock(engine)`**: `{ bpm, origin, beatsPerBar, stepsPerBar }` for the Web Audio engine; `null` on the no-op. `origin` is AudioContext time of beat 0 after `unlock()`.
- **`music.setState`**: crossfades layer gains over **1 bar** at the current tempo. `kuangDive` sets 128 BPM unless `setTempo` was already called. `grip` ducks the music bus −24 dB for the duration of the state.
- **`music.setKey(root, mode)`**: adaptive layers and Phase Lock stub tones (`a·f0`, `b·f0`) quantize onto the mission scale (`phaseLockTones` in `audio/music/Harmony.ts`).
- **Motifs**: corp patterns in `audio/music/motifs.ts` (HRTF + inverse-distance gain). `motifDistanceGain` / `shouldAttachMotif` are the renderer hook for attach/detach with distance. Approach boosts attached motifs.
- **Diagnostics** (lab / e2e only): `clock`, `crossfade`, `pulse` alongside the existing `music` object.

### 9.15 Contract notes from M2.5 (repo copy only)

- **`FlightController`** (`player/FlightController.ts`) is a factory. `step(frame, dt, opts?)` is the only way the sim advances; it is pure (no DOM, no Three, no clock). `params` is a mutable copy of the §3.3 table (plus look/spring extras) so Tweakpane can bind it. `pose` is the end of the last step; `prev` is the start, for render interpolation. `telemetry` is a live readout object (also Tweakpane-bound). Defaults: cruise 80 u/s, boost 600, accel 120/900, drag half-life 0.6 s, pitch ±85°, visual bank 6°, auto-level 0.3 s, FOV 75° +12° with speed.
- **Who steps it.** The App constructs the controller (and an empty `CollisionWorld`) and puts it on `App.flight` / `ModeContext.flight?`. `?lab=flight` is what currently calls `step`. The future matrix mode MUST call `step` once per sim tick and MUST NOT also let the App step it (the lab flag is the gate today).
- **Input.** Look = `mouseDx/Dy` (already sensitivity-scaled) + `lookX/Y` stick, pitch-clamped. Thrust/strafe are look-relative; `vertical` is world-up. `down('boost')` switches accel and max speed. `opts.reduceMotion` forces banking and FOV kick off (§8.10).
- **Grid assist** (on by default): when the look heading is within `gridAssistConeDeg` (15°) of a world axis, yaw/pitch slerp toward that axis at `gridAssistRateDeg` (30°/s). Disable with `params.gridAssist` (lab checkbox + debug GUI).
- **Ceiling.** Above 12,000 u a spring pushes down and `controlScale = 1 / (1 + over / ceilingSluggish)` scales look and thrust. Soft: the player can overshoot; they are not teleported onto the line.
- **Collision** (`player/Collision.ts`): spheres and AABBs, `kind: 'construct' | 'ice'`. Within 20 u a spring pushes out and `telemetry.flare` / `iceContact` report the closest hull. The player point cannot stay inside: a just-entered frame is fully corrected, a deep spawn is pushed at `hullPushMax` u/s. Trace accrual is not applied here (Trace does not exist yet); poll `telemetry.iceContact`.
- **`CameraRig`** (`player/CameraRig.ts`) writes an interpolated pose onto a `THREE.PerspectiveCamera` (`rotation.order = 'YXZ'`). Banking is visual-only roll. It does not use the M0.4 Renderer service — pass `renderer` (today a `WebGLRenderer`) into `?lab=flight`.
- **Lab:** `?lab=flight`. Click the canvas for pointer lock. Debug GUI folder `flight` is the §3.3 table. Pass `renderer.three` (the `WebGLRenderer`) into the lab; `App.renderer` is the M0.4 service.

### 9.16 Contract notes from M0.4 (repo copy only)

Render skeleton. M1.4–M1.8 replace **their own pass file** and must not edit sibling passes, `PostChain.ts`, or `targets.ts`.

- **`settings.graphics.quality`** (`auto|low|medium|high`) maps through `render/quality.ts` onto a resolved `QualityConfig` (`tier`, `baseScale`, `persistence`, `bloomMips`, `latticeRadius`, line/point caps, `hdr`). `auto` picks Low on software/no-HDR, Medium on typical integrated, High on discrete / Apple silicon. `?quality=` is a session override and does not write the save. Reduce Motion forces `persistence: false`.
- **`App.renderer`** is the `Renderer` service (`render/Renderer.ts`), not a raw `THREE.WebGLRenderer`. The Three instance is `renderer.three`. `ModeContext.renderer` is optional so existing ModeStack unit tests stay unchanged; the App always provides it.
- **`PostPass`** (`render/post/pass.ts`): `{ name, slot, kind?, resize, render(input, ctx) → Texture, dispose }`. Identity / disabled passes **return `input` unchanged** and allocate nothing. Slots: `persistence` (M1.4, `PersistencePass.ts`), `bloom` (M1.5, `BloomPass.ts` writes `ctx.bloom` and returns combined), `blackIce` (M1.8, `BlackIceComposite.ts`; stub adds bloom when present), `crt` (`VectorCrtPass.ts` M1.6 / `RasterCrtPass.ts` M1.7, selected by `PostMode`), `final` (M0.4). Beach skips CRT.
- **`PostContext.encoded`**: `'hdr'` until a CRT pass tonemaps. FinalComposite applies Reinhard + desaturate-to-white only while `'hdr'`. When VectorCrtPass (or RasterCrtPass) tonemaps, it MUST set `encoded = 'ldr'` so the backbuffer is not darkened twice.
- **Targets** (`render/targets.ts`): `hdrScene` (RGBA16F + depth, RGBA8 fallback if the half-float framebuffer probe fails), `persist` ping-pong (for M1.4), `post` ping-pong, `blackIceMask` (R8), `hud`, `simstim` 320×240 RGBA8. Extra RTs (bloom mips) should be allocated inside the owning pass via `createColorTarget` / `createPingPong`.
- **Dynamic resolution** (`render/dynamicRes.ts`): GPU ms > 15 for 30 frames → scale −0.1 down to 0.6; < 12 ms for 30 frames → step back up. `inject(ms)` is the artificial-load hook (debug GUI + tests). Effective internal size = CSS × min(DPR, 2) × `baseScale` × dynres scale.
- **Dev route**: `?lab=render` draws the HDR test cube. `window.__nonspace` is also exposed on that route (not only `?debug`). `?lab=flight` skips PostChain and draws with `renderer.three`.

---

## 10. Milestones and tasks

### 10.1 How to use this section

- Each task is sized for **one coding agent in one focused session**. It lists **depends on**, **deliverables** (files from Section 8.11) and **acceptance criteria (AC)**.
- **Definition of done (all tasks):** TypeScript strict with no errors; ESLint clean; unit tests for pure logic; no console errors or WebGL warnings; no per-frame allocations in hot paths; dev route or Look Lab hook to see the work; **screenshot or short capture** attached to the PR for visual tasks; perf numbers for render tasks (GPU ms at 1080p on the reference machine or the Look Lab's GPU timer).
- Tasks marked **[parallel]** can run at the same time once their dependencies are met. **Waves** at the end of the section show the recommended parallel schedule.

### M0 — Foundations

**M0.1 Repo scaffold**
- Depends on: —
- Deliverables: Vite + TS + Three.js project; ESLint/Prettier; Vitest; Playwright with headless Chromium WebGL2; `vite-plugin-glsl`; Tweakpane debug GUI behind `?debug`; GPU timer util; CI workflow (lint, test, build, e2e smoke); folder skeleton per 8.11; `README` with commands.
- AC: `npm run dev` shows a black full-window canvas with an FPS/GPU-ms readout under `?debug`; `npm test` and `npm run e2e` pass in CI; `npm run build` emits `dist/` under 1 MB; the WebGL2 check shows a friendly unsupported-browser page when WebGL2 is unavailable.

**M0.2 Core loop, modes, events, RNG** [parallel]
- Depends on: M0.1
- Deliverables: `core/loop.ts` (fixed 60 Hz sim, render interpolation), `app/ModeStack.ts`, `core/events.ts` (typed bus per 9.1), `core/rng.ts` (PCG32), `core/hash.ts`, `core/save.ts` + `settings.ts` (versioned localStorage).
- AC: unit tests prove PCG32 determinism against fixed vectors; ModeStack tests cover push/pop/cover/simulatesWhenCovered; the sim runs at fixed steps under throttled CPU; the save round-trips and a migration test passes.

**M0.3 Input service** [parallel]
- Depends on: M0.1
- Deliverables: `input/*` with an action map, pointer lock, gamepad, text-capture mode, a remap API.
- AC: a test page shows live action states; pointer lock enters on click and exits on Esc; the gamepad works with the standard mapping; text-capture suspends actions; bindings persist.

**M0.4 Render skeleton and post chain** [parallel]
- Depends on: M0.1
- Deliverables: `render/Renderer.ts`, `targets.ts` (HDR 16F with an RGBA8 fallback), `PostChain.ts` (pass interface, ping-pong helpers, resize/DPR), `quality.ts`, `dynamicRes.ts`, a pass-through `FinalComposite`.
- AC: a test cube renders into HDR and is tonemapped to screen; resizing and DPR changes don't leak targets (checked via `renderer.info`); the quality tier switches at runtime; dynamic resolution responds to an artificial GPU load.

### M1 — The Look (the art pipeline; can largely run in parallel)

**M1.1 Beam line renderer** [parallel]
- Depends on: M0.4
- Deliverables: `BeamBatch` (static + dynamic, per 9.2), `beamLine.vert/.frag`, `palette.ts`.
- AC: 150k segments render at ≤ 3 ms GPU at 1080p on the reference machine; segments crossing the near plane render correctly with no flipping or spikes (test scene: lines passing through the camera); sub-pixel lines don't shimmer during slow camera motion (width conservation); vertex dwell is visible and tunable; palette uniform changes recolor everything live; fog fades to black.

**M1.2 Lightpoints and traffic shader** [parallel]
- Depends on: M0.4
- Deliverables: `PointBatch`, `lightPoint.*`, `traffic.vert` with a path texture.
- AC: 60k points in one draw at ≤ 1 ms; traffic points move along polyline paths at constant speed with no jitter at path joints; distance attenuation keeps far points at 1.5 px minimum without aliasing.

**M1.3 Ground grid and local lattice** [parallel]
- Depends on: M0.4, M1.1 (lattice uses beams)
- Deliverables: `GroundGrid.ts`, `groundGrid.frag` (3 line levels, analytic AA, checker cells, warp-field uniforms), `LocalLattice.ts` (camera-centred cell window, spherical fade).
- AC: no visible moiré or aliasing at grazing angles from altitudes 2–5,000 u; the grid reads as infinite (no hard edge or horizon glow); the warp field visibly bends lines with 4 control points; the lattice reveals smoothly with no popping as the player moves across cells.

**M1.4 Phosphor persistence pass** [parallel]
- Depends on: M0.4
- Deliverables: `PersistencePass.ts`, `persistence.frag`.
- AC: moving lines leave trails that shift from blue-white to yellow-green; frame-rate independence (trail length matches at 30/60/144 fps within 10%); angular-velocity anti-smear works; the comfort setting disables or shortens trails.

**M1.5 Bloom, halation and tonemap** [parallel]
- Depends on: M0.4
- Deliverables: `BloomPass.ts` (6 mips), halation mip, tonemap in `VectorCrtPass` stub.
- AC: bloom costs ≤ 1.2 ms at 1080p; hot lines (intensity 4) desaturate toward white; the bloom radius is controllable per palette state (Wintermute ×2 hook).

**M1.6 Vector CRT composite** [parallel]
- Depends on: M1.5
- Deliverables: `VectorCrtPass.ts` (barrel, jitter, flicker tied to a load metric, vignette, glass, grain, true black).
- AC: all effects are individually toggleable in the debug GUI; with "Reduce flashing" on, flicker amplitude is 0; the black floor measures RGB (0,0,0) in empty regions; text (Hershey) remains readable at 1080p.

**M1.7 Raster CRT and NTSC pass** [parallel]
- Depends on: M0.4
- Deliverables: `RasterCrtPass.ts`, `rasterCrt.frag`, transition params (H-hold roll, static, tracking).
- AC: a test card (SMPTE bars + text) shows visible chroma bleed (I/Q) greater than luma blur, 240 scanlines, an aperture grille and curvature; the transition plays in 0.3 s and passes the flash rule (≤ 3 flashes/s, low contrast).

**M1.8 Black ICE mask pipeline** [parallel]
- Depends on: M1.1, M1.5
- Deliverables: `blackIce.frag`, `BlackIceComposite.ts`, UV edge-line material with crawl.
- AC: a black ICE solid in front of a bright construct makes that region truly black *including its bloom*; its edges glow ultraviolet and crawl; screen-edge tendril overlay mode works (for grip).

**M1.9 Look Lab (art integration scene)**
- Depends on: M1.1–M1.8
- Deliverables: `debug/LookLab.ts` (`?lab=look`): ground grid, lattice, hand-placed ESFA ziggurat, Mitsubishi cube stacks, T-A slabs, a white ICE shell, a black ICE shard, traffic, placeholder spiral-arm points, free-fly camera. Playwright screenshot test with tolerance.
- AC: **art review checklist** passes: (1) no horizon glow, (2) blacks are black, (3) persistence trails visible on motion, (4) vertex dwell visible, (5) black ICE eats glow, (6) corp shapes distinguishable in grayscale, (7) holds 60 fps on the reference integrated GPU at 1080p, Medium tier. Golden screenshots are committed.

### M2 — The Matrix (world and movement)

**M2.1 Construct grammar** [parallel]
- Depends on: M0.2 (rng), M1.1 (for preview only)
- Deliverables: `world/constructs/{grammar,primitives,lod}.ts`, all primitives in the 8.6 table, producing `LineSet` + face triangles + `PointSet`; `?lab=grammar`.
- AC: unit tests show deterministic output for a given seed and params; every primitive previews in the lab with live param sliders; LOD far/mid/near are generated with segment counts within the budget table; edges dedupe (no doubled lines, which would look brighter).

**M2.2 Corp heraldry and landmarks content** [parallel]
- Depends on: M2.1
- Deliverables: `content/corps.ts`, `content/landmarks.ts` (T-A Straylight, T-A Berne, Mitsubishi BoA, ESFA, Sense/Net, Hosaka, Turing Geneva, Chiba black-clinic node, M3 Hosaka node), rhythm animation hook (`pulse(t, tempo)`).
- AC: each landmark renders in the lab at its heraldry; rhythms sync to a mock tempo clock; the grayscale-distinguishability check passes.

**M2.3 Sector streaming and procedural population**
- Depends on: M2.1, M0.2
- Deliverables: `world/{coords,Sector,SectorStreamer,sectorWorker,densityMap}.ts`, `traffic/routing.ts`, authored `density.png` and `regions.png` (first pass).
- AC: flying in a straight line at boost speed for 2 minutes produces no frame hitch above 4 ms from streaming (worker gen plus budgeted upload); returning to a sector reproduces identical content; far landmarks remain visible as points from any sector; traffic routes Manhattan-style along the grid.

**M2.4 Sky: spiral arms and far constellations** [parallel]
- Depends on: M1.2
- Deliverables: `world/sky/*`.
- AC: 40k points in one draw; 0.1× parallax; imperceptible rotation; the arms read as unreachable when climbing to the ceiling.

**M2.5 Flight controller and camera rig** [parallel]
- Depends on: M0.2, M0.3
- Deliverables: `player/{FlightController,CameraRig,Collision}.ts` per 3.3, grid assist, ceiling, soft hull collision, banking/FOV options.
- AC: matches the 3.3 parameter table (exposed in the debug GUI); grid assist snaps within 15° and can be disabled; the player cannot enter a hull and gets pushed out smoothly; the ceiling behaves softly; a unit test integrates the controller deterministically at a fixed dt.

**M2.6 Coordinate jump and address book**
- Depends on: M2.5, M2.3, M3.3 (deck panel input; can stub)
- Deliverables: `player/CoordinateJump.ts`, `fx/JumpStreak.ts`, address book in deck.
- AC: typing valid coordinates jumps there in 1.5–3 s, arriving at rest 300 u from the target; invalid coordinates give a deck error beep; the jump is blocked in grip, inside cores and at trace 100%; sectors at the destination are ready on arrival (preload during the streak).

**M2.7 Jack-in and jack-out sequences**
- Depends on: M1.9, M2.3
- Deliverables: `fx/JackInSequence.ts` (phosphenes, origami fold, grid race-out, landmark fade, HUD boot), `fx/CrtCollapse.ts`, `modes/JackIn.ts`, `modes/JackOut.ts`.
- AC: a 5.5 s full version and a 1.2 s short version; skippable on any key after the first viewing; passes the flash rule (verified by stepping frames and measuring large-area luminance changes); jack-out collapse in 0.6 s.

### M3 — Deck and HUD

**M3.1 Text rendering** [parallel]
- Depends on: M1.1
- Deliverables: `HersheyText.ts` (Hershey JSON → `LineSet`, world-space billboarded and screen-space), `BitmapText.ts` (Px437 atlas), `VfdText.ts` + `vfd.frag` (7/14-seg with ghost segments), font asset conversion script.
- AC: all three render the full ASCII range; Hershey text is legible at 16 px cap height at 1080p; VFD ghost segments are visible at 6%; attribution for CC BY-SA fonts is added to the credits file.

**M3.2 HUD** 
- Depends on: M3.1, M1.1, M0.4 (hudRT)
- Deliverables: `hud/{Hud,Radar,EegTrace,VfdStrip,Bargraph,Terminal,Pip,Reticle}.ts` per 6.2; HUD render target composited after the CRT pass.
- AC: all elements are driven by events or mocks in a `?lab=hud` page; the EEG morphs smoothly from calm to ragged to flat across neural 0–100 and flatline; the terminal prints at 1200 baud and Wintermute mode prints instantly; layout holds at 16:9, 21:9 and 4:3; the HUD is unaffected by barrel distortion.

**M3.3 Deck panel and DOM menus**
- Depends on: M3.2, M0.3
- Deliverables: `hud/DeckPanel.ts` (COORD, SOFTS, LOG, PING, STATUS), `hud/dom/{Settings,Subtitles}.ts`, title/boot POST screen (`modes/Boot.ts`, `modes/Title.ts`) with the audio-unlock key press.
- AC: the deck opens and closes without pausing the sim; coordinate entry works with text capture; settings cover all options in 8.10; subtitles render and scale; the title key press calls `audio.unlock()`.

### M4 — Breach

**M4.1 Phase Lock prototype (2D, standalone) — GO/NO-GO gate**
- Depends on: M0.1 (can start on day one; Canvas2D or simple WebGL lines)
- Deliverables: `debug/PhaseLockLab.ts` (`?lab=phaselock`), `breach/PhaseLock.ts` (pure math), simple Web Audio stereo tones (no engine needed).
- AC: the match metric and lock meter behave per 3.5 (unit tested); rolling visibly matches frequency difference; telegraphed re-keys; 3 difficulty presets; a **playtest note** (≥ 3 testers or recorded self-tests over 10 tries each) reports time-to-lock distributions and whether it's fun under re-key pressure. **The coordinator decides go/no-go before M4.3+.**

**M4.2 ICE model and visuals**
- Depends on: M4.1 (math), M2.1 (shells), M1.8 (black ICE)
- Deliverables: `breach/IceModel.ts` (layers per 9.3, drift, re-key scheduler, grip state), `breach/IceVisuals.ts` (nested counter-rotating shells, moiré hatching via `iceFacet.frag`, active facet + Lissajous figures as dynamic beams, shatter via `fx/Shatter.ts`), content: `content/ice/{white,gray,black}.ts`.
- AC: all 3 classes are visually distinct in grayscale; shatter runs 1.2 s with persistence trails; the re-key telegraph is visible and audible (mock sfx); black ICE grip tendrils trigger correctly.

**M4.3 Breach controller and consequences**
- Depends on: M4.2, M2.5, M3.2
- Deliverables: `breach/BreachController.ts`, `breach/Grip.ts`, `deck/{NeuralLoad,Trace,Heat}.ts`, `modes/Breach.ts`, `modes/Flatline.ts` (sequence per 3.6), engage/disengage rules, HUD wiring.
- AC: engaging from ≤ 60 u facing a facet enters breach; knobs map per 3.9; trace and neural follow 3.6 rates (unit tests with a simulated clock); grip disables jack-out and enforces the 8 s countdown; flatline plays its full sequence and returns to the checkpoint with a scar; burned forces a jack-out.

**M4.4 Softs system** [parallel after M4.3 interface]
- Depends on: M4.3
- Deliverables: `deck/softs/{registry,effects}.ts`, `content/softs.ts` per 9.4, HUD slots and cooldowns, Dixie read hook (`H`) as a soft-like ability.
- AC: each soft's effect is verifiable in `?lab=phaselock3d` (in-matrix breach test); charges and cooldowns persist per run; MIMIC converges per its rate; DECOY lures watchers.

**M4.5 Core interior and download**
- Depends on: M2.1, M4.3, M1.2
- Deliverables: `breach/CoreInterior.ts`, `modes/Core.ts`, target/decoy constellations, download hold, exfil choice (jack out vs route out with re-freezing layers).
- AC: core generation is deterministic by seed; the target constellation pulses on-beat and decoys off-beat; download progress emits events; route-out scrubs 30% trace; cracked layers re-freeze over the configured time.

**M4.6 Watchers and sweeps** [parallel]
- Depends on: M2.3, M4.3 (trace)
- Deliverables: `world/watchers/Watcher.ts` (Turing/sysop sweep beams, detection cones, trace gain, DECOY lure), radar blips.
- AC: sweep beams are visible as vector fans; exposure raises trace at the configured rate; decoys divert watchers for their duration.

### M5 — Audio

**M5.1 Audio engine** [parallel]
- Depends on: M0.1
- Deliverables: `audio/{AudioEngine,buses,spatial}.ts`, FM and noise AudioWorklets, voices (FM, subtractive, drums, bass), limiter, ducking, the API in 9.7 (stubs where needed).
- AC: unlock on gesture works across Chrome, Firefox and Safari; 16 simultaneous FM voices with no glitches at 128-frame buffers on the reference machine; HRTF panning for motifs; duck works.

**M5.2 SFX catalog** [parallel]
- Depends on: M5.1
- Deliverables: `audio/sfx/*` with every recipe in 7.3, `audio/modem.ts` (FSK), `audio/dixieVoice.ts` (barks and laugh).
- AC: a `?lab=sfx` page with buttons for every SFX; the modem is recognizable to testers; the flatline sequence is timed to the visual (event-driven).

**M5.3 Adaptive music and motifs**
- Depends on: M5.1
- Deliverables: `audio/music/{Sequencer,Harmony}.ts`, patterns per state (7.2), corp motifs, tempo clock exported to the renderer for rhythm sync (`pulse(t)`).
- AC: state changes crossfade within 1 bar; motifs attach and detach with distance; the tempo clock drives construct pulses in sync (±10 ms); the Phase Lock tones are in the mission key.

**M5.4 Phase Lock audio coupling**
- Depends on: M5.1, M4.3
- Deliverables: `audio.phaseLock` implementation; consonance and beating; re-key slides; grip soundscape.
- AC: matches the 2D prototype's feel; audio can be disabled without harming solvability.

### M6 — Simstim and meatspace

**M6.1 Simstim renderer and feed system**
- Depends on: M1.7, M0.2
- Deliverables: `render/simstim/{SimstimRenderer,flatDither.frag}`, `simstim/{SimstimFeed,MollyTimeline,Gates,Pain}.ts`, `modes/Simstim.ts` (overlay, flip/peek/lag), PIP thumbnail feed, chip clock overlay.
- AC: the timeline plays in meat time whether or not flipped; flipping is instant with transition; the matrix keeps simulating underneath (verified: a re-key happens while flipped); gate events fire with early/late/hit; wait segments accrue exposure; pain overlays and the echo into neural load work.

**M6.2 Simstim content: Sense/Net**
- Depends on: M6.1
- Deliverables: low-poly flat-shaded Sense/Net lobby, corridors and vault as `.glb` (Blender, ≤ 3k tris per scene), 3 gate locations, guard mannequins, Panther Moderns panic (abstracted crowd shapes, alarms), Molly's lines, timeline file.
- AC: plays end-to-end in `?mission=m2` with gates hit on time; reads as "a building" through the raster CRT at 320×240.

**M6.3 Simstim content: Straylight**
- Depends on: M6.1
- Deliverables: Straylight villa interiors (low-poly, ornate as abstraction: arches, stairwells, the cameo head as an emissive low-poly object), Molly's injury segment, 3Jane, Hideo and Riviera mannequins, the word scene for M7.
- AC: as M6.2, for M5 and M7 timelines.

**M6.4 Teletext renderer and interludes** [parallel]
- Depends on: M1.7, M0.3
- Deliverables: `meat/{Teletext,TeletextPage,Interlude}.ts` (Canvas2D 40×24, mosaic graphics, double height, page header clock), `narrative/InkRuntime.ts`, `modes/Interlude.ts`, Ink build script.
- AC: renders an authentic teletext test page (all 8 colors, mosaics, double height); Ink choices via 1–4; pages pass through the raster CRT; a ringing-phone animation and audio hook.

### M7 — Narrative, AI, missions

**M7.0 Story bible and fidelity pass** [parallel, writer]
- Depends on: —
- Deliverables: `docs/story-bible.md` in the repo: character voice notes, the timeline of book beats used, a list of design licenses taken, short-quote inventory (each ≤ ~10 words), names checked against the text; Ink source for P0, M1–M7 and Dixie barks.
- AC: every beat in Section 4.4 has a verified-against-text note or is flagged "invented"; no quoted passage exceeds a short phrase; Ink compiles.

**M7.1 Mission runner**
- Depends on: M0.2, schema in 9.5
- Deliverables: `narrative/{MissionRunner,schema,triggers}.ts`, checkpoints, objective tracking, timeline actions, the `?mission=&checkpoint=` debug route.
- AC: zod rejects malformed missions with readable errors; unit tests run a scripted mock mission through triggers (time, meatTime, event, near, flags, all/any); checkpoint restore reproduces state.

**M7.2 Dixie companion**
- Depends on: M7.1, M5.2, M3.2
- Deliverables: `companion/{Dixie,barks}.ts`: event-driven barks with rate limits (≤ 1 per 12 s unless critical), the `H` read, auto-hold during simstim (holds lock meter decay at 50% efficiency), flatline commentary, the erase prompt.
- AC: barks never overlap; the read reports the correct ratio after 4 s; toggling his auto-hold is visible in the lock meter while flipped.

**M7.3 AI presences**
- Depends on: M1.3 (warp), M1.5 (bloom hook), M3.2 (HUD hijack), M5.3
- Deliverables: `ai/{Wintermute,Neuromancer,Hijack,Persona}.ts`: every behavior in 3.8, the persona vector portrait from SVG paths (convert-at-build script), Neuromancer softening (segment subdivision + bend in `beamLine.vert` behind a flag + warm palette), pull, forced beach.
- AC: each behavior is triggerable from the debug GUI and from mission actions; overexposure and softening are reversible with no leftover state.

**M7.4 Mission P0 + M1 (vertical slice content)**
- Depends on: M7.1, M6.4, M2.7, M4.5, M2.6, M5.3, M7.0 (P0/M1 Ink)
- Deliverables: `content/missions/{p0,m1}.ts`, Chiba cluster landmark set, tutorial prompts (diegetic: Hershey labels on facets and Dixie-less system terminal lines).
- AC: **Vertical Slice** (see 10.2): a new player can complete P0 and M1 in 10–15 min without outside help (3 testers); the e2e test plays M1 via scripted inputs to completion.

**M7.5 Mission M2 "Sense/Net"**
- Depends on: M7.4, M6.2, M4.4, M4.6
- AC: 3 gates with tuned windows; Moderns' panic halves re-key; failure paths (Molly caught, flatline) and retry work.

**M7.6 Mission M3 "The Construct"**
- Depends on: M7.5, M7.2, M7.3
- AC: Dixie onboarding; scripted Berne flatline with no scar; first Wintermute hijack.

**M7.7 Mission M4 "Turing" + Act III interludes**
- Depends on: M7.6, M4.6
- AC: completable with ≤ 2 breaches; heat increases difficulty measurably.

**M7.8 Kuang and the dive**
- Depends on: M4.3, M1.1 (kuang flag), M5.3
- Deliverables: Kuang entity (spline body of iridescent ribs, mimicry color-match animation), tube-dive mode (polygonal tube 8–16 lanes, lane movement, countermeasure crawlers, segment gates with generous Phase Lock), `content/softs.ts` Kuang entry.
- AC: the dive holds 60 fps; lane input feels crisp at constant speed; gates reuse PhaseLock with Kuang tolerance; Kuang's spectrum is unique on screen.

**M7.9 Mission M5 "Kuang Grade Mark Eleven"**
- Depends on: M7.8, M6.3, M7.3, M7.7
- AC: phases A–E play in order with checkpoints per phase; interleaved simstim gates; forced flatline transitions to the beach.

**M7.10 Beach renderer and M6 "The Beach"**
- Depends on: M0.4, M7.1, M5.1
- Deliverables: `render/beach/*`, `modes/Beach.ts` (walk controller), Linda CSG figure, sun cycle, checkerboard bleed-through, dub-bass audio leading to the exit, the stay choice.
- AC: ≥ 60 fps at half-res raymarch on the reference GPU; the checkerboard reveal responds to stillness and gaze; following the bass reliably leads out; staying triggers Ending B.

**M7.11 Mission M7 "True Name", merge, epilogue, endings**
- Depends on: M7.9, M7.10, M7.2
- Deliverables: word-entry climax, the merge sequence (global palette break, line re-flow, grid transformation), Dixie erase prompt, teletext epilogue, optional final jack-in, credits (including font attributions).
- AC: all three endings are reachable; the save reflects completion; credits are complete.

### M8 — Polish and ship

**M8.1 Accessibility pass**: all options in 8.10 verified end to end; a photosensitivity audit of every sequence (frame-step luminance check script); remap UI tested with gamepad only. *Depends on: M7.4 (start), M7.11 (finish).*

**M8.2 Performance pass**: hit 8.7 on the reference integrated GPU across all missions; dynamic resolution tuning; Low-tier fallback verified on a no-float-RT browser config. *Depends on: M7.9.*

**M8.3 Tuning pass**: ICE difficulty curves per mission using the tuning tables (12.3); gate windows; trace rates; 5 external playtests. *Depends on: M7.11.*

**M8.4 QA automation**: Playwright e2e for boot, Look Lab golden, M1 scripted playthrough, mission-schema validation of all content, save migration. *Depends on: M7.4 (grow continuously).*

**M8.5 Release build**: static deploy, cache headers, unsupported-browser page, version stamp, crash/error reporter (console capture to an optional endpoint, off by default). *Depends on: M8.1–M8.4.*

### 10.2 Milestone gates

| Gate | Contents | Exit criteria |
|---|---|---|
| **G1 Look** | M0.*, M1.*, M2.1, M2.2 | Look Lab passes the art checklist and perf; the coordinator approves the art direction from captures |
| **G2 Phase Lock go/no-go** | M4.1 | Playtest note shows lock times within targets and positive fun signal; otherwise switch to the fallback (11.2) |
| **G3 Vertical Slice** | Through M7.4 | P0 + M1 fully playable start to finish with audio, HUD, flatline and retry; 60 fps reference |
| **G4 Alpha** | M7.5–M7.7, M6.* | Acts I–III playable; simstim sync proven fun |
| **G5 Beta** | M7.8–M7.11 | Full campaign and all endings |
| **G6 Release** | M8.* | Accessibility, perf, QA green |

### 10.3 Parallel waves (recommended schedule)

| Wave | Tasks (run concurrently) |
|---|---|
| 0 | M0.1 · M7.0 (writer, independent) |
| 1 | M0.2 · M0.3 · M0.4 · M4.1 · M5.1 |
| 2 | M1.1 · M1.2 · M1.4 · M1.5 · M1.7 · M2.5 · M5.2 · M5.3 · M7.1 |
| 3 | M1.3 · M1.6 · M1.8 · M2.1 · M2.4 · M3.1 · M6.4 |
| 4 | M1.9 · M2.2 · M2.3 · M3.2 · M4.2 · M6.1 · M7.10 |
| 5 | M2.6 · M2.7 · M3.3 · M4.3 · M7.3 |
| 6 | M4.4 · M4.5 · M4.6 · M5.4 · M6.2 · M6.3 · M7.2 · M7.8 |
| 7 | M7.4 (→ G3 Vertical Slice) |
| 8 | M7.5 → M7.6 → M7.7 (sequential content) · M8.4 · M8.1 (start) |
| 9 | M7.9 → M7.11 · M8.2 |
| 10 | M8.3 · M8.1 (finish) · M8.5 |

---

## 11. Open questions and risks

### 11.1 Open questions (need a decision from the user/coordinator)

1. **IP and distribution.** *Neuromancer* is copyrighted, and a TV adaptation is in production, so the rights are actively managed. A free non-commercial fan project is lower risk; anything commercial needs a license. **Fallback:** keep systems IP-agnostic. A "Sprawl-original" content pack can replace names (Case → original cowboy; T-A → an invented orbital dynasty) with no code changes. Decide before M7.0 writing begins.
2. **Protagonist**: Case (default) or an original cowboy who crosses the book's events?
3. **Molly pings**: these are not in the book (Case can't talk back through simstim). Keep them as a design license for agency, or remove them for purity and rely only on timing?
4. **The toxin-sac clock**: should there be a campaign-level real deadline (days between missions), or is it narrative only (current plan)?
5. **Economy**: no money system is planned. Should softs be bought from fences (adds menus and balance work) or remain story unlocks (current plan)?
6. **Voice acting** for Dixie/Molly, or text plus processed barks only (current plan)?
7. **Scope of Act III**: is M4 "Turing" needed, or can Act III be interludes only to reach the Kuang run sooner?
8. **Gamepad parity** at launch or as a stretch?

### 11.2 Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Phase Lock isn't fun** or is too abstract under pressure | Core mechanic fails | Prototype first (M4.1, gate G2). **Fallback mechanic:** "Facet Sequence": ICE facets light in a rhythmic sequence and you fly the breaker through the matching facets on-beat (rhythm-flight); the same ICE data, rhythm replaces ratio |
| Thick additive lines **overdraw** on integrated GPUs | Frame drops at dense clusters | Glow width capped at 3σ (bloom does halos); LOD to points aggressively; segment budgets per tier; GPU timer in Look Lab from day one |
| **Motion sickness** from speed and persistence smear | Players quit | Comfort options default-visible on first boot; anti-smear on angular velocity; no forced camera roll; stable horizon cue (ground grid) |
| **Photosensitive seizures** from flicker/static | Safety | MUST-level flash rule, Reduce Flashing option, automated frame-luminance check (M8.1) |
| **Simstim content cost** (scenes, mannequins, timing) | Schedule | Strict low-poly budget, rigid mannequins, camera paths not character control, reuse modular kit pieces across Sense/Net and Straylight |
| **Near-plane and log-depth bugs** in custom line shaders | Visual glitches | Explicit near-plane clipping in VS; shared `#include` chunks; dedicated test scene in M1.1 AC |
| **Moiré/aliasing** on infinite grid at grazing angles | Ugly, "cheap" look | Analytic AA with density fade per level; test at multiple altitudes (M1.3 AC) |
| **Audio autoplay** restrictions | Silent first experience | Title "press any key" unlock; visual-only solvability |
| **Safari** WebGL2 quirks (float RTs, worklets) | Broken on Mac/iOS Safari | RGBA8 fallback tier; test Safari in CI matrix where possible; AudioWorklet fallback to ScriptProcessor-free simple oscillators |
| **Determinism drift** in proc gen | Sectors change between visits or across browsers | Integer hash + PCG; generation quantizes positions to the grid; unit tests with golden hashes |
| **Book fidelity** errors (wrong order of events, invented details presented as canon) | Fans notice; tone breaks | M7.0 fidelity pass; flag licenses explicitly |
| **Aesthetic drift** toward synthwave/2077 by individual agents | Loses identity | Anti-reference table (2.3); art review checklist at G1; palette locked in code (no ad-hoc colors in the matrix) |
| **Multi-agent integration** conflicts | Rework | Contracts in Section 9 are frozen per wave; changes require updating this doc in the same PR; Look Lab and labs as integration points |

---

## 12. Appendix

### 12.1 Glossary (for agents new to the book)

- **Matrix / cyberspace**: the "consensual hallucination" of the global network, perceived directly by jacking in.
- **Jack in / jack out**: connecting/disconnecting the deck's trodes to the brain.
- **Deck**: the cowboy's console (Case's is an Ono-Sendai Cyberspace 7).
- **Cowboy**: a hacker who runs the matrix to steal data.
- **ICE**: intrusion countermeasures electronics; **black ICE** can kill.
- **Icebreaker / virus**: programs that defeat ICE; **Kuang Grade Mark Eleven** is a Chinese military icebreaker.
- **Flatline**: brain death (a flat EEG); **the Dixie Flatline** is the nickname of McCoy Pauley, a legendary cowboy who survived flatlining, now a ROM personality construct.
- **Simstim**: simulated stimulation, experiencing another person's sensorium.
- **Wintermute / Neuromancer**: twin AIs owned by Tessier-Ashpool (Berne and Rio).
- **Straylight**: the T-A family villa inside Freeside, an orbital resort.
- **Turing (Registry/Police)**: the authority that polices AIs.
- **The Sprawl / BAMA**: the Boston–Atlanta Metropolitan Axis.
- **Meat**: the body, from a cowboy's point of view.

### 12.2 Short-phrase inventory (allowed quotes; verify in M7.0)

"consensual hallucination" · "lines of light ranged in the nonspace of the mind" · "clusters and constellations of data" · "like city lights, receding" · "transparent 3D chessboard" · "stepped scarlet pyramid" · "green cubes" · "spiral arms of military systems" · "distanceless home" · "primitive arcade games" · "the meat". Keep every in-game quote to a short phrase like these; everything else is original writing.

### 12.3 Starting tuning tables

**ICE presets (Normal difficulty)**

| Preset | Ratios | tolRatio | phaseDrift | rekeyEvery | telegraph | lockTime | traceRate | feedbackDps | grip |
|---|---|---|---|---|---|---|---|---|---|
| white-1 (M1) | 1:1, 1:2 | 0.10 | 0.10 | — | — | 2.0 | 0.6 | 0 | — |
| gray-2 (M2) | 1:2, 2:3, 3:4 | 0.07 | 0.25 | 7–10 | 1.2 | 2.5 | 1.0 | 3 | — |
| gray-3 (M3) | 2:3, 3:4, 3:5, 4:5 | 0.06 | 0.35 | 6–8 | 1.0 | 2.5 | 1.2 | 4 | — |
| black-1 (M3 recon, M5) | 2:3, 3:5, 4:5, 5:6 | 0.05 | 0.50 | 4–6 | 0.8 | 3.0 | 1.5 | 9 | 60 / 8 s |
| kuang-gate (M5 dive) | 1:2, 2:3, 3:4 | 0.12 | 0.20 | — | — | 1.2 | 0.8 | 2 | — |

**Difficulty multipliers**

| | Story | Normal | Hard |
|---|---|---|---|
| tolRatio | ×1.6 | ×1.0 | ×0.8 |
| rekey interval | ×1.5 | ×1.0 | ×0.75 |
| telegraph | ×1.5 | ×1.0 | ×0.8 |
| feedbackDps | ×0.4 | ×1.0 | ×1.3 |
| gate windows | ×1.5 | ×1.0 | ×0.75 |

**Proposed Phase Lock tuning (proposed, pending human playtest)**

This comes from the M4.1 scripted playtest (`prototypes/phase-lock/PLAYTEST.md`). With the tables above, a practiced player cracks gray ICE before its first re-key. Grip also fires on the first failed re-key, which happens in 30% of black tries on Normal and 75% on Hard. And `tolRatio` barely matters, because the ratio detents snap R onto the exact ratio. These changes are only in effect where the lab's `T` toggle selects them. Adopt them only after at least 3 human testers × 10 tries confirm them.

| Change | Plan value | Proposed |
|---|---|---|
| gray-2 lockTime / rekeyEvery | 2.5 / 7–10 | 3.5 / 5–7 |
| gray-3 lockTime / rekeyEvery | 2.5 / 6–8 | 3.5 / 4.5–6.5 |
| black-1 grip on a failed re-key | any time | only after 7 s engaged (re-keys still stop during grip) |
| Difficulty: phaseDrift | ×1.0 | Story ×0.7, Normal ×1.0, Hard ×1.2 |
| Difficulty: lockTime | ×1.0 | Story ×0.85, Normal ×1.0, Hard ×1.0 |

Scripted results with these values (average profile, median time to lock): gray-3 Normal 8.3 s, with 66% of tries seeing a re-key and 100% cracked. black-1 Normal 8.3 s, 100% cracked, gripped in 17.5% of tries. black-1 Hard 11.8 s, 98% cracked, gripped in 64%, which is still too often; grip needs another pass.

**Gate windows (M2 starting values)**: early −20 s, late +15 s; exposure 4%/s while waiting; fail at 100%.

**Trace**: hull contact 2%/s; watcher sweep exposure 6%/s; core interior ×1.5 multiplier; burned at 100%.
