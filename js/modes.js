// modes.js — Sequencing models switcher and landing page manager.
import { refs } from "./state.js";
import { setPolyphonyControlsVisible } from "./scale.js";
import { MODEL_GUIDES } from "./model_guides.js";

export const POLYPHONIC_MODELS = new Set([
  "particles",
  "pendulum",
  "flock",
  "krell",
  "lsystem",
  "lotka_volterra",
  "orbital",
  "hanenbow",
  "sandpile",
  "percolation",
  "dla",
  "epidemic",
  "changes",
  "physarum",
  "reaction_diffusion",
  "kuramoto",
  "fitzhugh_nagumo",
  "ripple_tank",
  "convection",
  "markov_matrix",
  "genetic_breeder",
  "chladni",
  "brownian_ratchet",
  "tracy_ribbon",
  "self_avoiding_walk",
  "billiards",
  "nodal_graph",
  "shift_register_2d",
  "cellular_bug",
  "boolean_euclidean"
]);

export const MODELS = [
  {
    id: "boolean_euclidean",
    name: "Boolean Euclidean Logic",
    kicker: "Polyrhythmic Algebra · Combinatorial Logic · Coincidence Accents",
    available: true,
    desc: "Multi-stream Euclidean rhythm generators (E(k1, n1), E(k2, n2), etc.) combined via Boolean logic operators (XOR, AND, OR, NAND, XNOR, MAJORITY). Hit coincidences trigger velocity accents and harmonic octave leaps across up to 8 polyphonic voice channels.",
    tags: ["Euclidean Rhythm", "Boolean Logic", "Polyrhythms", "Combinatorics", "Coincidence Accents", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
      <path d="M12 7.5v9" />
    </svg>`
  },
  {
    id: "cellular_bug",
    name: "2D Cellular + Bug",
    kicker: "Artificial Life · Turmites & Langton's Ants · Glider Collisions",
    available: true,
    desc: "2D Cellular Automata grid (Conway Life, Brian's Brain, HighLife) traversed by mobile Turmites and Langton's Ants. Dual interaction coupling: bugs build highways and forage across live cells, while cluster density and glider collisions trigger scale-quantized staccato note bursts and velocity accents.",
    tags: ["Artificial Life", "Cellular Automata", "Turmites", "Langton's Ant", "Conway Life", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9v-3M12 18v-3M9 12H6M18 12h-3M7 7l2 2M15 15l2 2M7 17l2-2M15 9l2-2" />
    </svg>`
  },
  {
    id: "shift_register_2d",
    name: "2D Shift Register",
    kicker: "Toroidal Bit Matrix · Orthogonal Clocks · Galois Feedback Logic",
    available: true,
    desc: "2D toroidal bit matrix with orthogonal horizontal and vertical shift clocks, programmable feedback polynomial taps (Triadex Muse heritage), and register cross-sum scale pitch and velocity mapping. Features dual clock dividers, multi-voice polyphony up to 8 voices, and direct manipulation bit toggling.",
    tags: ["Toroidal Matrix", "Shift Register", "Galois LFSR", "Triadex Muse", "Orthogonal Clocks", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="18" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "nodal_graph",
    name: "Nodal Directed Graph",
    kicker: "Topological Automata · Weighted Branching · Aleatoric Pathways",
    available: true,
    desc: "Probabilistic directed state graph where autonomous walker tokens traverse topological network structures (Chordal Cycles, Binary Trees, Scale-Free Hubs, De Bruijn Shifts, Forward DAGs). Node arrivals trigger scale-quantized notes, in-degree connectivity modulates note velocity, and edge traversal durations determine gate articulation.",
    tags: ["Graph Theory", "Directed Graph", "Topological Automata", "Chordal Cycles", "8-Voice Polyphony", "Draggable Nodes"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.5 6.5l7 1.2M7.5 8.5l3.5 7.5M16.5 10l-3.5 6" />
    </svg>`
  },
  {
    id: "mene311",
    name: "Mene311",
    kicker: "Stochastic S&H · Quantizer · Echo Loop",
    available: true,
    desc: "Classical generative signal chain created by Mene311. Gate probability triggers Sample & Hold and continuous LFO waveshaping, shaped through Gaussian distributions, quantized across 18 scales, with micro-timing humanize, real-time MIDI to the FM-1 and session save/recall.",
    tags: ["64 Steps", "18 Scales", "Echo / Deja-Vu", "Live MIDI", "Audio Audition"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12h3l2-6 4 12 3-8 2 4 2-2h4" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="11" cy="18" r="1.2" fill="currentColor" />
      <circle cx="14" cy="10" r="1.2" fill="currentColor" />
    </svg>`
  },
  {
    id: "turing",
    name: "Turing Machine",
    kicker: "Shift Register · Bit Slip · Mutation",
    available: true,
    desc: "Shift-register melody generator inspired by Tom Whitwell's Turing Machine. A circulating loop of bits slowly mutates according to a write probability, locking into hypnotic melodic cycles or drifting into ever-changing variations.",
    tags: ["Shift Register", "Lock Loop", "Bit Slip", "Probabilistic Write"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" stroke-dasharray="3 3" />
      <path d="M12 4v4m0 8v4M4 12h4m8 0h4" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "cellular",
    name: "Cellular Automata",
    kicker: "Wolfram 1D Rules · Step Matrix · Emergent",
    available: true,
    desc: "Step generation driven by 1D elementary cellular automata (Rule 30, 90, 110, 150). Patterns evolve across generations through local neighbor interactions, yielding organic self-similar melodic contours.",
    tags: ["Wolfram 1D Rules", "Rule 30 / 110", "Emergent Evolution", "Seed Genetics", "Polyphonic / Lead"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="5" height="5" />
      <rect x="10" y="3" width="5" height="5" />
      <rect x="17" y="3" width="5" height="5" />
      <rect x="6.5" y="10" width="5" height="5" fill="currentColor" />
      <rect x="13.5" y="10" width="5" height="5" />
      <rect x="10" y="17" width="5" height="5" fill="currentColor" />
    </svg>`
  },
  {
    id: "particles",
    name: "Particles",
    kicker: "2D Kinetic Grid · Multi-Head · Collision Physics",
    available: true,
    desc: "Multi-head particle collision simulator inspired by Orca and Plinky. Moving directional playheads navigate a 2D physics surface, reflecting elastically off boundaries. When particles collide on the same cell, they trigger musical notes and either deflect at 90°, annihilate, or spawn child particles with finite lifetimes.",
    tags: ["2D Kinetic Grid", "Multi-Head", "Elastic Reflection", "Deflect (90°)", "Spawn Child", "Orca / Plinky"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.5" fill="currentColor" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
      <path d="M8 8l8 8M18 6l-3 3M6 18l3-3" />
      <circle cx="12" cy="12" r="3" stroke-dasharray="2 2" />
    </svg>`
  },
  {
    id: "pendulum",
    name: "Double Pendulum",
    kicker: "Deterministic Chaos · Direct Manipulation · Phase Attractor",
    available: true,
    desc: "Chaotic double pendulum physics engine yielding evolving trajectories, strange attractors, and phase-space polyphony. Direct-drag the bobs on canvas to prime initial angles, toggle between repeatable loops and continuous free-running chaos, and map kinetic vectors to scale degrees.",
    tags: ["Deterministic Chaos", "RK4 Integrator", "Direct Drag", "Phase Attractor", "Dual-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="4" r="2" fill="currentColor" />
      <line x1="12" y1="6" x2="16" y2="13" />
      <circle cx="16" cy="13" r="2.5" fill="currentColor" />
      <line x1="16" y1="15.5" x2="8" y2="20" />
      <circle cx="8" cy="20" r="3" fill="currentColor" />
    </svg>`
  },
  {
    id: "flock",
    name: "Flocking Swarm",
    kicker: "Autonomous Boids · Continuous Event Time · Spatial Chords",
    available: true,
    desc: "Autonomous boid flocking simulation unlinked to any step clock. Boids navigate a 2D field via Separation, Alignment, and Cohesion. When the flock congregates at armed attractor targets, it fires up to 8-voice polyphonic chords across custom scales with kinetic dynamics, scattering the swarm in a repulsion blast.",
    tags: ["Continuous Event Time", "Free Boids", "Attractor Targets", "8-Voice Polyphony", "Cluster Chords", "Scatter Blasts"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 18l4-2 3 3 2-6-6 2 3 3" fill="currentColor" />
      <path d="M11 10l3.5-1.8 2.6 2.6 1.8-5.3-5.3 1.8 2.6 2.6" fill="currentColor" />
      <circle cx="18" cy="18" r="3" stroke-dasharray="2 2" />
    </svg>`
  },
  {
    id: "rungler",
    name: "Rob Hordijk Rungler",
    kicker: "Chaotic Stepped Shift Register · Benjolin · Cross-Modulation",
    available: true,
    desc: "Chaotic shift-register melody generator inspired by Rob Hordijk's Benjolin and Blippoo Box. Two cross-modulating analog oscillators feed a comparator into a 16-bit shift register, decoded by a 4-bit Rungler DAC ladder to produce self-steering melodic bifurcations and hypnotic repeating loops.",
    tags: ["16-Bit Register", "4-Bit Rungler DAC", "Benjolin", "Dual Oscillators", "Cross-Mod Feedback", "Hybrid Clock"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
      <circle cx="9" cy="6" r="1.5" fill="currentColor" />
      <circle cx="13" cy="18" r="1.5" fill="currentColor" />
      <rect x="17" y="9" width="4" height="6" rx="1" />
    </svg>`
  },
  {
    id: "krell",
    name: "Buchla Krell Patch",
    kicker: "Dual Function Generators · Source of Uncertainty · Non-Metric Ambient",
    available: true,
    desc: "Self-generating modular patch pioneered by Todd Barton and inspired by Bebe & Louis Barron's 1956 Forbidden Planet. Dual non-linear function generators cross-modulate Rise and Fall slopes via Sample & Hold random voltages, producing organic non-metric ambient melodies and dynamic velocity phrasing.",
    tags: ["Buchla 266", "Source of Uncertainty", "Sample & Hold", "Cross-Mod Dwell", "Non-Metric", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 18l5-12 6 12 7-8" />
      <circle cx="8" cy="6" r="1.8" fill="currentColor" />
      <circle cx="14" cy="18" r="1.8" fill="currentColor" />
      <path d="M3 12h3m3 0h3m3 0h3" stroke-dasharray="1 2" />
    </svg>`
  },
  {
    id: "lsystem",
    name: "L-System Grammar",
    kicker: "Lindenmayer Formal Grammar · Fractal Turtle · Motif Branching",
    available: true,
    desc: "Recursive string-rewriting morphogenetic engine based on Aristid Lindenmayer's biological grammars. A musical turtle navigates branching rewrite rules with bracket stack push/pop, transforming recursive axioms (Fractal Canopy, Dragon Curve, Sierpinski, Hilbert) into self-similar polyphonic motifs and evolving melodic structures.",
    tags: ["Formal Grammar", "Recursive Rewriting", "Stack Push / Pop", "Fractal Turtle", "Self-Similar Motifs", "Direct Rule Edit"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="22" x2="12" y2="13" />
      <line x1="12" y1="13" x2="7" y2="7" />
      <line x1="12" y1="13" x2="17" y2="7" />
      <line x1="7" y1="7" x2="4" y2="3" />
      <line x1="7" y1="7" x2="9" y2="3" />
      <line x1="17" y1="7" x2="15" y2="3" />
      <line x1="17" y1="7" x2="20" y2="3" />
      <circle cx="4" cy="3" r="1.5" fill="currentColor" />
      <circle cx="9" cy="3" r="1.5" fill="currentColor" />
      <circle cx="15" cy="3" r="1.5" fill="currentColor" />
      <circle cx="20" cy="3" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "lotka_volterra",
    name: "Lotka-Volterra Attractor",
    kicker: "3-Species Food Chain · RK4 Integrator · Poincaré Polyphony",
    available: true,
    desc: "Non-linear population dynamics and chaotic phase attractor based on the 3-species Hastings-Powell food chain. Runge-Kutta 4th-order integration simulates Prey flutters, Predator ostinatos, and Apex sub-bass strikes triggered as continuous trajectories pierce Poincaré cutting planes.",
    tags: ["Hastings-Powell", "RK4 Integrator", "Poincaré Triggers", "Chaotic Attractor", "3-Species Polyphony", "Continuous Phase"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(-30 12 12)" />
      <ellipse cx="12" cy="12" rx="6" ry="3" transform="rotate(30 12 12)" stroke-dasharray="2 2" />
      <circle cx="7" cy="10" r="1.5" fill="currentColor" />
      <circle cx="16" cy="15" r="1.8" fill="currentColor" />
      <circle cx="12" cy="7" r="1.2" fill="currentColor" />
    </svg>`
  },
  {
    id: "orbital",
    name: "Orbital Resonance",
    kicker: "Keplerian Celestial Mechanics · Symplectic Verlet · Conjunction Polyphony",
    available: true,
    desc: "Multi-body celestial mechanics simulator driven by Symplectic Velocity-Verlet numerical integration. Up to 8 orbiting planets navigate elliptical Keplerian orbits around a central star, triggering melodic chimes at periapsis velocity transits and polyphonic alignment chords during angular celestial conjunctions.",
    tags: ["Celestial Mechanics", "Velocity-Verlet", "Periapsis Triggers", "Angular Conjunctions", "8-Voice Polyphony", "Kepler's 3rd Law"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="7" ry="4" stroke="currentColor" fill="none" />
      <ellipse cx="12" cy="12" rx="10" ry="7" stroke="currentColor" stroke-dasharray="2 2" fill="none" transform="rotate(-25 12 12)" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
      <circle cx="5" cy="9" r="1.2" fill="currentColor" />
    </svg>`
  },
  {
    id: "hanenbow",
    name: "Hanenbow Ballistics",
    kicker: "Electroplankton Toy · Specular Ricochet · Damped Leaf Springs",
    available: true,
    desc: "Acoustic ballistics simulator inspired by Toshio Iwai's Electroplankton. Plankton creatures shoot from an interactive spring-cannon into a pond of flexible leaves. Impacts cause leaves to oscillate elastically, triggering crystal bells and ricocheting plankton into syncopated arpeggio cascades.",
    tags: ["Electroplankton", "Toshio Iwai", "Specular Ballistics", "Leaf Springs", "8-Voice Polyphony", "Interactive Angles"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20c4-8 12-14 16-16" stroke-dasharray="2 2" />
      <path d="M11 15l5-3" stroke-width="2.2" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
      <path d="M7 11l6-2" stroke-width="2.2" />
      <circle cx="13" cy="9" r="1.5" fill="currentColor" />
      <circle cx="4" cy="20" r="2.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "sandpile",
    name: "Abelian Sandpile",
    kicker: "Self-Organized Criticality · Avalanches · Lattice Cascades",
    available: true,
    desc: "Discrete 2D cellular automaton governed by the Bak-Tang-Wiesenfeld Abelian sandpile model. Sand grains accumulate on a critical grid until cells exceed capacity (z ≥ 4) and topple to neighbors. Cascades unfold across all scales following a 1/f pink noise power law, triggering center-of-mass polyphony, spatial quadrant chords, and avalanche dynamics.",
    tags: ["BTW Sandpile", "Self-Organized Criticality", "1/f Pink Noise", "Lattice Avalanches", "Center-of-Mass Pitch", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l7 18H5l7-18z" />
      <path d="M12 7v5m-2-2h4" stroke-dasharray="1 1" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </svg>`
  },
  {
    id: "percolation",
    name: "Percolation Clusters",
    kicker: "Critical Phase Transition · Fluid Porosity · Disjoint Set Union",
    available: true,
    desc: "2D lattice fluid porosity and electrical conduction simulator governed by percolation theory. Sites randomly occupy with probability p; as p crosses the critical phase threshold (pc ≈ 0.5927), disconnected droplets coalesce into a giant spanning cluster. Conduction pulses sweep through porous channels triggering polyphonic chords, staccato droplet cascades, and resonant timbre modulation.",
    tags: ["Percolation", "Phase Transition", "Criticality (pc=0.59)", "DSU Union-Find", "Spanning Cluster", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="2.5" height="2.5" fill="currentColor" />
      <rect x="14.5" y="7" width="2.5" height="2.5" fill="currentColor" />
      <rect x="10.75" y="10.75" width="2.5" height="2.5" fill="currentColor" />
      <rect x="7" y="14.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="14.5" y="14.5" width="2.5" height="2.5" fill="currentColor" />
      <path d="M9.5 8.25h5M8.25 9.5v5M12 9.5v5M15.75 9.5v5" stroke-dasharray="1 1" />
    </svg>`
  },
  {
    id: "dla",
    name: "DLA Dendritic Crystal",
    kicker: "Fractal Growth · Brownian Walkers · Witten-Sander Df ≈ 1.71",
    available: true,
    desc: "Diffusion-Limited Aggregation (DLA) fractal crystallization engine. Brownian particles diffuse through a 2D field and adhere to aggregate seed clusters with variable stickiness, producing delicate mineral snowflakes and columnar coral branches. Polar radial distance maps to octave spread while polar anomaly angles quantize to scale degrees.",
    tags: ["DLA Fractal", "Brownian Motion", "Witten-Sander (Df=1.71)", "Polar Quantization", "Crystal Dendrites", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 12v-8m0 8v8m0-8h-8m8 0h8" />
      <path d="M12 8l4-4m-4 8l-4-4m4 8l4 4m-4-8l-4 4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="4" r="1.2" fill="currentColor" />
      <circle cx="12" cy="20" r="1.2" fill="currentColor" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" />
      <circle cx="20" cy="12" r="1.2" fill="currentColor" />
    </svg>`
  },
  {
    id: "epidemic",
    name: "SIR Epidemic Network",
    kicker: "Stochastic Contagion · Spatial Contact Graph · R₀ Threshold",
    available: true,
    desc: "Stochastic epidemiological network simulator governed by Kermack-McKendrick SIR dynamics. Susceptible agents contract infection from spatial neighbors with distance-decay transmission probability β. Active infections pulse through contact edges creating viral choral crescendos and macro-dramatic arcs as the population develops temporary protective immunity.",
    tags: ["SIR Contagion", "Reproduction R₀", "Contact Graph", "Spatial Immunity", "Epidemic Waves", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="5" cy="8" r="2" />
      <circle cx="19" cy="8" r="2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
      <path d="M7 9l3 2m4 0l3-2m-8 6l2-2m4 0l2 2" stroke-dasharray="1 1" />
    </svg>`
  },
  {
    id: "changes",
    name: "Change Ringing",
    kicker: "Campanology Permutations · English Full-Circle Bells · Blue Line",
    available: true,
    desc: "English church bell change ringing and method permutation sequencer. Bells navigate full-circle changes across stages 4 to 8 (Minimus to Major, matching the FM-1's 8 hardware voices) via Plain Hunt, Plain Bob, Grandsire, Stedman, and interactive Call Changes. Features authentic handstroke/backstroke open lead pauses, conductor Bob/Single calls, and real-time Blue Line method trajectory visualization.",
    tags: ["Change Ringing", "Campanology", "Permutation Rules", "Method Ringing", "The Blue Line", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a5 5 0 0 0-5 5v5a7 7 0 0 0-3 6h16a7 7 0 0 0-3-6V7a5 5 0 0 0-5-5z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "physarum",
    name: "Physarum Slime Mould",
    kicker: "Bio-Computing Transport Networks · Chemotaxis Swarm · Steiner Optimization",
    available: true,
    desc: "Autonomous multi-agent chemotaxis simulation based on Jeff Jones' formulation of Physarum polycephalum. Hundreds of mobile sensory agents forage across a 2D diffused pheromone field, self-organizing into biological transport highways connecting up to 8 food oat nodes. Peristaltic nutrient flux pulses trigger scale-quantized notes respecting the FM-1's 8 hardware voices.",
    tags: ["Physarum", "Slime Mould", "Chemotaxis", "Steiner Networks", "Multi-Agent", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V3M12 15v6M9 12H3M15 12h6" />
      <circle cx="12" cy="3" r="1.5" />
      <circle cx="12" cy="21" r="1.5" />
      <circle cx="3" cy="12" r="1.5" />
      <circle cx="21" cy="12" r="1.5" />
      <path d="M5.5 5.5l3 3m7 7l3 3m-13 0l3-3m7-7l3-3" stroke-dasharray="1 1" />
    </svg>`
  },
  {
    id: "reaction_diffusion",
    name: "Reaction-Diffusion",
    kicker: "Turing Morphogenesis · Non-Linear Chemical PDEs · Resonance Probes",
    available: true,
    desc: "Gray-Scott chemical morphogenesis simulation where substrate U and autocatalytic morphogen V react and diffuse across a 2D substrate. Produces self-replicating mitosis spots, coral labyrinths, expanding solitonic wave rings, and spiral chaos. 8 spatial resonance probes detect local chemical wavefronts, triggering scale-quantized notes respecting the FM-1's strict 8-voice polyphony limit.",
    tags: ["Turing Morphogenesis", "Reaction-Diffusion", "Gray-Scott", "Chemical PDEs", "Solitons", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18c2.5 0 4-2 4-4s-1.5-4-4-4c-2.5 0-4-2-4-4s1.5-6 4-6z" />
      <circle cx="12" cy="7.5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="16.5" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "kuramoto",
    name: "Kuramoto Oscillators",
    kicker: "Non-Linear Phase Synchronization · Order Parameter · Downbeat Chords",
    available: true,
    desc: "Coupled non-linear phase oscillators exhibiting spontaneous collective synchronization. Up to 8 phase oscillators with natural frequency dispersion interact through sinusoidal mean-field coupling. Alternates dynamically between aperiodic polyrhythmic cascades and massive, unified downbeat synchronization chords as macroscopic order parameter r fluctuates.",
    tags: ["Kuramoto", "Phase Sync", "Coupled Oscillators", "Order Parameter", "Polyrhythms", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <circle cx="12" cy="3" r="1.5" fill="currentColor" />
      <circle cx="21" cy="12" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "fitzhugh_nagumo",
    name: "FitzHugh-Nagumo Spiking",
    kicker: "Neuromorphic Spiking Network · Action Potentials · Refractory Phrasing",
    available: true,
    desc: "Biological neuromorphic neural network governed by coupled FitzHugh-Nagumo fast-slow electrophysiology ODEs. Action potential depolarization bursts trigger velocity-sensitive notes across up to 8 voices, while slow potassium recovery periods enforce realistic instrumental phrasing and prevent voice crowding.",
    tags: ["Neuromorphic", "FitzHugh-Nagumo", "Action Potentials", "Synfire Chains", "Central Pattern Generator", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M9 11l6-4M9 13l6 4M18 9v6" />
      <path d="M2 12h1m18-6h1m-1 12h1" stroke-dasharray="1 1" />
    </svg>`
  },
  {
    id: "ripple_tank",
    name: "Acoustic Ripple Tank",
    kicker: "Physical Wave Mechanics · FDTD 2D Interference · Hydrophone Sensors",
    available: true,
    desc: "2D acoustic wave equation ripple tank simulated via Finite-Difference Time-Domain (FDTD). Fluid surface ripples propagate, reflect off barrier walls and apertures, and create interference fringes. Up to 8 virtual hydrophone pickups detect crest crossings, triggering scale-quantized notes with stereo panning across the tank.",
    tags: ["Wave Equation", "FDTD", "Interference", "Diffraction", "Hydrophones", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="8" stroke-dasharray="2 2" />
      <path d="M4 12h2m12 0h2M12 4v2m0 12v2" />
    </svg>`
  },
  {
    id: "convection",
    name: "Rayleigh-Bénard Convection",
    kicker: "Thermal Fluid Dynamics · Dew Point Condensation · Tropospheric Clouds",
    available: true,
    desc: "Atmospheric Rayleigh-Bénard thermal convection simulation with Boussinesq Navier-Stokes fluid mechanics. Heated air from the ground plate rises in counter-rotating convection rolls; upon cooling past saturation dew points in the upper troposphere, vapor condenses into cloud billows, triggering crystalline high-octave chimes and deep grounding sub-bass downdrafts.",
    tags: ["Convection", "Thermodynamics", "Navier-Stokes", "Clouds", "Condensation", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 20h18" stroke-width="2" />
      <path d="M7 16c0-3 2-5 5-5s5 2 5 5" />
      <path d="M12 11V4M9 7l3-3 3 3" />
      <path d="M16 8a3 3 0 0 1 5 2c0 2-2 3-5 3" stroke-dasharray="1 1" />
    </svg>`
  },
  {
    id: "markov_matrix",
    name: "Markov Melodic Memory",
    kicker: "Transition Matrix · Boltzmann Entropy · High-Order N-Grams",
    available: true,
    desc: "Conditional state transition probability matrix between scale degrees with Boltzmann temperature scaling and high-order N-gram memory history. Multiple concurrent polyphonic walkers explore melodic cadences, cyclic ostinatos, and aleatoric clouds with Shannon entropy telemetry.",
    tags: ["Markov Matrix", "Boltzmann Temp", "Shannon Entropy", "N-Gram Memory", "8-Voice Polyphony", "Direct Heatmap"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8.5 6h7M18 8.5v7M15.5 18h-7M6 15.5v-7M8 8l8 8" />
    </svg>`
  },
  {
    id: "genetic_breeder",
    name: "Melodic Genome Breeder",
    kicker: "Interactive Genetic Algorithm · Crossover · Allele Mutation",
    available: true,
    desc: "Evolutionary melodic population breeder. Maintains 8 active musical genome chromosomes subjected to roulette wheel selection, single-point crossover, and allele mutation. Upvote or downvote individual genomes to steer melodic survival across successive generations.",
    tags: ["Genetic Algorithm", "Evolutionary", "Crossover", "Mutation", "Interactive Fitness", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 4c4 4 4 12 8 12s4-8 8-12" />
      <path d="M4 20c4-4 4-12 8-12s4 8 8 12" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "chladni",
    name: "Chladni Cymatics Plate",
    kicker: "Standing Wave Acoustics · Nodal Sand Patterns · Harmonic Probes",
    available: true,
    desc: "Ernst Chladni’s vibrating square acoustic plate simulation. Virtual sand grains are repelled from anti-nodal zones, accumulating into geometric standing wave nodal figures. Eight hydrophone pickup probes capture chime harmonics and bell overtones with dynamic velocity response.",
    tags: ["Chladni", "Cymatics", "Standing Waves", "Eigenfunctions", "Sand Patterns", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M3 12h18M12 3v18" stroke-dasharray="2 2" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "brownian_ratchet",
    name: "Brownian Thermal Ratchet",
    kicker: "Langevin Thermodynamics · Feynman Diode · Stochastic Work",
    available: true,
    desc: "Richard Feynman’s microscopic thermal ratchet and pawl engine. A paddle wheel in a fluctuating heat bath (T1) drives an asymmetric toothed cogwheel, restricted to forward rotation by a spring-loaded pawl in bath T2 against counter-torque load. Forward and reverse clicks trigger velocity-sensitive polyphonic pawl chimes.",
    tags: ["Brownian Ratchet", "Feynman Diode", "Langevin Dynamics", "Thermal Rectifier", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v4m0 8v4M4 12h4m8 0h4" />
      <path d="M16 8l-4 4-2-2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>`
  },
  {
    id: "tracy_ribbon",
    name: "Electroplankton Tracy Ribbon",
    kicker: "Spline Vector Trajectory · Organic Kinematics · Curvature Dynamics",
    available: true,
    desc: "Toshio Iwai’s Tracy plankton creature from Nintendo Electroplankton. Draw continuous vector gestures across an aquatic workbench canvas to construct a closed, looping ribbon contour. An autonomous Tracy creature navigates the closed ribbon with continuous momentum; local curvature modulates dynamics and articulation while swimming tail oscillations spawn trailing polyphonic echo droplets.",
    tags: ["Tracy", "Electroplankton", "Spline Trajectory", "Vector Ribbon", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12c4-8 12-8 16 0s-12 8-16 0z" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <path d="M7 10c1-2 3-2 4 0" />
      <circle cx="9" cy="8" r="1" fill="currentColor" />
    </svg>`
  },
  {
    id: "billiards",
    name: "Ballistic Billiards",
    kicker: "Hamiltonian Ray Optics · Specular Reflection · Ergodic Caustics",
    available: true,
    desc: "Dynamical Hamiltonian billiard simulator based on classical geometric chaos. Particles traverse bounded tables (Bunimovich Stadium, Sinai Scatterer, Confocal Ellipse, Cardioid, Polygonal Wedge) undergoing elastic specular reflections. Boundary collisions trigger scale-quantized notes, impact velocities modulate dynamics, and segment flight paths control gate articulation.",
    tags: ["Hamiltonian Optics", "Specular Reflection", "Bunimovich Stadium", "Sinai Scatterer", "8-Voice Polyphony", "Direct Slingshot"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="7" />
      <circle cx="9" cy="12" r="2" fill="currentColor" />
      <path d="M11 12l6-4m0 0l-2 5m2-5l-4-1" />
    </svg>`
  },
  {
    id: "self_avoiding_walk",
    name: "Polymer Self-Avoiding Walk",
    kicker: "Lattice Self-Avoidance · Steric Jamming · Folding Cascades",
    available: true,
    desc: "Growing polymer chain simulation on a 2D discrete lattice. Monomers advance to unoccupied adjacent lattice nodes subject to strict self-avoidance. When encountering steric hindrance dead-ends (jamming traps), the chain collapses and anneals, discharging an explosive polyphonic chord cascade across up to 8 voices.",
    tags: ["Polymer", "Self-Avoiding Walk", "Steric Jamming", "Protein Folding", "8-Voice Polyphony"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 4h8v8H4z" stroke-dasharray="2 2" />
      <path d="M4 12h8v8h8" />
      <circle cx="4" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="20" r="2" fill="currentColor" />
      <circle cx="20" cy="20" r="2.5" fill="currentColor" />
    </svg>`
  }
];

export const TOOLS = [
  {
    id: "dxpatch",
    name: "DX Patch Generator",
    kicker: "6-Op FM Voice Synthesis · 32-Voice Bank · SysEx I/O",
    available: true,
    desc: "Algorithmic patch generator and sound design workbench for Yamaha DX7 and M-VAVE FM-1. Features 11 category recipes, 6 sonic profiles, timbral macros, 6-operator matrix editing, real-time FM audio preview, and 32-voice cartridge bank export.",
    tags: ["6-Op FM", "32 Algorithms", "Voice (163B)", "Bank (4104B)", "SysEx Transmit", "Real-Time Audio"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h12M6 16h4m4 0h4" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
    </svg>`
  },
  {
    id: "librarian",
    name: "Preset & Pattern Librarian",
    kicker: "Hardware Preset Export · 16-Slot Pattern Pull & Upload · Step Editor",
    available: true,
    desc: "Bi-directional hardware librarian and pattern workbench for the M-VAVE FM-1. Pull and archive all 128 presets (FM, VA, 8-Bit) and 16 64-step sequencer patterns directly from device RAM, edit sequences interactively, or upload new patterns from .syx, .mid, .json, or Pulses banks.",
    tags: ["128 Presets (0x10)", "16 Patterns (0x11)", "Pattern Upload (0x20)", "MIDI (.mid) I/O", "64-Step Editor", "Full Backup"],
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" />
      <path d="M4 10h16M9 14h6M12 3v3M8 3v3M16 3v3" />
    </svg>`
  }
];

export const FILTER_TAGS = [
  { id: "monophonic", label: "Monophonic" },
  { id: "polyphonic", label: "Polyphonic" },
  { id: "grid-based", label: "Grid-based" },
  { id: "physics", label: "Physics" },
  { id: "biological", label: "Biological" },
  { id: "stochastic", label: "Stochastic" },
  { id: "algorithmic", label: "Algorithmic" },
  { id: "autonomous", label: "Autonomous" }
];

export const MODEL_TAG_MAP = {
  mene311: ["monophonic", "stochastic"],
  turing: ["monophonic", "algorithmic", "stochastic"],
  cellular: ["monophonic", "grid-based", "algorithmic"],
  particles: ["polyphonic", "grid-based", "physics"],
  pendulum: ["polyphonic", "physics", "autonomous"],
  flock: ["polyphonic", "biological", "autonomous"],
  rungler: ["monophonic", "algorithmic"],
  krell: ["polyphonic", "stochastic", "autonomous"],
  lsystem: ["polyphonic", "algorithmic"],
  lotka_volterra: ["polyphonic", "biological"],
  orbital: ["polyphonic", "physics", "autonomous"],
  hanenbow: ["polyphonic", "physics", "autonomous"],
  sandpile: ["polyphonic", "grid-based", "physics"],
  percolation: ["polyphonic", "grid-based", "stochastic"],
  dla: ["polyphonic", "grid-based", "stochastic"],
  epidemic: ["polyphonic", "biological"],
  changes: ["polyphonic", "algorithmic"],
  physarum: ["polyphonic", "grid-based", "biological", "autonomous"],
  reaction_diffusion: ["polyphonic", "grid-based", "autonomous"],
  kuramoto: ["polyphonic", "algorithmic", "autonomous"],
  fitzhugh_nagumo: ["polyphonic", "biological", "autonomous"],
  ripple_tank: ["polyphonic", "grid-based", "physics", "autonomous"],
  convection: ["polyphonic", "grid-based", "physics", "autonomous"],
  markov_matrix: ["polyphonic", "grid-based", "algorithmic"],
  genetic_breeder: ["polyphonic", "biological"],
  chladni: ["polyphonic", "grid-based", "physics", "autonomous"],
  brownian_ratchet: ["polyphonic", "physics", "stochastic", "autonomous"],
  tracy_ribbon: ["polyphonic", "grid-based", "autonomous"],
  self_avoiding_walk: ["polyphonic", "grid-based", "stochastic", "biological"],
  billiards: ["polyphonic", "physics", "autonomous"],
  nodal_graph: ["polyphonic", "algorithmic", "autonomous", "stochastic"],
  shift_register_2d: ["polyphonic", "grid-based", "algorithmic"],
  cellular_bug: ["polyphonic", "grid-based", "biological", "algorithmic"],
  boolean_euclidean: ["polyphonic", "algorithmic", "stochastic"]
};

// Bind filter tags to each model definition
for (const m of MODELS) {
  m.filterTags = MODEL_TAG_MAP[m.id] || [];
}

const activeSelectedTags = new Set();

export function filterModelsByTags(selectedTags = []) {
  const tagList = Array.isArray(selectedTags) ? selectedTags : Array.from(selectedTags || []);
  if (!tagList || tagList.length === 0) {
    return [...MODELS];
  }
  return MODELS.filter((m) => {
    const mTags = MODEL_TAG_MAP[m.id] || [];
    return tagList.every((t) => mTags.includes(t));
  });
}

export function getSelectedFilterTags() {
  return Array.from(activeSelectedTags);
}

export function setSelectedFilterTags(tags) {
  activeSelectedTags.clear();
  if (tags) {
    for (const t of tags) activeSelectedTags.add(t);
  }
  applyModelFilters();
}

export function clearSelectedFilterTags() {
  activeSelectedTags.clear();
  applyModelFilters();
}

export function toggleFilterTag(tagId) {
  if (activeSelectedTags.has(tagId)) {
    activeSelectedTags.delete(tagId);
  } else {
    activeSelectedTags.add(tagId);
  }
  applyModelFilters();
  return activeSelectedTags.has(tagId);
}

export function renderModelFilterBar(container) {
  if (!container) return;
  container.innerHTML = "";
  container.setAttribute("role", "toolbar");
  container.setAttribute("aria-label", "Filter sequencing models by tag");

  const label = document.createElement("span");
  label.className = "models-filter-label";
  label.textContent = "TAGS";

  const tagsGroup = document.createElement("div");
  tagsGroup.className = "models-filter-tags";

  for (const tag of FILTER_TAGS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-filter-btn";
    btn.dataset.tag = tag.id;
    btn.textContent = tag.label;
    btn.setAttribute("aria-pressed", activeSelectedTags.has(tag.id) ? "true" : "false");
    if (activeSelectedTags.has(tag.id)) {
      btn.classList.add("is-active");
    }

    btn.addEventListener("click", () => {
      toggleFilterTag(tag.id);
    });

    tagsGroup.appendChild(btn);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "model-filter-clear-btn";
  clearBtn.textContent = "CLEAR";
  clearBtn.title = "Clear all active tag filters";
  clearBtn.style.display = activeSelectedTags.size > 0 ? "" : "none";
  clearBtn.addEventListener("click", () => {
    clearSelectedFilterTags();
  });

  const countBadge = document.createElement("span");
  countBadge.className = "models-filter-count";
  countBadge.id = "models-filter-count";

  container.append(label, tagsGroup, clearBtn, countBadge);
  updateFilterUIState();
}

export function applyModelFilters() {
  const grid = document.getElementById("models-grid");
  const cards = grid ? grid.querySelectorAll(".model-card") : [];
  const selected = Array.from(activeSelectedTags);

  let visibleCount = 0;
  cards.forEach((card) => {
    const modelId = card.dataset.modelId;
    if (!modelId) return;
    const modelTags = MODEL_TAG_MAP[modelId] || [];
    const matches = selected.length === 0 || selected.every((t) => modelTags.includes(t));
    card.style.display = matches ? "" : "none";
    if (matches) visibleCount++;
  });

  let emptyEl = document.getElementById("models-empty-state");
  if (visibleCount === 0 && cards.length > 0) {
    if (!emptyEl && grid) {
      emptyEl = document.createElement("div");
      emptyEl.id = "models-empty-state";
      emptyEl.className = "models-empty-state";
      emptyEl.textContent = "No models match all selected tags. Try deselecting a tag.";
      grid.appendChild(emptyEl);
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }

  updateFilterUIState(visibleCount, cards.length);
}

function updateFilterUIState(visibleCount, totalCount) {
  const container = document.getElementById("models-filter-bar");
  if (!container) return;

  const buttons = container.querySelectorAll(".model-filter-btn");
  buttons.forEach((btn) => {
    const tagId = btn.dataset.tag;
    const active = activeSelectedTags.has(tagId);
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const clearBtn = container.querySelector(".model-filter-clear-btn");
  if (clearBtn) {
    clearBtn.style.display = activeSelectedTags.size > 0 ? "" : "none";
  }

  const countEl = container.querySelector(".models-filter-count");
  if (countEl) {
    if (activeSelectedTags.size > 0) {
      const total = totalCount ?? MODELS.length;
      const count = visibleCount ?? filterModelsByTags(activeSelectedTags).length;
      countEl.textContent = `${count} / ${total}`;
    } else {
      countEl.textContent = `${MODELS.length}`;
    }
  }
}

let activeModelId = null;
let callbacks = { onEnterModel: null, onLeaveModel: null };

export function getActiveModel() {
  return activeModelId;
}

export function renderModelsGrid(container) {
  if (!container) return;
  container.innerHTML = "";

  for (const m of MODELS) {
    const card = document.createElement("div");
    card.className = "model-card is-active";
    card.dataset.modelId = m.id;
    card.dataset.tags = (MODEL_TAG_MAP[m.id] || []).join(" ");
    card.title = `${m.name}: ${m.desc}`;

    card.innerHTML = `
      <div class="model-card-top">
        <div class="model-icon-wrap" aria-hidden="true">${m.icon}</div>
        <div class="model-header-text">
          <div class="model-title-row">
            <h3 class="model-title">${m.name}</h3>
          </div>
          <div class="model-kicker">${m.kicker}</div>
        </div>
      </div>
      <div class="model-card-body">
        <div class="model-tags">
          ${m.tags.map((t) => `<span class="model-tag">${t}</span>`).join("")}
        </div>
      </div>
      <div class="model-card-footer">
        <button class="model-launch-btn primary" data-launch="${m.id}" title="${m.name}: ${m.desc}">
          Launch ${m.name} Engine <span>→</span>
        </button>
      </div>
    `;

    card.querySelector(`[data-launch="${m.id}"]`)?.addEventListener("click", (e) => {
      e.stopPropagation();
      showModel(m.id);
    });
    // Clicking anywhere on the active card also launches it
    card.addEventListener("click", () => {
      showModel(m.id);
    });

    container.appendChild(card);
  }

  applyModelFilters();
}

export function openModelGuide(modelId = activeModelId) {
  if (!modelId) return;
  const guide = MODEL_GUIDES[modelId];
  if (!guide) return;

  const modal = document.getElementById("model-guide-modal");
  const titleEl = document.getElementById("modal-guide-title");
  const kickerEl = document.getElementById("modal-guide-kicker");
  const bodyEl = document.getElementById("modal-guide-body");
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = guide.title;
  if (kickerEl) kickerEl.textContent = guide.kicker || "";

  let html = `<div class="modal-section-title">Model Overview</div>`;
  if (Array.isArray(guide.paragraphs)) {
    for (const p of guide.paragraphs) {
      html += `<p class="modal-paragraph">${p}</p>`;
    }
  }

  if (Array.isArray(guide.controls) && guide.controls.length > 0) {
    html += `<div class="modal-section-title">Controls &amp; Surface Interaction</div>`;
    html += `<ul class="modal-control-list">`;
    for (const c of guide.controls) {
      html += `
        <li class="modal-control-item">
          <div class="modal-control-name">${c.name}</div>
          <div class="modal-control-desc">${c.desc}</div>
        </li>
      `;
    }
    html += `</ul>`;
  }

  bodyEl.innerHTML = html;
  modal.style.display = "flex";
}

export function closeModelGuide() {
  const modal = document.getElementById("model-guide-modal");
  if (modal) modal.style.display = "none";
}

export function renderToolsGrid(container) {
  if (!container) return;
  container.innerHTML = "";

  for (const t of TOOLS) {
    const card = document.createElement("div");
    card.className = "model-card is-active";
    card.dataset.toolId = t.id;
    card.title = `${t.name}: ${t.desc}`;

    card.innerHTML = `
      <div class="model-card-top">
        <div class="model-icon-wrap" aria-hidden="true">${t.icon}</div>
        <div class="model-header-text">
          <div class="model-title-row">
            <h3 class="model-title">${t.name}</h3>
          </div>
          <div class="model-kicker">${t.kicker}</div>
        </div>
      </div>
      <div class="model-card-body">
        <div class="model-tags">
          ${t.tags.map((tag) => `<span class="model-tag">${tag}</span>`).join("")}
        </div>
      </div>
      <div class="model-card-footer">
        <button class="model-launch-btn primary" data-launch="${t.id}" title="${t.name}: ${t.desc}">
          Launch ${t.name} <span>→</span>
        </button>
      </div>
    `;

    card.querySelector(`[data-launch="${t.id}"]`)?.addEventListener("click", (e) => {
      e.stopPropagation();
      showModel(t.id);
    });
    card.addEventListener("click", () => {
      showModel(t.id);
    });

    container.appendChild(card);
  }
}

export const STEP_MODELS = new Set([
  "mene311",
  "cellular",
  "turing",
  "particles",
  "rungler",
  "lsystem",
  "lotka_volterra"
]);

const HASH_ALIAS_MAP = {
  "#lotka-volterra": "lotka_volterra",
  "#lv": "lotka_volterra",
  "#btw": "sandpile",
  "#soc": "sandpile",
  "#porosity": "percolation",
  "#cluster": "percolation",
  "#fractal": "dla",
  "#sir": "epidemic",
  "#bells": "changes",
  "#campanology": "changes",
  "#slime": "physarum",
  "#mould": "physarum",
  "#rd": "reaction_diffusion",
  "#reaction-diffusion": "reaction_diffusion",
  "#turing-patterns": "reaction_diffusion",
  "#sync-oscillators": "kuramoto",
  "#phase-sync": "kuramoto",
  "#fitzhugh-nagumo": "fitzhugh_nagumo",
  "#fhn": "fitzhugh_nagumo",
  "#spiking-network": "fitzhugh_nagumo",
  "#neuromorphic": "fitzhugh_nagumo",
  "#ripple-tank": "ripple_tank",
  "#waves": "ripple_tank",
  "#acoustic-tank": "ripple_tank",
  "#thermal-convection": "convection",
  "#clouds": "convection",
  "#rayleigh-benard": "convection",
  "#markov": "markov_matrix",
  "#markov-matrix": "markov_matrix",
  "#melodic-memory": "markov_matrix",
  "#stochastic-melody": "markov_matrix",
  "#breeder": "genetic_breeder",
  "#genetic": "genetic_breeder",
  "#genome": "genetic_breeder",
  "#genetic-algorithm": "genetic_breeder",
  "#cymatics": "chladni",
  "#standing-waves": "chladni",
  "#nodal-plate": "chladni",
  "#ratchet": "brownian_ratchet",
  "#feynman-diode": "brownian_ratchet",
  "#thermal-ratchet": "brownian_ratchet",
  "#tracy": "tracy_ribbon",
  "#ribbon": "tracy_ribbon",
  "#electroplankton": "tracy_ribbon",
  "#saw": "self_avoiding_walk",
  "#polymer": "self_avoiding_walk",
  "#polymer-walk": "self_avoiding_walk",
  "#billiard": "billiards",
  "#bunimovich": "billiards",
  "#sinai": "billiards",
  "#boolean-euclidean": "boolean_euclidean",
  "#beuclid": "boolean_euclidean",
  "#logic-euclid": "boolean_euclidean",
  "#cellular-bug": "cellular_bug",
  "#cbug": "cellular_bug",
  "#turmite": "cellular_bug",
  "#langton": "cellular_bug",
  "#shift-register-2d": "shift_register_2d",
  "#sr2d": "shift_register_2d",
  "#shift2d": "shift_register_2d",
  "#nodal-graph": "nodal_graph",
  "#nodal": "nodal_graph",
  "#graph": "nodal_graph",
  "#dxpatchgen": "dxpatch",
  "#patch-generator": "dxpatch",
  "#sync": "librarian",
  "#export": "librarian"
};

export function resolveHashToModel(rawHash) {
  const h = (rawHash || "").toLowerCase().split("?")[0];
  if (!h || h === "#" || h === "#models") return null;
  if (HASH_ALIAS_MAP[h]) return HASH_ALIAS_MAP[h];
  const bare = h.slice(1);
  if (MODELS.some((m) => m.id === bare) || TOOLS.some((t) => t.id === bare) || bare === "librarian") {
    return bare;
  }
  return null;
}

export function showLanding(updateHash = true) {
  if (callbacks.onLeaveModel && activeModelId) {
    try {
      callbacks.onLeaveModel(activeModelId);
    } catch (err) {
      console.warn("Error in onLeaveModel:", err);
    }
  }
  activeModelId = null;

  const viewLanding = document.getElementById("view-landing");
  const viewWorkspace = document.getElementById("view-workspace") || document.getElementById("view-mene311");
  const viewDxpatch = document.getElementById("view-dxpatch");
  const viewLibrarian = document.getElementById("view-librarian");
  const btnBack = document.getElementById("btn-back-landing");
  const modeTag = document.getElementById("brand-mode-tag");
  const seqBar = document.getElementById("sequence");
  const rhythmBar = document.getElementById("rhythm-bar");
  const grooveBar = document.getElementById("humanise-velocity-bar");

  if (seqBar) seqBar.style.display = "block";
  if (rhythmBar) rhythmBar.style.display = "block";
  if (grooveBar) grooveBar.style.display = "flex";

  if (refs.tempo) refs.tempo.style.display = "";
  if (refs.speed) refs.speed.style.display = "none";
  if (refs.rate) refs.rate.style.display = "";
  if (refs.length) refs.length.style.display = "";
  if (refs.gate) refs.gate.style.display = "";

  if (viewLanding) viewLanding.style.display = "block";
  if (viewWorkspace) viewWorkspace.style.display = "none";
  if (viewDxpatch) viewDxpatch.style.display = "none";
  if (viewLibrarian) viewLibrarian.style.display = "none";

  for (const m of MODELS) {
    const el = document.getElementById(`model-${m.id}`);
    if (el) el.style.display = "none";
  }

  if (btnBack) btnBack.style.display = "none";
  if (modeTag) modeTag.style.display = "none";
  setPolyphonyControlsVisible(false);

  if (updateHash && window.location.hash !== "#models") {
    history.replaceState(null, "", "#models");
  }
}

export function showModel(id, updateHash = true) {
  const isKnown = MODELS.some((m) => m.id === id) || TOOLS.some((t) => t.id === id) || id === "librarian";
  if (!isKnown) return;

  const viewLanding = document.getElementById("view-landing");
  const viewWorkspace = document.getElementById("view-workspace") || document.getElementById("view-mene311");
  const viewDxpatch = document.getElementById("view-dxpatch");
  const viewLibrarian = document.getElementById("view-librarian");
  const btnBack = document.getElementById("btn-back-landing");
  const modeTag = document.getElementById("brand-mode-tag");
  const seqBar = document.getElementById("sequence");
  const rhythmBar = document.getElementById("rhythm-bar");
  const grooveBar = document.getElementById("humanise-velocity-bar");

  activeModelId = id;

  if (viewLanding) viewLanding.style.display = "none";

  // Polyphony controls visibility in Notes bar: visible on polyphonic models, hidden on monophonic models
  setPolyphonyControlsVisible(POLYPHONIC_MODELS.has(id));

  // Unlinked free models hide discrete step sequencer bars
  const isStepModel = STEP_MODELS.has(id);
  if (seqBar) seqBar.style.display = isStepModel ? "block" : "none";
  if (rhythmBar) rhythmBar.style.display = isStepModel ? "block" : "none";
  if (grooveBar) grooveBar.style.display = isStepModel ? "flex" : "none";

  // Swap Tempo/Rate/Length/Gate with generic Speed knob in global bar
  if (refs.tempo) refs.tempo.style.display = isStepModel ? "" : "none";
  if (refs.speed) refs.speed.style.display = isStepModel ? "none" : "";
  if (refs.rate) refs.rate.style.display = isStepModel ? "" : "none";
  if (refs.length) refs.length.style.display = isStepModel ? "" : "none";
  if (refs.gate) refs.gate.style.display = isStepModel ? "" : "none";

  if (id === "dxpatch" || id === "librarian") {
    if (viewWorkspace) viewWorkspace.style.display = "none";
    if (viewDxpatch) viewDxpatch.style.display = id === "dxpatch" ? "block" : "none";
    if (viewLibrarian) viewLibrarian.style.display = id === "librarian" ? "block" : "none";
    if (btnBack) {
      btnBack.textContent = "‹ Tools";
      btnBack.title = "Return to Tools & Models";
      btnBack.style.display = "inline-flex";
    }
    if (modeTag) {
      modeTag.textContent = id === "dxpatch" ? "DX Patch Generator" : "Librarian";
      modeTag.style.display = "inline-block";
    }
  } else {
    if (viewDxpatch) viewDxpatch.style.display = "none";
    if (viewLibrarian) viewLibrarian.style.display = "none";
    if (viewWorkspace) viewWorkspace.style.display = "block";
    for (const m of MODELS) {
      const el = document.getElementById(`model-${m.id}`);
      if (el) el.style.display = m.id === id ? "block" : "none";
    }
    if (btnBack) {
      btnBack.textContent = "‹ Models";
      btnBack.title = "Return to Sequencer Models";
      btnBack.style.display = "inline-flex";
    }
    if (modeTag) {
      const found = MODELS.find((m) => m.id === id);
      if (found) modeTag.textContent = found.name;
      modeTag.style.display = "inline-block";
    }
  }

  if (updateHash && window.location.hash !== `#${id}`) {
    history.pushState(null, "", `#${id}`);
  }

  if (callbacks.onEnterModel) {
    callbacks.onEnterModel(id);
  }
}

export function initModes({ onEnterModel, onLeaveModel } = {}) {
  callbacks.onEnterModel = onEnterModel;
  callbacks.onLeaveModel = onLeaveModel;

  const filterBar = document.getElementById("models-filter-bar");
  if (filterBar) renderModelFilterBar(filterBar);

  const grid = document.getElementById("models-grid");
  if (grid) renderModelsGrid(grid);

  const toolsGrid = document.getElementById("tools-grid");
  if (toolsGrid) renderToolsGrid(toolsGrid);

  // Return to landing page buttons
  const returnToLanding = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    showLanding();
  };

  const btnBack = document.getElementById("btn-back-landing");
  btnBack?.addEventListener("click", returnToLanding);

  document.querySelectorAll(".nav-back-btn").forEach((btn) => {
    btn.addEventListener("click", returnToLanding);
  });

  const linkModels = document.getElementById("link-models");
  linkModels?.addEventListener("click", returnToLanding);

  const linkDxModels = document.getElementById("dxpatch-link-models");
  linkDxModels?.addEventListener("click", returnToLanding);

  const linkLibModels = document.getElementById("lib-link-models");
  linkLibModels?.addEventListener("click", returnToLanding);

  // Wire model guide modal button and close handlers
  const btnGuide = document.getElementById("btn-model-guide");
  btnGuide?.addEventListener("click", () => {
    openModelGuide(activeModelId);
  });

  const modal = document.getElementById("model-guide-modal");
  const closeBtn = document.getElementById("modal-guide-close");
  closeBtn?.addEventListener("click", closeModelGuide);

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModelGuide();
    }
  });

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && modal.style.display !== "none") {
        closeModelGuide();
      }
    });
  }

  // Handle URL hash changes
  window.addEventListener("hashchange", () => {
    const targetId = resolveHashToModel(window.location.hash);
    if (targetId) {
      if (activeModelId !== targetId) showModel(targetId, false);
    } else if (activeModelId !== null) {
      showLanding(false);
    }
  });

  // Initial view selection
  const initialTarget = resolveHashToModel(window.location.hash);
  if (initialTarget) {
    showModel(initialTarget, false);
  } else {
    showLanding(false);
  }
}
