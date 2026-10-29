# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of remaining, unimplemented non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap of Unimplemented Models

| Model ID | Model Name | Primary Domain | Core Mathematical / Physical Primitives | Complexity | Status |
|---|---|---|---|---|---|
| `tracy_ribbon` | **Electroplankton Tracy Ribbon** | Continuous Vector Trajectory | Organic spline path curvature, tangent velocity mapping, expressive FM envelopes | Moderate (2.5/5) | **Next / Pending** |
| `self_avoiding_walk` | **Polymer Self-Avoiding Walk** | Molecular Folding / Jamming | Lattice self-avoidance, conformational steric hindrance, collapse cascades | Moderate (3/5) | Backlog |

---

## 2. Core Framework Integration Standards

Every model implementation must strictly adhere to the following shared framework patterns:

1. **Scale Quantization ([js/scale.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/scale.js))**:
   - Always resolve pitch using `getRootMidi()`, `getActiveScaleIntervals()`, and `quantize(rawMidi, intervals, root)`.
2. **Audio & MIDI Engine ([js/player.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/player.js))**:
   - Live note triggers dispatch via `liveNoteOn(note, vel, durMs)` and `liveNoteOff(note)`.
   - Continuous timbre modulation dispatches via `midi.sendControlChange(ccDest, ccVal)` (typically CC #74 Brightness / Cutoff via `dispatchTimbreCc`).
3. **Polyphony Ceiling & Voice Allocation Manager ([js/poly.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/poly.js))**:
   - Every polyphonic model reuses `selectPolyVoices(candidates, maxVoices, strategy)` and `playVoice()`, respecting global `state.polyphony` (1–8) and `state.polyStrategy` (Extrema, Lowest, Highest, Spread, Cluster, Cycle, Random).
   - Guarantees strict $\le 8$ voices FIFO stealing for M-VAVE FM-1 hardware buffer safety and dual MIDI / browser synth dispatch.
   - Polyphony controls are housed in the Notes div and automatically hidden on monophonic models.
4. **Session Snapshot Serialization ([js/snapshot.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/snapshot.js))**:
   - Register under `registerModel({ id, version: 1, migrations: {}, capture(), restore(h) })`.
   - Register ownership prefix in `PREFIX` within `js/snapshot.js`.
5. **State & Lifecycle ([js/state.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/state.js), [js/modes.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/modes.js), [js/rack.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/rack.js))**:
   - Mirror pitch parameters (`scale`, `root`, `pitchSpan`).
   - Wire `init<Model>()`, `activate<Model>Model()`, and `deactivate<Model>Model()`.
   - Supply `generate<Model>Bank()` returning a valid bank structure (`[{ length: seqLen, steps, rate }]`) so step-based UI components never throw undefined errors.
6. **Workbench Aesthetics ([.agents/rules/style.md](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/.agents/rules/style.md))**:
   - Zero CSS or canvas gradients (`linear-gradient`, `createLinearGradient`).
   - Dynamic token resolution via `getComputedStyle(document.documentElement)` (`--panel`, `--panel2`, `--line`, `--accent`, `--ok`, `--err`).

---

## 3. Active Specification: Electroplankton "Tracy" Ribbon Path Trajectory

- **Model ID**: `tracy_ribbon`
- **Category**: Continuous Vector Trajectory / Organic Gestural Graphics / Spline Kinematics.
- **Architectural Scope**: Inspired by Toshio Iwai’s Tracy plankton creature from Nintendo *Electroplankton*. The user draws or records continuous freehand vector gestures across an aquatic workbench canvas to construct a closed, looping ribbon contour. An autonomous Tracy creature navigates the closed ribbon with continuous momentum, centripetal acceleration, and organic swimming wiggle.
- **Mathematical Formulation**:
  - Closed Catmull-Rom or cubic B-spline interpolation parameterized by arc length $s \in [0, L]$.
  - Tangent vector $\mathbf{T}(s) = \mathbf{r}'(s) / \|\mathbf{r}'(s)\|$, normal vector $\mathbf{N}(s)$, and local curvature $\kappa(s) = \|\mathbf{r}'(s) \times \mathbf{r}''(s)\| / \|\mathbf{r}'(s)\|^3$.
  - Creature kinematics: Position $\mathbf{r}(t)$ advances with variable speed $v(t) = v_0 \cdot (1 - \beta \kappa(s))$ (creature slows naturally when rounding sharp bends, accelerates through long open straights).
- **Musical Mapping**:
  - Spatial coordinates $(x(s), y(s))$ map to 2D scale pitch and octave degrees.
  - Local path curvature $\kappa(s)$ modulates gate duration, velocity dynamics, and FM modulator depth (sharp turns trigger punchy staccato pings, while smooth arcs generate lyrical legato swells).
  - Swimming tail oscillations spawn trailing polyphonic echo droplets (up to 8 polyphonic voices managed via `js/poly.js`).
  - Speed $v(s)$ and tangential acceleration continuously modulate FM-1 CC #74 Brightness.

---

## 4. Backlog Models Catalogue (Two-Sentence References)

For future reference and extension, these additional models are documented with concise descriptions:

1. **Self-Avoiding Random Walk (Polymer Chain Folding)**: A growing molecular polymer chain steps randomly onto neighboring unoccupied lattice nodes while strictly forbidding self-intersection. When the chain approaches conformational jamming (steric hindrance traps), the chain collapses and folds with an explosive, harmonically resolved chord cascade before initiating a new structural domain.
