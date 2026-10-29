# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of remaining, unimplemented non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap of Unimplemented Models

| Model ID | Model Name | Primary Domain | Core Mathematical / Physical Primitives | Complexity | Status |
|---|---|---|---|---|---|
| `fitzhugh_nagumo` | **FitzHugh-Nagumo Spiking Network** | Neuromorphic Electrophysiology | Fast excitation / slow recovery ODEs, action potential gate spikes, refractory periods | Moderate (3.5/5) | **Next / Pending** |
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

## 3. Active Specification: FitzHugh-Nagumo Biological Neuromorphic Spiking Network

- **Model ID**: `fitzhugh_nagumo`
- **Category**: Neuromorphic Electrophysiology / Spiking Neural Networks / Excitable Media.
- **Architectural Scope**: A network of up to 8 excitable biological neurons governed by the non-linear FitzHugh-Nagumo dynamical system. All-or-nothing action potential spike events emit velocity-sensitive MIDI notes, while refractory recovery periods naturally enforce musical phrasing and prevent voice crowding.

### Mathematical Formulation
Coupled fast-slow excitation system for $N$ biological neurons ($i \in \{1 \dots N\}$, where $N \le 8$ matches the FM-1 hardware voice limit):
$$\frac{dv_i}{dt} = v_i - \frac{v_i^3}{3} - w_i + I_i(t) + \sum_{j=1}^N W_{ij} s_j(t)$$
$$\frac{dw_i}{dt} = \epsilon (v_i + a - b w_i)$$

Where:
- $v_i$ is the fast membrane potential variable (generates the rapid depolarization upstroke of an action potential).
- $w_i$ is the slow recovery / potassium gate variable (produces the hyperpolarizing refractory recovery period).
- $I_i(t)$ is the external injected stimulus current (governing the resting baseline excitability: sub-threshold quiescent vs limit-cycle tonic pacing).
- $W_{ij}$ is the synaptic connection weight matrix (excitatory $W_{ij} > 0$ and inhibitory $W_{ij} < 0$).
- $s_j(t) = 1$ when pre-synaptic neuron $j$ fires an action potential, injecting synaptic current into post-synaptic neuron $i$.
- $\epsilon, a, b$ are biophysical parameters controlling threshold sensitivity and refractory timescale.

### Musical Mapping
- **Neuron Voices**: Up to 8 biological neurons mapped 1-to-1 to voice slots `0`–`7`. Each neuron is tuned to a scale-quantized pitch (using `scale.js`).
- **Trigger Events**: Crossing the action potential voltage threshold ($v_i \ge 1.0$ with $dv_i/dt > 0$) emits a note gate pulse.
- **Refractory Phrasing**: During the recovery phase ($w_i \gg 0$), the neuron is in an absolute refractory period, preventing repeated note triggers. This mimics human breathing and natural acoustic instrumental articulation.
- **Network Topologies**:
  - **Synfire Chain**: Feedforward cascade of spikes producing rhythmic arpeggios and linear phrases.
  - **Central Pattern Generator (CPG)**: Reciprocal inhibitory loops producing rhythmic walking and breathing gates.
  - **Bursting Hubs**: Master pacemakers driving subordinate follower ensembles.
- **Timbre Modulation (CC #74)**: Mean network membrane potential and instantaneous population firing rate modulate CC #74 Brightness via `dispatchTimbreCc()`.

---

## 4. Backlog Models Catalogue (Two-Sentence References)

For future reference and extension, these additional models are documented with concise descriptions:

1. **2D Acoustic Wave Equation Ripple Tank (Finite-Difference Time Domain)**: A discrete height field simulates physical acoustic surface ripples propagating from interactive drop points and reflecting off user-drawn spatial barrier walls. Acoustic wavefront crests crossing virtual hydrophone pickup sensors trigger scale-quantized notes whose velocity and stereo pan mirror real-time wave pressure and propagation vectors.
2. **Atmospheric Rayleigh-Bénard Convection & Cloud Formation**: Simulates thermal fluid parcels rising from a warm ground plate into a cool upper boundary, where water vapor condenses into cloud billows upon reaching saturation dew points. Dew point condensation events sound resonant bell tones in high octave registers, while sinking downdrafts trigger low-frequency grounding bass pulses.
3. **High-Order Markov Chain Stochastic Pitch-Transition Matrix**: A stochastic transition network models musical memory by choosing subsequent notes based on conditional transition probability tables derived from the previous $N$ melodic intervals. As the user alters transition temperature or introduces mutation entropy, melodic phrases smoothly transition between rigid stylistic motifs and surprising aleatoric improvisations.
4. **Interactive Genetic Algorithm Melodic Genome Breeder**: Maintains a breeding population of musical chromosome vectors encoding rhythm, scale degree intervals, and gate envelopes, subjected to mutation and crossover operations. The user tags sounding motifs with positive or negative interactive fitness scores, steering the evolutionary survival and emergence of complex, personalized musical themes over successive generations.
5. **Chladni Acoustic Resonant Plate & Nodal Sand Patterns**: Simulates Ernst Chladni’s vibrating square acoustic plates where virtual sand grains are propelled off anti-nodal zones and settle onto geometric nodal lines defined by 2D standing wave eigenfunctions $\cos(n \pi x / L)\cos(m \pi y / L) - \cos(m \pi x / L)\cos(n \pi y / L) = 0$. Grains settling into equilibrium nodal pockets trigger micro-tonal chime harmonics that shift dramatically as modal vibrational frequencies $m$ and $n$ are swept.
6. **Brownian Ratchet / Feynman Thermal Diode**: A microscopic mechanical paddle immersed in a fluctuating thermal bath attempts to drive a cogwheel restricted to unidirectional rotation by an asymmetric spring-loaded pawl. Stochastic thermal collisions occasionally overcome the pawl barrier, generating aperiodic rhythmic step advances whose statistical burst frequencies are governed by temperature and mechanical load.
7. **Electroplankton "Tracy" Ribbon Path Trajectory**: Inspired by Toshio Iwai’s Tracy plankton species, the user draws continuous organic vector gestures across an aquatic canvas, spawning a creature that perpetually navigates the closed contour. As the creature traverses segments of the ribbon, local curvature, speed, and heading direction are continuously translated into quantized pitch shifts, gate lengths, and expressive FM modulation envelopes.
8. **Self-Avoiding Random Walk (Polymer Chain Folding)**: A growing molecular polymer chain steps randomly onto neighboring unoccupied lattice nodes while strictly forbidding self-intersection. When the chain approaches conformational jamming (steric hindrance traps), the chain collapses and folds with an explosive, harmonically resolved chord cascade before initiating a new structural domain.
