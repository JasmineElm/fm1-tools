# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of remaining, unimplemented non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap of Unimplemented Models

| Model ID | Model Name | Primary Domain | Core Mathematical / Physical Primitives | Complexity | Status |
|---|---|---|---|---|---|
| `kuramoto` | **Coupled Kuramoto Oscillators** | Non-Linear Phase Synchronization | Sinusoidal phase coupling, order parameter $r$, collective sync chords | Moderate (3/5) | **Next / Pending** |
| `fitzhugh_nagumo` | **FitzHugh-Nagumo Spiking Network** | Neuromorphic Electrophysiology | Fast excitation / slow recovery ODEs, action potential gate spikes, refractory periods | Moderate (3.5/5) | Backlog |
| `ripple_tank` | **2D Acoustic Ripple Tank (FDTD)** | Physical Wave Mechanics | Height field wave equation, hydrophone virtual pickups, reflection barriers | High (4/5) | Backlog |
| `convection` | **Rayleigh-Bénard Thermal Convection** | Atmospheric Thermodynamics | Buoyancy vs thermal dissipation, dew point saturation triggers, convective rolls | Mod-High (3.5/5) | Backlog |
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

## 3. Active Specification: Coupled Kuramoto Phase Synchronization Oscillators

- **Model ID**: `kuramoto`
- **Category**: Non-Linear Dynamics / Phase Synchronization / Coupled Oscillators.
- **Architectural Scope**: A network of up to 8 non-linear phase oscillators with distinct intrinsic natural frequencies $\omega_i$ interact through sinusoidal mean-field coupling. The system dynamically transitions between aperiodic polyrhythmic counterpoint and sudden, explosive collective downbeat synchronization chords.

### Mathematical Formulation
Phase evolution of $N$ coupled oscillators:
$$\frac{d\theta_i}{dt} = \omega_i + \frac{K}{N} \sum_{j=1}^N \sin(\theta_j - \theta_i) + \xi_i(t)$$

Where:
- $\theta_i \in [0, 2\pi)$ is the phase angle of oscillator $i \in \{1 \dots N\}$ (where $N \le 8$ matches the FM-1 hardware voice limit).
- $\omega_i$ is the intrinsic natural angular frequency, drawn from a Lorentzian or Gaussian distribution with central frequency $\omega_0$ and dispersion $\sigma_\omega$.
- $K$ is the coupling strength parameter.
- $\xi_i(t)$ is an optional stochastic thermal perturbing noise term.

Complex order parameter $r e^{i \psi}$:
$$r(t) e^{i \psi(t)} = \frac{1}{N} \sum_{j=1}^N e^{i \theta_j(t)}$$
- $r(t) \in [0, 1]$ measures macroscopic phase coherence: $r \approx 0$ represents incoherent, wandering polyrhythms; $r \to 1$ represents full collective phase-locking.
- $\psi(t)$ is the average collective phase angle.

### Musical Mapping
- **Oscillator Voices**: Up to 8 oscillator nodes mapped 1-to-1 to voice slots `0`–`7`. Each oscillator is tuned to a scale-quantized pitch (higher natural frequency $\omega_i$ maps to higher pitch degree/octave).
- **Trigger Events**: Each time an oscillator's phase crosses the top zenith ($\theta_i \equiv 0 \pmod{2\pi}$ with positive velocity), a note pulse is emitted.
- **Macro-Structural Dynamics**:
  - **Incoherent Phase ($r < 0.35$)**: Independent, aperiodic polyrhythmic cascades resembling raindrops or gamelan interlocking patterns.
  - **Critical Transition ($0.35 \le r \le 0.85$)**: Transient partial clusters forming harmonic dyads and triads.
  - **Synchronized State ($r > 0.85$)**: Massive, unified downbeat chords striking simultaneously!
- **Timbre Modulation (CC #74)**: The macroscopic coherence order parameter $r(t)$ directly modulates CC #74 Brightness via `dispatchTimbreCc()`.

---

## 4. Backlog Models Catalogue (Two-Sentence References)

For future reference and extension, these additional models are documented with concise descriptions:

1. **FitzHugh-Nagumo Biological Neuromorphic Spiking Network**: A network of simplified biological neurons with fast excitation voltage and slow recovery variables generates all-or-nothing action potential spikes upon receiving sensory stimulus. Action potential firing events directly emit velocity-sensitive MIDI gates, while refractory recovery periods naturally enforce musical phrasing and prevent voice crowding.
2. **2D Acoustic Wave Equation Ripple Tank (Finite-Difference Time Domain)**: A discrete height field simulates physical acoustic surface ripples propagating from interactive drop points and reflecting off user-drawn spatial barrier walls. Acoustic wavefront crests crossing virtual hydrophone pickup sensors trigger scale-quantized notes whose velocity and stereo pan mirror real-time wave pressure and propagation vectors.
3. **Atmospheric Rayleigh-Bénard Convection & Cloud Formation**: Simulates thermal fluid parcels rising from a warm ground plate into a cool upper boundary, where water vapor condenses into cloud billows upon reaching saturation dew points. Dew point condensation events sound resonant bell tones in high octave registers, while sinking downdrafts trigger low-frequency grounding bass pulses.
4. **High-Order Markov Chain Stochastic Pitch-Transition Matrix**: A stochastic transition network models musical memory by choosing subsequent notes based on conditional transition probability tables derived from the previous $N$ melodic intervals. As the user alters transition temperature or introduces mutation entropy, melodic phrases smoothly transition between rigid stylistic motifs and surprising aleatoric improvisations.
5. **Interactive Genetic Algorithm Melodic Genome Breeder**: Maintains a breeding population of musical chromosome vectors encoding rhythm, scale degree intervals, and gate envelopes, subjected to mutation and crossover operations. The user tags sounding motifs with positive or negative interactive fitness scores, steering the evolutionary survival and emergence of complex, personalized musical themes over successive generations.
6. **Chladni Acoustic Resonant Plate & Nodal Sand Patterns**: Simulates Ernst Chladni’s vibrating square acoustic plates where virtual sand grains are propelled off anti-nodal zones and settle onto geometric nodal lines defined by 2D standing wave eigenfunctions $\cos(n \pi x / L)\cos(m \pi y / L) - \cos(m \pi x / L)\cos(n \pi y / L) = 0$. Grains settling into equilibrium nodal pockets trigger micro-tonal chime harmonics that shift dramatically as modal vibrational frequencies $m$ and $n$ are swept.
7. **Brownian Ratchet / Feynman Thermal Diode**: A microscopic mechanical paddle immersed in a fluctuating thermal bath attempts to drive a cogwheel restricted to unidirectional rotation by an asymmetric spring-loaded pawl. Stochastic thermal collisions occasionally overcome the pawl barrier, generating aperiodic rhythmic step advances whose statistical burst frequencies are governed by temperature and mechanical load.
8. **Electroplankton "Tracy" Ribbon Path Trajectory**: Inspired by Toshio Iwai’s Tracy plankton species, the user draws continuous organic vector gestures across an aquatic canvas, spawning a creature that perpetually navigates the closed contour. As the creature traverses segments of the ribbon, local curvature, speed, and heading direction are continuously translated into quantized pitch shifts, gate lengths, and expressive FM modulation envelopes.
9. **Self-Avoiding Random Walk (Polymer Chain Folding)**: A growing molecular polymer chain steps randomly onto neighboring unoccupied lattice nodes while strictly forbidding self-intersection. When the chain approaches conformational jamming (steric hindrance traps), the chain collapses and folds with an explosive, harmonically resolved chord cascade before initiating a new structural domain.
