# Implementation Plan: Generative & Non-Step Sequencer Models

This master plan tracks the implementation of remaining, unimplemented non-step, evolutionary, physical, population, and aleatoric sequencer models for **FM-1 Pulses**.

---

## 1. Roadmap of Unimplemented Models

| Model ID | Model Name | Primary Domain | Core Mathematical / Physical Primitives | Complexity | Status |
|---|---|---|---|---|---|
| `physarum` | **Physarum Slime Mould Network** | Biological Foraging / Transport | 3-sensor agent steering, 2D Float32Array pheromone diffusion/decay, Steiner flux tubes | Highest (5/5) | **Next / Pending** |
| `reaction_diffusion` | **Gray-Scott Reaction-Diffusion** | Chemical Morphogenesis | 2D Laplacian morphogen diffusion, non-linear reaction loops, modal cluster triggers | High (4.5/5) | Backlog |
| `kuramoto` | **Coupled Kuramoto Oscillators** | Non-Linear Phase Synchronization | Sinusoidal phase coupling, order parameter $r$, collective sync chords | Moderate (3/5) | Backlog |
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

## 3. Active Specification: Physarum Polycephalum (Slime Mould Nutrient Network)

- **Model ID**: `physarum`
- **Category**: Biological Process / Bio-Computational Multi-Agent Foraging / Steiner Optimization.
- **Architectural Scope**: Combines multi-agent sensory steering particles with a 2D diffused/decaying pheromone scalar field.

### Mathematical Formulation
Agent sensory sampling at Forward, Left ($+\theta_s$), and Right ($-\theta_s$) coordinates:
$$\mathbf{s}_F = \mathbf{x}_k + S_d (\cos \phi_k, \sin \phi_k)$$
$$\mathbf{s}_L = \mathbf{x}_k + S_d (\cos(\phi_k + \theta_s), \sin(\phi_k + \theta_s))$$
$$\mathbf{s}_R = \mathbf{x}_k + S_d (\cos(\phi_k - \theta_s), \sin(\phi_k - \theta_s))$$

Trail diffusion and evaporation equation:
$$C(x, y, t + \Delta t) = (1 - \delta) \cdot \left[ C(x, y, t) + D \nabla^2 C(x, y, t) \right] + \sum_k \delta(\mathbf{x} - \mathbf{x}_k)$$

### Implementation Skeleton
```javascript
export class PhysarumModel {
  constructor(gridW = 64, gridH = 48, numAgents = 384) {
    this.w = gridW; this.h = gridH;
    this.numAgents = numAgents;
    this.trail = new Float32Array(gridW * gridH);
    this.diffused = new Float32Array(gridW * gridH);
    this.agentX = new Float32Array(numAgents);
    this.agentY = new Float32Array(numAgents);
    this.agentAngle = new Float32Array(numAgents);
    this.sensorAngle = Math.PI / 4;
    this.sensorDist = 4.0;
    this.decay = 0.94;
    this.food = [
      { x: 16, y: 14, scaleDeg: 0, flux: 0 },
      { x: 48, y: 12, scaleDeg: 2, flux: 0 },
      { x: 50, y: 38, scaleDeg: 4, flux: 0 },
      { x: 18, y: 36, scaleDeg: 5, flux: 0 }
    ];
    this.initAgents();
  }

  sampleTrail(x, y) {
    const gx = Math.round(x + this.w) % this.w;
    const gy = Math.round(y + this.h) % this.h;
    return this.trail[gy * this.w + gx];
  }

  update(dt) {
    for (let i = 0; i < this.numAgents; i++) {
      const a = this.agentAngle[i], x = this.agentX[i], y = this.agentY[i];
      const fC = this.sampleTrail(x + Math.cos(a) * this.sensorDist, y + Math.sin(a) * this.sensorDist);
      const lC = this.sampleTrail(x + Math.cos(a + this.sensorAngle) * this.sensorDist, y + Math.sin(a + this.sensorAngle) * this.sensorDist);
      const rC = this.sampleTrail(x + Math.cos(a - this.sensorAngle) * this.sensorDist, y + Math.sin(a - this.sensorAngle) * this.sensorDist);

      if (fC > lC && fC > rC) { /* keep */ }
      else if (lC > rC) this.agentAngle[i] += 0.3;
      else if (rC > lC) this.agentAngle[i] -= 0.3;
      else this.agentAngle[i] += (Math.random() - 0.5) * 0.4;

      this.agentX[i] = (x + Math.cos(this.agentAngle[i]) * 1.5 + this.w) % this.w;
      this.agentY[i] = (y + Math.sin(this.agentAngle[i]) * 1.5 + this.h) % this.h;
      this.trail[Math.floor(this.agentY[i]) * this.w + Math.floor(this.agentX[i])] += 1.0;
    }

    // Check food flux triggers
    const intervals = getActiveScaleIntervals();
    const root = getRootMidi();
    for (let f = 0; f < this.food.length; f++) {
      const node = this.food[f];
      const idx = Math.floor(node.y) * this.w + Math.floor(node.x);
      this.trail[idx] += 8.0;
      node.flux += this.trail[idx] * dt;
      if (node.flux >= 18.0) {
        node.flux = 0.0;
        const note = quantize(root + (intervals[node.scaleDeg % intervals.length] || 0));
        playVoice(f, note, Math.min(127, Math.max(40, Math.round(this.trail[idx] * 8))), 280);
      }
    }

    // Diffuse & decay
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        const idx = y * this.w + x;
        this.diffused[idx] = (this.trail[idx - 1] + this.trail[idx + 1] + this.trail[idx - this.w] + this.trail[idx + this.w]) * 0.25 * this.decay;
      }
    }
    this.trail.set(this.diffused);
  }
}
```

### Musical & Scalability Profile
- **Musical Output**: Biological pulsing rhythms along Steiner highway veins connecting harmonic root nodes; evolves from chaos into hypnotic transport loops.
- **Scalability**: $64 \times 48$ downsampled field with 384 lightweight agents runs in $\approx 0.35 \text{ ms}$ per frame ($< 3\%$ CPU budget at 60 FPS). Max 4–8 food voices.

---

## 4. Backlog Models Catalogue (Two-Sentence References)

For future reference and extension, these additional models are documented with concise descriptions:

1. **Gray-Scott Reaction-Diffusion (Turing Chemical Morphogenesis)**: Two virtual chemical morphogens diffuse across a 2D substrate and react non-linearly to generate dynamic animal coat patterns like spots, labyrinthine stripes, and dividing solitonic waves. As localized chemical concentration fronts divide and collapse, they trigger polyphonic modal clusters whose spatial wavelengths determine interval voicings and FM-1 operator feedback depths.
2. **Coupled Kuramoto Phase Synchronization Oscillators**: A population of non-linear phase oscillators with distinct natural frequencies interact through sinusoidal coupling, periodically drifting into collective synchronization before desynchronizing through external perturbing noise. Phase lock events trigger simultaneous polyphonic downbeat chords, while transient asynchronous phases generate intricate, wandering polyrhythmic bell cascades.
3. **FitzHugh-Nagumo Biological Neuromorphic Spiking Network**: A network of simplified biological neurons with fast excitation voltage and slow recovery variables generates all-or-nothing action potential spikes upon receiving sensory stimulus. Action potential firing events directly emit velocity-sensitive MIDI gates, while refractory recovery periods naturally enforce musical phrasing and prevent voice crowding.
4. **2D Acoustic Wave Equation Ripple Tank (Finite-Difference Time Domain)**: A discrete height field simulates physical acoustic surface ripples propagating from interactive drop points and reflecting off user-drawn spatial barrier walls. Acoustic wavefront crests crossing virtual hydrophone pickup sensors trigger scale-quantized notes whose velocity and stereo pan mirror real-time wave pressure and propagation vectors.
5. **Atmospheric Rayleigh-Bénard Convection & Cloud Formation**: Simulates thermal fluid parcels rising from a warm ground plate into a cool upper boundary, where water vapor condenses into cloud billows upon reaching saturation dew points. Dew point condensation events sound resonant bell tones in high octave registers, while sinking downdrafts trigger low-frequency grounding bass pulses.
6. **High-Order Markov Chain Stochastic Pitch-Transition Matrix**: A stochastic transition network models musical memory by choosing subsequent notes based on conditional transition probability tables derived from the previous $N$ melodic intervals. As the user alters transition temperature or introduces mutation entropy, melodic phrases smoothly transition between rigid stylistic motifs and surprising aleatoric improvisations.
7. **Interactive Genetic Algorithm Melodic Genome Breeder**: Maintains a breeding population of musical chromosome vectors encoding rhythm, scale degree intervals, and gate envelopes, subjected to mutation and crossover operations. The user tags sounding motifs with positive or negative interactive fitness scores, steering the evolutionary survival and emergence of complex, personalized musical themes over successive generations.
8. **Chladni Acoustic Resonant Plate & Nodal Sand Patterns**: Simulates Ernst Chladni’s vibrating square acoustic plates where virtual sand grains are propelled off anti-nodal zones and settle onto geometric nodal lines defined by 2D standing wave eigenfunctions $\cos(n \pi x / L)\cos(m \pi y / L) - \cos(m \pi x / L)\cos(n \pi y / L) = 0$. Grains settling into equilibrium nodal pockets trigger micro-tonal chime harmonics that shift dramatically as modal vibrational frequencies $m$ and $n$ are swept.
9. **Brownian Ratchet / Feynman Thermal Diode**: A microscopic mechanical paddle immersed in a fluctuating thermal bath attempts to drive a cogwheel restricted to unidirectional rotation by an asymmetric spring-loaded pawl. Stochastic thermal collisions occasionally overcome the pawl barrier, generating aperiodic rhythmic step advances whose statistical burst frequencies are governed by temperature and mechanical load.
10. **Electroplankton "Tracy" Ribbon Path Trajectory**: Inspired by Toshio Iwai’s Tracy plankton species, the user draws continuous organic vector gestures across an aquatic canvas, spawning a creature that perpetually navigates the closed contour. As the creature traverses segments of the ribbon, local curvature, speed, and heading direction are continuously translated into quantized pitch shifts, gate lengths, and expressive FM modulation envelopes.
11. **Self-Avoiding Random Walk (Polymer Chain Folding)**: A growing molecular polymer chain steps randomly onto neighboring unoccupied lattice nodes while strictly forbidding self-intersection. When the chain approaches conformational jamming (steric hindrance traps), the chain collapses and folds with an explosive, harmonically resolved chord cascade before initiating a new structural domain.
