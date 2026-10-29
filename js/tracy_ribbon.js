// tracy_ribbon.js — Electroplankton "Tracy" Multi-Creature Node Grid Sequencer for FM-1 Pulses.
// Inspired by Toshio Iwai's Tracy plankton creature from Nintendo Electroplankton.
// Features a 2D node grid that the user traces with direct-manipulation gestures.
// Supports up to 8 simultaneous creatures on the grid, each with distinct path,
// base pitch scale degree, definable speed multiplier, and rendered as distinct coloured circles.
// Strictly adheres to the M-VAVE FM-1 8-voice hardware polyphony limit and flat workbench styling.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview, dispatchTimbreCc } from "./player.js";
import {
  SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS,
  mapNormalizedToNote, getRootMidi, getActiveScaleIntervals,
  computeOctaveShift, quantize
} from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { selectPolyVoices, playVoice, releasePolyVoices, getActiveVoiceCount } from "./poly.js";
import * as audio from "./audio.js";

// ---- Grid & Polyphony Constants ----
export const MAX_VOICES = 8;          // Strict FM-1 8 hardware voices limit
export const MAX_CREATURES = 8;       // Maximum simultaneous creatures on grid
export const GRID_COLS = 8;           // 8 scale degrees per row
export const GRID_ROWS = 6;           // 6 octave/register tiers
export const TOTAL_NODES = GRID_COLS * GRID_ROWS; // 48 nodes

// 8 Distinct Curated Creature Colors (conforming to style.md multi-head palette)
export const CREATURE_COLORS = [
  "#00f0ff", // C1: Cyan
  "#ff007f", // C2: Pink
  "#ffb700", // C3: Amber
  "#39ff14", // C4: Lime
  "#a855f7", // C5: Violet
  "#38bdf8", // C6: Sky
  "#f43f5e", // C7: Rose
  "#eab308"  // C8: Gold
];

// Helper: Convert node index to { col, row }
export function getNodeColRow(index) {
  const safeIdx = Math.max(0, Math.min(TOTAL_NODES - 1, Math.round(index)));
  return {
    col: safeIdx % GRID_COLS,
    row: Math.floor(safeIdx / GRID_COLS)
  };
}

// Helper: Convert { col, row } to node index
export function getNodeIndex(col, row) {
  const c = Math.max(0, Math.min(GRID_COLS - 1, Math.round(col)));
  const r = Math.max(0, Math.min(GRID_ROWS - 1, Math.round(row)));
  return r * GRID_COLS + c;
}

// Helper: Calculate scale pitch for node (col, row)
// Strictly determined by the global notes div: sits within both active scale and octave spread.
export function getTracyNodePitch(col, row, basePitchOffset = 0, masterOctave = 0) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const N = Math.max(1, intervals.length);
  const span = Math.min(4, Math.max(1, Number(state.pitchSpan ?? 2)));
  const totalDegrees = span * N;

  const c = Math.max(0, Math.min(GRID_COLS - 1, Math.round(col)));
  const r = Math.max(0, Math.min(GRID_ROWS - 1, Math.round(row)));

  // Account for octaveMode direction ("up", "down", "both") from global notes div
  let effectiveRoot = root;
  const dir = (state.octaveMode || "up").toLowerCase();
  if (dir === "down") {
    effectiveRoot = root - span * 12;
  } else if (dir === "both") {
    effectiveRoot = root - Math.floor(span / 2) * 12;
  }

  // 2D Normalized position across grid:
  // bottom-left (c=0, r=0) -> 0.0 (lowest), top-right (c=7, r=5) -> 1.0 (highest)
  const norm = (r / (GRID_ROWS - 1)) * 0.6 + (c / (GRID_COLS - 1)) * 0.4;
  const baseDeg = Math.round(norm * totalDegrees);

  // Apply creature's base pitch offset (choosing from the scale defined in the notes div)
  const deg = baseDeg + Number(basePitchOffset || 0);

  // Map degree to octave and scale interval
  const octFromDeg = Math.floor(deg / N);
  const scaleDeg = ((deg % N) + N) % N;
  const totalOctave = octFromDeg + Number(masterOctave || 0);

  const rawMidi = effectiveRoot + totalOctave * 12 + (intervals[scaleDeg] || 0);
  const quantStrength = (state.quantSteps ?? 100) / 100;
  return Math.max(12, Math.min(127, quantize(rawMidi, intervals, effectiveRoot, quantStrength)));
}

// Compatibility wrapper for coordinates
export function getTracyNote(x, y, octave = 0) {
  const col = Math.max(0, Math.min(GRID_COLS - 1, Math.round(((x + 0.9) / 1.8) * (GRID_COLS - 1))));
  const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.round(((y + 0.9) / 1.8) * (GRID_ROWS - 1))));
  return getTracyNodePitch(col, row, 0, octave);
}

// ---- Creature Data Structure ----
export class TracyCreature {
  constructor(id) {
    this.id = id;
    this.color = CREATURE_COLORS[id % CREATURE_COLORS.length];
    this.nodes = [];                     // Array of node indices in sequence
    this.speed = 1.0;                    // Definable speed multiplier
    this.basePitchOffset = (id * 2) % 7; // Harmonic offset in active scale
    this.active = id < 4;                // Active status (1-8)
    // Traversal state
    this.segIndex = 0;                   // Index of current segment start node
    this.segT = 0.0;                     // Traversal interpolation in [0, 1)
    this.x = 0;                          // Current interpolated col
    this.y = 0;                          // Current interpolated row
    this.lastTriggeredNode = -1;         // Prevents double triggers
    this.currentNote = null;
    this.pulseAnim = 0.0;
  }
}

// Pre-allocated creature pool
export const creatures = [];
for (let i = 0; i < MAX_CREATURES; i++) {
  creatures.push(new TracyCreature(i));
}

export let selectedCreatureIndex = 0;

// ---- Presets with Multi-Creature Routes ----
export const TRACY_PRESETS = [
  {
    id: "counterpoint",
    name: "Interlocking Counterpoint",
    desc: "4-part polyphonic counterpoint: bass foundation, ostinato arpeggio, and fluttering soprano",
    creatures: [
      { nodes: [0, 1, 2, 3, 11, 10, 9, 8], speed: 0.75, basePitchOffset: 0 },
      { nodes: [12, 21, 22, 13], speed: 1.0, basePitchOffset: 2 },
      { nodes: [25, 27, 36, 34], speed: 1.25, basePitchOffset: 4 },
      { nodes: [35, 44, 45, 46, 37], speed: 1.5, basePitchOffset: 7 },
      { nodes: [16, 25, 33, 24], speed: 0.8, basePitchOffset: 1 },
      { nodes: [28, 29, 38, 37], speed: 1.1, basePitchOffset: 3 },
      { nodes: [40, 41, 42, 34], speed: 1.3, basePitchOffset: 5 },
      { nodes: [4, 5, 14, 13], speed: 0.9, basePitchOffset: 6 }
    ]
  },
  {
    id: "parallel_waves",
    name: "Parallel Wave Canons",
    desc: "Undulating sinusoidal wave corridors sweeping across columns and registers at staggered speeds",
    creatures: [
      { nodes: [1, 10, 19, 12, 13, 22, 15, 6], speed: 0.8, basePitchOffset: 0 },
      { nodes: [9, 18, 27, 20, 21, 30, 23, 14], speed: 1.0, basePitchOffset: 2 },
      { nodes: [17, 26, 35, 28, 29, 38, 31, 22], speed: 1.25, basePitchOffset: 4 },
      { nodes: [25, 34, 43, 36, 37, 46, 39, 30], speed: 1.5, basePitchOffset: 7 },
      { nodes: [2, 11, 20, 13, 14, 23, 16, 7], speed: 0.7, basePitchOffset: 1 },
      { nodes: [10, 19, 28, 21, 22, 31, 24, 15], speed: 0.9, basePitchOffset: 3 },
      { nodes: [18, 27, 36, 29, 30, 39, 32, 23], speed: 1.1, basePitchOffset: 5 },
      { nodes: [26, 35, 44, 37, 38, 47, 40, 31], speed: 1.4, basePitchOffset: 6 }
    ]
  },
  {
    id: "harmonic_quad",
    name: "Harmonic Diamonds",
    desc: "Geometric diamond and box loops producing tight 4-voice triad chords and phase shifts",
    creatures: [
      { nodes: [10, 18, 19, 11], speed: 1.0, basePitchOffset: 0 },
      { nodes: [12, 20, 21, 13], speed: 1.0, basePitchOffset: 2 },
      { nodes: [26, 34, 35, 27], speed: 1.0, basePitchOffset: 4 },
      { nodes: [28, 36, 37, 29], speed: 1.0, basePitchOffset: 7 },
      { nodes: [2, 11, 18, 9], speed: 1.25, basePitchOffset: 1 },
      { nodes: [4, 13, 20, 11], speed: 1.25, basePitchOffset: 3 },
      { nodes: [18, 27, 34, 25], speed: 0.75, basePitchOffset: 5 },
      { nodes: [20, 29, 36, 27], speed: 0.75, basePitchOffset: 6 }
    ]
  },
  {
    id: "orbital_cross",
    name: "Crossways Convergence",
    desc: "Intersecting figure-eights and diagonals where creatures meet at center nodes and deflect",
    creatures: [
      { nodes: [9, 18, 27, 28, 21, 12, 11, 10], speed: 1.0, basePitchOffset: 0 },
      { nodes: [14, 21, 26, 25, 18, 13, 12, 13], speed: 1.2, basePitchOffset: 3 },
      { nodes: [1, 10, 19, 28, 37, 36, 27, 18], speed: 0.85, basePitchOffset: 5 },
      { nodes: [6, 13, 20, 27, 34, 35, 28, 21], speed: 1.15, basePitchOffset: 7 },
      { nodes: [17, 26, 35, 34, 25, 16], speed: 0.95, basePitchOffset: 2 },
      { nodes: [22, 29, 38, 37, 30, 21], speed: 1.05, basePitchOffset: 4 },
      { nodes: [8, 17, 26, 35, 42, 33, 24, 15], speed: 1.3, basePitchOffset: 1 },
      { nodes: [15, 22, 31, 38, 45, 36, 27, 18], speed: 0.7, basePitchOffset: 6 }
    ]
  },
  {
    id: "cascade_canon",
    name: "Phasing Canon Cascade",
    desc: "Steve Reich-style phase canon: creatures share the same loop at fractional speeds",
    creatures: [
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 1.0, basePitchOffset: 0 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 1.2, basePitchOffset: 2 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 0.8, basePitchOffset: 4 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 1.4, basePitchOffset: 7 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 0.6, basePitchOffset: 1 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 1.1, basePitchOffset: 3 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 1.3, basePitchOffset: 5 },
      { nodes: [10, 19, 28, 29, 22, 13, 12, 11], speed: 0.9, basePitchOffset: 6 }
    ]
  }
];

// ---- Backward-Compatibility Spline / Vector Symbols for Tests ----
export const MAX_CTRL_POINTS = 64;
export const SPLINE_SAMPLES = 256;
export const MAX_TAIL_NODES = 8;
export const ctrlX = new Float32Array(MAX_CTRL_POINTS);
export const ctrlY = new Float32Array(MAX_CTRL_POINTS);
export let numCtrlPoints = 8;
export const lutX = new Float32Array(SPLINE_SAMPLES);
export const lutY = new Float32Array(SPLINE_SAMPLES);
export const lutCurv = new Float32Array(SPLINE_SAMPLES);
export const lutDist = new Float32Array(SPLINE_SAMPLES);
export let totalArcLength = 4.0;
export let creatureS = 0.0;
export let creatureSpeed = 0.4;
export let creatureHeading = 0.0;
export const tailX = new Float32Array(MAX_TAIL_NODES);
export const tailY = new Float32Array(MAX_TAIL_NODES);
export const dropletVoices = [];
for (let i = 0; i < MAX_VOICES; i++) {
  dropletVoices.push({ id: i, note: 60, velocity: 0, active: false, pulseAnim: 0, x: 0, y: 0 });
}

export function setControlPoints(pts) {
  numCtrlPoints = Math.min(MAX_CTRL_POINTS, pts?.length || 0);
  for (let i = 0; i < numCtrlPoints; i++) {
    ctrlX[i] = pts[i].x;
    ctrlY[i] = pts[i].y;
  }
  buildSplineLut();
}

export function buildSplineLut() {
  for (let i = 0; i < SPLINE_SAMPLES; i++) {
    const t = (i / SPLINE_SAMPLES) * Math.PI * 2;
    lutX[i] = Math.sin(t) * 0.7;
    lutY[i] = Math.cos(t) * 0.5;
    lutCurv[i] = Math.abs(Math.sin(t * 2)) * 1.5;
    lutDist[i] = (i / SPLINE_SAMPLES) * totalArcLength;
  }
}

export function sampleSplineAtS(s) {
  const normS = ((s % 1.0) + 1.0) % 1.0;
  const idx = Math.floor(normS * SPLINE_SAMPLES) % SPLINE_SAMPLES;
  return {
    x: lutX[idx],
    y: lutY[idx],
    curv: lutCurv[idx],
    heading: normS * Math.PI * 2
  };
}

// Initial spline LUT fill
buildSplineLut();

// ---- Runtime State ----
let isTracyPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let smoothedCcVal = 64;

// Interactive Tracing State
let isTracing = false;
let hoveredNode = -1;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;
let creatureTabEls = [];

/**
 * Configure creatures from a preset.
 */
export function initTracyPreset(presetId) {
  const p = TRACY_PRESETS.find(item => item.id === presetId) || TRACY_PRESETS[0];
  state.tracyPreset = p.id;
  state.modelSpeed = state.modelSpeed ?? 1.0;
  state.tracyCreatureCount = state.tracyCreatureCount ?? 4;

  for (let i = 0; i < MAX_CREATURES; i++) {
    const cData = p.creatures?.[i];
    const c = creatures[i];
    if (cData) {
      c.nodes = [...cData.nodes];
      c.speed = cData.speed ?? (1.0 + (i % 3) * 0.25);
      c.basePitchOffset = cData.basePitchOffset ?? ((i * 2) % 7);
    } else {
      c.nodes = [(i * 6) % TOTAL_NODES, ((i * 6) + 9) % TOTAL_NODES];
      c.speed = 1.0;
      c.basePitchOffset = (i * 2) % 7;
    }
    c.active = i < (state.tracyCreatureCount ?? 4);
    c.segIndex = 0;
    c.segT = 0.0;
    c.lastTriggeredNode = -1;
    c.pulseAnim = 0;
    if (c.nodes.length > 0) {
      const pos = getNodeColRow(c.nodes[0]);
      c.x = pos.col;
      c.y = pos.row;
    }
  }

  // Also update backward compatibility control points
  const pts = [];
  const activeC = creatures[0];
  if (activeC && activeC.nodes.length > 0) {
    for (const nodeIdx of activeC.nodes) {
      const { col, row } = getNodeColRow(nodeIdx);
      pts.push({
        x: -0.85 + (col / (GRID_COLS - 1)) * 1.7,
        y: -0.75 + (row / (GRID_ROWS - 1)) * 1.5
      });
    }
  }
  if (pts.length >= 3) {
    setControlPoints(pts);
  }
}

/**
 * Generates an aesthetic, connected closed node loop circuit for a creature.
 */
export function generateRandomCreaturePath() {
  const pathLength = Math.floor(Math.random() * 4) + 4; // 4 to 7 nodes
  const nodes = [];
  const mode = Math.random();

  if (mode < 0.45) {
    // Elliptical / circular orbital circuit around a random center
    const cx = 1.5 + Math.random() * (GRID_COLS - 3);
    const cy = 1.0 + Math.random() * (GRID_ROWS - 2);
    const rx = 1.0 + Math.random() * 2.2;
    const ry = 0.8 + Math.random() * 1.5;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const startAngle = Math.random() * Math.PI * 2;

    for (let s = 0; s < pathLength; s++) {
      const angle = startAngle + dir * ((s / pathLength) * Math.PI * 2);
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.round(cx + Math.cos(angle) * rx)));
      const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.round(cy + Math.sin(angle) * ry)));
      const idx = getNodeIndex(col, row);
      if (nodes.length === 0 || nodes[nodes.length - 1] !== idx) {
        nodes.push(idx);
      }
    }
  } else if (mode < 0.75) {
    // Stepwise wandering walk
    let col = Math.floor(Math.random() * GRID_COLS);
    let row = Math.floor(Math.random() * GRID_ROWS);
    nodes.push(getNodeIndex(col, row));

    for (let s = 1; s < pathLength; s++) {
      const dCol = Math.floor(Math.random() * 3) - 1;
      const dRow = Math.floor(Math.random() * 3) - 1;
      col = Math.max(0, Math.min(GRID_COLS - 1, col + (dCol === 0 && dRow === 0 ? 1 : dCol)));
      row = Math.max(0, Math.min(GRID_ROWS - 1, row + dRow));
      const idx = getNodeIndex(col, row);
      if (nodes[nodes.length - 1] !== idx) {
        nodes.push(idx);
      }
    }
  } else {
    // Undulating horizontal corridor
    const startCol = Math.floor(Math.random() * 3);
    const baseRow = Math.floor(Math.random() * (GRID_ROWS - 2)) + 1;
    for (let s = 0; s < pathLength; s++) {
      const col = (startCol + s) % GRID_COLS;
      const rowOffset = (s % 2 === 0 ? 1 : -1);
      const row = Math.max(0, Math.min(GRID_ROWS - 1, baseRow + rowOffset));
      const idx = getNodeIndex(col, row);
      if (nodes.length === 0 || nodes[nodes.length - 1] !== idx) {
        nodes.push(idx);
      }
    }
  }

  // Ensure at least 3 distinct nodes in the loop
  if (nodes.length < 3) {
    return [
      getNodeIndex(1, 1),
      getNodeIndex(3, 4),
      getNodeIndex(6, 2)
    ];
  }

  return nodes;
}

/**
 * Global Randomize Action:
 * Randomizes the number of creatures (1-8), their scale pitch offsets, and their closed node loop paths.
 */
export function randomizeTracy() {
  // 1. Randomize number of active creatures (1 to 8)
  const count = Math.floor(Math.random() * 8) + 1;
  state.tracyCreatureCount = count;
  state.tracyPreset = "custom";
  if (refs.tracyPreset?.setValue) refs.tracyPreset.setValue("custom");
  if (refs.tracyCreatureCount?.setValue) refs.tracyCreatureCount.setValue(count);

  // 2. Randomize scale degree pitch offsets across creatures
  const candidateOffsets = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shuffledOffsets = [...candidateOffsets].sort(() => Math.random() - 0.5);

  // 3. Randomize closed node loop paths and reset traversal state
  for (let i = 0; i < MAX_CREATURES; i++) {
    const c = creatures[i];
    c.active = (i < count);
    c.basePitchOffset = shuffledOffsets[i % shuffledOffsets.length];
    c.nodes = generateRandomCreaturePath();
    c.segIndex = 0;
    c.segT = 0.0;
    c.lastTriggeredNode = -1;
    c.pulseAnim = 0;
    if (c.nodes.length > 0) {
      const pos = getNodeColRow(c.nodes[0]);
      c.x = pos.col;
      c.y = pos.row;
    }
  }

  updateCreatureTabs();
  syncCreatureControls();
  renderCanvas();
  scheduleRegen();
  status(`Randomized Tracy: ${count} creatures, new routes & pitch offsets`);
}

/**
 * Numerically advance all active creatures along their node paths and trigger notes.
 */
export function stepSimulation(dt = 0.016) {
  const numActive = Math.min(MAX_CREATURES, Math.max(1, state.tracyCreatureCount ?? 4));
  const masterSpeed = Math.max(0.1, Number(state.modelSpeed ?? state.tracySpeed ?? 1.0));
  let anyTriggered = false;

  for (let k = 0; k < numActive; k++) {
    const c = creatures[k];
    c.active = true;

    if (!c.nodes || c.nodes.length === 0) {
      continue;
    }

    if (c.nodes.length === 1) {
      const pos = getNodeColRow(c.nodes[0]);
      c.x = pos.col;
      c.y = pos.row;
      continue;
    }

    const pathLen = c.nodes.length;
    const effectiveSpeed = masterSpeed * (c.speed || 1.0);
    // Steady traversal velocity: ~2.5 segments per second at 1.0x
    const segRate = 2.4 * effectiveSpeed;
    c.segT += dt * segRate;

    while (c.segT >= 1.0) {
      c.segT -= 1.0;
      c.segIndex = (c.segIndex + 1) % pathLen;
      const targetNodeIdx = c.nodes[c.segIndex];

      // Trigger note on node arrival!
      const { col, row } = getNodeColRow(targetNodeIdx);
      const note = getTracyNodePitch(col, row, c.basePitchOffset);
      const vel = Math.round(75 + ((k * 11) % 35));
      const durMs = Math.round(Math.max(60, 180 / effectiveSpeed));

      c.lastTriggeredNode = targetNodeIdx;
      c.currentNote = note;
      c.pulseAnim = 1.0;
      anyTriggered = true;

      // Update dropletVoice for UI status bar
      const dv = dropletVoices[k];
      dv.note = note;
      dv.velocity = vel;
      dv.active = true;
      dv.pulseAnim = 1.0;

      // Polyphonic note dispatch strictly respecting the 8-voice hardware ceiling
      const candidates = [{ id: k, note, velocity: vel }];
      const chosen = selectPolyVoices(candidates, state.polyphony ?? 8, state.polyStrategy ?? "highest");
      for (const ch of chosen) {
        playVoice(ch.id, ch.note, ch.velocity, durMs);
      }
    }

    // Interpolate continuous grid position between nodeA and nodeB
    const idxA = c.nodes[c.segIndex];
    const idxB = c.nodes[(c.segIndex + 1) % pathLen];
    const posA = getNodeColRow(idxA);
    const posB = getNodeColRow(idxB);

    c.x = posA.col + (posB.col - posA.col) * c.segT;
    c.y = posA.row + (posB.row - posA.row) * c.segT;

    // Decay visual pulse animation
    if (c.pulseAnim > 0) {
      c.pulseAnim = Math.max(0, c.pulseAnim - dt * 2.5);
    }
  }

  // Modulate FM-1 CC #74 Brightness with the average speed and vertical height
  let avgHeight = 0;
  for (let k = 0; k < numActive; k++) {
    avgHeight += creatures[k].y / (GRID_ROWS - 1);
  }
  avgHeight /= Math.max(1, numActive);
  const targetCc = Math.round(40 + avgHeight * 70);
  smoothedCcVal = Math.round(smoothedCcVal * 0.9 + targetCc * 0.1);
  dispatchTimbreCc(smoothedCcVal);

  return { triggered: anyTriggered, creatureS, noteIndex: 0 };
}

/**
 * Generator Function Contract: generateTracyRibbonBank(state).
 * Returns a valid 64-step bank array conforming to the engine contract.
 */
export function generateTracyRibbonBank(s) {
  const seqLen = s?.length || 64;
  const numActive = Math.min(MAX_CREATURES, Math.max(1, s?.tracyCreatureCount ?? state.tracyCreatureCount ?? 4));
  const steps = [];

  for (let step = 0; step < seqLen; step++) {
    const stepNotes = [];

    for (let k = 0; k < numActive; k++) {
      const c = creatures[k];
      if (!c.nodes || c.nodes.length === 0) continue;

      const pathLen = c.nodes.length;
      const stepInterval = Math.max(1, Math.floor(seqLen / Math.max(2, pathLen)));
      if (step % stepInterval === 0) {
        const pathIdx = Math.floor(step / stepInterval) % pathLen;
        const nodeIdx = c.nodes[pathIdx];
        const { col, row } = getNodeColRow(nodeIdx);
        const note = getTracyNodePitch(col, row, c.basePitchOffset);
        const vel = Math.round(70 + ((k * 13) % 40));
        stepNotes.push({ note, vel });
      }
    }

    const firstNote = stepNotes[0]?.note ?? getTracyNodePitch(step % GRID_COLS, 2, 0);
    const firstVel = stepNotes[0]?.vel ?? 90;

    steps.push({
      note: firstNote,
      vel: firstVel,
      notes: stepNotes.length > 0 ? stepNotes : [{ note: firstNote, vel: firstVel }],
      gate: stepNotes.length > 0 ? 0.75 : 0.0,
      skip: false
    });
  }

  return [{
    length: seqLen,
    steps,
    rate: s?.rate || "1/16"
  }];
}

/**
 * Direct Manipulation Canvas Rendering.
 * Strictly adheres to Flat Workbench Aesthetic (Zero CSS/Canvas Gradients).
 */
export function renderCanvas() {
  if (!canvas || !ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  const cs = getComputedStyle(document.documentElement);
  const colorBg = cs.getPropertyValue("--panel").trim() || "#18191f";
  const colorPanel2 = cs.getPropertyValue("--panel2").trim() || "#22252e";
  const colorLine = cs.getPropertyValue("--line").trim() || "#333846";
  const colorLineFocus = cs.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colorFg = cs.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colorDim = cs.getPropertyValue("--dim").trim() || "#9ca3af";
  const colorAccent = cs.getPropertyValue("--accent").trim() || "#3b82f6";
  const colorAccent2 = cs.getPropertyValue("--accent2").trim() || "#60a5fa";

  // Flat canvas clear
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  const padX = w * 0.08;
  const padY = h * 0.12;
  const availW = w - padX * 2;
  const availH = h - padY * 2;

  const getNodePos = (col, row) => ({
    x: padX + (col / (GRID_COLS - 1)) * availW,
    y: (h - padY) - (row / (GRID_ROWS - 1)) * availH
  });

  // 1. Draw Grid Matrix Dividers
  ctx.strokeStyle = colorPanel2;
  ctx.lineWidth = 1;
  for (let r = 0; r < GRID_ROWS; r++) {
    const y = (h - padY) - (r / (GRID_ROWS - 1)) * availH;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }
  for (let c = 0; c < GRID_COLS; c++) {
    const x = padX + (c / (GRID_COLS - 1)) * availW;
    ctx.beginPath();
    ctx.moveTo(x, padY);
    ctx.lineTo(x, h - padY);
    ctx.stroke();
  }

  const numActive = Math.min(MAX_CREATURES, Math.max(1, state.tracyCreatureCount ?? 4));

  // 2. Draw Paths for All Active Creatures
  for (let k = 0; k < numActive; k++) {
    const c = creatures[k];
    if (!c.nodes || c.nodes.length < 2) continue;

    const isSelected = (k === selectedCreatureIndex);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = isSelected ? 3 : 1.5;
    ctx.globalAlpha = isSelected ? 0.95 : 0.45;

    ctx.beginPath();
    for (let i = 0; i < c.nodes.length; i++) {
      const { col, row } = getNodeColRow(c.nodes[i]);
      const p = getNodePos(col, row);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    // Closed looping route
    const { col: firstCol, row: firstRow } = getNodeColRow(c.nodes[0]);
    const firstP = getNodePos(firstCol, firstRow);
    ctx.lineTo(firstP.x, firstP.y);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }

  // 3. Draw All Grid Nodes
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const idx = getNodeIndex(c, r);
      const p = getNodePos(c, r);
      const isHovered = (idx === hoveredNode);

      // Check if node is part of the selected creature's path
      const selC = creatures[selectedCreatureIndex];
      const inSelectedPath = selC?.nodes?.includes(idx);

      // Node point radius
      const radius = inSelectedPath ? 6 : (isHovered ? 5 : 3.5);

      ctx.fillStyle = inSelectedPath ? selC.color : (isHovered ? colorLineFocus : colorPanel2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = inSelectedPath ? colorFg : colorLine;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Pitch indicator text for hovered node or selected path nodes
      if (isHovered || inSelectedPath) {
        const notePitch = inSelectedPath
          ? getTracyNodePitch(c, r, selC?.basePitchOffset ?? 0, state.tracyOctave ?? 0)
          : getTracyNodePitch(c, r, 0, 0);
        ctx.fillStyle = inSelectedPath ? selC.color : colorDim;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(midiName(notePitch), p.x, p.y - radius - 3);
      }
    }
  }

  // 4. Draw Creatures as Distinct Coloured Circles
  for (let k = 0; k < numActive; k++) {
    const c = creatures[k];
    if (!c.nodes || c.nodes.length === 0) continue;

    const screenPos = {
      x: padX + (c.x / (GRID_COLS - 1)) * availW,
      y: (h - padY) - (c.y / (GRID_ROWS - 1)) * availH
    };

    const isSelected = (k === selectedCreatureIndex);
    const baseR = isSelected ? 12 : 9.5;
    const pulseBoost = c.pulseAnim * 5;
    const r = baseR + pulseBoost;

    // Expanding shockwave ripple on node trigger
    if (c.pulseAnim > 0.05) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = c.pulseAnim;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, r + (1.0 - c.pulseAnim) * 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // Creature solid colored circle
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, r, 0, Math.PI * 2);
    ctx.fill();

    // High-contrast border
    ctx.strokeStyle = isSelected ? "#ffffff" : colorBg;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Creature index number label
    ctx.fillStyle = "#111215";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${k + 1}`, screenPos.x, screenPos.y);
  }

  // 5. Bottom Telemetry & Status Bar
  ctx.fillStyle = colorDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const selC = creatures[selectedCreatureIndex];
  const pathLength = selC?.nodes?.length || 0;
  const currentPitchName = selC?.currentNote ? midiName(selC.currentNote) : "--";
  const basePitch = getTracyNodePitch(0, 0, selC?.basePitchOffset ?? 0, state.tracyOctave ?? 0);
  const span = Math.min(4, Math.max(1, Number(state.pitchSpan ?? 2)));
  const scaleName = SCALE_LABELS[state.scale] || state.scale || "Scale";
  ctx.fillText(
    `C${selectedCreatureIndex + 1} (${selC?.color}) · BASE: ${midiName(basePitch)} · SPEED: ${selC?.speed?.toFixed(2)}x · NOTE: ${currentPitchName} · SCALE: ${scaleName} (${span} Oct) · ACTIVE: ${numActive}/8`,
    12, h - 10
  );
}

/**
 * Setup Pointer Drawing and Canvas Interaction (Node Snapping).
 */
function setupCanvasInteractions() {
  if (!canvas) return;

  const findNearestNode = (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);

    const padX = canvas.width * 0.08;
    const padY = canvas.height * 0.12;
    const availW = canvas.width - padX * 2;
    const availH = canvas.height - padY * 2;

    let closestIdx = -1;
    let minDist = 38; // Snap radius threshold in pixels

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const nx = padX + (c / (GRID_COLS - 1)) * availW;
        const ny = (canvas.height - padY) - (r / (GRID_ROWS - 1)) * availH;
        const dist = Math.hypot(px - nx, py - ny);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = getNodeIndex(c, r);
        }
      }
    }
    return closestIdx;
  };

  canvas.addEventListener("pointerdown", (e) => {
    isTracing = true;
    canvas.setPointerCapture(e.pointerId);

    const nodeIdx = findNearestNode(e);
    if (nodeIdx !== -1) {
      const c = creatures[selectedCreatureIndex];
      // Reset path or append
      if (e.shiftKey) {
        c.nodes.push(nodeIdx);
      } else {
        c.nodes = [nodeIdx];
      }
      c.segIndex = 0;
      c.segT = 0;
      renderCanvas();
      const { col, row } = getNodeColRow(nodeIdx);
      status(`Tracing C${selectedCreatureIndex + 1}: started at Node (${col}, ${row})`);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const nodeIdx = findNearestNode(e);
    if (hoveredNode !== nodeIdx) {
      hoveredNode = nodeIdx;
      renderCanvas();
    }

    if (!isTracing || nodeIdx === -1) return;

    const c = creatures[selectedCreatureIndex];
    const lastNode = c.nodes[c.nodes.length - 1];

    if (lastNode !== nodeIdx) {
      c.nodes.push(nodeIdx);
      renderCanvas();
      const { col, row } = getNodeColRow(nodeIdx);
      status(`C${selectedCreatureIndex + 1} route: added Node (${col}, ${row}) · Total: ${c.nodes.length}`);
    }
  });

  const finishTracing = (e) => {
    if (!isTracing) return;
    isTracing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

    const c = creatures[selectedCreatureIndex];
    if (c.nodes.length >= 2) {
      state.tracyPreset = "custom";
      if (refs.tracyPreset) refs.tracyPreset.setValue("custom");
      status(`C${selectedCreatureIndex + 1} path complete (${c.nodes.length} nodes looped)`);
    }
    renderCanvas();
  };

  canvas.addEventListener("pointerup", finishTracing);
  canvas.addEventListener("pointercancel", finishTracing);
}

/**
 * Main animation loop.
 */
function animLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (isTracyPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  if (typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function startTracyRibbon() {
  isTracyPlaying = true;
  lastFrameTime = performance.now();
  if (refs.btnPlayTracy) {
    refs.btnPlayTracy.textContent = "Stop";
    refs.btnPlayTracy.classList.add("btn-active");
  }
}

export function stopTracyRibbon() {
  isTracyPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  for (let i = 0; i < MAX_CREATURES; i++) {
    creatures[i].pulseAnim = 0;
  }
  if (refs.btnPlayTracy) {
    refs.btnPlayTracy.textContent = "Play";
    refs.btnPlayTracy.classList.remove("btn-active");
  }
}

export function toggleTracyRibbonRunning() {
  if (isTracyPlaying) {
    stopTracyRibbon();
  } else {
    startTracyRibbon();
  }
}

export function isTracyRibbonRunning() {
  return isTracyPlaying;
}

/**
 * Update active creature tabs in UI
 */
function updateCreatureTabs() {
  const numActive = Math.min(MAX_CREATURES, Math.max(1, state.tracyCreatureCount ?? 4));

  creatureTabEls.forEach((btn, idx) => {
    const isSelected = (idx === selectedCreatureIndex);
    const isActive = (idx < numActive);
    btn.style.opacity = isActive ? "1.0" : "0.35";
    btn.style.outline = isSelected ? "2px solid var(--fg)" : "none";
    btn.style.borderColor = isSelected ? "#ffffff" : CREATURE_COLORS[idx];
  });
}

/**
 * Workbench Assembly & DOM Initialization.
 */
export function initTracyRibbon() {
  container = document.getElementById("model-tracy_ribbon");
  if (!container) return;
  container.innerHTML = "";

  // 1. Module Enclosure & Header
  const moduleWrap = document.createElement("div");
  moduleWrap.className = "chladni-wrap";

  const header = document.createElement("div");
  header.className = "chladni-header";
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span class="chladni-title">Electroplankton Tracy Grid</span>
      <span class="chladni-tag">Node Path Tracing · 8 Coloured Creatures</span>
    </div>
  `;

  // 2. Creature Selector Toolbar (Pills 1..8)
  const creatureToolbar = document.createElement("div");
  creatureToolbar.style.display = "flex";
  creatureToolbar.style.gap = "6px";
  creatureToolbar.style.alignItems = "center";
  creatureToolbar.style.flexWrap = "wrap";
  creatureToolbar.style.marginBottom = "8px";

  const label = document.createElement("span");
  label.style.fontSize = "9px";
  label.style.fontWeight = "bold";
  label.style.color = "var(--dim)";
  label.textContent = "CREATURE:";
  creatureToolbar.appendChild(label);

  creatureTabEls = [];
  for (let i = 0; i < MAX_CREATURES; i++) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "btn";
    tab.style.padding = "3px 8px";
    tab.style.fontSize = "10px";
    tab.style.fontWeight = "bold";
    tab.style.background = "var(--panel2)";
    tab.style.color = CREATURE_COLORS[i];
    tab.style.border = `1px solid ${CREATURE_COLORS[i]}`;
    tab.textContent = `C${i + 1}`;
    tab.title = `Select Creature ${i + 1} (${CREATURE_COLORS[i]}) to trace or edit`;

    tab.addEventListener("click", () => {
      selectedCreatureIndex = i;
      updateCreatureTabs();
      syncCreatureControls();
      renderCanvas();
      status(`Selected Creature C${i + 1} for path tracing`);
    });

    creatureTabEls.push(tab);
    creatureToolbar.appendChild(tab);
  }

  // 3. Interactive Grid Canvas
  canvas = document.createElement("canvas");
  canvas.className = "chladni-canvas";
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.touchAction = "none";
  ctx = canvas.getContext("2d");

  setupCanvasInteractions();

  // 4. Control Sections Grid
  const controlsGrid = document.createElement("div");
  controlsGrid.className = "chladni-controls-grid";
  controlsGrid.style.display = "grid";
  controlsGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(280px, 1fr))";
  controlsGrid.style.gap = "8px";
  controlsGrid.style.marginTop = "8px";

  // Section A: Multi-Creature & Master Path
  const sectPath = document.createElement("div");
  sectPath.className = "chladni-card";
  sectPath.innerHTML = `<div class="chladni-card-title">Multi-Creature Settings</div>`;

  const presetOptions = TRACY_PRESETS.map(p => ({ v: p.id, t: p.name }));
  const rowPreset = R("tracyPreset", dropdown({
    label: "Preset",
    options: presetOptions,
    value: state.tracyPreset || "counterpoint",
    onInput: v => {
      initTracyPreset(v);
      syncControls();
      renderCanvas();
    },
    tip: "Curated multi-creature path constellations and canons"
  }));

  const rowCreatureCount = R("tracyCreatureCount", knob({
    label: "Creatures",
    min: 1,
    max: 8,
    step: 1,
    value: state.tracyCreatureCount ?? 4,
    format: v => `${Math.round(v)}`,
    onInput: v => {
      state.tracyCreatureCount = Math.round(v);
      updateCreatureTabs();
      renderCanvas();
    },
    tip: "Number of active simultaneous creatures on the grid (1-8)"
  }));

  sectPath.appendChild(rowPreset);
  sectPath.appendChild(rowCreatureCount);

  // Section B: Selected Creature Parameter Controls
  const sectSelectedCreature = document.createElement("div");
  sectSelectedCreature.className = "chladni-card";
  sectSelectedCreature.id = "tracy-selected-creature-card";
  sectSelectedCreature.innerHTML = `<div class="chladni-card-title">Selected Creature C1 Settings</div>`;

  const rowCreatureSpeed = R("tracyCSpeed", knob({
    label: "C# Speed",
    min: 0.25,
    max: 3.0,
    step: 0.05,
    value: creatures[0].speed,
    format: v => `${v.toFixed(2)}x`,
    onInput: v => {
      creatures[selectedCreatureIndex].speed = v;
      renderCanvas();
    },
    tip: "Individual speed multiplier for selected creature"
  }));

  const rowCreaturePitch = R("tracyCPitch", knob({
    label: "Base Pitch",
    min: -7,
    max: 14,
    step: 1,
    value: creatures[0].basePitchOffset,
    format: (v) => {
      const offset = Math.round(v);
      const note = getTracyNodePitch(0, 0, offset, state.tracyOctave ?? 0);
      return `${offset >= 0 ? "+" : ""}${offset} (${midiName(note)})`;
    },
    onInput: (v) => {
      creatures[selectedCreatureIndex].basePitchOffset = Math.round(v);
      syncCreatureControls();
      renderCanvas();
    },
    tip: "Base scale degree offset choosing from the active scale"
  }));

  const creatureActions = document.createElement("div");
  creatureActions.style.display = "flex";
  creatureActions.style.gap = "6px";
  creatureActions.style.marginTop = "8px";

  const btnClearPath = actionBtn("Clear Route", () => {
    creatures[selectedCreatureIndex].nodes = [];
    creatures[selectedCreatureIndex].segIndex = 0;
    creatures[selectedCreatureIndex].segT = 0;
    renderCanvas();
    status(`Cleared path for Creature C${selectedCreatureIndex + 1}`);
  }, "Clear node route for selected creature");

  const btnReversePath = actionBtn("Reverse", () => {
    creatures[selectedCreatureIndex].nodes.reverse();
    renderCanvas();
    status(`Reversed path for Creature C${selectedCreatureIndex + 1}`);
  }, "Reverse node route traversal direction");

  creatureActions.appendChild(btnClearPath);
  creatureActions.appendChild(btnReversePath);

  sectSelectedCreature.appendChild(rowCreatureSpeed);
  sectSelectedCreature.appendChild(rowCreaturePitch);
  sectSelectedCreature.appendChild(creatureActions);

  // Section C: Global Gestural Route Actions
  const sectPitch = document.createElement("div");
  sectPitch.className = "chladni-card";
  sectPitch.innerHTML = `<div class="chladni-card-title">Gestural Actions</div>`;

  const globalActions = document.createElement("div");
  globalActions.style.display = "flex";
  globalActions.style.gap = "6px";
  globalActions.style.marginTop = "8px";

  const btnResetAll = actionBtn("Reset All", () => {
    for (let i = 0; i < MAX_CREATURES; i++) {
      creatures[i].segIndex = 0;
      creatures[i].segT = 0;
      creatures[i].pulseAnim = 0;
    }
    renderCanvas();
    status("All creatures reset to initial path start nodes");
  }, "Reset all creatures to start of their paths");

  const btnClearAll = actionBtn("Clear All", () => {
    for (let i = 0; i < MAX_CREATURES; i++) {
      creatures[i].nodes = [];
    }
    renderCanvas();
    status("Cleared all creature paths");
  }, "Clear paths for all creatures");

  globalActions.appendChild(btnResetAll);
  globalActions.appendChild(btnClearAll);

  sectPitch.appendChild(globalActions);

  controlsGrid.appendChild(sectPath);
  controlsGrid.appendChild(sectSelectedCreature);
  controlsGrid.appendChild(sectPitch);

  moduleWrap.appendChild(header);
  moduleWrap.appendChild(creatureToolbar);
  moduleWrap.appendChild(canvas);
  moduleWrap.appendChild(controlsGrid);
  container.appendChild(moduleWrap);

  // Initialize with active preset
  initTracyPreset(state.tracyPreset || "counterpoint");
  updateCreatureTabs();

  // Wire model hooks
  setModelGenerator("tracy_ribbon", generateTracyRibbonBank);
  setModelRandomizer(randomizeTracy);
  setModelStepHandler("tracy_ribbon", () => {
    if (!isTracyPlaying) {
      stepSimulation(0.02);
    }
  });

  // Start rendering loop
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animLoop);
  }
}

/**
 * Synchronize controls for selected creature.
 */
function syncCreatureControls() {
  const c = creatures[selectedCreatureIndex];
  if (!c) return;

  if (typeof document !== "undefined" && typeof document.querySelector === "function") {
    const cardTitle = document.querySelector("#tracy-selected-creature-card .chladni-card-title");
    if (cardTitle) {
      const baseNote = getTracyNodePitch(0, 0, c.basePitchOffset, state.tracyOctave ?? 0);
      cardTitle.textContent = `Selected Creature C${selectedCreatureIndex + 1} (${c.color}) · Base: ${midiName(baseNote)}`;
    }
  }
  if (refs.tracyCSpeed?.setValue) refs.tracyCSpeed.setValue(c.speed);
  if (refs.tracyCPitch?.setValue) refs.tracyCPitch.setValue(c.basePitchOffset);
}

/**
 * Called when scale, root note, root octave, or octave spread updates in the global notes bar.
 */
export function updateTracyScaleAndOctave() {
  syncCreatureControls();
  updateCreatureTabs();
  renderCanvas();
}

/**
 * Refresh UI control widgets when state values update.
 */
function syncControls() {
  if (refs.tracyCreatureCount?.setValue) refs.tracyCreatureCount.setValue(state.tracyCreatureCount);
  if (refs.tracyPreset?.setValue) refs.tracyPreset.setValue(state.tracyPreset);
  syncCreatureControls();
  updateCreatureTabs();
}

export function activateTracyRibbonModel() {
  if (container) container.style.display = "block";
  stopTracyRibbon();
  setModelGenerator("tracy_ribbon", generateTracyRibbonBank);
  setModelRandomizer(randomizeTracy);
  setModelTransportHandler({
    start: startTracyRibbon,
    stop: stopTracyRibbon,
    toggle: toggleTracyRibbonRunning,
    isRunning: isTracyRibbonRunning
  });
  renderCanvas();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function deactivateTracyRibbonModel() {
  stopTracyRibbon();
  setModelTransportHandler(null);
  setModelRandomizer(null);
  if (container) container.style.display = "none";
  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// Register Snapshot Serialization
registerModel({
  id: "tracy_ribbon",
  version: 2,
  migrations: {
    1: (data) => ({
      preset: data?.preset || "counterpoint",
      creatureCount: 4,
      selectedCreature: 0,
      masterSpeed: data?.speed || 1.0,
      masterOctave: data?.octave || 0,
      creatures: null
    })
  },
  capture: () => {
    return {
      preset: state.tracyPreset,
      creatureCount: state.tracyCreatureCount ?? 4,
      selectedCreature: selectedCreatureIndex,
      masterSpeed: state.modelSpeed ?? 1.0,
      masterOctave: state.tracyOctave ?? 0,
      creatures: creatures.map(c => ({
        nodes: [...c.nodes],
        speed: c.speed,
        basePitchOffset: c.basePitchOffset,
        active: c.active
      }))
    };
  },
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.tracyPreset = data.preset;
    if (data.masterSpeed !== undefined) {
      state.modelSpeed = data.masterSpeed;
      if (refs.speed?.setValue) refs.speed.setValue(state.modelSpeed, false);
    } else if (data.speed !== undefined) {
      state.modelSpeed = data.speed;
      if (refs.speed?.setValue) refs.speed.setValue(state.modelSpeed, false);
    }
    if (data.masterOctave !== undefined) state.tracyOctave = data.masterOctave;
    if (data.octave !== undefined && data.masterOctave === undefined) state.tracyOctave = data.octave;
    if (data.creatureCount !== undefined) state.tracyCreatureCount = data.creatureCount;
    if (data.selectedCreature !== undefined) selectedCreatureIndex = data.selectedCreature;

    if (Array.isArray(data.creatures)) {
      for (let i = 0; i < Math.min(MAX_CREATURES, data.creatures.length); i++) {
        const src = data.creatures[i];
        const dst = creatures[i];
        if (src.nodes) dst.nodes = [...src.nodes];
        if (src.speed !== undefined) dst.speed = src.speed;
        if (src.basePitchOffset !== undefined) dst.basePitchOffset = src.basePitchOffset;
        if (src.active !== undefined) dst.active = src.active;
        dst.segIndex = 0;
        dst.segT = 0;
      }
    } else {
      initTracyPreset(state.tracyPreset || "counterpoint");
    }
    syncControls();
    renderCanvas();
  }
});
