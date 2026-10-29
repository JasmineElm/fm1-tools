// state.js — Central state, parameter definitions, and shared references.
import { generateBank, classicName } from "./generator.js";

export const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
export const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
export const SLOTS = 1;
export const PRESET_N = 5;
export const STATE_VERSION = 1;

export const DEFAULT = {
  randVel: false,
  randVelAmt: 0,
  seed: (Math.random() * 1e9) | 0,
  length: 64, rate: 6, tempo: 120, modelSpeed: 1.0, swing: 50, gate: 50,
  gateProb: 70, velocity: 100, velMin: 1, velMax: 127, humanize: 0, gateQuant: 0, snapGrid: 4,
  gateBlend: 0, euclidRot: 0, euclidDiv: "16", euclidHits: 4, euclidMode: "hits",
  scale: "pentMinor",
  customScale: [0, 3, 5, 7, 10],
  root: 60,
  rootNote: 0,
  rootOctave: 4,
  pitchSpan: 3,
  polyphony: 4,
  polyStrategy: "extrema",
  safeMode: false,
  lfoWave: "sine", lfoShape: 0, lfoAmp: 50, lfoOffset: 0, lfoRate: 4, octave: 0, octaveMode: "up", gravity: 0, unipolar: false,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0, loop: 8, loopFrom: 1,

  // Cellular Automata model parameters
  caRule: 30,
  caGenesis: "center",
  caBoundary: "wrap",
  caMapping: "matrix",
  caNoteRule: "closest",
  caScale: "pentMinor",
  caCustomScale: [0, 3, 5, 7, 10],
  caRoot: 48,
  caRootNote: 0,
  caRootOctave: 3,
  caOctaves: 3,
  caQuantSteps: 100,
  caOctave: 0,
  caOctaveMode: "up",
  caMinVel: 30,
  caMaxVel: 120,
  caDensity: 85,
  caInitDensity: 35,
  caVelocity: 100,

  // Turing Machine model parameters
  turingLength: 16,
  turingProb: 0,
  turingSpan: 2,
  turingDacBits: 8,
  turingScale: "pentMinor",
  turingCustomScale: [0, 3, 5, 7, 10],
  turingRoot: 48,
  turingRootNote: 0,
  turingRootOctave: 3,
  turingQuantSteps: 100,
  turingOctave: 0,
  turingOctaveMode: "up",
  turingSlip: 0,

  // Particle Simulator model parameters
  particleGridSize: 16,
  particleCollisionMode: "deflect",
  particleChildLife: 16,
  particleMaxCount: 20,
  particleBoundary: "reflect",
  particleWallNotes: false,
  particleNoteRule: "x-pitch-y-oct",
  particleOctaves: 3,
  particlePolyphony: 2,
  particleScale: "pentMinor",
  particleCustomScale: [0, 3, 5, 7, 10],
  particleRoot: 48,
  particleRootNote: 0,
  particleRootOctave: 3,
  particleLoopMode: "loop",

  // Double Pendulum model parameters
  pendulumL1: 100,
  pendulumL2: 90,
  pendulumM1: 10,
  pendulumM2: 10,
  pendulumGravity: 9.8,
  pendulumDamping: 0.001,
  pendulumDrive: 0.0,
  pendulumInitTheta1: 120,
  pendulumInitTheta2: 110,
  pendulumMapping: "height",
  pendulumTrigger: "sector",
  pendulumEnergyThresh: 25,
  pendulumSectors: Array(36).fill(1),
  pendulumSectorNotes: null,
  pendulumSectorPermutation: null,
  pendulumTriggerBob: "both",
  pendulumLoopMode: "loop",
  pendulumScale: "pentMinor",
  pendulumCustomScale: [0, 3, 5, 7, 10],
  pendulumRoot: 48,
  pendulumRootNote: 0,
  pendulumRootOctave: 3,
  pendulumOctaves: 3,
  pendulumVelocity: 100,
  pendulumQuantSteps: 100,
  pendulumOctave: 0,
  pendulumOctaveMode: "up",

  // Flocking model parameters (Autonomous Swarm, Unlinked to Step Sequencer)
  flockBoidCount: 16,
  flockSpeed: 5.2,
  flockSeparation: 1.6,
  flockAlignment: 0.05,
  flockCohesion: 0.008,
  flockScale: "minor_dorian",
  flockCustomScale: [0, 3, 5, 7, 10],
  flockRoot: 48,
  flockMaxVoices: 6,
  flockBlast: 8.5,
  flockTriggerRadius: 48,
  flockResetRadius: 88,
  flockVelocity: 100,
  flockRunning: false,
  flockChordMode: "cycle",

  // Rob Hordijk Rungler model parameters
  runglerMode: "sync", // "sync" | "free"
  runglerFreq1: 2.0,   // Base rate of Osc 1 (multiplier in sync mode, Hz in free mode)
  runglerFreq2: 3.14,  // Frequency of Osc 2 (Hz)
  runglerToOsc1: 35,   // Rungler DAC -> Osc 1 depth (-100 to 100)
  runglerToOsc2: 55,   // Rungler DAC -> Osc 2 depth (-100 to 100)
  runglerFeedback: 45, // Comparator feedback (0 to 100)
  runglerTaps: [12, 13, 14, 15], // 4 tap bit indices
  runglerScale: "pentMinor",
  runglerCustomScale: [0, 3, 5, 7, 10],
  runglerRoot: 48,
  runglerRootNote: 0,
  runglerRootOctave: 3,
  runglerCcDest: 74,   // MIDI CC destination (74 = Brightness / Cutoff)
  runglerCcDepth: 80,  // CC modulation depth (0 to 127)
  runglerGateLen: 180, // Gate duration in ms

  // Buchla 266 Krell Generative Patch parameters
  krellVoices: 2,      // Active voice count (1 to 4)
  krellRise: 0.8,      // Base rise time in seconds (0.1 to 6.0)
  krellFall: 2.2,      // Base fall time in seconds (0.2 to 10.0)
  krellCrossMod: 45,   // Pitch-to-time cross-modulation depth (-100 to 100%)
  krellCurve: "exp",   // Envelope curvature: "exp" | "lin" | "log"
  krellDwell: 0.15,    // Rest/pause time between cycles in seconds (0 to 3.0)
  krellSpan: 3,        // Octave span across active scale (1 to 4)
  krellScale: "pentMinor",
  krellCustomScale: [0, 3, 5, 7, 10],
  krellRoot: 48,
  krellRootNote: 0,
  krellRootOctave: 3,
  krellCcDest: 74,     // FM-1 CC #74 Brightness
  krellCcDepth: 95,    // Continuous filter modulation depth (0 to 127)

  // L-System Morphogenetic Grammar parameters
  lsystemAxiom: "F",
  lsystemRuleF: "F[+F]F[-F][F]",
  lsystemRuleX: "X",
  lsystemRuleY: "Y",
  lsystemDepth: 3,
  lsystemDegreeStep: 1,
  lsystemBranchDecay: 85, // % velocity retention per bracket depth level
  lsystemOctaveStep: 1,
  lsystemAngle: 25,       // degrees for visual turtle branch angle
  lsystemPreset: "canopy",
  lsystemMode: "sync",     // "sync" | "free"
  lsystemSpan: 3,
  lsystemCcDest: 74,
  lsystemCcDepth: 80,
  lsystemGateLen: 180,

  // Lotka-Volterra Predator-Prey Ecological Phase Space parameters
  lvInitX: 0.75,
  lvInitY: 0.2,
  lvInitZ: 8.5,
  lvA: 5.0,
  lvB1: 3.0,
  lvB2: 2.0,
  lvC: 0.1,
  lvD1: 0.4,
  lvD2: 0.01,
  lvSpeed: 1.0,
  lvThresholdX: 0.54,
  lvThresholdY: 0.20,
  lvThresholdZ: 8.8,
  lvPreset: "limcycle",
  lvMode: "sync",
  lvSpan: 3,
  lvCcDest: 74,
  lvCcDepth: 85,
  lvGateLen: 180,

  // Keplerian Orbital Resonance model parameters
  orbitalBodies: 5,
  orbitalSpeed: 1.0,
  orbitalEccentricity: 0.25,
  orbitalGravity: 1.0,
  orbitalConjunction: true,
  orbitalConjThresh: 0.08,
  orbitalTriggerMode: "both",
  orbitalPitchMap: "orbit-rank",
  orbitalPreset: "laplace",
  orbitalMode: "sync",
  orbitalSpan: 3,
  orbitalScale: "pentMinor",
  orbitalCustomScale: [0, 3, 5, 7, 10],
  orbitalRoot: 48,
  orbitalRootNote: 0,
  orbitalRootOctave: 3,
  orbitalCcDest: 74,
  orbitalCcDepth: 80,
  orbitalGateLen: 220,

  // Electroplankton Hanenbow Ballistics model parameters
  hanenbowLeaves: 5,
  hanenbowGravity: 980,
  hanenbowElasticity: 0.85,
  hanenbowFireRate: 1.5,
  hanenbowLaunchSpeed: 650,
  hanenbowLaunchAngle: -60,
  hanenbowPreset: "cascade",
  hanenbowMode: "sync",
  hanenbowSpan: 3,
  hanenbowScale: "pentMinor",
  hanenbowCustomScale: [0, 3, 5, 7, 10],
  hanenbowRoot: 48,
  hanenbowRootNote: 0,
  hanenbowRootOctave: 3,
  hanenbowCcDest: 74,
  hanenbowCcDepth: 85,
  hanenbowGateLen: 240,
  hanenbowTimingPeriod: 1.5,

  // Bak-Tang-Wiesenfeld Abelian Sandpile (SOC) model parameters
  sandpileGridSize: 33,
  sandpileDropRate: 10,
  sandpileDropAmount: 1,
  sandpileDropPattern: "center",
  sandpileBoundary: "open",
  sandpilePitchMapping: "x-axis",
  sandpileCellRule: "extrema",
  sandpilePolyphony: 3,
  sandpileOctaveSpread: 2,
  sandpilePreset: "empty",
  sandpileMode: "sync",
  sandpileSpan: 2,
  sandpileScale: "pentMinor",
  sandpileCustomScale: [0, 3, 5, 7, 10],
  sandpileRoot: 48,
  sandpileRootNote: 0,
  sandpileRootOctave: 3,
  sandpileCcDest: 74,
  sandpileCcDepth: 80,
  sandpileGateLen: 180,
  sandpileVelocity: 90,
};

export const state = { ...DEFAULT };
export const refs = {};           // state key -> control element (has setValue)
export const locks = new Map();   // "slot:step" -> [{ note, vel }]

let selectedSlot = 0;
export function getSelected() { return selectedSlot; }
export function setSelected(s) { selectedSlot = Math.max(0, Math.min(SLOTS - 1, s)); }

let bank = [];
export function getBank() { return bank; }
export function setBank(b) { bank = b; }

let prevGateBlend = state.gateBlend > 0 ? state.gateBlend : 100;
export function getPrevGateBlend() { return prevGateBlend; }
export function setPrevGateBlend(v) { prevGateBlend = v; }

export function status(msg, cls = "") {
  const el = document.getElementById("status");
  if (el) { el.textContent = msg; el.className = "status " + cls; }
}

export function refreshLoopInfo() {
  const el = document.getElementById("loopinfo");
  if (!el) return;
  const L = Math.max(3, Math.round(state.length || 64));
  const a = Math.round(refs.loopFrom?.value ?? state.loopFrom ?? 1);
  const n = Math.round(refs.loop?.value ?? state.loop ?? 8);
  const reps = (L - a + 1) / n;
  const loopTxt = n >= 2 && a + n - 1 <= L ? `loop ${a}–${a + n - 1} ×${reps.toFixed(1)}` : "loop off";
  if (state.gateBlend > 0) {
    const blend = Math.min(100, Math.max(0, state.gateBlend ?? 0)) / 100;
    const mode = state.euclidMode || "hits";
    const rot = ((state.euclidRot ?? 0) % L + L) % L;
    let info = "";
    if (mode === "hits") {
      const hitsVal = Math.max(1, Math.round(Number(state.euclidHits) || 4));
      info = `every ${hitsVal}st`;
    } else {
      const divVal = Math.max(1, Math.round(Number(state.euclidDiv) || 16));
      info = `div ${divVal}`;
    }
    el.textContent = `${loopTxt} · ${info}${rot ? " rot " + rot : ""}${blend < 1 ? " @" + Math.round(blend * 100) + "%" : ""}`;
  } else el.textContent = loopTxt;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Register a control under its state key; set(..., false) keeps it silent on sync
export function R(key, el) { refs[key] = el; return el; }

export const setState = (key, fn) => (v) => {
  state[key] = fn ? fn(v) : v;
  scheduleRegen();
};

// Regeneration hooks
let onRegenCallbacks = [];
export function onRegen(fn) { onRegenCallbacks.push(fn); }

let onTempoProbeCallbacks = [];
export function onTempoProbe(fn) { onTempoProbeCallbacks.push(fn); }

export function triggerRegenHooks() {
  for (const fn of onRegenCallbacks) fn();
}

let currentModelGenerator = null;
export function setModelGenerator(fn) {
  currentModelGenerator = typeof fn === "function" ? fn : null;
}

let currentModelRandomizer = null;
export function setModelRandomizer(fn) {
  currentModelRandomizer = typeof fn === "function" ? fn : null;
}

export function getCurrentModelRandomizer() {
  return currentModelRandomizer;
}

export function doGenerate(newSeed = true) {
  if (newSeed) state.seed = (Math.random() * 1e9) | 0;
  refs.seed?.setValue(state.seed, false);
  if (typeof currentModelGenerator === "function") {
    bank = currentModelGenerator(state);
  } else {
    bank = generateBank(state);
  }
  triggerRegenHooks();
  status(`pattern · seed ${state.seed >>> 0}`);
}

let regenTimer = null;
export function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    if (typeof currentModelGenerator === "function") {
      bank = currentModelGenerator(state);
    } else {
      bank = generateBank(state);
    }
    triggerRegenHooks();
  }, 40);
  for (const fn of onTempoProbeCallbacks) fn();
}
