# FM-1 Pulses

Browser-based generative MIDI workstation for the **M-VAVE FM-1** (6-operator FM synthesizer). Built with vanilla JavaScript, Web MIDI, Web Audio, and PWA standards. Zero dependencies, no build steps, and no server required.

**▶ Live:** https://james-lemin.com/fm1-pulses/

---

## Overview

FM-1 Pulses generates evolving musical phrases, continuous physical simulations, and polyphonic generative textures in real time for the M-VAVE FM-1 over MIDI, paired with a built-in browser FM synthesizer for cable-free auditioning. Sessions can be saved and restored deterministically (see **Session files** below).

### Sequencer Models (32 Engines)

FM-1 Pulses includes **32 algorithmic, physical, biological, and stochastic sequencing engines** accessible from the filterable model selection hub (`Monophonic`, `Polyphonic`, `Grid-based`, `Physics`, `Biological`, `Stochastic`, `Algorithmic`, `Autonomous`):

#### Classic Modular & Shift-Register Generators
- **Mene311 (Stochastic)**: An analog-inspired generative signal chain combining Sample & Hold, continuous LFO waveshaping, Gaussian distribution weighting, scale quantization, and a looping Deja-Vu buffer.
- **Turing Machine**: A shift-register melody generator inspired by Tom Whitwell's Music Thing Modular Turing Machine. Circulating bit registers mutate probabilistically, moving between locked repetitive loops and gradual melodic drift.
- **Rob Hordijk Rungler**: Chaotic stepped shift-register generator inspired by the Benjolin and Blippoo Box. Two cross-modulating oscillators feed a comparator into a 16-bit shift register decoded by a 4-bit Rungler DAC ladder.
- **Buchla Krell Patch**: Self-generating West Coast patch inspired by Todd Barton and *Forbidden Planet*. Dual non-linear function generators cross-modulate Rise and Fall slopes via Sample & Hold random voltages for organic non-metric phrasing.
- **2D Shift Register**: Toroidal bit matrix with orthogonal X/Y shift clocks, feedback polynomial taps (Triadex Muse heritage), and register cross-sum scale pitch and velocity mapping.

#### Cellular, Lattice & Criticality Models
- **Cellular Automata**: Emergent step generator powered by 1D elementary cellular automata (Wolfram Rules 30, 90, 110, and 150), producing organic self-similar fractal patterns across generations.
- **Abelian Sandpile**: Bak-Tang-Wiesenfeld self-organized criticality lattice. Accumulating grains topple (`z ≥ 4`) into scale-free `1/f` avalanches, triggering center-of-mass polyphony and spatial quadrant chords.
- **Percolation Clusters**: 2D fluid porosity and electrical conduction lattice using Disjoint Set Union (DSU). As site occupancy crosses the critical phase threshold (`p_c ≈ 0.5927`), conduction pulses sweep through spanning clusters.
- **DLA Dendritic Crystal**: Witten-Sander Diffusion-Limited Aggregation engine where Brownian walkers adhere to seed clusters, mapping radial growth and polar angles to octave spread and scale degrees.
- **Polymer Self-Avoiding Walk**: Growing polymer chain on a 2D lattice subject to strict steric self-avoidance, discharging polyphonic folding cascades when encountering jamming traps.

#### Physics, Acoustics & Celestial Mechanics
- **Particles**: A 2D kinetic collision engine inspired by Orca and Plinky. Autonomous directional playheads traverse an interactive surface, rebounding off boundaries and deflectors to trigger notes on collision.
- **Double Pendulum**: Chaotic attractor physics engine powered by Runge-Kutta 4th-order (RK4) integration of Euler-Lagrange equations with direct-drag bob manipulation and phase-space polyphony.
- **Orbital Resonance**: Multi-body Keplerian celestial mechanics simulator driven by Symplectic Velocity-Verlet integration, triggering chimes at periapsis transits and alignment chords during planetary conjunctions.
- **Acoustic Ripple Tank**: 2D Finite-Difference Time-Domain (FDTD) wave equation simulator with interactive barriers, diffraction apertures, and up to 8 virtual hydrophone pickups.
- **Rayleigh-Bénard Convection**: Boussinesq Navier-Stokes thermal fluid simulation where rising warm plumes cool past upper-troposphere dew points to condense into cloud billows and downdrafts.
- **Chladni Cymatics Plate**: Vibrating square acoustic plate (`m, n` eigenmodes) where virtual sand grains migrate toward nodal lines and 8 pickup probes capture harmonic overtones.
- **Brownian Thermal Ratchet**: Richard Feynman's microscopic ratchet-and-pawl thermal engine driven by dual Langevin heat baths (`T1`, `T2`) against a counter-torque load.
- **Ballistic Billiards**: Hamiltonian dynamical billiards in mathematical collision tables (Bunimovich Stadium, Sinai, Ellipse, Cardioid) with specular reflection ray acoustics.

#### Biological, Ecological & Neuromorphic Systems
- **Flocking Swarm**: Autonomous boid flocking chord engine driven by Separation, Alignment, and Cohesion. When the swarm congregates at interactive Attractor Targets, it fires up to 8-voice chords and scatters in a repulsion blast.
- **Lotka-Volterra Attractor**: 3-species Hastings-Powell ecological food chain integrated via RK4, triggering Prey flutters, Predator ostinatos, and Apex sub-bass strikes across Poincaré cutting planes.
- **SIR Epidemic Network**: Kermack-McKendrick stochastic contagion across a spatial contact graph, translating infection waves and temporary immunity into macro-dramatic choral arcs.
- **Physarum Slime Mould**: Multi-agent chemotaxis simulation (`Physarum polycephalum`) where hundreds of sensory agents forage across a pheromone field to form Steiner transport highways between food nodes.
- **Reaction-Diffusion**: Gray-Scott chemical morphogenesis PDE solver producing mitosis spots, coral labyrinths, and spiral waves monitored by 8 drifting resonance probes.
- **Kuramoto Oscillators**: Coupled non-linear phase oscillators that transition between aperiodic polyrhythmic cascades and unified downbeat synchronization chords as order parameter `r` fluctuates.
- **FitzHugh-Nagumo Spiking**: Neuromorphic spiking neural network governed by fast-slow electrophysiology ODEs, producing synfire chains and refractory-spaced phrasing.

#### Formal Grammars, Combinatorics & Evolutionary Engines
- **L-System Grammar**: Aristid Lindenmayer recursive string-rewriting engine with a bracketed state stack (`[`, `]`), translating fractal turtle geometries into self-similar motifs.
- **Change Ringing**: English full-circle church bell campanology engine (stages 4–8, Plain Hunt, Plain Bob, Grandsire, Stedman, and interactive Call Changes) with real-time Blue Line trajectory plotting.
- **Markov Melodic Memory**: Conditional state-transition probability matrix with Boltzmann temperature scaling, N-gram memory, and multi-walker polyphony.
- **Melodic Genome Breeder**: Interactive genetic algorithm maintaining 8 musical chromosomes evolving via roulette selection, single-point crossover, allele mutation, and user fitness ratings.
- **Nodal Directed Graph**: Probabilistic directed state graph where autonomous walker tokens traverse topological network structures (Chordal Cycles, Binary Trees, Scale-Free Hubs, De Bruijn Shifts, Forward DAGs).

#### Interactive Aquatic Toys (Electroplankton)
- **Hanenbow Ballistics**: Inspired by Toshio Iwai's *Electroplankton*. Plankton launch from a draggable spring-cannon and ricochet off damped elastic leaves into syncopated arpeggio cascades.
- **Electroplankton Tracy Ribbon**: Multi-creature node-loop sequencer inspired by *Electroplankton* Tracy, where creatures traverse drawn vector paths with curvature-driven dynamics.

---

## Tools

- **DX Patch Generator**: Algorithmic sound designer and SysEx patch manager for Yamaha DX7 and FM-1 hardware. Generates organic FM patches across 11 sonic categories using seedable macro controls, mutates existing voices with controlled drift, renders interactive envelope and algorithm topologies, auditions via a built-in 6-operator FM Web Audio engine, and transmits voices/banks directly to hardware over USB MIDI or standard `.syx` files.
- **Preset & Pattern Librarian**: Bidirectional hardware librarian and 64-step pattern workbench for the M-VAVE FM-1. Pulls and exports all 128 presets (`SysEx 0x10` → 231B BaudGirl v4 `.syx`, 163B DX7 VCED, 4104B VMEM bank, or `.json`), pulls all 16 64-step patterns directly from hardware RAM (`SysEx 0x11` → `.syx`, `.mid`, or `.json`), edits polyphonic patterns interactively, and uploads new patterns (`SysEx 0x20`) from `.syx`, `.mid`, `.json`, or the Pulses sequencer bank.

---

## Shared Architecture

All sequencer models operate within a unified modular workstation environment:

- **64-Step Sequence Grid**: An interactive 16×4 step grid with individual step locking, micro-adjustments, active playhead tracking, and manual gate toggling.
- **Harmonics & Scale Quantizer**: 20 scale presets plus a chromatic custom scale editor, root note selection, scale snap quantization, and directional octave spread.
- **8-Voice Polyphony & Voice Allocation**: Hardware-safe voice manager (`js/poly.js`) respecting the M-VAVE FM-1's 8-voice ceiling via FIFO voice stealing and selectable voice-picking strategies (Extrema, Lowest, Highest, Spread, Cluster, Cycle, Random).
- **Dual-Clock Lookahead Scheduler**: High-precision lookahead scheduling (`js/player.js`) synchronizing Web MIDI timestamps and Web Audio synthesis with zero GC churn.
- **Rhythm & Euclidean Engine**: Algorithmic gate generator featuring classic world rhythm presets (Tresillo, Cinquillo, Clave, Bossa Nova, etc.), variable Euclidean density, grid snap, and rotation.
- **2D Perlin Field Randomizer**: Shared coherent noise generator (`js/perlin.js`) for seeding and randomizing spatial grids and multi-agent fields.
- **Groove & Dynamics**: Micro-timing humanize jitter, velocity randomization, and a swing engine with hardware-compatible presets (Straight, Light, MPC, Hard, Triplet).
- **Dual Auditioning**: Real-time MIDI transmission alongside a built-in multi-voice Web Audio synthesizer with selectable timbres (Electric Piano, Bell, Bass, Organ, Square).
- **Hardware Integration**: Bidirectional USB MIDI communication, automatic hardware BPM sync, and Bluetooth (BLE) wireless MIDI support (strictly note triggers and velocity to match FM-1 hardware constraints).
- **Presets & Storage**: Five quick-recall browser slots per model, plus versioned `.fm1p.json` session export/import.
- **In-App Model Guides**: Contextual per-model reference modal (`?` button in the model header) alongside the general workstation **[User Guide](guide.html)**.

---

## Quick Start

Web MIDI requires a secure origin (`https://` or `localhost`):

```bash
python3 -m http.server 8080
```

1. Open `http://localhost:8080` in Chrome, Edge, or any Web MIDI-enabled browser.
2. Connect the FM-1 via USB and grant MIDI access when prompted.
3. Filter or select an engine from the **Sequencing Models** hub, or open **DX Patch Generator** or **Preset & Pattern Librarian** under **Tools**.
4. Tweak parameters or press **Randomise** (or `R` / `G`) to roll a new pattern or simulation state.
5. Click **▶ Play** (or `Space`) to play live through the browser synth and FM-1.
6. Click **export** to download the session, or use a preset slot to keep it in the browser.

> ### ⚠ Hardware Notes
>
> - **Bluetooth MIDI**: BLE supports wireless live playback. Device reads (tempo sync, librarian pulls) require a wired USB connection.
> - **8-Voice Ceiling & MIDI CC**: The M-VAVE FM-1 hardware is strictly 8-voice polyphonic and does not process continuous MIDI CC streams; all models control note triggers and velocity only.

---

## Session files

A session is a JSON envelope that records the *recipe* for the exact browser state, not the generated notes:

```jsonc
{
  "format": "fm1-pulses.session", "formatVersion": 1,
  "model": { "id": "turing", "version": 1 },
  "state": { "params": {…}, "locks": {…}, "selected": 0, "hidden": { "bits": […] } },
  "ui": { "theme": "dark" }, "output": { "sound": "…", "volume": 0.8 }
}
```

- Each sequencer model has its own `version` and an ordered chain of migrations (`js/snapshot.js`). Older files are upgraded on import; files from a **newer** version are refused rather than truncated.
- Unknown parameters are preserved through an import/export round trip.
- Models register hidden state (shift registers, cellular/lattice grids, particle/agent coordinates, and seeds) from their own module.
- Files from before this format load as Mene311 v1.
- Run `node --test tests/` for the unit test suite across all 32 models and core modules.

---

## Project Structure

```
├── AGENTS.md                 # Engineering guidelines, hardware constraints & contracts
├── index.html                # Main application markup & hub
├── guide.html                # Workstation & tools user guide
├── manifest.json             # PWA manifest
├── sw.js                     # Service worker for offline use
├── css/
│   ├── style.css             # Core layout & semantic design tokens
│   ├── rack.css              # Workstation panel styling & themes
│   ├── dxpatch.css           # DX Patch Generator modular panel styling
│   └── librarian.css         # Preset & Pattern Librarian workbench styling
├── docs/
│   └── plan.md               # Master roadmap & framework integration standards
├── js/
│   ├── rack.js               # Master UI coordinator & lifecycle wiring
│   ├── modes.js              # Sequencer model & tools switcher, tag filters & modal guide
│   ├── billiards.js          # Ballistic dynamical billiards Hamiltonian collision model
│   ├── nodal_graph.js        # Nodal Directed Graph topological automata model
│   ├── model_guides.js       # Contextual in-app guide content for all 32 models
│   ├── state.js              # Shared reactive application state & parameter defaults
│   ├── poly.js               # 8-voice polyphony ceiling & voice allocation strategies
│   ├── player.js             # Dual-clock lookahead scheduler & live note dispatch
│   ├── perlin.js             # Shared 2D Perlin noise field generator
│   ├── scale.js              # Scale quantizer, pitch span & polyphony UI controls
│   ├── rhythm.js             # 64-step grid & Euclidean rhythm generator
│   ├── grid.js               # Step grid DOM rendering & direct manipulation
│   ├── humanise.js           # Micro-timing jitter & swing engine
│   ├── velocity.js           # Velocity dynamics & range controls
│   ├── controls.js           # Transport & global parameter bindings
│   ├── knob.js               # Rotary & scrubbable control primitives
│   ├── scope.js              # Real-time waveform & pitch contour visualizer
│   ├── themes.js             # FM-1 firmware BGTHEME color themes
│   ├── device.js             # Device status & tempo sync
│   ├── snapshot.js           # Versioned session format, model registry & migrations
│   ├── storage.js            # Session export/import & per-model preset slots
│   ├── midi.js               # Web MIDI & Web Bluetooth BLE interface
│   ├── audio.js              # Internal Web Audio audition synthesizer
│   ├── dx7.js                # DX7 domain model, 32 algorithms & SysEx codecs
│   ├── dxgenerator.js        # FM patch generator & mutator algorithms
│   ├── dxaudio.js            # 6-operator FM Web Audio synthesis engine
│   ├── dxpatch.js            # DX Patch Generator UI & interactive matrix
│   ├── va.js                 # BaudGirl FM-1+VA domain model & 231B SysEx codec
│   ├── pattern.js            # FM-1 SysEx 0x20 / RAM 0x11 / .mid pattern codecs
│   ├── librarian.js          # Preset & Pattern Librarian UI, hardware sync & editor
│   ├── generator.js          # Mene311 stochastic generation engine
│   ├── turing.js             # Turing Machine shift-register model
│   ├── cellular.js           # Cellular Automata Wolfram rule engine
│   ├── particles.js          # 2D kinetic particle collision engine
│   ├── pendulum.js           # Chaotic Double Pendulum attractor engine
│   ├── flock.js              # Autonomous Flocking Swarm chord engine
│   ├── rungler.js            # Rob Hordijk Rungler chaotic shift-register model
│   ├── krell.js              # Buchla 266 Krell Patch autonomous generative engine
│   ├── lsystem.js            # L-System Morphogenetic Grammar sequencer model
│   ├── lotka_volterra.js     # Lotka-Volterra Predator-Prey phase attractor model
│   ├── orbital.js            # Keplerian Orbital Resonance & conjunction chimes model
│   ├── hanenbow.js           # Electroplankton Hanenbow leaf deflection ballistics model
│   ├── sandpile.js           # Bak-Tang-Wiesenfeld Abelian Sandpile criticality model
│   ├── percolation.js        # 2D Percolation phase transition & DSU cluster model
│   ├── dla.js                # Diffusion-Limited Aggregation dendritic crystal model
│   ├── epidemic.js           # Kermack-McKendrick SIR Epidemic network model
│   ├── changes.js            # Campanology English church bell change-ringing model
│   ├── physarum.js           # Physarum polycephalum slime mould chemotaxis model
│   ├── reaction_diffusion.js # Gray-Scott Reaction-Diffusion morphogenesis model
│   ├── kuramoto.js           # Coupled Kuramoto phase-synchronization oscillators
│   ├── fitzhugh_nagumo.js    # FitzHugh-Nagumo neuromorphic spiking network model
│   ├── ripple_tank.js        # 2D FDTD Acoustic Ripple Tank interference model
│   ├── convection.js         # Rayleigh-Bénard atmospheric thermal convection model
│   ├── markov_matrix.js      # Markov Melodic Memory transition matrix model
│   ├── genetic_breeder.js    # Interactive Melodic Genome Breeder evolutionary model
│   ├── chladni.js            # Ernst Chladni vibrating cymatics plate model
│   ├── brownian_ratchet.js   # Feynman Brownian Thermal Ratchet & pawl model
│   ├── tracy_ribbon.js       # Electroplankton Tracy multi-creature node-loop model
│   └── self_avoiding_walk.js # Polymer Self-Avoiding Walk lattice folding model
├── tests/                    # node --test unit suite (all 31 models & core modules)
└── presets/
    └── scales.json           # Scale interval definitions
```

---

## Documentation

- **In-App Model Guide (`?`)**: Click the **`?`** button in the active model header to view a dedicated breakdown of that engine's mathematical/physical system, interactive canvas controls, parameter bindings, and musical tips.
- **Workstation User Guide**: Consult **[guide.html](guide.html)** (accessible via the top navigation bar) for global transport, scale/polyphony controls, Euclidean rhythm generation, and the DX Patch & Librarian tools.
