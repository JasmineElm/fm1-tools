// changes.js — English Change Ringing & Campanology Sequencer for FM-1 Pulses.
// Full-Circle Church Bell Permutations, Method Ringing, and Blue Line Trajectories.
//
// Generative Architecture:
// 1. Classical Campanology Permutations Engine:
//    - Stages 4 to 8 bells: Minimus (4), Doubles (5), Minor (6), Triples (7), Major (8).
//      Directly aligns with the M-VAVE FM-1's strict 8-voice polyphony ceiling.
//    - Methods: Plain Hunt, Plain Bob, Grandsire, Stedman, and interactive Call Changes.
//    - Authentic place notation parsing (cross changes 'x', lead/lie '1N', dodges '14', '12', '125').
//    - Real-time Bob and Single conductor calls triggered at lead-ends.
// 2. Campanology Timing & Acoustics:
//    - Row-by-row sequential striking down each change (Position 1 -> Position N).
//    - Handstroke vs Backstroke alternating cycles with authentic "Open Lead" pause at handstroke.
//    - Scale quantization using scale.js (diatonic descending scale from Treble down to Tenor = Root).
//    - Micro-rubato / human swing timing emulation.
//    - Continuous Timbre CC #74 Brightness modulation via dispatchTimbreCc() driven by change permutation entropy.
// 3. Flat Workbench Interactive Visualizer:
//    - Dual-panel canvas: Left = Radial Belfry Bell Wheels with swinging ropes, clappers, and impact halos;
//      Right = The historic "Blue Line" Sheet (Red line for Treble, Blue line for selected working bell).
//    - Direct manipulation: click bell to track its Blue Line; Shift-click or drag adjacent bells to execute Call Changes.
// 4. Zero GC Churn: Pre-allocated TypedArrays (Uint8Array, Int16Array, Float32Array).
// 5. Dual Sync/Free modes: 64-step transport-locked rhythm pattern or continuous autonomous campanology.

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

// ---- Constants & Pre-allocated TypedArrays (Zero GC Churn) ----
export const MAX_BELLS = 8;
export const MIN_BELLS = 4;
export const MAX_HISTORY_ROWS = 32;

export const STAGES = [
  { v: 4, t: "Minimus (4 Bells)", count: 4 },
  { v: 5, t: "Doubles (5 Bells)", count: 5 },
  { v: 6, t: "Minor (6 Bells)", count: 6 },
  { v: 7, t: "Triples (7 Bells)", count: 7 },
  { v: 8, t: "Major (8 Bells)", count: 8 }
];

export const METHODS = [
  { v: "plain_hunt", t: "Plain Hunt" },
  { v: "plain_bob", t: "Plain Bob" },
  { v: "grandsire", t: "Grandsire" },
  { v: "stedman", t: "Stedman" },
  { v: "call_changes", t: "Call Changes" }
];

// Current row of bells: 1-indexed bell numbers (1 = Treble, stage = Tenor)
const currentRow = new Uint8Array(MAX_BELLS);
// History of rows for the Blue Line sheet: [MAX_HISTORY_ROWS * MAX_BELLS]
const historyRows = new Uint8Array(MAX_HISTORY_ROWS * MAX_BELLS);
const historyStrokes = new Uint8Array(MAX_HISTORY_ROWS); // 0 = Handstroke, 1 = Backstroke
let historyCount = 0;
let historyHead = 0;

// Bell physics & visualizer state
const bellAngles = new Float32Array(MAX_BELLS);
const bellTargetAngles = new Float32Array(MAX_BELLS);
const bellFlash = new Float32Array(MAX_BELLS);
const bellLastStrike = new Float64Array(MAX_BELLS);

// Campanology sequencing engine state
let currentStage = 8;
let currentMethod = "plain_bob";
let stroke = 0; // 0 = Handstroke, 1 = Backstroke
let leadIndex = 0; // Current place in method lead
let rowCount = 0;
let pendingCall = "none"; // "none", "bob", "single"
let currentCall = "none";
let isRunning = false;
let animFrameId = null;
let lastFrameTime = 0;

// Strike timer within current row
let currentStrikePos = 0; // 0 to stage - 1
let strikeTimer = 0;
let isRowPause = false;
let rowPauseTimer = 0;

// Canvas & UI references
let canvas = null;
let ctx = null;
let container = null;
let isInteracting = false;
let hoveredBell = -1;
let dragSourceBell = -1;

/**
 * Initialize row permutation to Rounds (1, 2, 3, ..., stage).
 */
export function resetToRounds(stage = currentStage) {
  currentStage = Math.max(MIN_BELLS, Math.min(MAX_BELLS, stage));
  for (let i = 0; i < MAX_BELLS; i++) {
    currentRow[i] = i < currentStage ? (i + 1) : 0;
  }
  leadIndex = 0;
  stroke = 0;
  currentStrikePos = 0;
  strikeTimer = 0;
  isRowPause = false;
  rowPauseTimer = 0;
  pendingCall = "none";
  currentCall = "none";

  // Push rounds into history
  pushHistoryRow();
}

/**
 * Push current row into history circular buffer for the Blue Line diagram.
 */
function pushHistoryRow() {
  const offset = (historyHead % MAX_HISTORY_ROWS) * MAX_BELLS;
  for (let i = 0; i < MAX_BELLS; i++) {
    historyRows[offset + i] = currentRow[i];
  }
  historyStrokes[historyHead % MAX_HISTORY_ROWS] = stroke;
  historyHead++;
  if (historyCount < MAX_HISTORY_ROWS) historyCount++;
}

/**
 * Apply place notation to generate the next row permutation.
 * Notation can be 'x' (all adjacent pairs swap) or place indices (e.g. '18', '14', '12', '1', '5').
 */
export function applyPlaceNotation(row, notation, stage) {
  const next = new Uint8Array(row);
  const N = stage;

  if (notation === "x" || notation === "-") {
    // Cross change: swap all adjacent pairs
    for (let i = 0; i < N - 1; i += 2) {
      const tmp = next[i];
      next[i] = next[i + 1];
      next[i + 1] = tmp;
    }
    return next;
  }

  // Parse fixed positions from notation (1-indexed)
  const fixed = new Uint8Array(N + 1);
  for (let c = 0; c < notation.length; c++) {
    const ch = notation[c];
    const p = parseInt(ch, 10);
    if (p >= 1 && p <= N) {
      fixed[p] = 1;
    }
  }

  // Unfixed adjacent pairs swap
  let i = 1;
  while (i <= N) {
    if (fixed[i]) {
      i++;
    } else if (i + 1 <= N && !fixed[i + 1]) {
      const idx1 = i - 1;
      const idx2 = i;
      const tmp = next[idx1];
      next[idx1] = next[idx2];
      next[idx2] = tmp;
      i += 2;
    } else {
      i++;
    }
  }

  return next;
}

/**
 * Advance one row according to the selected campanology method.
 */
export function advanceMethodRow() {
  const stage = currentStage;
  const method = currentMethod;

  // Toggle stroke: 0 = Handstroke, 1 = Backstroke
  stroke = stroke === 0 ? 1 : 0;
  rowCount++;

  if (method === "call_changes") {
    // In Call Changes, bells keep their current order until conductor calls a swap
    pushHistoryRow();
    return;
  }

  let notation = "x";

  if (method === "plain_hunt") {
    // Plain Hunt: alternating cross and lead/lie place notation
    const isOdd = stage % 2 !== 0;
    if (isOdd) {
      // For Doubles (5) or Triples (7): 'x' (last bell stays) then '1' (first bell stays)
      notation = (leadIndex % 2 === 0) ? "x" : "1";
    } else {
      // For Minimus (4), Minor (6), Major (8): 'x' then '1N'
      notation = (leadIndex % 2 === 0) ? "x" : `1${stage}`;
    }
    leadIndex++;
  } else if (method === "plain_bob") {
    // Plain Bob: hunt until lead end, where a dodge occurs (12 for plain lead, 14 for Bob, 1234 for Single)
    const leadLength = stage * 2; // Rows per lead: 4->8, 6->12, 8->16
    const posInLead = leadIndex % leadLength;

    if (posInLead === leadLength - 1) {
      // Lead End!
      if (pendingCall === "bob") {
        notation = "14";
        currentCall = "Bob!";
        pendingCall = "none";
      } else if (pendingCall === "single") {
        notation = stage >= 6 ? "1234" : "123";
        currentCall = "Single!";
        pendingCall = "none";
      } else {
        notation = "12"; // Plain lead end dodge
        currentCall = "none";
      }
    } else {
      notation = (posInLead % 2 === 0) ? "x" : `1${stage}`;
    }
    leadIndex++;
  } else if (method === "grandsire") {
    // Grandsire (Doubles on 5 bells, Triples on 7 bells)
    if (stage === 5) {
      // 10-row lead for Grandsire Doubles
      const gNotations = ["3", "1", "5", "1", "5", "1", "5", "1", "5", "125"];
      const pos = leadIndex % 10;
      if (pos === 9) {
        if (pendingCall === "bob") {
          notation = "145";
          currentCall = "Bob!";
          pendingCall = "none";
        } else if (pendingCall === "single") {
          notation = "12345";
          currentCall = "Single!";
          pendingCall = "none";
        } else {
          notation = "125";
          currentCall = "none";
        }
      } else {
        notation = gNotations[pos];
      }
    } else {
      // Grandsire on 6 or 8 bells: generalized hunt with 3rd place lead-ends
      const pos = leadIndex % (stage * 2);
      if (pos === 0) notation = "3";
      else if (pos === (stage * 2 - 1)) {
        notation = pendingCall === "bob" ? "14" : "12";
        pendingCall = "none";
      } else {
        notation = (pos % 2 === 1) ? "1" : "x";
      }
    }
    leadIndex++;
  } else if (method === "stedman") {
    // Stedman: 6-row blocks alternating quick and slow
    const stedmanNotations = ["3", "1", "x", "3", "1", "3", "3", "1", "x", "1", "3", "1"];
    const pos = leadIndex % 12;
    notation = stedmanNotations[pos];
    leadIndex++;
  }

  // Apply place notation to generate next row
  const next = applyPlaceNotation(currentRow, notation, stage);
  for (let i = 0; i < stage; i++) {
    currentRow[i] = next[i];
  }

  pushHistoryRow();
}

/**
 * Swap two adjacent bells (for manual Call Changes direct manipulation).
 */
export function swapAdjacentBells(pos1, pos2) {
  if (pos1 < 0 || pos1 >= currentStage || pos2 < 0 || pos2 >= currentStage) return false;
  if (Math.abs(pos1 - pos2) !== 1) return false;

  const tmp = currentRow[pos1];
  currentRow[pos1] = currentRow[pos2];
  currentRow[pos2] = tmp;
  pushHistoryRow();
  return true;
}

/**
 * Apply a classic historical Call Change preset.
 */
export function applyCallPreset(presetName) {
  const N = currentStage;
  if (presetName === "rounds") {
    resetToRounds(N);
    return;
  }

  if (presetName === "queens") {
    // Queens: Odd bells first, then even bells (e.g. 1 3 5 7 2 4 6 8)
    let idx = 0;
    for (let b = 1; b <= N; b += 2) currentRow[idx++] = b;
    for (let b = 2; b <= N; b += 2) currentRow[idx++] = b;
  } else if (presetName === "tittums") {
    // Tittums: Weaving odds and evens (e.g. 1 5 2 6 3 7 4 8 on 8)
    const half = Math.ceil(N / 2);
    let idx = 0;
    for (let i = 0; i < half; i++) {
      if (idx < N) currentRow[idx++] = 1 + i;
      if (idx < N && 1 + half + i <= N) currentRow[idx++] = 1 + half + i;
    }
  } else if (presetName === "whittingtons") {
    // Whittingtons (St. Mary-le-Bow chime): 5 3 1 2 4 6 7 8 (or front bells inverted)
    if (N >= 5) {
      currentRow[0] = 5;
      currentRow[1] = 3;
      currentRow[2] = 1;
      currentRow[3] = 2;
      currentRow[4] = 4;
      for (let i = 5; i < N; i++) currentRow[i] = i + 1;
    }
  } else if (presetName === "reverse") {
    // Reverse rounds: Tenor to Treble
    for (let i = 0; i < N; i++) currentRow[i] = N - i;
  }

  pushHistoryRow();
}

/**
 * Calculate pitch (MIDI note) for a given bell number.
 * Bell 1 (Treble) = highest pitch.
 * Bell stage (Tenor) = lowest pitch (Root MIDI).
 * Quantized cleanly via scale.js against active scale intervals.
 */
export function getBellNote(bellNumber, stage = currentStage) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();

  // Bell number is 1 to stage
  // Scale steps above root: Bell stage is 0 (Tenor), Bell 1 is stage - 1 (Treble)
  const bellIdx = Math.max(1, Math.min(stage, bellNumber));
  const scaleStep = stage - bellIdx;

  let rawMidi;
  if (Array.isArray(intervals) && intervals.length > 0) {
    const oct = Math.floor(scaleStep / intervals.length);
    const degree = scaleStep % intervals.length;
    rawMidi = root + (oct * 12) + intervals[degree];
  } else {
    // Diatonic major fallback: [0, 2, 4, 5, 7, 9, 11, 12]
    const diatonic = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
    rawMidi = root + (diatonic[scaleStep % diatonic.length] || scaleStep);
  }

  return quantize(rawMidi, intervals, root);
}

/**
 * Calculate permutation entropy / disorder of current row (0 in rounds, 1 in maximally mixed).
 */
function calculateRowEntropy() {
  const N = currentStage;
  if (N <= 1) return 0;
  let inversions = 0;
  const maxInversions = (N * (N - 1)) / 2;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (currentRow[i] > currentRow[j]) inversions++;
    }
  }
  return inversions / maxInversions;
}

/**
 * Execute a single bell strike at current position in current row.
 */
function strikeBell(bellNumber) {
  if (bellNumber < 1 || bellNumber > currentStage) return;

  const note = getBellNote(bellNumber, currentStage);
  const baseVel = Number(state.changesVelocity) || 96;
  const swing = (Number(state.changesSwing) || 5) / 100;

  // Bells have weight: Tenor is heavier (longer duration & deeper velocity)
  const weightRatio = bellNumber / currentStage;
  const vel = Math.max(30, Math.min(127, Math.round(baseVel * (0.85 + 0.3 * weightRatio))));
  const durMs = Math.round(300 + weightRatio * 500);

  // Polyphonic voice slot: 0 to 7 mapped 1-to-1 to bell 1 to 8
  const voiceSlot = `bell_${bellNumber - 1}`;
  playVoice(voiceSlot, note, vel, durMs);

  // Visual excitation
  const bellIdx = bellNumber - 1;
  bellFlash[bellIdx] = 1.0;
  bellLastStrike[bellIdx] = performance.now();
  // Bell wheel swing impulse: alternating direction depending on stroke
  const impulse = stroke === 0 ? 0.35 : -0.35;
  bellAngles[bellIdx] += impulse;

  // Dynamic Timbre CC dispatch on Tenor strike or significant changes
  if (bellNumber === currentStage || bellNumber === 1) {
    const entropy = calculateRowEntropy();
    const leadProgress = (leadIndex % (currentStage * 2)) / (currentStage * 2);
    dispatchTimbreCc(entropy, leadProgress, Number(state.changesRate) || 160);
  }
}

/**
 * Main simulation step loop for autonomous / Free mode ringing.
 */
function stepSimulation(deltaTime) {
  const rateMs = Math.max(60, Math.min(500, Number(state.changesRate) || 160));
  const openLeadPercent = Math.max(0, Math.min(200, Number(state.changesOpenLead) || 50));
  const openLeadMs = rateMs * (openLeadPercent / 100);

  // Update wheel angles with damped harmonic oscillator (spring back to vertical)
  for (let i = 0; i < MAX_BELLS; i++) {
    bellAngles[i] *= 0.92;
    if (bellFlash[i] > 0.01) {
      bellFlash[i] *= 0.88;
    } else {
      bellFlash[i] = 0;
    }
  }

  if (isRowPause) {
    rowPauseTimer += deltaTime;
    if (rowPauseTimer >= openLeadMs) {
      isRowPause = false;
      rowPauseTimer = 0;
      currentStrikePos = 0;
      strikeTimer = 0;
      advanceMethodRow();
    }
    return;
  }

  strikeTimer += deltaTime;
  if (strikeTimer >= rateMs) {
    strikeTimer = 0;
    // Strike the bell at current position
    const bellToStrike = currentRow[currentStrikePos];
    strikeBell(bellToStrike);

    currentStrikePos++;
    if (currentStrikePos >= currentStage) {
      // Row completed!
      currentStrikePos = 0;
      // If just finished a backstroke (stroke == 1), traditionally an open lead pause occurs before next handstroke
      if (stroke === 1 && openLeadMs > 5) {
        isRowPause = true;
        rowPauseTimer = 0;
      } else {
        advanceMethodRow();
      }
    }
  }
}

/**
 * Canvas rendering function: Belfry Bell Wheels (Left) + The Blue Line Sheet (Right).
 */
export function renderCanvas() {
  if (!canvas || !ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  const style = getComputedStyle(document.documentElement);
  const colorBg = style.getPropertyValue("--panel").trim() || "#18191f";
  const colorPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colorLine = style.getPropertyValue("--line").trim() || "#333846";
  const colorLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colorFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colorDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colorAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colorAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colorOk = style.getPropertyValue("--ok").trim() || "#22c55e";
  const colorErr = style.getPropertyValue("--err").trim() || "#ef4444";

  // Flat background
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  const splitX = Math.floor(w * 0.46);

  // Divider line between Belfry and Blue Line
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(splitX, 0);
  ctx.lineTo(splitX, h);
  ctx.stroke();

  // Selected working bell for the Blue Line
  const workingBell = Math.max(1, Math.min(currentStage, Number(state.changesSelectedBell) || 2));

  // ==========================================
  // LEFT PANEL: BELFRY WHEEL & BELL CHAIR
  // ==========================================
  const belfryW = splitX;
  const belfryH = h;
  const centerX = belfryW / 2;
  const centerY = belfryH / 2;
  const radius = Math.min(centerX, centerY) - 36;

  // Header / Status
  ctx.font = "10px monospace";
  ctx.fillStyle = colorDim;
  ctx.fillText("BELFRY RING", 12, 18);
  ctx.fillStyle = stroke === 0 ? colorAccent : colorDim;
  ctx.fillText(stroke === 0 ? "HANDSTROKE [SALLY]" : "BACKSTROKE [TAIL]", 12, 32);

  if (currentCall !== "none") {
    ctx.fillStyle = colorOk;
    ctx.font = "bold 11px monospace";
    ctx.fillText(currentCall, 12, 46);
  }

  // Draw radial circle guide
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw bells in radial order according to current row permutation
  const N = currentStage;
  for (let pos = 0; pos < N; pos++) {
    const bellNum = currentRow[pos];
    const bellIdx = bellNum - 1;
    // Angle in circle: position 0 is top (-PI/2), moving clockwise
    const theta = -Math.PI / 2 + (pos * (Math.PI * 2) / N);
    const bx = centerX + Math.cos(theta) * radius;
    const by = centerY + Math.sin(theta) * radius;

    const isCurrentStriking = (pos === currentStrikePos && isRunning);
    const isWorking = (bellNum === workingBell);
    const isTreble = (bellNum === 1);
    const isTenor = (bellNum === N);
    const flash = bellFlash[bellIdx] || 0;

    // Bell wheel radius scaled by bell weight (Treble smaller, Tenor larger)
    const bellRadius = 14 + (bellNum / N) * 8;

    // Draw resonant impact halo on strike
    if (flash > 0.05) {
      ctx.strokeStyle = isWorking ? colorAccent : (isTreble ? colorErr : colorFg);
      ctx.lineWidth = 1 + flash * 2;
      ctx.beginPath();
      ctx.arc(bx, by, bellRadius + (1.0 - flash) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bell wheel outer circle
    ctx.fillStyle = isCurrentStriking ? colorPanel2 : colorBg;
    ctx.strokeStyle = isWorking ? colorAccent : (isCurrentStriking ? colorFg : colorLine);
    ctx.lineWidth = isWorking ? 2 : 1;
    ctx.beginPath();
    ctx.arc(bx, by, bellRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Wheel spokes and swinging clapper
    const swingAngle = bellAngles[bellIdx] || 0;
    ctx.strokeStyle = colorLineFocus;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.sin(swingAngle) * (bellRadius - 4), by + Math.cos(swingAngle) * (bellRadius - 4));
    ctx.stroke();

    // Clapper ball
    ctx.fillStyle = isCurrentStriking ? colorAccent : colorDim;
    ctx.beginPath();
    ctx.arc(bx + Math.sin(swingAngle) * (bellRadius - 4), by + Math.cos(swingAngle) * (bellRadius - 4), 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Bell label text: Bell number & Place
    ctx.font = isWorking ? "bold 11px monospace" : "10px monospace";
    ctx.fillStyle = isTreble ? colorErr : (isWorking ? colorAccent : colorFg);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${bellNum}`, bx, by - 1);

    // Tiny position indicator below bell
    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(`P${pos + 1}`, bx, by + bellRadius + 9);
  }

  // ==========================================
  // RIGHT PANEL: THE BLUE LINE SHEET
  // ==========================================
  const sheetX = splitX + 16;
  const sheetY = 16;
  const sheetW = w - sheetX - 16;
  const sheetH = h - 32;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "10px monospace";
  ctx.fillStyle = colorDim;
  ctx.fillText("METHOD SHEET · THE BLUE LINE", sheetX, sheetY);
  ctx.fillText(`STAGE: ${N} BELLS | WORKING BELL: #${workingBell}`, sheetX + sheetW - 200, sheetY);

  const gridTop = sheetY + 16;
  const gridBottom = sheetY + sheetH;
  const availableH = gridBottom - gridTop;
  const numRowsToDisplay = Math.min(historyCount, MAX_HISTORY_ROWS);

  // Column spacing for the places: Lead (1st) to Lie (N-th)
  const colStep = sheetW / (N + 1);

  // Draw place column grid guidelines
  ctx.strokeStyle = colorPanel2;
  ctx.lineWidth = 1;
  for (let c = 1; c <= N; c++) {
    const cx = sheetX + c * colStep;
    ctx.beginPath();
    ctx.moveTo(cx, gridTop);
    ctx.lineTo(cx, gridBottom);
    ctx.stroke();

    // Place labels at top
    ctx.font = "9px monospace";
    ctx.fillStyle = colorDim;
    ctx.textAlign = "center";
    const label = c === 1 ? "1 (Lead)" : (c === N ? `${N} (Lie)` : `${c}`);
    ctx.fillText(label, cx, gridTop - 4);
  }

  if (numRowsToDisplay > 1) {
    const rowStep = availableH / (MAX_HISTORY_ROWS);

    // Draw all bell paths softly
    for (let b = 1; b <= N; b++) {
      if (b === 1 || b === workingBell) continue; // Treble and Working bell drawn prominently below

      ctx.strokeStyle = colorLine;
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let r = 0; r < numRowsToDisplay; r++) {
        const histIdx = (historyHead - numRowsToDisplay + r + MAX_HISTORY_ROWS) % MAX_HISTORY_ROWS;
        const rowOffset = histIdx * MAX_BELLS;
        // Find position of bell b in this row
        let posOfBell = 0;
        for (let p = 0; p < N; p++) {
          if (historyRows[rowOffset + p] === b) {
            posOfBell = p + 1;
            break;
          }
        }
        const px = sheetX + posOfBell * colStep;
        const py = gridTop + r * rowStep;
        if (r === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // 1. Draw TREBLE line in RED (Centuries-old Campanology Convention)
    ctx.strokeStyle = colorErr;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let r = 0; r < numRowsToDisplay; r++) {
      const histIdx = (historyHead - numRowsToDisplay + r + MAX_HISTORY_ROWS) % MAX_HISTORY_ROWS;
      const rowOffset = histIdx * MAX_BELLS;
      let posOfTreble = 1;
      for (let p = 0; p < N; p++) {
        if (historyRows[rowOffset + p] === 1) {
          posOfTreble = p + 1;
          break;
        }
      }
      const px = sheetX + posOfTreble * colStep;
      const py = gridTop + r * rowStep;
      if (r === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // 2. Draw THE BLUE LINE for the selected WORKING BELL
    ctx.strokeStyle = colorAccent;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let r = 0; r < numRowsToDisplay; r++) {
      const histIdx = (historyHead - numRowsToDisplay + r + MAX_HISTORY_ROWS) % MAX_HISTORY_ROWS;
      const rowOffset = histIdx * MAX_BELLS;
      let posOfWorking = workingBell;
      for (let p = 0; p < N; p++) {
        if (historyRows[rowOffset + p] === workingBell) {
          posOfWorking = p + 1;
          break;
        }
      }
      const px = sheetX + posOfWorking * colStep;
      const py = gridTop + r * rowStep;
      if (r === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Draw current active row playhead line at latest row
    const latestY = gridTop + (numRowsToDisplay - 1) * rowStep;
    ctx.strokeStyle = colorFg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sheetX + colStep, latestY);
    ctx.lineTo(sheetX + N * colStep, latestY);
    ctx.stroke();

    // Draw active strike dot on current striking bell position
    if (isRunning && currentStrikePos < N) {
      const activeX = sheetX + (currentStrikePos + 1) * colStep;
      ctx.fillStyle = colorAccent;
      ctx.beginPath();
      ctx.arc(activeX, latestY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Restore alignment defaults
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Main animation frame callback for rendering and simulation progression.
 */
function animationTick(now) {
  if (!lastFrameTime) lastFrameTime = now;
  const deltaTime = Math.min(100, now - lastFrameTime);
  lastFrameTime = now;

  if (isRunning) {
    stepSimulation(deltaTime);
  }

  renderCanvas();
  animFrameId = requestAnimationFrame(animationTick);
}

/**
 * Generator Function Contract: generateChangesBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateChangesBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const stage = Math.max(MIN_BELLS, Math.min(MAX_BELLS, Number(stateObj?.changesStage) || currentStage));
  const method = stateObj?.changesMethod || currentMethod;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const simRow = new Uint8Array(MAX_BELLS);
  const useCurrentRow = (stage === currentStage);
  for (let i = 0; i < stage; i++) {
    if (stateObj?.currentRow && stateObj.currentRow[i] <= stage) {
      simRow[i] = stateObj.currentRow[i];
    } else if (useCurrentRow && currentRow[i] <= stage && currentRow[i] >= 1) {
      simRow[i] = currentRow[i];
    } else {
      simRow[i] = i + 1;
    }
  }

  const steps = [];
  let simLead = 0;
  let simStroke = 0;
  let simPosInRow = 0;

  for (let s = 0; s < seqLen; s++) {
    const bellNumber = simRow[simPosInRow];
    const note = getBellNote(bellNumber, stage);
    const weightRatio = bellNumber / stage;
    const vel = Math.max(30, Math.min(127, Math.round(90 * (0.85 + 0.3 * weightRatio))));

    steps.push({
      note,
      vel,
      gate: 1,
      accent: bellNumber === 1 || bellNumber === stage ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "changes",
      bell: bellNumber,
      place: simPosInRow + 1
    });

    simPosInRow++;
    if (simPosInRow >= stage) {
      simPosInRow = 0;
      simStroke = simStroke === 0 ? 1 : 0;

      // Advance permutation
      let notation = "x";
      if (method === "plain_hunt") {
        const isOdd = stage % 2 !== 0;
        notation = isOdd ? (simLead % 2 === 0 ? "x" : "1") : (simLead % 2 === 0 ? "x" : `1${stage}`);
      } else if (method === "plain_bob") {
        const leadLen = stage * 2;
        const posInLead = simLead % leadLen;
        notation = (posInLead === leadLen - 1) ? "12" : (posInLead % 2 === 0 ? "x" : `1${stage}`);
      } else if (method === "grandsire") {
        notation = (simLead % 2 === 0) ? "3" : "1";
      } else if (method === "stedman") {
        const sted = ["3", "1", "x", "3", "1", "3"];
        notation = sted[simLead % 6];
      }
      simLead++;

      const next = applyPlaceNotation(simRow, notation, stage);
      for (let i = 0; i < stage; i++) simRow[i] = next[i];
    }
  }

  return [
    {
      length: seqLen,
      rate: rateIdx,
      steps
    }
  ];
}

/**
 * Handle direct canvas interaction (click to select working bell; Shift-click to swap adjacent bells).
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const splitX = Math.floor(canvas.width * 0.46);

    // Left side: Belfry Wheel interaction
    if (clickX <= splitX) {
      const centerX = splitX / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(centerX, centerY) - 36;
      const N = currentStage;

      for (let pos = 0; pos < N; pos++) {
        const theta = -Math.PI / 2 + (pos * (Math.PI * 2) / N);
        const bx = centerX + Math.cos(theta) * radius;
        const by = centerY + Math.sin(theta) * radius;
        const dist = Math.hypot(clickX - bx, clickY - by);

        if (dist <= 22) {
          const clickedBell = currentRow[pos];
          if (e.shiftKey) {
            // Shift-click: Call change swap with adjacent bell!
            const nextPos = (pos + 1) % N;
            swapAdjacentBells(pos, nextPos);
            status(`Call Change: swapped bell ${clickedBell} and ${currentRow[pos]}`);
          } else {
            // Normal click: set as Blue Line working bell
            setState({ changesSelectedBell: clickedBell });
            status(`Working Bell: Bell #${clickedBell} (Blue Line)`);
          }
          renderCanvas();
          return;
        }
      }
    }
  });
}

/**
 * Model activation lifecycle hook (called from rack.js / modes.js onEnterModel).
 */
export function activateChangesModel() {
  isRunning = true;
  lastFrameTime = performance.now();
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(animationTick);
  }
  status("Changes campanology engine active");
}

/**
 * Model deactivation lifecycle hook (called when switching away from Changes).
 */
export function deactivateChangesModel() {
  isRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  releasePolyVoices();
}

/**
 * Initialize DOM UI layout, controls, parameters, and canvas for Changes model.
 */
export function initChanges() {
  container = document.getElementById("model-changes");
  if (!container) return;

  // Build model container UI following flat workbench aesthetic
  container.innerHTML = `
    <div class="layout">
      <div class="module">
        <div class="rack" id="changes-controls-rack"></div>
      </div>
      <div class="display">
        <h2>Campanology · Change Ringing <small id="changes-info">Belfry Wheel & Method Blue Line</small></h2>
        <canvas id="changes-canvas" class="wave" width="800" height="340" style="height: 340px; cursor: pointer;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("changes-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
    setupCanvasInteraction();
  }

  // Register state defaults
  if (state.changesStage === undefined) state.changesStage = 8;
  if (state.changesMethod === undefined) state.changesMethod = "plain_bob";
  if (state.changesRate === undefined) state.changesRate = 160;
  if (state.changesOpenLead === undefined) state.changesOpenLead = 50;
  if (state.changesSelectedBell === undefined) state.changesSelectedBell = 2;
  if (state.changesVelocity === undefined) state.changesVelocity = 96;
  if (state.changesSwing === undefined) state.changesSwing = 5;

  currentStage = Number(state.changesStage) || 8;
  currentMethod = state.changesMethod || "plain_bob";
  resetToRounds(currentStage);

  // Mount controls rack
  const rackEl = document.getElementById("changes-controls-rack");
  if (rackEl) {
    // 1. Stage dropdown (Minimus 4 to Major 8)
    const stageDropdown = dropdown({
      label: "STG",
      options: STAGES.map(s => ({ value: s.v, label: s.t })),
      value: state.changesStage,
      onChange: (val) => {
        const stg = Number(val);
        setState({ changesStage: stg });
        resetToRounds(stg);
        renderCanvas();
        scheduleRegen();
      }
    });
    rackEl.appendChild(stageDropdown);

    // 2. Method dropdown
    const methodDropdown = dropdown({
      label: "METH",
      options: METHODS.map(m => ({ value: m.v, label: m.t })),
      value: state.changesMethod,
      onChange: (val) => {
        currentMethod = val;
        setState({ changesMethod: val });
        leadIndex = 0;
        renderCanvas();
        scheduleRegen();
      }
    });
    rackEl.appendChild(methodDropdown);

    // 3. Strike Rate knob (ms)
    const rateKnob = knob({
      label: "RATE",
      min: 60,
      max: 400,
      step: 5,
      value: state.changesRate,
      unit: "ms",
      onChange: (val) => {
        setState({ changesRate: Math.round(val) });
      }
    });
    rackEl.appendChild(rateKnob);

    // 4. Open Lead pause knob (%)
    const leadPauseKnob = knob({
      label: "LEAD",
      min: 0,
      max: 150,
      step: 5,
      value: state.changesOpenLead,
      unit: "%",
      onChange: (val) => {
        setState({ changesOpenLead: Math.round(val) });
      }
    });
    rackEl.appendChild(leadPauseKnob);

    // 5. Selected working bell knob (1 to 8)
    const bellSelectKnob = knob({
      label: "BELL",
      min: 1,
      max: 8,
      step: 1,
      value: state.changesSelectedBell,
      onChange: (val) => {
        const b = Math.max(1, Math.min(currentStage, Math.round(val)));
        setState({ changesSelectedBell: b });
        renderCanvas();
      }
    });
    rackEl.appendChild(bellSelectKnob);

    // 6. Base Velocity knob
    const velKnob = knob({
      label: "VEL",
      min: 30,
      max: 127,
      step: 1,
      value: state.changesVelocity,
      onChange: (val) => {
        setState({ changesVelocity: Math.round(val) });
      }
    });
    rackEl.appendChild(velKnob);

    // 7. Swing / Rubato knob
    const swingKnob = knob({
      label: "SWNG",
      min: 0,
      max: 25,
      step: 1,
      value: state.changesSwing,
      unit: "%",
      onChange: (val) => {
        setState({ changesSwing: Math.round(val) });
      }
    });
    rackEl.appendChild(swingKnob);

    // 8. Action buttons: BOB and SINGLE calls
    const btnBob = actionBtn("BOB", () => {
      pendingCall = "bob";
      status("Conductor Call: BOB called for next lead end!");
      renderCanvas();
    });
    rackEl.appendChild(btnBob);

    const btnSingle = actionBtn("SNGL", () => {
      pendingCall = "single";
      status("Conductor Call: SINGLE called for next lead end!");
      renderCanvas();
    });
    rackEl.appendChild(btnSingle);

    // 9. Call Changes presets: ROUNDS, QUEENS, TITTUMS
    const btnRounds = actionBtn("RNDS", () => {
      applyCallPreset("rounds");
      status("Bells reset to Rounds");
      renderCanvas();
    });
    rackEl.appendChild(btnRounds);

    const btnQueens = actionBtn("QN", () => {
      applyCallPreset("queens");
      status("Call Change: Queens (Odds then Evens)");
      renderCanvas();
    });
    rackEl.appendChild(btnQueens);

    const btnTittums = actionBtn("TIT", () => {
      applyCallPreset("tittums");
      status("Call Change: Tittums (Woven)");
      renderCanvas();
    });
    rackEl.appendChild(btnTittums);
  }

  // Register model generator for SYNC mode
  setModelGenerator("changes", (st) => generateChangesBank(st));
}

// Register snapshot serialization (at module top-level for immediate registry access)
registerModel({
  id: "changes",
  version: 1,
  capture: () => ({
    currentRow: Array.from(currentRow.slice(0, currentStage)),
    stage: currentStage,
    method: currentMethod,
    stroke,
    leadIndex,
    rowCount,
    pendingCall
  }),
  restore: (snap) => {
    if (!snap) return;
    if (snap.stage) currentStage = snap.stage;
    if (snap.method) currentMethod = snap.method;
    if (snap.stroke !== undefined) stroke = snap.stroke;
    if (snap.leadIndex !== undefined) leadIndex = snap.leadIndex;
    if (snap.rowCount !== undefined) rowCount = snap.rowCount;
    if (snap.pendingCall) pendingCall = snap.pendingCall;
    if (Array.isArray(snap.currentRow)) {
      for (let i = 0; i < snap.currentRow.length; i++) {
        currentRow[i] = snap.currentRow[i];
      }
    }
    renderCanvas();
  }
});
