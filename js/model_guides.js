// js/model_guides.js — In-app guide descriptions and control specifications for all 29 sequencer models.

export const MODEL_GUIDES = {
  mene311: {
    title: "Mene311 Stochastic S&H",
    kicker: "Stochastic S&H · Quantizer · Echo Loop",
    paragraphs: [
      "The Mene311 engine simulates a classical West Coast modular generative signal chain. Gate probability triggers Sample & Hold circuits coupled with continuous LFO waveshaping, generating Gaussian-distributed voltage contours that are quantized across musical scales to yield organic, evolving melodic phrases.",
      "Melodic output is routed through a circular Deja-Vu echo buffer that repeats motifs over configurable intervals. Note triggers and velocities strictly respect scale degree quantization, while micro-timing humanize introduces subtle analog-style drift before streaming to the FM-1 synthesizer."
    ],
    controls: [
      { name: "PROB (Gate Probability)", desc: "Likelihood of generating a new note trigger on any active step." },
      { name: "SHAPE (LFO Waveshape)", desc: "Modulation curve profile (sine, triangle, ramp, square) modulating sample voltages." },
      { name: "ECHO / DEJA-VU", desc: "Circular memory loop buffer length (1–64 steps); locks repeating motifs or drifts." },
      { name: "LFO SPEED", desc: "Internal modulation oscillator frequency governing pitch contour transitions." },
      { name: "SPREAD", desc: "Gaussian variance spread modulating note deviation around the root key." }
    ]
  },
  turing: {
    title: "Turing Machine",
    kicker: "Shift Register · Bit Slip · Mutation",
    paragraphs: [
      "Inspired by Tom Whitwell's Music Thing Modular Turing Machine, this engine uses a circulating binary shift register to produce hypnotic, pseudo-random melodies. Bits circulating through the register are decoded via an 8-bit DAC ladder into scale-quantized pitch voltages.",
      "A probabilistic write head mutates bits at each step according to the mutation parameter: at 0% mutation, the sequence loops indefinitely as a locked ostinato; at 100%, it continuously evolves into new random melodies. Step slip periodically shifts bits for polyrhythmic phased variation."
    ],
    controls: [
      { name: "LENGTH (Register Size)", desc: "Shift register cycle length (8, 16, 32, or 64 steps) defining the loop period." },
      { name: "MUTATION (Write Prob)", desc: "Probability of mutating circulating bits (0% = locked loop, 100% = random walk)." },
      { name: "SLIP (Bit Slip)", desc: "Periodic phase rotation shifting bit positions relative to the transport clock." },
      { name: "PRESETS", desc: "Instant register seed states (Locked 8, Locked 16, High Flux, Melodic Arp)." },
      { name: "BITS MATRIX", desc: "Direct toggleable grid cells allowing manual bit editing in the active register." }
    ]
  },
  cellular: {
    title: "Cellular Automata",
    kicker: "Wolfram 1D Rules · Step Matrix · Emergent",
    paragraphs: [
      "Driven by Stephen Wolfram's 1D elementary cellular automata, this model computes successive generations of binary cells governed by local neighbor rules (such as Rule 30, 90, 110, or 150). Each generation's spatial bit arrangement is mapped into musical pitch and rhythm vectors.",
      "The resulting sequences exhibit emergent complexity—from periodic crystalline loops to chaotic, fractal, and self-similar contours. Cells can be manually primed on the interactive seed grid, and stochastic mutation introduces subtle generational variation."
    ],
    controls: [
      { name: "RULE", desc: "Elementary Wolfram rule number (e.g., Rule 30 chaotic, Rule 90 fractal, Rule 110 Turing-complete)." },
      { name: "GENS (Generations)", desc: "Number of automata step generations computed across the time axis." },
      { name: "MUTATE", desc: "Random bit-flip probability injected into neighbor state transitions." },
      { name: "PITCH MAP", desc: "Spatial mapping mode (Linear, Center-Out, Bit-Weight, Inverted) translating cells to scale degrees." },
      { name: "SEED GRID", desc: "Interactive 1D cell strip to toggle initial generation conditions directly." }
    ]
  },
  particles: {
    title: "Particles",
    kicker: "2D Kinetic Grid · Multi-Head · Collision Physics",
    paragraphs: [
      "Inspired by Orca and Plinky, Particles is a multi-head 2D kinetic collision simulator. Autonomous playheads travel across an interactive surface with directional velocities, bouncing elastically off grid boundaries and user-drawn obstacle walls.",
      "When particles collide on the same coordinate cell, they trigger musical note events across up to 8 polyphonic voices. Collision outcomes are selectable: particles can deflect at 90° angles, bounce elastically, annihilate, or spawn temporary child particles that cascade across the grid."
    ],
    controls: [
      { name: "GRID SIZE", desc: "Dimensions of the 2D physics surface (width and height)." },
      { name: "HEADS (1–8)", desc: "Number of active particle playheads traversing the grid simultaneously." },
      { name: "COLLISION MODE", desc: "Physical response on collision: Deflect (90° turn), Annihilate, Spawn Child, or Bounce." },
      { name: "CHILD LIFE", desc: "Duration and velocity decay of child particles spawned during collision events." },
      { name: "CANVAS OBSTACLES", desc: "Click and drag directly on the canvas to place deflector blocks and walls." }
    ]
  },
  pendulum: {
    title: "Double Pendulum",
    kicker: "Deterministic Chaos · Direct Manipulation · Phase Attractor",
    paragraphs: [
      "Simulates the deterministic chaos of a coupled double pendulum using a 4th-order Runge-Kutta (RK4) numerical integrator. The nonlinear kinetic interactions of the two hinged arms produce non-repeating, strange attractor orbits that never truly repeat.",
      "Angular positions and angular velocities of the pendulum bobs are mapped into scale degrees and dynamics. The engine supports dual-voice polyphony reflecting both inner and outer bob vectors, while kinetic energy continuously shapes note velocity."
    ],
    controls: [
      { name: "GRAVITY", desc: "Gravitational constant accelerating downward swing velocity." },
      { name: "DAMPING", desc: "Friction dissipation slowing pendulum momentum over time." },
      { name: "LENGTH 1 & 2", desc: "Relative rod lengths of the primary and secondary pendulum arms." },
      { name: "MASS 1 & 2", desc: "Mass distribution between the inner hinge and outer bob." },
      { name: "CANVAS BOB DRAG", desc: "Directly click and drag pendulum bobs on canvas to prime initial angular trajectories." }
    ]
  },
  flock: {
    title: "Flocking Swarm",
    kicker: "Autonomous Boids · Continuous Event Time · Spatial Chords",
    paragraphs: [
      "Based on Craig Reynolds' Boids artificial life simulation, this model simulates an autonomous flock of agents navigating a 2D territory via Separation (collision avoidance), Alignment (velocity matching), and Cohesion (flock centering).",
      "When the flock congregates near armed attractor targets placed on the canvas, it discharges up to 8-voice polyphonic chords quantized to the active scale, accompanied by an explosive scatter impulse that disperses the swarm before it regroups."
    ],
    controls: [
      { name: "BOIDS (Swarm Count)", desc: "Number of autonomous flying agents simulated in the flock." },
      { name: "SEPARATION", desc: "Repulsion strength preventing agents from crowding nearby neighbors." },
      { name: "ALIGNMENT", desc: "Steering force matching agent headings to the local average direction." },
      { name: "COHESION", desc: "Centripetal pull drawing agents toward the flock's center of mass." },
      { name: "ATTRACTORS", desc: "Click canvas to place or move armed musical chord target nodes." }
    ]
  },
  rungler: {
    title: "Rob Hordijk Rungler",
    kicker: "Chaotic Stepped Shift Register · Benjolin · Cross-Modulation",
    paragraphs: [
      "Faithfully models Rob Hordijk's legendary Benjolin Rungler circuit. Two high-frequency analog oscillators cross-modulate each other's frequency and clock a comparator feeding a 16-bit shift register, which is decoded through a 4-bit DAC ladder into chaotic stepped control voltages.",
      "The Rungler's feedback loops generate exotic bifurcations, stepped ostinatos, and unpredictable aleatoric melodies. The output is scale-quantized and mapped across the configured pitch span, delivering vintage modular synth character."
    ],
    controls: [
      { name: "OSC 1 FREQ", desc: "Frequency rate of the primary clock oscillator driving the shift register." },
      { name: "OSC 2 FREQ", desc: "Frequency rate of the secondary cross-modulating oscillator." },
      { name: "X-MOD DEPTH", desc: "Bidirectional cross-modulation depth between the two oscillators." },
      { name: "RUNGLER DAC", desc: "Tap points and decoding ladder configuration of the 4-bit Rungler DAC." },
      { name: "LOOP / LOCK", desc: "Freezes shift register feedback into repeating cyclic stepped melodies." }
    ]
  },
  krell: {
    title: "Buchla Krell Patch",
    kicker: "Dual Function Generators · Source of Uncertainty · Non-Metric Ambient",
    paragraphs: [
      "Inspired by Todd Barton's Buchla 266 patch and Bebe & Louis Barron's soundtrack for Forbidden Planet (1956). Two nonlinear function generators cross-modulate each other's Rise and Fall slopes, sampled with random voltages to yield unmetered, self-generating ambient phrases.",
      "At the end of each Rise/Fall cycle, the engine triggers a scale-quantized pitch, modulates gate dwell time, and produces smooth timbral swells. It operates in continuous event time, ideal for cinematic soundscapes and generative installations."
    ],
    controls: [
      { name: "RISE (Attack Slope)", desc: "Base rise duration range for the generative function generator." },
      { name: "FALL (Decay Slope)", desc: "Base fall duration range for the generative function generator." },
      { name: "UNCERTAINTY", desc: "Random voltage depth modulating pitch and slope times." },
      { name: "DWELL (Rest Time)", desc: "Inter-event rest pause between consecutive envelope cycles." },
      { name: "VOICE COUNT", desc: "Active generative voices operating concurrent asynchronous cycles." }
    ]
  },
  lsystem: {
    title: "L-System Grammar",
    kicker: "Lindenmayer Formal Grammar · Fractal Turtle · Motif Branching",
    paragraphs: [
      "Implements Aristid Lindenmayer's formal string rewriting grammars, originally developed to model biological plant growth and fractal curves (Hilbert, Koch, Dragon, Sierpinski). Successive string iterations expand recursive branching motifs.",
      "A virtual LOGO-style turtle graphics interpreter traverses the expanded string, translating forward steps, turns, and branch push/pop operations into melodic pitch intervals and rhythmic gates across up to 8 polyphonic voices."
    ],
    controls: [
      { name: "PRESET GRAMMAR", desc: "Formal grammar system (Hilbert Curve, Koch Snowflake, Dragon Curve, Plant Branching)." },
      { name: "DEPTH (Iterations)", desc: "Recursive expansion depth (1–5) governing pattern complexity." },
      { name: "ANGLE", desc: "Turtle turning angle in degrees affecting interval trajectory." },
      { name: "AXIOM / RULES", desc: "Editable production string rules defining recursive character substitutions." },
      { name: "STEP RATE", desc: "Interpretation speed traversing the compiled L-System string." }
    ]
  },
  lotka_volterra: {
    title: "Lotka-Volterra Predator-Prey",
    kicker: "Nonlinear Population ODEs · Ecological Cycles · Phase Space",
    paragraphs: [
      "Simulates the nonlinear ordinary differential equations (ODEs) governing biological predator-prey population dynamics. Prey reproduce naturally and are consumed by predators, while predator populations rise with food supply and decline when prey is scarce.",
      "The coupled population trajectories trace closed orbital paths in phase space. Instantaneous populations of both species are mapped into two-voice polyphony, where population surges trigger rhythmic flourishes and ecological collapse triggers harmonic cadences."
    ],
    controls: [
      { name: "PREY BIRTH (α)", desc: "Intrinsic reproduction rate of the prey population." },
      { name: "PREDATION (β)", desc: "Encounter and consumption rate of prey by predators." },
      { name: "PREDATOR LOSS (γ)", desc: "Natural mortality rate of predators in the absence of prey." },
      { name: "PREDATOR GAIN (δ)", desc: "Reproduction efficiency of predators per consumed prey." },
      { name: "PHASE CANVAS", desc: "Click and drag to set initial population starting coordinates." }
    ]
  },
  orbital: {
    title: "Keplerian Orbital Resonance",
    kicker: "Gravitational N-Body · Celestial Resonances · Periapsis Triggers",
    paragraphs: [
      "Simulates gravitational celestial mechanics where multiple planets orbit a central sun in Keplerian ellipses. Ratios between orbital periods produce harmonic celestial resonances (such as the Laplace 4:2:1 resonance of Jupiter's moons Io, Europa, and Ganymede).",
      "Each planet triggers musical notes as it sweeps through its periapsis (closest approach to the sun), where orbital velocity peaks. True anomaly, semi-major axis, and orbital inclination map into scale pitch and velocity across up to 8 voices."
    ],
    controls: [
      { name: "PRESET SYSTEM", desc: "Celestial resonance systems (Laplace 4:2:1, Trappist-1, Golden Ratio, Solar Inner)." },
      { name: "BODIES (1–8)", desc: "Number of active celestial planets orbiting the central star." },
      { name: "GRAVITY", desc: "Central gravitational constant setting overall orbital velocities." },
      { name: "ECCENTRICITY", desc: "Orbital elongation; higher eccentricity creates dramatic velocity spikes at periapsis." },
      { name: "CANVAS ORBITS", desc: "Click and drag planets directly to alter orbital radius and momentum." }
    ]
  },
  hanenbow: {
    title: "Hanenbow Bouncing Seeds",
    kicker: "Kinetic Acoustics · Foliage Deflection · Rebound Chimes",
    paragraphs: [
      "Inspired by Toshio Iwai's Electroplankton Hanenbow, seeds are emitted from a central cannon and rebound off angled foliage pads. Each acoustic leaf collision triggers a scale-quantized chime whose pitch depends on leaf angle, size, and elevation.",
      "As seeds ricochet between foliage pads, they produce cascading arpeggios and rhythmic echoes. Foliage paddle angles can be directly rotated on the canvas, allowing players to sculpt recurring acoustic ricochet loops."
    ],
    controls: [
      { name: "SEED RATE", desc: "Emission frequency of bouncing seeds fired from the cannon." },
      { name: "LEAF TILT", desc: "Angle of acoustic foliage pads, steering rebound trajectories." },
      { name: "ELASTICITY", desc: "Bounciness factor; higher elasticity prolongs seed ricochet chains." },
      { name: "LEAF PITCH", desc: "Scale degree and octave assigned to individual foliage leaves." },
      { name: "CANVAS LEAF DRAG", desc: "Click and drag leaf paddles directly to position and rotate them in space." }
    ]
  },
  sandpile: {
    title: "Abelian Sandpile (SOC)",
    kicker: "Self-Organized Criticality · Avalanches · Lattice Cascades",
    paragraphs: [
      "Simulates the Bak-Tang-Wiesenfeld Abelian Sandpile, the canonical model of Self-Organized Criticality (SOC). Sand grains are deposited onto a 2D integer lattice; whenever a cell accumulates 4 or more grains, it topples and distributes 1 grain to each cardinal neighbor.",
      "These local topples cascade into avalanches across all spatial scales, obeying a 1/f pink noise power law. Avalanche center-of-mass and kinetic intensity trigger polyphonic cascading chords across up to 8 voices."
    ],
    controls: [
      { name: "SIZE", desc: "Lattice width and height (odd grid dimensions)." },
      { name: "RATE", desc: "Continuous sand deposition rate (grains per second)." },
      { name: "GRAINS", desc: "Number of sand grains added per deposition tick." },
      { name: "BOUNDARY", desc: "Boundary dissipation: Open sink (canonical SOC), Closed reflective, or Toroidal wrap." },
      { name: "MAPPING", desc: "Pitch mapping mode (X-axis, Y-axis, Radial distance, Height density, Diagonal)." },
      { name: "CANVAS BURST", desc: "Click to drop sand; Shift+Click to trigger a massive 50-grain burst cascade." }
    ]
  },
  percolation: {
    title: "Percolation Cluster Flow",
    kicker: "Critical Threshold · Phase Transition · Fractal Flow",
    paragraphs: [
      "Simulates percolation theory on a porous 2D lattice. Cells or bonds are randomly opened with probability p. When p passes the critical threshold (p_c ≈ 0.5927), an infinite spanning cluster suddenly forms across the entire lattice in a second-order phase transition.",
      "Fluid fronts propagating through the open pores trigger scale-quantized notes along the percolation frontier. Spanning cluster events fire sweeping polyphonic chords, capturing the dramatic acoustic signature of phase transitions."
    ],
    controls: [
      { name: "OCCUPANCY (p)", desc: "Probability of site opening; tune near p_c = 0.593 for critical fractal clusters." },
      { name: "GRID SIZE", desc: "Lattice resolution of the porous simulation medium." },
      { name: "SWEEP SPEED", desc: "Fluid injection and frontier traversal propagation velocity." },
      { name: "CLUSTER MODE", desc: "Frontier detection strategy (Spanning cluster, Isolated pockets, Flow boundary)." },
      { name: "CANVAS INJECTION", desc: "Click canvas to manually inject fluid reservoirs into lattice nodes." }
    ]
  },
  dla: {
    title: "Diffusion-Limited Aggregation",
    kicker: "Brownian Walkers · Dendritic Fractals · Crystal Growth",
    paragraphs: [
      "Simulates Witten-Sander Diffusion-Limited Aggregation (DLA). Random Brownian particles diffuse through a chamber until they touch an existing seed crystal, where they stick to form intricate, fractal dendritic structures with fractal dimension D ≈ 1.71.",
      "Every sticking event triggers a musical note whose pitch is quantized based on radial distance, branching hierarchy, and cluster mass, creating crystalline generative growth melodies."
    ],
    controls: [
      { name: "WALKERS", desc: "Number of concurrent Brownian particles wandering the chamber." },
      { name: "STICKINESS", desc: "Adhesion probability upon colliding with the crystal cluster." },
      { name: "SEED PRESET", desc: "Initial seed geometry (Center Point, Bottom Substrate, Circular Ring)." },
      { name: "GROWTH RATE", desc: "Simulation steps processed per frame." },
      { name: "CANVAS SEED", desc: "Click to place new nucleation seed points on the canvas." }
    ]
  },
  epidemic: {
    title: "Epidemic Network Dynamics",
    kicker: "SIR Compartmental Model · Contagion Waves · Network Graphs",
    paragraphs: [
      "Simulates epidemic disease spread over complex social networks using the SIR (Susceptible-Infected-Recovered) compartmental model. Pathogens propagate across graph edges based on infection transmission rate β and node recovery rate γ.",
      "Transmission events trigger sharp percussive note pulses, while secondary contagion wave peaks discharge polyphonic cluster chords across up to 8 voices, tracing rhythmic pulses that follow epidemiological curves."
    ],
    controls: [
      { name: "INFECTION (β)", desc: "Transmission probability across network edges per contact tick." },
      { name: "RECOVERY (γ)", desc: "Rate at which infected nodes clear infection and transition to immune/recovered." },
      { name: "TOPOLOGY", desc: "Graph structure (Small-World, Scale-Free, Random Erdos-Renyi, Ring)." },
      { name: "NODES", desc: "Total node population in the network graph (16–64 nodes)." },
      { name: "CANVAS INOCULATE", desc: "Click any node to introduce an infection outbreak or vaccination shield." }
    ]
  },
  changes: {
    title: "Campanology Method Ringing",
    kicker: "Permutation Group Theory · Plain Hunt · Church Bells",
    paragraphs: [
      "Implements traditional English church bell change ringing (campanology). A peal of tuned bells rings in ordered permutations where no bell can move more than one position per stroke, obeying strict permutation group theory.",
      "The engine executes historical methods including Plain Bob, Grandsire, and Stedman across towers of 4 to 8 bells. Conductor calls ('Bob' and 'Single') alter lead ends to create complete, non-repeating melodic cycles."
    ],
    controls: [
      { name: "STAGE (Bells)", desc: "Tower bell count: Minimus (4 bells), Minor (6 bells), or Major (8 bells)." },
      { name: "METHOD", desc: "Traditional ringing method (Plain Hunt, Plain Bob, Grandsire, Stedman)." },
      { name: "CALLS", desc: "Conductor call interventions (Bob, Single, Plain) steering lead permutations." },
      { name: "STROKE TEMPO", desc: "Ringing tempo separating handstroke and backstroke sequences." },
      { name: "BELL REORDER", desc: "Interactive rope visualizer showing current permutation positions." }
    ]
  },
  physarum: {
    title: "Physarum Slime Mold",
    kicker: "Chemotaxis · Foraging Swarm · Vein Networks",
    paragraphs: [
      "Simulates the biological foraging intelligence of Physarum polycephalum (true slime mold). Thousands of amoeboid agents deposit and follow chemical attractant trails, self-organizing into optimal nutrient transport vein networks.",
      "Sensors sampling chemoattractant gradients and vein transport fluxes trigger scale-quantized notes, mapping biological network morphogenesis directly to polyphonic sound."
    ],
    controls: [
      { name: "AGENTS", desc: "Population of slime mold foraging agents simulated." },
      { name: "SENSOR ANGLE", desc: "Directional angle of forward optical sensory receptors." },
      { name: "SENSOR DIST", desc: "Lookahead sensor distance probing chemoattractant gradients." },
      { name: "DECAY RATE", desc: "Evaporation rate of deposited chemical trail substance." },
      { name: "CANVAS FOOD", desc: "Click to place nutrient food sources attracting slime mold veins." }
    ]
  },
  reaction_diffusion: {
    title: "Reaction-Diffusion (Gray-Scott)",
    kicker: "Turing Morphogenesis · Chemical Waves · Rhythmic Strobe",
    paragraphs: [
      "Numerically integrates the 2D Gray-Scott partial differential equations (PDEs) modeling chemical reaction-diffusion and Alan Turing's biological morphogenesis. Chemical species U and V interact, diffuse at different rates, and precipitate self-organizing organic patterns (mitosis spots, coral stripes, solitons).",
      "Eight hydrophone sensor probes sample local morphogen concentrations, pulsing rhythmically on transport-synced strobe ticks. Probes autonomously drift along chemical concentration gradients ($\nabla V$), with note pitch dynamically modulated by wave angle and velocity/duration shaped by local reaction energy ($U \cdot V^2$) across up to 8 polyphonic voices."
    ],
    controls: [
      { name: "FEED (F)", desc: "Inflow supply rate of chemical reactant U into the substrate." },
      { name: "KILL (K)", desc: "Removal dissipation rate of chemical product V." },
      { name: "STROBE", desc: "Musical clock strobe rate (16n, 8n, 8t, 4n) scanning probes for reaction activity." },
      { name: "DRIFT", desc: "Toggle autonomous probe drift along morphogen gradient vectors ($\nabla V$)." },
      { name: "PRESETS", desc: "Turing pattern regimes (Coral, Mitosis, Solitons, Spirals, Holes)." },
      { name: "PROBES (1–8)", desc: "Audio sensor pickup positions sampling concentration waves." },
      { name: "CANVAS INJECT", desc: "Click and drag to inoculate morphogen droplets directly onto the substrate." }
    ]
  },
  kuramoto: {
    title: "Kuramoto Oscillator Sync",
    kicker: "Coupled Nonlinear Phases · Spontaneous Synchronization · Fireflies",
    paragraphs: [
      "Simulates the Kuramoto model of coupled nonlinear phase oscillators. Each oscillator has an intrinsic natural frequency and is pulled toward collective alignment by coupling strength K, mimicking spontaneous biological synchrony in fireflies, neural ensembles, and circadian pacemakers.",
      "As oscillators cross zero phase, they trigger musical notes. When collective synchronization occurs (order parameter r ≈ 1), the oscillators lock into unison chords, and when decoupled, they drift into complex polyrhythmic counterpoints."
    ],
    controls: [
      { name: "COUPLING (K)", desc: "Phase attraction strength pulling oscillators into collective sync." },
      { name: "SPREAD", desc: "Variance of intrinsic natural frequencies among oscillators." },
      { name: "OSCILLATORS (1–8)", desc: "Number of active coupled rotators simulated." },
      { name: "SYNC METRIC (r)", desc: "Live coherence order parameter measuring phase alignment." },
      { name: "CANVAS PHASE", desc: "Interactive phase ring showing real-time oscillator angles and clusters." }
    ]
  },
  fitzhugh_nagumo: {
    title: "FitzHugh-Nagumo Neural Action",
    kicker: "Biological Neuron Spikes · Refractory Dynamics · Action Potentials",
    paragraphs: [
      "Simulates the FitzHugh-Nagumo model of biological neural excitability. A fast membrane voltage variable couples with a slow recovery gate variable, producing realistic action potential spikes and refractory quiet periods.",
      "When external stimulus current crosses the excitation threshold, the virtual neuron fires regenerative action potential spikes, driving percussive polyphonic triggers that reproduce neural burst rhythms."
    ],
    controls: [
      { name: "CURRENT (I_ext)", desc: "External stimulus current driving membrane excitation." },
      { name: "RECOVERY (τ)", desc: "Time constant of the recovery gate variable governing refractory duration." },
      { name: "THRESHOLD", desc: "Spike trigger potential voltage initiating action potentials." },
      { name: "COUPLING", desc: "Electrotonic gap-junction diffusion between adjacent neurons." },
      { name: "CANVAS STIMULUS", desc: "Click neuron nodes to inject immediate depolarizing current pulses." }
    ]
  },
  ripple_tank: {
    title: "Acoustic Wave Ripple Tank",
    kicker: "2D Wave Equation FDTD · Interference Fringes · Slit Diffraction",
    paragraphs: [
      "Simulates physical 2D wave propagation using Finite-Difference Time-Domain (FDTD) numerical integration of the wave equation. Droplets excite acoustic wave ripples that reflect off boundaries, diffract through apertures, and interfere constructively and destructively.",
      "Eight hydrophone pickups positioned across the tank detect acoustic wave crests, converting pressure ripples into scale-quantized note events across up to 8 voices."
    ],
    controls: [
      { name: "DAMPING", desc: "Fluid viscosity dissipation factor determining wave decay time." },
      { name: "WAVE SPEED (c)", desc: "Acoustic wave propagation velocity across the medium." },
      { name: "PRESETS", desc: "Wave geometries (Free Tank, Young's Double Slit, Elliptical Cavity, Parabolic)." },
      { name: "PICKUPS (1–8)", desc: "Hydrophone sensor locations detecting passing wave peaks." },
      { name: "CANVAS DROP", desc: "Click and drag to drop water droplets and inject wave perturbations." }
    ]
  },
  convection: {
    title: "Rayleigh-Bénard Convection",
    kicker: "Thermal Buoyancy · Fluid Rolls · Plume Updrafts",
    paragraphs: [
      "Simulates Rayleigh-Bénard thermal fluid convection. Fluid heated from below becomes buoyant and ascends, while cooler fluid near the top descends, organizing into counter-rotating convection rolls and turbulent buoyant plumes.",
      "Thermal sensor probes placed throughout the convection chamber detect temperature lapses and vertical updrafts, mapping buoyancy momentum into scale-quantized polyphony."
    ],
    controls: [
      { name: "RAYLEIGH (Ra)", desc: "Buoyancy strength versus viscous drag setting convection turbulence." },
      { name: "PRANDTL (Pr)", desc: "Ratio of momentum diffusivity to thermal diffusivity." },
      { name: "HEATING PROFILE", desc: "Bottom thermal boundary condition (Uniform, Center Plume, Dual Wells)." },
      { name: "SAMPLERS (1–8)", desc: "Temperature and vertical velocity sensor locations." },
      { name: "CANVAS HEAT", desc: "Click and drag on the chamber to inject localized thermal heat pulses." }
    ]
  },
  markov_matrix: {
    title: "Markov Melodic Memory",
    kicker: "Transition Matrix · Boltzmann Entropy · High-Order N-Grams",
    paragraphs: [
      "Implements a conditional state transition probability matrix between scale degrees, featuring Boltzmann temperature scaling and high-order N-gram memory history.",
      "Multiple concurrent polyphonic walkers explore melodic cadences, cyclic ostinatos, and aleatoric clouds, while matrix transition entropy dynamically steers melodic phrasing."
    ],
    controls: [
      { name: "TEMPERATURE", desc: "Boltzmann temperature scaling transition odds (low = predictable, high = random)." },
      { name: "N-GRAM ORDER", desc: "Melodic memory depth (unigram, bigram, or trigram history)." },
      { name: "WALKERS (1–8)", desc: "Number of concurrent polyphonic melodic walkers navigating the matrix." },
      { name: "MATRIX CANVAS", desc: "Interactive heatmap grid; click and drag cells to adjust transition probabilities." }
    ]
  },
  genetic_breeder: {
    title: "Melodic Genome Breeder",
    kicker: "Interactive Genetic Algorithm · Crossover · Allele Mutation",
    paragraphs: [
      "An evolutionary melodic population breeder. Maintains 8 active musical chromosomes subjected to roulette wheel selection, single-point crossover, and allele mutation.",
      "Upvote or downvote individual genomes to steer melodic survival and reproductive fitness, allowing musical ideas to evolve through artificial selection across successive generations."
    ],
    controls: [
      { name: "POPULATION (8)", desc: "Current pool of melodic genome chromosomes." },
      { name: "CROSSOVER RATE", desc: "Probability of gene exchange between selected parent chromosomes." },
      { name: "MUTATION RATE", desc: "Allele mutation probability altering pitch, gate, and timing alleles." },
      { name: "FITNESS VOTING", desc: "Thumb up / down buttons to rate genomes and steer evolutionary fitness." },
      { name: "BREED GENERATION", desc: "Triggers reproduction and selection cycle to yield a new generation." }
    ]
  },
  chladni: {
    title: "Chladni Cymatics Plate",
    kicker: "Standing Wave Acoustics · Nodal Sand Patterns · Harmonic Probes",
    paragraphs: [
      "Simulates Ernst Chladni's vibrating acoustic plate. Sand grains on a vibrating surface are repelled from antinodal peaks and collect along zero-amplitude nodal lines, creating geometric standing wave patterns.",
      "Eight hydrophone pickup probes placed across the plate sample standing wave amplitudes and chime harmonics, mapping cymatic resonance patterns to scale pitches."
    ],
    controls: [
      { name: "MODE M & N", desc: "Orthogonal modal frequencies setting the nodal standing wave geometry." },
      { name: "PLATE BOUNDARY", desc: "Plate boundary conditions (Free Edge, Clamped Center, Circular)." },
      { name: "SAND PARTICLES", desc: "Particle density migrating toward nodal lines." },
      { name: "PICKUPS (1–8)", desc: "Harmonic chime pickup sensor positions on the plate." },
      { name: "CANVAS AGITATE", desc: "Click and drag to displace sand and excite new modal vibrations." }
    ]
  },
  brownian_ratchet: {
    title: "Brownian Thermal Ratchet",
    kicker: "Langevin Thermodynamics · Feynman Diode · Stochastic Work",
    paragraphs: [
      "Simulates Richard Feynman's microscopic thermal ratchet and pawl engine. A paddle wheel in a fluctuating heat bath (T1) drives an asymmetric toothed cogwheel, restricted to forward rotation by a spring-loaded pawl in bath T2 against counter-torque load.",
      "Forward and reverse ratcheting clicks trigger polyphonic pawl chimes, capturing the mechanical acoustics of thermal rectification and the Second Law of Thermodynamics."
    ],
    controls: [
      { name: "TEMP 1 (Hot)", desc: "Fluctuating thermal energy in the drive reservoir exciting the paddle wheel." },
      { name: "TEMP 2 (Cold)", desc: "Temperature of the pawl reservoir governing locking stability." },
      { name: "TORQUE LOAD", desc: "Counter-torque opposing forward mechanical work." },
      { name: "TEETH COUNT", desc: "Number of asymmetric teeth on the cogwheel." },
      { name: "PAWL CHIME", desc: "Scale note triggered upon each successful ratcheting step." }
    ]
  },
  tracy_ribbon: {
    title: "Electroplankton Tracy Ribbon",
    kicker: "Spline Vector Trajectory · Organic Kinematics · Curvature Dynamics",
    paragraphs: [
      "Inspired by Toshio Iwai's Tracy plankton creature from Nintendo Electroplankton. Users trace closed ribbon circuits across an interactive 8x6 node matrix, which autonomous creatures traverse with continuous momentum.",
      "Curvature and speed modulate dynamics and articulation, while each creature maintains an independent base pitch from the active scale, generating multi-voice polyphonic ribbons."
    ],
    controls: [
      { name: "CREATURES (1–8)", desc: "Number of active Tracy creatures navigating looping ribbon circuits." },
      { name: "NODE MATRIX", desc: "Interactive 8x6 grid of 48 musical pitch nodes." },
      { name: "SPEED MULT", desc: "Individual speed multiplier for each creature ($0.25\\times \\dots 3.0\\times$)." },
      { name: "DRAW RIBBON", desc: "Click and drag across nodes on the canvas to trace closed looping routes." },
      { name: "BASE PITCH", desc: "Independent root scale degree assigned to each creature." }
    ]
  },
  self_avoiding_walk: {
    title: "Polymer Self-Avoiding Walk",
    kicker: "Lattice Self-Avoidance · Steric Jamming · Folding Cascades",
    paragraphs: [
      "Simulates synthetic polymer chain growth and protein folding on a 2D discrete lattice. Monomers advance to unoccupied adjacent lattice nodes subject to strict self-avoidance, ensuring the chain never intersects itself.",
      "When encountering steric hindrance dead-ends (jamming traps), the trapped polymer collapses and anneals, discharging an explosive polyphonic chord cascade across up to 8 voices before starting a new growth cycle."
    ],
    controls: [
      { name: "TARGET LENGTH", desc: "Maximum chain monomer count before conformational collapse." },
      { name: "LATTICE SIZE", desc: "Spatial boundaries of the discrete square lattice." },
      { name: "GROWTH RATE", desc: "Speed of polymer monomer advance in steps per second." },
      { name: "COLLAPSE VOICES", desc: "Number of voices triggered during steric jamming cascades (1–8)." },
      { name: "CANVAS OBSTACLES", desc: "Click to place static steric obstacles deflecting polymer growth." }
    ]
  },
  billiards: {
    title: "Ballistic Billiards",
    kicker: "Hamiltonian Ray Optics · Specular Reflection · Ergodic Caustics",
    paragraphs: [
      "Simulates classical Hamiltonian dynamical billiards where particles move at uniform speed within bounded planar tables (Bunimovich Stadium, Sinai Dispersing Billiard, Confocal Ellipse, Cardioid, and Triangular Wedge) undergoing specular elastic reflections.",
      "Boundary impacts trigger scale-quantized notes respecting the M-VAVE FM-1 8-voice hardware polyphony limit. Normal impact impulses modulate note velocity, while free flight segment distances determine note gate duration and octave register. Drag directly on the canvas to slingshot billiard balls at custom angles and velocities."
    ],
    controls: [
      { name: "TABLE PRESET", desc: "Selects table geometry (Stadium, Sinai Scatterer, Ellipse, Cardioid, Wedge)." },
      { name: "BALLS", desc: "Number of concurrent billiard balls (1 to 8 hardware polyphony ceiling)." },
      { name: "SPEED", desc: "Simulation ray traversal velocity multiplier." },
      { name: "SPIN", desc: "Magnetic Lorentz force curvature turning straight rays into cyclotron Larmor arcs." },
      { name: "DAMP", desc: "Restitution energy dissipation upon wall collisions." },
      { name: "BALL COLL", desc: "Toggle hard-sphere elastic collisions between balls in mid-flight." },
      { name: "CANVAS SLING", desc: "Click and drag on the table canvas to slingshot a ball with aim vector." }
    ]
  }
,
  nodal_graph: {
    title: "Nodal Directed Graph",
    kicker: "Topological Automata · Weighted Branching · Aleatoric Pathways",
    paragraphs: [
      "Simulates a probabilistic directed state graph where multiple autonomous walker tokens traverse topological network structures including Chordal Cycles, Binary Branching Trees, Barabási–Albert Scale-Free Hubs, De Bruijn Shift Registers, and Directed Acyclic Graphs.",
      "When walker tokens arrive at nodes, they trigger scale-quantized notes routed through the M-VAVE FM-1 8-voice hardware polyphony manager. In-degree node connectivity modulates note velocity, while edge traversal durations determine note gate lengths. Click and drag nodes directly on the canvas to sculpt custom topological geometry in real time."
    ],
    controls: [
      { name: "TOPO PRESET", desc: "Selects graph architecture (Chordal Cycles, Branching Tree, Hub Network, De Bruijn Shift, Forward DAG)." },
      { name: "WALKERS", desc: "Number of concurrent walker tokens traversing the graph (1 to 8 hardware polyphony limit)." },
      { name: "SPEED", desc: "Traversal velocity multiplier governing how swiftly tokens travel along directed edges." },
      { name: "ENTROPY", desc: "Branching temperature; higher values favor probabilistic exploration of secondary leap edges." },
      { name: "DENSITY", desc: "Temporal pacing and edge traversal duration scaling." },
      { name: "OCTAVE", desc: "Global octave transposition offset (-2 to +2 octaves)." },
      { name: "CANVAS DRAG", desc: "Directly click and drag network nodes to rearrange visual topology and spatial intervals." }
    ]
  }
};
