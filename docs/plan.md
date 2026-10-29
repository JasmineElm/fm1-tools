# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of remaining, unimplemented non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap of Unimplemented Models

| Model ID | Model Name | Primary Domain | Core Mathematical / Physical Primitives | Complexity | Status |
|---|---|---|---|---|---|
| `self_avoiding_walk` | **Polymer Self-Avoiding Walk** | Molecular Folding / Jamming | 2D lattice self-avoidance, conformational steric hindrance, collapse cascades | Moderate (3/5) | **Completed** |

**All generative and non-step sequencer models across the FM-1 Pulses roadmap are now 100% complete!**

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

## 3. Active Specification: Polymer Self-Avoiding Walk & Steric Jamming Folding

- **Model ID**: `self_avoiding_walk`
- **Category**: Statistical Polymer Physics / Molecular Conformation / Kinetic Jamming.
- **Architectural Scope**: Simulates a growing self-avoiding random walk (SAW) on a 2D discrete lattice representing synthetic polymer chain growth and molecular protein folding. At each step, the polymer head advances randomly to an adjacent lattice site strictly subject to the self-avoidance constraint (it can never intersect its own existing monomers).
- **Mathematical Formulation**:
  - 2D grid lattice $\mathbb{Z}^2$.
  - Chain path $\omega = (\omega_0, \omega_1, \dots, \omega_N)$ with $\|\omega_{i+1} - \omega_i\| = 1$ and $\omega_i \neq \omega_j$ for all $i \neq j$.
  - Neighborhood coordination number $z = 4$ (Von Neumann neighbors). Available forward moves: $A(\omega_N) = \{ v \in \mathcal{N}(\omega_N) \mid v \notin \omega \}$.
  - Steric Hindrance & Jamming Trap: When $|A(\omega_N)| = 0$, the chain is deadlocked (steric entrapment).
  - Collapse & Folding Cascade: Upon jamming or reaching target chain length, the trapped polymer undergoes global conformational collapse / structural annealing, discharging an explosive, harmonically resolved polyphonic chord cascade before crystallizing a new structural domain.
- **Musical Mapping**:
  - Each polymer monomer addition triggers a melodic step quantized to the active scale based on 2D coordinates and turn angle.
  - Steric trapping / deadlock events trigger an explosive, harmonically resolved polyphonic chord cascade across up to 8 voices (`js/poly.js`).
  - Chain radius of gyration $R_g$ and mean end-to-end distance continuously modulate FM-1 CC #74 Brightness.

---

## 4. Completed Model Specifications

### 4.1 Electroplankton Tracy Node Grid Path Tracing Sequencer

- **Model ID**: `tracy_ribbon`
- **Category**: Kinetic Path Tracing / Multi-Agent Route Navigation.
- **Architectural Scope**: Inspired by Toshio Iwai's *Electroplankton* Tracy creature, this model features an interactive 2D node matrix ($8 \times 6 = 48$ nodes) where users directly trace looping routes for up to 8 simultaneous creatures.
- **Mathematical & Structural Primitives**:
  - Discrete Node Grid: $\text{Cols} = 8$ by $\text{Rows} = 6$ ($48$ interactive nodes).
  - Notes Div & Pitch Confinement: All node pitches strictly sit within both the active scale (`state.scale`, `state.customScale`) and the octave spread (`state.pitchSpan` $\in [1, 4]$) configured in the global Notes div, starting at `getRootMidi()` and obeying `state.octaveMode`.
  - Multi-Creature Routes: Up to 8 creatures simultaneously traversing independent closed circuits.
  - Per-Creature Parameters: Individual path waypoints, distinct base pitch chosen from the scale defined in the notes div (displayed with note name), and definable speed multiplier ($0.25\times \dots 3.0\times$).
  - Curated Color Palette: 8 distinct flat color circles (`#00f0ff`, `#ff007f`, `#ffb700`, `#39ff14`, `#a855f7`, `#38bdf8`, `#f43f5e`, `#eab308`).
  - Polyphony & Audio Dispatch: Dispatches note events on node arrivals via `selectPolyVoices()` and `playVoice()`, observing the M-VAVE FM-1 8-voice hardware ceiling.

### 4.2 Polymer Self-Avoiding Walk & Steric Jamming Folding

- **Model ID**: `self_avoiding_walk`
- **Category**: Statistical Polymer Physics / Molecular Conformation / Kinetic Jamming.
- **Architectural Scope**: Simulates a growing self-avoiding random walk (SAW) on a 2D discrete lattice representing synthetic polymer chain growth and molecular protein folding. Monomer additions trigger scale-quantized notes; steric jamming triggers polyphonic collapse cascades.

### 4.3 Global 2D Perlin Noise Generator & Drawn Grid Randomizers

- **Module**: `js/perlin.js`
- **Architectural Scope**: Standalone, zero-dependency, zero-GC 2D Improved Perlin noise and Fractal Brownian Motion (fBm) engine available globally to all sequencer models and client scripts (via ES module export and `window.perlinNoise`).
- **Core Primitives**:
  - `setPerlinSeed(seed)` / `getPerlinSeed()`: Deterministic permutation table generation using Mulberry32 PRNG and Fisher-Yates shuffle.
  - `perlin2D(x, y)`: Ken Perlin's quintic fade curve ($6t^5 - 15t^4 + 10t^3$), 8-direction gradient hash, normalized to $[-1.0, 1.0]$.
  - `fbm2D(x, y, options)`: Multi-octave Fractal Brownian Motion octave summation normalized to $[-1.0, 1.0]$.
  - `fillPerlin2D(buffer, width, height, options)`: In-place TypedArray filler (`Float32Array`, `Uint8Array`) with frequency scale, octaves, persistence, lacunarity, min/max mapping, threshold gating, power contrast shaping, and additive modes.
  - `generatePerlinGrid(width, height, options)`: Convenient allocator returning a filled `Float32Array`.
- **Integrated Drawn Grid Models**:
  - `ripple_tank` ([js/ripple_tank.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/ripple_tank.js)): `randomizeRippleTank()` fills acoustic wave displacement fields (`uCurr`, `uPrev`) with boundary-clamped Perlin waves; registers with `setModelRandomizer()` and provides toolbar `RND` button.
  - `reaction_diffusion` ([js/reaction_diffusion.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/reaction_diffusion.js)): `randomizeReactionDiffusion()` seeds organic morphogen $V$ clusters and complementary $U$ inhibitor fields; registers with `setModelRandomizer()` and provides toolbar `RND` button.
  - `convection` ([js/convection.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/convection.js)): `randomizeConvection()` perturbs base temperature lapse rates and moisture distributions with Perlin thermal plumes and vapor clouds; registers with `setModelRandomizer()` and provides toolbar `RND` button.
  - `physarum` ([js/physarum.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/physarum.js)): `randomizePhysarum()` generates organic chemoattractant trail highways (`trailField`); registers with `setModelRandomizer()` and provides toolbar `RND` button.

