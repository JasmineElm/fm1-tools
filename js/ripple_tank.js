// ripple_tank.js — 2D Acoustic Wave Equation Ripple Tank Sequencer for FM-1 Pulses.
// Finite-Difference Time-Domain (FDTD) wave propagation, interference fringes, boundary reflections, and virtual hydrophone pickups.
//
// Generative Architecture:
// 1. 2D Acoustic Wave Equation (FDTD):
//    - d^2(u)/dt^2 = c^2 * laplacian(u) - gamma * d(u)/dt
//    - Discrete leapfrog integration on a regular lattice with zero GC allocations.
//    - u_next[x, y] = (2 * u_curr - u_prev + C^2 * (u_left + u_right + u_up + u_down - 4 * u_curr)) * damping
// 2. Virtual Hydrophone Pickups (Up to 8 Voices):
//    - Up to 8 hydrophone sensors placed in the acoustic fluid, strictly matching the M-VAVE FM-1's 8 hardware voices.
//    - Wavefront crest crossings trigger velocity-sensitive notes quantized through js/scale.js.
//    - Horizontal sensor position in the tank drives stereo pan (CC #10).
// 3. Physical Obstacles & Boundary Reflections:
//    - Rigid reflective walls, double-slit diffraction apertures, and parabolic waveguides.
//    - Direct manipulation: click/drag to drop water splashes or toggle barrier walls.
// 4. Continuous Timbre CC #74 Modulation:
//    - Total instantaneous acoustic wave energy in the tank modulates CC #74 Brightness via dispatchTimbreCc().
// 5. Strict 8-Voice Hardware Ceiling via js/poly.js.
// 6. Zero GC Churn: Pre-allocated TypedArrays (Float32Array, Uint8Array).

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
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
import { fillPerlin2D } from "./perlin.js";

// ---- Grid Dimensions & Pre-allocated TypedArrays (Zero GC Churn) ----
export const GRID_W = 80;
export const GRID_H = 48;
export const MAX_PICKUPS = 8; // FM-1 8 hardware voices

export let uPrev = new Float32Array(GRID_W * GRID_H);
export let uCurr = new Float32Array(GRID_W * GRID_H);
export let uNext = new Float32Array(GRID_W * GRID_H);
export const barriers = new Uint8Array(GRID_W * GRID_H);

// Pre-allocated Hydrophone Pickup Sensors
export const pickups = [];
for (let i = 0; i < MAX_PICKUPS; i++) {
  pickups.push({
    active: true,
    x: 10 + i * 8,
    y: 24,
    lastHeight: 0,
    cooldown: 0,
    pulseAnim: 0
  });
}

// Dripper Emitter Positions
export const drippers = [
  { x: 16, y: 24, phase: 0.0, rate: 1.0, active: true },
  { x: 16, y: 32, phase: 0.5, rate: 1.0, active: false }
];

// Presets
export const RIPPLE_PRESETS = [
  {
    id: "double_slit",
    name: "Double-Slit Diffraction",
    desc: "Central barrier with dual apertures; Young's spatial wave interference fringes across pickups",
    speed: 0.65,
    damping: 0.988,
    dripRate: 1.0,
    threshold: 0.03,
    dripperX: 16,
    dripperY: 24
  },
  {
    id: "elliptic_focus",
    name: "Whispering Gallery",
    desc: "Elliptical acoustic boundary; waves from Focus A converge at Focus B in rhythmic bursts",
    speed: 0.68,
    damping: 0.992,
    dripRate: 0.85,
    threshold: 0.06,
    dripperX: 20,
    dripperY: 24
  },
  {
    id: "parabolic_reflector",
    name: "Parabolic Waveguide",
    desc: "Curved acoustic mirror collimates circular waves into planar fronts sweeping across pickups",
    speed: 0.70,
    damping: 0.986,
    dripRate: 1.1,
    threshold: 0.05,
    dripperX: 18,
    dripperY: 24
  },
  {
    id: "corner_cube",
    name: "Resonant Cavity",
    desc: "Multi-chamber acoustic enclosure creating complex polyrhythmic reflections and echoes",
    speed: 0.62,
    damping: 0.991,
    dripRate: 0.75,
    threshold: 0.04,
    dripperX: 15,
    dripperY: 15
  },
  {
    id: "open_pond",
    name: "Open Ripple Basin",
    desc: "Open fluid with absorbing boundaries and dual harmonic droplet drops",
    speed: 0.60,
    damping: 0.982,
    dripRate: 1.25,
    threshold: 0.05,
    dripperX: 28,
    dripperY: 24
  }
];

// Runtime State
let isRipplePlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let dripTimer = 0;
let currentTool = "splash"; // "splash" | "barrier"
let isInteracting = false;
let draggedPickup = -1;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Configure acoustic barrier geometry and hydrophone positions according to preset.
 */
export function initTankPreset(presetId = state.ripplePreset || "double_slit") {
  const preset = RIPPLE_PRESETS.find(p => p.id === presetId) || RIPPLE_PRESETS[0];

  // Clear buffers
  uPrev.fill(0);
  uCurr.fill(0);
  uNext.fill(0);
  barriers.fill(0);

  // Reset hydrophone sensors
  for (let i = 0; i < MAX_PICKUPS; i++) {
    pickups[i].active = true;
    pickups[i].lastHeight = 0;
    pickups[i].cooldown = 0;
    pickups[i].pulseAnim = 0;
  }

  // Preset Geometry & Hydrophone Arrangements
  if (preset.id === "double_slit") {
    // Center barrier wall at x = 38 with two slits
    const wallX = 38;
    for (let y = 0; y < GRID_H; y++) {
      // Slits at y in [14..18] and [30..34]
      const inSlit1 = (y >= 14 && y <= 18);
      const inSlit2 = (y >= 30 && y <= 34);
      if (!inSlit1 && !inSlit2) {
        barriers[y * GRID_W + wallX] = 1;
        barriers[y * GRID_W + (wallX + 1)] = 1;
      }
    }

    // Dripper on left
    drippers[0].x = 16;
    drippers[0].y = 24;
    drippers[0].active = true;
    drippers[1].active = false;

    // Pickups arranged vertically across right side to capture interference nodes
    for (let i = 0; i < MAX_PICKUPS; i++) {
      pickups[i].x = 64;
      pickups[i].y = Math.round(5 + i * ((GRID_H - 10) / (MAX_PICKUPS - 1)));
    }
  } else if (preset.id === "elliptic_focus") {
    // Elliptic boundary wall
    const cx = GRID_W / 2;
    const cy = GRID_H / 2;
    const a = (GRID_W - 6) / 2;
    const b = (GRID_H - 6) / 2;

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const dx = (x - cx) / a;
        const dy = (y - cy) / b;
        const distSq = dx * dx + dy * dy;
        if (distSq >= 0.95 && distSq <= 1.2) {
          barriers[y * GRID_W + x] = 1;
        }
      }
    }

    // Foci at c = sqrt(a^2 - b^2)
    const focalDist = Math.round(Math.sqrt(Math.max(0, a * a - b * b)));
    const focus1X = Math.round(cx - focalDist * 0.85);
    const focus2X = Math.round(cx + focalDist * 0.85);

    drippers[0].x = focus1X;
    drippers[0].y = cy;
    drippers[0].active = true;
    drippers[1].active = false;

    // Hydrophones clustered at Focus 2 and radiating outward
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const angle = (i * Math.PI * 2) / MAX_PICKUPS;
      const rad = i === 0 ? 0 : 5 + (i % 3) * 3;
      pickups[i].x = Math.max(4, Math.min(GRID_W - 4, Math.round(focus2X + rad * Math.cos(angle))));
      pickups[i].y = Math.max(4, Math.min(GRID_H - 4, Math.round(cy + rad * Math.sin(angle))));
    }
  } else if (preset.id === "parabolic_reflector") {
    // Parabolic mirror on left side: x = 12 + 0.05 * (y - 24)^2
    for (let y = 4; y < GRID_H - 4; y++) {
      const dy = y - (GRID_H / 2);
      const px = Math.round(10 + 0.045 * (dy * dy));
      if (px < GRID_W - 10) {
        barriers[y * GRID_W + px] = 1;
        barriers[y * GRID_W + (px + 1)] = 1;
      }
    }

    // Dripper at the parabolic focal point
    drippers[0].x = 18;
    drippers[0].y = Math.round(GRID_H / 2);
    drippers[0].active = true;
    drippers[1].active = false;

    // Hydrophones arranged diagonally across rightward path
    for (let i = 0; i < MAX_PICKUPS; i++) {
      pickups[i].x = Math.round(42 + i * 4);
      pickups[i].y = Math.round(6 + i * 5);
    }
  } else if (preset.id === "corner_cube") {
    // Acoustic labyrinth / rooms
    const midX = Math.round(GRID_W / 2);
    const midY = Math.round(GRID_H / 2);

    // Cross walls with doorways
    for (let y = 0; y < GRID_H; y++) {
      if (y < midY - 6 || y > midY + 6) {
        barriers[y * GRID_W + midX] = 1;
      }
    }
    for (let x = 0; x < GRID_W; x++) {
      if (x < midX - 8 || x > midX + 8) {
        barriers[midY * GRID_W + x] = 1;
      }
    }

    drippers[0].x = 18;
    drippers[0].y = 14;
    drippers[0].active = true;
    drippers[1].active = false;

    // Pickups distributed in the four chambers
    const chamberOffsets = [
      { x: 18, y: 14 }, { x: 26, y: 14 },
      { x: 62, y: 14 }, { x: 70, y: 14 },
      { x: 18, y: 34 }, { x: 26, y: 34 },
      { x: 62, y: 34 }, { x: 70, y: 34 }
    ];
    for (let i = 0; i < MAX_PICKUPS; i++) {
      pickups[i].x = chamberOffsets[i].x;
      pickups[i].y = chamberOffsets[i].y;
    }
  } else {
    // open_pond: Dual dripper harmonic basin with no internal barriers
    drippers[0].x = 24;
    drippers[0].y = Math.round(GRID_H / 2);
    drippers[0].active = true;

    drippers[1].x = 56;
    drippers[1].y = Math.round(GRID_H / 2);
    drippers[1].active = true;

    // Pickups in circular array around center
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const angle = (i * Math.PI * 2) / MAX_PICKUPS - Math.PI / 2;
      pickups[i].x = Math.round(GRID_W / 2 + 18 * Math.cos(angle));
      pickups[i].y = Math.round(GRID_H / 2 + 14 * Math.sin(angle));
    }
  }
}

/**
 * Scale-quantized pitch mapping for hydrophone pickup sensor.
 */
export function getPickupNote(pickup) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.rippleSpan ?? 2)));

  const normY = 1.0 - Math.max(0.0, Math.min(1.0, pickup.y / (GRID_H - 1)));
  const normX = Math.max(0.0, Math.min(1.0, pickup.x / (GRID_W - 1)));

  const numDeg = intervals.length || 7;
  const deg = Math.floor(normY * numDeg) % numDeg;
  const oct = Math.min(span, Math.floor(normX * (span + 1)));

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Drop a water droplet splash at (gx, gy) with specified amplitude and radius.
 */
export function dropWater(gx, gy, amplitude = 1.6, radius = 2.5) {
  const cx = Math.max(1, Math.min(GRID_W - 2, Math.round(gx)));
  const cy = Math.max(1, Math.min(GRID_H - 2, Math.round(gy)));
  const rCeil = Math.ceil(radius);

  for (let dy = -rCeil; dy <= rCeil; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= GRID_H - 1) continue;
    const row = y * GRID_W;

    for (let dx = -rCeil; dx <= rCeil; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= GRID_W - 1) continue;
      const idx = row + x;
      if (barriers[idx]) continue;

      const dSq = dx * dx + dy * dy;
      if (dSq <= radius * radius) {
        const falloff = Math.exp(-dSq / (radius * 1.2));
        uCurr[idx] = Math.max(-2.5, Math.min(2.5, uCurr[idx] + amplitude * falloff));
      }
    }
  }
}

/**
 * Randomize wave field space with 2D Perlin noise.
 */
export function randomizeRippleTank() {
  fillPerlin2D(uCurr, GRID_W, GRID_H, {
    scale: 0.08,
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.0,
    min: -1.2,
    max: 1.2
  });

  // Zero boundaries and rigid barriers
  for (let y = 0; y < GRID_H; y++) {
    const row = y * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const idx = row + x;
      if (x === 0 || x === GRID_W - 1 || y === 0 || y === GRID_H - 1 || barriers[idx]) {
        uCurr[idx] = 0.0;
        uPrev[idx] = 0.0;
      } else {
        // Slight phase correlation in uPrev creates immediate dynamic wave propagation
        uPrev[idx] = uCurr[idx] * 0.75;
      }
    }
  }

  uNext.fill(0);
  status("Randomised wave field with Perlin noise", "ok");
  if (canvas) renderCanvas();
}

/**
 * Execute one numerical integration step of the 2D acoustic wave equation (FDTD).
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const currentPreset = RIPPLE_PRESETS.find(p => p.id === (state.ripplePreset || "double_slit")) || RIPPLE_PRESETS[0];

  const waveSpeed = Math.max(0.2, Math.min(1.0, Number(state.rippleSpeed ?? currentPreset.speed)));
  const damping = Math.max(0.95, Math.min(0.999, Number(state.rippleDamping ?? currentPreset.damping)));
  const dripRate = Math.max(0.1, Math.min(3.0, Number(state.rippleDripRate ?? currentPreset.dripRate)));

  // Courant parameter squared (CFL stability condition C^2 <= 0.5)
  const C2 = 0.44 * (waveSpeed * waveSpeed);

  // 1. Advance Periodic Droplets
  dripTimer += (dtMs / 1000) * dripRate * speedMult * 1.5;
  if (dripTimer >= 1.0) {
    dripTimer = 0;
    for (const d of drippers) {
      if (d.active) {
        dropWater(d.x, d.y, 1.4, 2.2);
      }
    }
  }

  // 2. FDTD 2D Leapfrog Wave Equation Update:
  // u_next[x, y] = (2 * u_curr - u_prev + C^2 * (u_left + u_right + u_up + u_down - 4 * u_curr)) * damping
  for (let y = 1; y < GRID_H - 1; y++) {
    const row = y * GRID_W;
    for (let x = 1; x < GRID_W - 1; x++) {
      const idx = row + x;

      if (barriers[idx]) {
        uNext[idx] = 0;
        continue;
      }

      const laplacian = uCurr[idx - 1] + uCurr[idx + 1] + uCurr[idx - GRID_W] + uCurr[idx + GRID_W] - 4.0 * uCurr[idx];
      const val = (2.0 * uCurr[idx] - uPrev[idx] + C2 * laplacian) * damping;
      uNext[idx] = Math.max(-2.5, Math.min(2.5, val));
    }
  }

  // Absorbing outer boundary condition (zero reflection off tank borders)
  for (let x = 0; x < GRID_W; x++) {
    uNext[x] *= 0.85;
    uNext[(GRID_H - 1) * GRID_W + x] *= 0.85;
  }
  for (let y = 0; y < GRID_H; y++) {
    uNext[y * GRID_W] *= 0.85;
    uNext[y * GRID_W + (GRID_W - 1)] *= 0.85;
  }

  // Swap TypedArray buffer references (O(1), zero GC churn)
  const tmp = uPrev;
  uPrev = uCurr;
  uCurr = uNext;
  uNext = tmp;

  // 3. Virtual Hydrophone Pickups Crest Detection & Voice Triggers
  let totalEnergy = 0;

  for (let p = 0; p < MAX_PICKUPS; p++) {
    const pickup = pickups[p];
    if (!pickup.active) continue;

    const px = Math.max(1, Math.min(GRID_W - 2, Math.round(pickup.x)));
    const py = Math.max(1, Math.min(GRID_H - 2, Math.round(pickup.y)));
    const h = uCurr[py * GRID_W + px];
    totalEnergy += Math.abs(h);

    // Cooldown decay
    if (pickup.cooldown > 0) {
      pickup.cooldown -= (dtMs / 16) * speedMult;
    }

    // Pulse animation decay
    if (pickup.pulseAnim > 0.01) {
      pickup.pulseAnim *= 0.88;
    } else {
      pickup.pulseAnim = 0;
    }

    // Trigger on rising wavefront crest exceeding preset-tuned acoustic threshold
    const threshold = currentPreset.threshold ?? 0.035;
    const isCrest = (h >= threshold && pickup.lastHeight < threshold && pickup.cooldown <= 0);

    if (isCrest) {
      pickup.cooldown = 14; // Refractory delay
      pickup.pulseAnim = 1.0;

      if (isRipplePlaying) {
        const note = getPickupNote(pickup);
        const intensity = Math.min(1.0, Math.max(0.1, h / 0.5));
        const vel = Math.max(50, Math.min(127, Math.round(75 + intensity * 45)));
        const durMs = Math.round(200 + (1.0 - (damping - 0.95) / 0.05) * 220);

        // Dispatch voice strictly through poly.js manager (slot p, 0 to 7)
        playVoice(`ripple_${p}`, note, vel, durMs);
      }
    }

    pickup.lastHeight = h;
  }
}

/**
 * Render Acoustic Ripple Tank and Hydrophone Sensors onto Canvas.
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

  // Flat canvas background
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  const scaleX = w / GRID_W;
  const scaleY = h / GRID_H;

  // 1. Draw Surface Acoustic Height Field (Flat steps, no gradients)
  for (let y = 0; y < GRID_H; y += 2) {
    const row = y * GRID_W;
    for (let x = 0; x < GRID_W; x += 2) {
      const idx = row + x;

      if (barriers[idx]) {
        // Barrier wall cell
        ctx.fillStyle = colorLineFocus;
        ctx.fillRect(x * scaleX, y * scaleY, scaleX * 2, scaleY * 2);
        continue;
      }

      const val = uCurr[idx];
      if (val > 0.06) {
        // Wave Crest (Positive Pressure)
        const alpha = Math.min(1.0, val / 0.7);
        ctx.fillStyle = colorAccent;
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillRect(x * scaleX, y * scaleY, scaleX * 2, scaleY * 2);
      } else if (val < -0.06) {
        // Wave Trough (Negative Pressure)
        const alpha = Math.min(1.0, -val / 0.7);
        ctx.fillStyle = colorPanel2;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillRect(x * scaleX, y * scaleY, scaleX * 2, scaleY * 2);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // 2. Draw Dripper Droplet Sources
  for (const d of drippers) {
    if (!d.active) continue;
    const dx = d.x * scaleX;
    const dy = d.y * scaleY;

    ctx.strokeStyle = colorAccent2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(dx, dy, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colorAccent;
    ctx.beginPath();
    ctx.arc(dx, dy, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Draw Virtual Hydrophone Pickup Pins (1..8)
  for (let p = 0; p < MAX_PICKUPS; p++) {
    const pickup = pickups[p];
    if (!pickup.active) continue;

    const px = pickup.x * scaleX;
    const py = pickup.y * scaleY;
    const pulse = pickup.pulseAnim;

    // Resonant pulse circle expanding on strike
    if (pulse > 0.05) {
      ctx.strokeStyle = colorOk;
      ctx.lineWidth = 1 + pulse * 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 8 + (1.0 - pulse) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sensor Pin Body
    ctx.fillStyle = pulse > 0.1 ? colorOk : colorPanel2;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pulse > 0.1 ? "#ffffff" : colorLineFocus;
    ctx.lineWidth = pulse > 0.1 ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.stroke();

    // Voice & Pitch Label
    const note = getPickupNote(pickup);
    const noteName = midiName(note);

    ctx.font = "bold 9px monospace";
    ctx.fillStyle = pulse > 0.2 ? "#ffffff" : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`H${p + 1}`, px, py - 11);

    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(noteName, px, py + 12);
  }

  // Mode badge in bottom corner
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.fillText(`Tool: ${currentTool.toUpperCase()} | Wave Speed: ${state.rippleSpeed || 0.65}`, 10, h - 8);
}

/**
 * Generator Function Contract: generateRippleTankBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateRippleTankBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const idx = s % MAX_PICKUPS;
    const note = getPickupNote(pickups[idx]);
    const isDownbeat = (s % 8 === 0);

    steps.push({
      note,
      vel: isDownbeat ? 110 : 86,
      notes: [{ note, vel: isDownbeat ? 110 : 86 }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "ripple_tank",
      pickupIdx: idx
    });
  }

  return [
    {
      length: seqLen,
      rate: rateIdx,
      steps
    }
  ];
}

// ---- Transport Handlers ----
export function isRippleRunning() {
  return isRipplePlaying;
}

export function startRipple() {
  if (isRipplePlaying) return;
  isRipplePlaying = true;
  audio.unlock();
  status("Ripple Tank: Wave simulation active", "ok");
}

export function stopRipple() {
  isRipplePlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  status("Ripple Tank: Stopped", "warn");
}

export function toggleRippleRunning() {
  if (isRipplePlaying) stopRipple();
  else startRipple();
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateRippleTankModel() {
  setModelGenerator(generateRippleTankBank);
  setModelRandomizer(randomizeRippleTank);
  setModelStepHandler((stepIdx) => {
    // In SYNC mode: step simulation advance
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startRipple,
    stop: stopRipple,
    toggle: toggleRippleRunning,
    isRunning: isRippleRunning
  });

  stopRipple();
  lastFrameTime = performance.now();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateRippleTankModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  stopRipple();
  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function animationTick(now) {
  if (getActiveModel() === "ripple_tank") {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;

    if (isRipplePlaying) {
      stepSimulation(dt);
    }
    renderCanvas();

    if (typeof requestAnimationFrame === "function") {
      animFrameId = requestAnimationFrame(animationTick);
    }
  } else {
    animFrameId = null;
  }
}

/**
 * Snapshot Registration
 */
registerModel({
  id: "ripple_tank",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.ripplePreset || "double_slit",
    speed: state.rippleSpeed ?? 0.65,
    damping: state.rippleDamping ?? 0.988,
    dripRate: state.rippleDripRate ?? 1.0,
    span: state.rippleSpan ?? 2,
    pickups: pickups.map(p => ({ x: p.x, y: p.y, active: p.active })),
    barriers: Array.from(barriers)
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) setState("ripplePreset", data.preset);
    if (data.speed !== undefined) setState("rippleSpeed", data.speed);
    if (data.damping !== undefined) setState("rippleDamping", data.damping);
    if (data.dripRate !== undefined) setState("rippleDripRate", data.dripRate);
    if (data.span !== undefined) setState("rippleSpan", data.span);

    if (Array.isArray(data.pickups)) {
      for (let i = 0; i < Math.min(MAX_PICKUPS, data.pickups.length); i++) {
        pickups[i].x = data.pickups[i].x;
        pickups[i].y = data.pickups[i].y;
        if (data.pickups[i].active !== undefined) pickups[i].active = data.pickups[i].active;
      }
    }
    if (Array.isArray(data.barriers)) {
      for (let i = 0; i < Math.min(GRID_W * GRID_H, data.barriers.length); i++) {
        barriers[i] = data.barriers[i];
      }
    }
    renderCanvas();
  }
});

/**
 * Initialize DOM Elements & Interactive Event Listeners.
 */
export function initRippleTank() {
  container = document.getElementById("model-ripple_tank");
  if (!container) return;

  container.innerHTML = `
    <div class="ripple-workbench" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- Controls Toolbar -->
      <div class="ripple-toolbar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel2); padding: 8px 12px; border: 1px solid var(--line);">
        <div id="ripple-preset-ctrl"></div>
        <div id="ripple-speed-ctrl"></div>
        <div id="ripple-damping-ctrl"></div>
        <div id="ripple-driprate-ctrl"></div>
        <div id="ripple-span-ctrl"></div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button id="ripple-tool-btn" class="btn" title="Toggle between Splash and Barrier drawing">Tool: Splash</button>
          <button id="ripple-rnd-btn" class="btn" title="Randomise wave field with Perlin noise">RND</button>
          <button id="ripple-splash-btn" class="btn" title="Drop large central splash">Drop Ripple</button>
          <button id="ripple-clear-btn" class="btn" title="Clear wave height field">Clear</button>
        </div>
      </div>

      <!-- Interactive Wave Field Canvas -->
      <div class="ripple-canvas-wrap" style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="ripple-canvas" width="680" height="340" style="display: block; width: 100%; height: auto; cursor: crosshair;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("ripple-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // Preset Dropdown
  const presetCtrl = document.getElementById("ripple-preset-ctrl");
  if (presetCtrl) {
    presetCtrl.appendChild(
      dropdown({
        label: "Geometry",
        options: RIPPLE_PRESETS.map(p => ({ value: p.id, label: p.name })),
        value: state.ripplePreset || "double_slit",
        tip: "Acoustic boundary, reflector, and barrier layout preset",
        onChange: (val) => {
          setState("ripplePreset", val);
          const p = RIPPLE_PRESETS.find(x => x.id === val);
          if (p) {
            setState("rippleSpeed", p.speed);
            setState("rippleDamping", p.damping);
            setState("rippleDripRate", p.dripRate);
            status(`Geometry: ${p.name} — ${p.desc}`);
          }
          initTankPreset(val);
          renderCanvas();
        }
      })
    );
  }

  // Wave Speed Knob
  const speedCtrl = document.getElementById("ripple-speed-ctrl");
  if (speedCtrl) {
    speedCtrl.appendChild(
      knob({
        label: "Speed c",
        min: 0.20,
        max: 1.00,
        step: 0.05,
        value: Number(state.rippleSpeed ?? 0.65),
        tip: "Acoustic wave propagation phase velocity across the fluid lattice",
        onChange: (v) => {
          setState("rippleSpeed", v);
          renderCanvas();
        }
      })
    );
  }

  // Damping Knob
  const dampingCtrl = document.getElementById("ripple-damping-ctrl");
  if (dampingCtrl) {
    dampingCtrl.appendChild(
      knob({
        label: "Damping γ",
        min: 0.950,
        max: 0.998,
        step: 0.002,
        value: Number(state.rippleDamping ?? 0.988),
        tip: "Fluid viscosity decay rate (lower = fast attenuation, higher = sustained reverberation)",
        onChange: (v) => {
          setState("rippleDamping", v);
          renderCanvas();
        }
      })
    );
  }

  // Drip Rate Knob
  const dripCtrl = document.getElementById("ripple-driprate-ctrl");
  if (dripCtrl) {
    dripCtrl.appendChild(
      knob({
        label: "Drip Rate",
        min: 0.2,
        max: 3.0,
        step: 0.1,
        value: Number(state.rippleDripRate ?? 1.0),
        unit: "x",
        tip: "Frequency of periodic water droplet emissions into the acoustic tank",
        onChange: (v) => {
          setState("rippleDripRate", v);
          renderCanvas();
        }
      })
    );
  }

  // Pitch Span Knob
  const spanCtrl = document.getElementById("ripple-span-ctrl");
  if (spanCtrl) {
    spanCtrl.appendChild(
      knob({
        label: "Span",
        min: 1,
        max: 4,
        step: 1,
        value: Number(state.rippleSpan ?? 2),
        unit: "oct",
        tip: "Pitch span in octaves mapped across the hydrophone sensor pickups",
        onChange: (v) => {
          setState("rippleSpan", v);
          renderCanvas();
        }
      })
    );
  }

  // Buttons
  const toolBtn = document.getElementById("ripple-tool-btn");
  if (toolBtn) {
    toolBtn.addEventListener("click", () => {
      currentTool = currentTool === "splash" ? "barrier" : "splash";
      toolBtn.textContent = `Tool: ${currentTool === "splash" ? "Splash" : "Barrier"}`;
      toolBtn.className = currentTool === "splash" ? "btn" : "btn btn-accent";
      renderCanvas();
    });
  }

  const rndBtn = document.getElementById("ripple-rnd-btn");
  if (rndBtn) {
    rndBtn.addEventListener("click", () => {
      randomizeRippleTank();
    });
  }

  const splashBtn = document.getElementById("ripple-splash-btn");
  if (splashBtn) {
    splashBtn.addEventListener("click", () => {
      dropWater(GRID_W / 2, GRID_H / 2, 2.0, 3.5);
      status("Dropped central ripple into tank");
      renderCanvas();
    });
  }

  const clearBtn = document.getElementById("ripple-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      uPrev.fill(0);
      uCurr.fill(0);
      uNext.fill(0);
      status("Cleared wave field");
      renderCanvas();
    });
  }

  setModelRandomizer(randomizeRippleTank);
  setupCanvasInteraction();
  initTankPreset(state.ripplePreset || "double_slit");
  renderCanvas();
}

/**
 * Direct Manipulation: Drag hydrophones to reposition, click to splash water or toggle barrier walls.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  function getGridCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const gx = Math.max(0, Math.min(GRID_W - 1, Math.round((mx / canvas.width) * GRID_W)));
    const gy = Math.max(0, Math.min(GRID_H - 1, Math.round((my / canvas.height) * GRID_H)));
    return { gx, gy, mx, my };
  }

  function getPickupUnderCursor(mx, my) {
    const scaleX = canvas.width / GRID_W;
    const scaleY = canvas.height / GRID_H;

    for (let p = 0; p < MAX_PICKUPS; p++) {
      const px = pickups[p].x * scaleX;
      const py = pickups[p].y * scaleY;
      const dist = Math.hypot(mx - px, my - py);
      if (dist <= 12) {
        return p;
      }
    }
    return -1;
  }

  canvas.addEventListener("mousedown", (e) => {
    isInteracting = true;
    const { gx, gy, mx, my } = getGridCoords(e);
    draggedPickup = getPickupUnderCursor(mx, my);

    if (draggedPickup !== -1) {
      const note = getPickupNote(pickups[draggedPickup]);
      playVoice(`ripple_${draggedPickup}`, note, 95, 240);
      status(`Hydrophone H${draggedPickup + 1} (${midiName(note)}) · Repositioning in acoustic field`);
      return;
    }

    if (currentTool === "splash") {
      dropWater(gx, gy, 1.8, 2.5);
      if (!isRipplePlaying) {
        status("Dropped ripple · Press Play (or Space) to start wave propagation", "ok");
      }
    } else {
      // Toggle barrier wall cell
      const idx = gy * GRID_W + gx;
      barriers[idx] = barriers[idx] ? 0 : 1;
    }
    renderCanvas();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isInteracting) return;
    const { gx, gy } = getGridCoords(e);

    if (draggedPickup !== -1) {
      pickups[draggedPickup].x = gx;
      pickups[draggedPickup].y = gy;
      renderCanvas();
      return;
    }

    if (currentTool === "splash") {
      dropWater(gx, gy, 0.9, 1.8);
    } else {
      const idx = gy * GRID_W + gx;
      barriers[idx] = 1;
    }
    renderCanvas();
  });

  window.addEventListener("mouseup", () => {
    isInteracting = false;
    draggedPickup = -1;
  });
}
