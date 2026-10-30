# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of generative, physical, non-step, evolutionary, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap & Backlog

All 29 generative and non-step sequencer models across the FM-1 Pulses roadmap are fully implemented, verified, and unit-tested:
- `mene311`, `turing`, `cellular`, `particles`, `pendulum`, `flock`, `rungler`, `krell`, `lsystem`, `lotka_volterra`, `orbital`, `hanenbow`, `sandpile`, `percolation`, `dla`, `epidemic`, `changes`, `physarum`, `reaction_diffusion`, `kuramoto`, `fitzhugh_nagumo`, `ripple_tank`, `convection`, `markov_matrix`, `genetic_breeder`, `chladni`, `brownian_ratchet`, `tracy_ribbon`, `self_avoiding_walk`.

| Model ID | Model Name | Primary Domain | Status |
|---|---|---|---|
| *(No pending models)* | — | — | All roadmap models implemented |

---

## 2. Core Framework Integration Standards

Every model implementation must strictly adhere to the following shared framework patterns:

1. **Scale Quantization ([js/scale.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/scale.js))**:
   - Always resolve pitch using `getRootMidi()`, `getActiveScaleIntervals()`, and `quantize(rawMidi, intervals, root)`.
2. **Audio & MIDI Engine ([js/player.js](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/js/player.js))**:
   - Live note triggers dispatch via `liveNoteOn(note, vel, durMs)` and `liveNoteOff(note)`.
   - M-VAVE FM-1 firmware does not process continuous MIDI CC; all models strictly control note triggering and velocity only.
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
   - Register and clear model generators and randomizers via `setModelGenerator(fn)` / `setModelRandomizer(fn)`.
6. **Workbench Aesthetics ([.agents/rules/style.md](file:///c:/Users/kj6fi/Dropbox/git/fm1-pulses/.agents/rules/style.md))**:
   - Strictly flat surfaces: Zero CSS or canvas gradients (`linear-gradient`, `createLinearGradient`).
   - Dynamic token resolution via `getComputedStyle(document.documentElement)` (`--panel`, `--panel2`, `--line`, `--accent`, `--ok`, `--err`).
   - Direct manipulation over textual labelling: interactive canvases, scrubbable values, and concise 1–3 character abbreviations.
