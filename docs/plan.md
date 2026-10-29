# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of remaining, unimplemented non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap of Unimplemented Models

| Model ID | Model Name | Primary Domain | Core Mathematical / Physical Primitives | Complexity | Status |
|---|---|---|---|---|---|
| `convection` | **Rayleigh-Bénard Thermal Convection** | Atmospheric Thermodynamics | Buoyancy vs thermal dissipation, dew point saturation triggers, convective rolls | Mod-High (3.5/5) | **Next / Pending** |
| `markov_matrix` | **High-Order Markov Transition Matrix** | Stochastic Melodic Memory | Conditional $N$-gram transition probability tables, mutation temperature | Moderate (2.5/5) | Backlog |
| `genetic_breeder` | **Interactive Genetic Algorithm** | Evolutionary Melodic Breeding | Musical chromosome crossover/mutation, interactive fitness scoring | Moderate (3/5) | Backlog |
| `chladni` | **Chladni Resonant Cymatics Plate** | Standing Wave Acoustics | 2D eigenfunction nodal lines, sand particle propulsion, chime harmonics | Moderate (3/5) | Backlog |
| `brownian_ratchet` | **Brownian Thermal Ratchet** | Statistical Thermodynamics | Stochastic thermal Langevin fluctuations, asymmetric potential barrier | Low-Mod (2.5/5) | Backlog |
| `tracy_ribbon` | **Electroplankton Tracy Ribbon** | Continuous Vector Trajectory | Organic spline path curvature, tangent velocity mapping, expressive FM envelopes | Moderate (2.5/5) | Backlog |
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

## 3. Active Specification: Atmospheric Rayleigh-Bénard Thermal Convection & Cloud Formation

- **Model ID**: `convection`
- **Category**: Fluid Thermodynamics / Atmospheric Physics / Non-Linear Convective Cells.
- **Architectural Scope**: Simulates thermal fluid parcels rising from a warm ground boundary into a cool upper boundary layer (Boussinesq approximation). Water vapor carried by buoyant updrafts condenses into cloud billows upon reaching saturation dew points, triggering resonant high-register bell tones, while cool sinking downdrafts trigger low-frequency grounding bass pulses.

### Mathematical Formulation
Coupled 2D Boussinesq Navier-Stokes & thermal convection:
$$\frac{\partial \mathbf{u}}{\partial t} = -(\mathbf{u} \cdot \nabla)\mathbf{u} - \frac{1}{\rho_0} \nabla p + \nu \nabla^2 \mathbf{u} + g \beta (T - T_0) \hat{\mathbf{y}}$$
$$\frac{\partial T}{\partial t} = -(\mathbf{u} \cdot \nabla) T + \kappa \nabla^2 T$$
$$\frac{\partial q}{\partial t} = -(\mathbf{u} \cdot \nabla) q + \kappa_q \nabla^2 q$$

Where:
- $\mathbf{u} = (u, v)$ is the fluid velocity vector field (vorticity & stream function $\psi$).
- $T(x, y)$ is the temperature field (heated bottom ground plate, cooled upper atmosphere).
- $q(x, y)$ is the water vapor mixing ratio.
- Rayleigh number $Ra = \frac{g \beta \Delta T H^3}{\nu \kappa}$ governs the transition from pure thermal conduction to counter-rotating convective rolls and turbulent thermal plumes.
- Dew point saturation condensation condition: when $q(x, y) \ge q_{\text{sat}}(T(x, y))$, vapor condenses into cloud droplets, releasing latent heat and triggering cloudburst note events.

### Musical Mapping
- **Convective Voice Slots**: Up to 8 thermal cloud probes / rising plumes mapped to voices `0`–`7`.
- **Condensation Triggers**: Reaching condensation saturation in the upper troposphere triggers crystalline, resonant chime notes in high octaves.
- **Downdraft Return Triggers**: Dense cool air sinking back to the ground plate sounds deep sub-bass grounding pulses.
- **Continuous CC #74 Modulation**: Mean vertical convective heat flux $\langle v \cdot T \rangle$ modulates CC #74 Brightness.
- **Direct Manipulation**: Click to inject localized heat plumes or cold air pockets; adjust ground temperature, lapse rate, and air humidity.

---

## 4. Backlog Models Catalogue (Two-Sentence References)

For future reference and extension, these additional models are documented with concise descriptions:

1. **High-Order Markov Chain Stochastic Pitch-Transition Matrix**: A stochastic transition network models musical memory by choosing subsequent notes based on conditional transition probability tables derived from the previous $N$ melodic intervals. As the user alters transition temperature or introduces mutation entropy, melodic phrases smoothly transition between rigid stylistic motifs and surprising aleatoric improvisations.
2. **Interactive Genetic Algorithm Melodic Genome Breeder**: Maintains a breeding population of musical chromosome vectors encoding rhythm, scale degree intervals, and gate envelopes, subjected to mutation and crossover operations. The user tags sounding motifs with positive or negative interactive fitness scores, steering the evolutionary survival and emergence of complex, personalized musical themes over successive generations.
3. **Chladni Acoustic Resonant Plate & Nodal Sand Patterns**: Simulates Ernst Chladni’s vibrating square acoustic plates where virtual sand grains are propelled off anti-nodal zones and settle onto geometric nodal lines defined by 2D standing wave eigenfunctions $\cos(n \pi x / L)\cos(m \pi y / L) - \cos(m \pi x / L)\cos(n \pi y / L) = 0$. Grains settling into equilibrium nodal pockets trigger micro-tonal chime harmonics that shift dramatically as modal vibrational frequencies $m$ and $n$ are swept.
4. **Brownian Ratchet / Feynman Thermal Diode**: A microscopic mechanical paddle immersed in a fluctuating thermal bath attempts to drive a cogwheel restricted to unidirectional rotation by an asymmetric spring-loaded pawl. Stochastic thermal collisions occasionally overcome the pawl barrier, generating aperiodic rhythmic step advances whose statistical burst frequencies are governed by temperature and mechanical load.
5. **Electroplankton "Tracy" Ribbon Path Trajectory**: Inspired by Toshio Iwai’s Tracy plankton species, the user draws continuous organic vector gestures across an aquatic canvas, spawning a creature that perpetually navigates the closed contour. As the creature traverses segments of the ribbon, local curvature, speed, and heading direction are continuously translated into quantized pitch shifts, gate lengths, and expressive FM modulation envelopes.
6. **Self-Avoiding Random Walk (Polymer Chain Folding)**: A growing molecular polymer chain steps randomly onto neighboring unoccupied lattice nodes while strictly forbidding self-intersection. When the chain approaches conformational jamming (steric hindrance traps), the chain collapses and folds with an explosive, harmonically resolved chord cascade before initiating a new structural domain.
