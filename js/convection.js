// convection.js — Atmospheric Rayleigh-Bénard Thermal Convection & Cloud Formation Sequencer for FM-1 Pulses.
// Boussinesq Navier-Stokes thermal convection, buoyant updrafts, dew point condensation billows, and downdrafts.
//
// Generative Architecture:
// 1. Rayleigh-Bénard Atmospheric Fluid Dynamics:
//    - Coupled 2D Boussinesq thermal advection-diffusion on a regular grid:
//      dT/dt = -(u * grad)T + kappa * laplacian(T)
//      dQ/dt = -(u * grad)Q + kappa_q * laplacian(Q)  (water vapor mixing ratio)
//      du/dt = -(u * grad)u - grad(p) + nu * laplacian(u) + buoyancy * (T - T_ambient) * j
//    - Mass conservation (div u = 0) enforced via pressure Poisson relaxation.
// 2. Microphysical Cloud Condensation & Latent Heat:
//    - When moisture Q exceeds temperature-dependent saturation Q_sat(T) in the cool upper troposphere,
//      vapor condenses into cloud droplets C, releasing latent heat and fueling explosive anvil updrafts!
// 3. Musical Mapping & Polyphonic Voices (Strict 8-Voice Hardware Ceiling):
//    - 8 thermal atmospheric probes mapped to voices 0–7.
//    - Cloud condensation events in the upper troposphere sound crystalline, resonant chime notes in high registers.
//    - Sinking cool downdrafts returning to the ground boundary sound deep grounding sub-bass pulses.
// 4. Continuous Timbre Modulation (CC #74):
//    - Total condensed cloud water mass and vertical convective heat flux drive CC #74 Brightness.
// 5. Zero GC Churn: Pre-allocated TypedArrays (Float32Array, Uint8Array).

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

// ---- Grid Dimensions & Pre-allocated Buffers (Zero GC Churn) ----
export const GRID_W = 64;
export const GRID_H = 36;
export const MAX_PROBES = 8; // FM-1 8 hardware voices limit

// Thermodynamic & Fluid Fields
export const temp = new Float32Array(GRID_W * GRID_H); // Temperature T in [0, 1]
export const tempPrev = new Float32Array(GRID_W * GRID_H);
export const vapor = new Float32Array(GRID_W * GRID_H); // Water vapor Q in [0, 1]
export const vaporPrev = new Float32Array(GRID_W * GRID_H);
export const cloud = new Float32Array(GRID_W * GRID_H); // Liquid cloud water C in [0, 1]
export const velU = new Float32Array(GRID_W * GRID_H); // Horizontal velocity
export const velV = new Float32Array(GRID_W * GRID_H); // Vertical velocity
export const velUPrev = new Float32Array(GRID_W * GRID_H);
export const velVPrev = new Float32Array(GRID_W * GRID_H);
export const pressure = new Float32Array(GRID_W * GRID_H);
export const divergence = new Float32Array(GRID_W * GRID_H);

// Pre-allocated Atmospheric Probes
export const probes = [];
for (let i = 0; i < MAX_PROBES; i++) {
  probes.push({
    active: true,
    x: 4 + i * 8,
    y: i < 5 ? 26 : 6, // 5 upper cloud probes, 3 lower downdraft probes
    lastCloud: 0,
    lastV: 0,
    cooldown: 0,
    pulseAnim: 0,
    role: i < 5 ? "cloud" : "downdraft"
  });
}

// Convection Presets
export const CONVECTION_PRESETS = [
  {
    id: "cumulus_rolls",
    name: "Bénard Convection Rolls",
    desc: "Counter-rotating convective rolls forming parallel streets of fluffy cumulus clouds",
    ra: 1.2,
    groundTemp: 0.95,
    humidity: 0.75,
    dewPoint: 0.45
  },
  {
    id: "thunderhead",
    name: "Explosive Thunderhead",
    desc: "Intense ground heating and moisture fueling a towering anvil updraft with massive chord bursts",
    ra: 2.2,
    groundTemp: 1.15,
    humidity: 0.95,
    dewPoint: 0.38
  },
  {
    id: "katabatic",
    name: "Katabatic Downdrafts",
    desc: "Cold mountain downdrafts alternating with warm updrafts in high-chime & sub-bass counterpoint",
    ra: 1.5,
    groundTemp: 0.85,
    humidity: 0.65,
    dewPoint: 0.50
  },
  {
    id: "metastable_mist",
    name: "Radiation Inversion",
    desc: "Stable boundary layer that intermittently erupts into delicate morning thermal plumes",
    ra: 0.85,
    groundTemp: 0.70,
    humidity: 0.85,
    dewPoint: 0.55
  },
  {
    id: "chaotic_plumes",
    name: "Turbulent Plumes",
    desc: "High Rayleigh number turbulent convection with swirling vortices and spontaneous cloudbursts",
    ra: 2.5,
    groundTemp: 1.20,
    humidity: 0.80,
    dewPoint: 0.42
  }
];

// Runtime State
let isConvectionPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let draggedProbe = -1;
let totalCloudMass = 0;
let meanHeatFlux = 0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Configure temperature lapse rate, moisture, and probe positions according to preset.
 */
export function initConvectionPreset(presetId = state.convectPreset || "cumulus_rolls") {
  const preset = CONVECTION_PRESETS.find(p => p.id === presetId) || CONVECTION_PRESETS[0];

  velU.fill(0);
  velV.fill(0);
  velUPrev.fill(0);
  velVPrev.fill(0);
  pressure.fill(0);
  divergence.fill(0);
  cloud.fill(0);

  const tGround = Number(state.convectGroundTemp ?? preset.groundTemp);
  const tTop = 0.15;
  const humidity = Number(state.convectHumidity ?? preset.humidity);

  // Initialize vertical temperature lapse rate and moisture
  for (let y = 0; y < GRID_H; y++) {
    const normY = y / (GRID_H - 1); // 0 at bottom (ground), 1 at top (troposphere)
    const baseT = tGround * (1.0 - normY) + tTop * normY;

    for (let x = 0; x < GRID_W; x++) {
      const idx = y * GRID_W + x;
      // Small horizontal perturbation to trigger Rayleigh-Bénard roll instability
      const pert = 0.08 * Math.sin((x / GRID_W) * Math.PI * 4);
      temp[idx] = Math.max(0.0, Math.min(1.5, baseT + pert));
      tempPrev[idx] = temp[idx];

      // Moisture profile (highest near warm evaporating ground)
      const baseQ = humidity * (1.0 - normY * 0.7);
      vapor[idx] = Math.max(0.0, Math.min(1.2, baseQ));
      vaporPrev[idx] = vapor[idx];
    }
  }

  // Setup Probes
  for (let i = 0; i < MAX_PROBES; i++) {
    probes[i].active = true;
    probes[i].lastCloud = 0;
    probes[i].lastV = 0;
    probes[i].cooldown = 0;
    probes[i].pulseAnim = 0;

    if (preset.id === "katabatic") {
      // 4 left upper probes, 4 right lower probes
      if (i < 4) {
        probes[i].x = Math.round(6 + i * 10);
        probes[i].y = 28;
        probes[i].role = "cloud";
      } else {
        probes[i].x = Math.round(38 + (i - 4) * 6);
        probes[i].y = 5;
        probes[i].role = "downdraft";
      }
    } else if (preset.id === "thunderhead") {
      // Clustered across the central anvil dome
      probes[i].x = Math.round(GRID_W / 2 + (i - 3.5) * 6);
      probes[i].y = i % 2 === 0 ? 28 : 22;
      probes[i].role = "cloud";
    } else {
      // 5 upper cloud probes across top, 3 lower downdraft probes across bottom
      if (i < 5) {
        probes[i].x = Math.round(6 + i * 12);
        probes[i].y = 26;
        probes[i].role = "cloud";
      } else {
        probes[i].x = Math.round(14 + (i - 5) * 18);
        probes[i].y = 6;
        probes[i].role = "downdraft";
      }
    }
  }
}

/**
 * Scale-quantized pitch mapping for thermal cloud / downdraft probe.
 */
export function getProbeNote(probe) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.convectSpan ?? 2)));

  const normY = probe.y / (GRID_H - 1);
  const normX = probe.x / (GRID_W - 1);

  const numDeg = intervals.length || 7;
  const deg = Math.floor(normX * numDeg) % numDeg;

  // Cloud probes in upper troposphere get high octave registers; ground probes get sub-bass
  let oct = 0;
  if (probe.role === "cloud") {
    oct = Math.min(span, Math.max(1, Math.floor(normY * span) + 1));
  } else {
    oct = 0; // Grounding sub-bass
  }

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Inject localized thermal hot spot or cold air parcel.
 */
export function injectThermalPlume(gx, gy, tempDelta = 0.6, radius = 4) {
  const cx = Math.max(2, Math.min(GRID_W - 3, Math.round(gx)));
  const cy = Math.max(1, Math.min(GRID_H - 2, Math.round(gy)));
  const rCeil = Math.ceil(radius);

  for (let dy = -rCeil; dy <= rCeil; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= GRID_H) continue;
    const row = y * GRID_W;

    for (let dx = -rCeil; dx <= rCeil; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= GRID_W) continue;
      const idx = row + x;

      const dSq = dx * dx + dy * dy;
      if (dSq <= radius * radius) {
        const falloff = Math.exp(-dSq / (radius * 1.5));
        temp[idx] = Math.max(0.0, Math.min(2.0, temp[idx] + tempDelta * falloff));
        // Also inject extra vapor with warm thermal plumes
        if (tempDelta > 0) {
          vapor[idx] = Math.max(0.0, Math.min(1.5, vapor[idx] + 0.3 * falloff));
        }
      }
    }
  }
}

/**
 * Randomize atmospheric thermodynamic and vapor fields with 2D Perlin noise.
 * Generates organic thermal plumes, moisture clouds, and gentle circulation seeds.
 */
export function randomizeConvection() {
  const currentPreset = CONVECTION_PRESETS.find(p => p.id === (state.convectPreset || "cumulus_rolls")) || CONVECTION_PRESETS[0];
  const tGround = Number(state.convectGroundTemp ?? currentPreset.groundTemp);
  const tTop = 0.15;
  const humidity = Number(state.convectHumidity ?? currentPreset.humidity);

  // Generate 2D Perlin perturbation into temp buffer
  fillPerlin2D(temp, GRID_W, GRID_H, {
    scale: 0.1,
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.0,
    min: -0.35,
    max: 0.55
  });

  // Generate 2D Perlin vapor pockets
  fillPerlin2D(vapor, GRID_W, GRID_H, {
    scale: 0.12,
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2.0,
    min: -0.25,
    max: 0.45
  });

  for (let y = 0; y < GRID_H; y++) {
    const normY = y / (GRID_H - 1);
    const baseT = tGround * (1.0 - normY) + tTop * normY;
    const baseQ = humidity * (1.0 - normY * 0.7);

    for (let x = 0; x < GRID_W; x++) {
      const idx = y * GRID_W + x;

      // Add base temperature lapse profile to Perlin perturbation
      const t = baseT + temp[idx];
      temp[idx] = Math.max(0.05, Math.min(2.0, t));
      tempPrev[idx] = temp[idx];

      // Add base humidity to Perlin moisture pockets
      const q = baseQ + vapor[idx];
      vapor[idx] = Math.max(0.0, Math.min(1.5, q));
      vaporPrev[idx] = vapor[idx];
    }
  }

  // Clear existing condensates and fluid velocities
  cloud.fill(0);
  velU.fill(0);
  velV.fill(0);
  velUPrev.fill(0);
  velVPrev.fill(0);
  pressure.fill(0);
  divergence.fill(0);

  status("Randomised atmospheric thermodynamic fields with Perlin noise", "ok");
  if (canvas) renderCanvas();
}

/**
 * Bilinear sampling helper for semi-Lagrangian fluid advection.
 */
function sampleBilinear(field, x, y) {
  const fx = Math.max(0, Math.min(GRID_W - 1.001, x));
  const fy = Math.max(0, Math.min(GRID_H - 1.001, y));

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(GRID_W - 1, x0 + 1);
  const y1 = Math.min(GRID_H - 1, y0 + 1);

  const wx1 = fx - x0;
  const wx0 = 1.0 - wx1;
  const wy1 = fy - y0;
  const wy0 = 1.0 - wy1;

  return (
    field[y0 * GRID_W + x0] * wx0 * wy0 +
    field[y0 * GRID_W + x1] * wx1 * wy0 +
    field[y1 * GRID_W + x0] * wx0 * wy1 +
    field[y1 * GRID_W + x1] * wx1 * wy1
  );
}

/**
 * Execute one numerical integration step of the Rayleigh-Bénard thermal convection simulation.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const effectiveDt = (dtMs / 1000) * speedMult * 1.8;

  const currentPreset = CONVECTION_PRESETS.find(p => p.id === (state.convectPreset || "cumulus_rolls")) || CONVECTION_PRESETS[0];
  const ra = Math.max(0.5, Math.min(3.5, Number(state.convectRa ?? currentPreset.ra)));
  const tGround = Number(state.convectGroundTemp ?? currentPreset.groundTemp);
  const dewThreshold = Math.max(0.2, Math.min(0.8, Number(state.convectDewPoint ?? currentPreset.dewPoint)));

  // Copy current states to previous buffers
  velUPrev.set(velU);
  velVPrev.set(velV);
  tempPrev.set(temp);
  vaporPrev.set(vapor);

  // 1. Buoyancy & Thermal Forcing:
  // F_buoy = ra * (T - T_ambient), upward acceleration
  for (let y = 0; y < GRID_H; y++) {
    const normY = y / (GRID_H - 1);
    const ambientT = tGround * (1.0 - normY) + 0.15 * normY;
    const row = y * GRID_W;

    for (let x = 0; x < GRID_W; x++) {
      const idx = row + x;
      const buoyancy = ra * (tempPrev[idx] - ambientT) * 1.8;
      // Negative drag / gravity if heavy liquid cloud droplets accumulate
      const cloudDrag = cloud[idx] * 0.8;
      velV[idx] += (buoyancy - cloudDrag) * effectiveDt;
    }
  }

  // 2. Semi-Lagrangian Advection of Velocity Field
  for (let y = 1; y < GRID_H - 1; y++) {
    const row = y * GRID_W;
    for (let x = 1; x < GRID_W - 1; x++) {
      const idx = row + x;
      const prevX = x - velUPrev[idx] * effectiveDt * 20.0;
      const prevY = y - velVPrev[idx] * effectiveDt * 20.0;

      velU[idx] = sampleBilinear(velUPrev, prevX, prevY) * 0.985;
      velV[idx] = sampleBilinear(velVPrev, prevX, prevY) * 0.985;
    }
  }

  // 3. Pressure Poisson Projection to Enforce Incompressibility (div u = 0)
  for (let y = 1; y < GRID_H - 1; y++) {
    const row = y * GRID_W;
    for (let x = 1; x < GRID_W - 1; x++) {
      const idx = row + x;
      divergence[idx] = -0.5 * (velU[idx + 1] - velU[idx - 1] + velV[idx + GRID_W] - velV[idx - GRID_W]);
      pressure[idx] = 0;
    }
  }

  // Jacobi iterations for pressure
  for (let iter = 0; iter < 4; iter++) {
    for (let y = 1; y < GRID_H - 1; y++) {
      const row = y * GRID_W;
      for (let x = 1; x < GRID_W - 1; x++) {
        const idx = row + x;
        pressure[idx] = (divergence[idx] + pressure[idx - 1] + pressure[idx + 1] + pressure[idx - GRID_W] + pressure[idx + GRID_W]) * 0.25;
      }
    }
  }

  // Subtract pressure gradient from velocities
  for (let y = 1; y < GRID_H - 1; y++) {
    const row = y * GRID_W;
    for (let x = 1; x < GRID_W - 1; x++) {
      const idx = row + x;
      velU[idx] -= 0.5 * (pressure[idx + 1] - pressure[idx - 1]);
      velV[idx] -= 0.5 * (pressure[idx + GRID_W] - pressure[idx - GRID_W]);
    }
  }

  // Boundary Conditions on Velocity (no-slip ground and top)
  for (let x = 0; x < GRID_W; x++) {
    velV[x] = 0;
    velV[(GRID_H - 1) * GRID_W + x] = 0;
  }

  // 4. Semi-Lagrangian Advection of Temperature & Moisture
  let sumCloud = 0;
  let sumHeatFlux = 0;

  for (let y = 0; y < GRID_H; y++) {
    const row = y * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const idx = row + x;
      const prevX = x - velU[idx] * effectiveDt * 20.0;
      const prevY = y - velV[idx] * effectiveDt * 20.0;

      temp[idx] = sampleBilinear(tempPrev, prevX, prevY);
      vapor[idx] = sampleBilinear(vaporPrev, prevX, prevY);

      // Microphysical Cloud Condensation & Evaporation
      // Saturation threshold Q_sat decreases with altitude / low temperature
      const normY = y / (GRID_H - 1);
      const satQ = dewThreshold * (0.3 + 0.7 * Math.pow(temp[idx], 1.8));

      if (vapor[idx] > satQ && normY > 0.3) {
        // Vapor condenses into cloud droplets
        const dCond = Math.min(vapor[idx] - satQ, 0.2);
        vapor[idx] -= dCond;
        cloud[idx] = Math.min(1.0, cloud[idx] + dCond * 1.5);
        // Release latent heat of condensation
        temp[idx] += dCond * 0.15;
      } else {
        // Evaporation of cloud water in dry/warm parcels
        if (cloud[idx] > 0.01) {
          cloud[idx] *= 0.94;
        } else {
          cloud[idx] = 0;
        }
      }

      sumCloud += cloud[idx];
      sumHeatFlux += velV[idx] * temp[idx];
    }
  }

  // Re-supply heat and moisture at ground plate (y = 0)
  for (let x = 0; x < GRID_W; x++) {
    temp[x] = tGround;
    vapor[x] = 0.9;
  }
  // Cooled plate at top
  for (let x = 0; x < GRID_W; x++) {
    temp[(GRID_H - 1) * GRID_W + x] = 0.12;
  }

  totalCloudMass = sumCloud / (GRID_W * GRID_H);
  meanHeatFlux = Math.max(0, sumHeatFlux / (GRID_W * GRID_H));

  // 5. Thermal Probe Sensors & Note Triggers
  for (let p = 0; p < MAX_PROBES; p++) {
    const probe = probes[p];
    if (!probe.active) continue;

    const px = Math.max(1, Math.min(GRID_W - 2, Math.round(probe.x)));
    const py = Math.max(1, Math.min(GRID_H - 2, Math.round(probe.y)));
    const idx = py * GRID_W + px;

    const curCloud = cloud[idx];
    const curV = velV[idx];

    // Cooldown decay
    if (probe.cooldown > 0) {
      probe.cooldown -= (dtMs / 16) * speedMult;
    }

    // Pulse animation decay
    if (probe.pulseAnim > 0.01) {
      probe.pulseAnim *= 0.88;
    } else {
      probe.pulseAnim = 0;
    }

    if (probe.role === "cloud") {
      // Trigger on cloud condensation onset exceeding threshold (0.15)
      const isCloudCondensation = (curCloud >= 0.15 && probe.lastCloud < 0.15 && probe.cooldown <= 0);

      if (isCloudCondensation) {
        probe.cooldown = 16;
        probe.pulseAnim = 1.0;

        if (isConvectionPlaying) {
          const note = getProbeNote(probe);
          const vel = Math.max(50, Math.min(127, Math.round(75 + Math.min(1.0, curCloud / 0.6) * 45)));
          const durMs = Math.round(180 + Math.min(1.0, curCloud) * 200);

          playVoice(`convect_${p}`, note, vel, durMs);
        }
      }
    } else {
      // Downdraft probe: triggers when cold sinking air reaches ground (v < -0.18)
      const isDowndraftHit = (curV <= -0.18 && probe.lastV > -0.18 && probe.cooldown <= 0);

      if (isDowndraftHit) {
        probe.cooldown = 18;
        probe.pulseAnim = 1.0;

        if (isConvectionPlaying) {
          const note = getProbeNote(probe); // Sub-bass register
          const vel = Math.max(60, Math.min(127, Math.round(85 + Math.min(1.0, Math.abs(curV) / 0.5) * 40)));
          const durMs = 280;

          playVoice(`convect_${p}`, note, vel, durMs);
        }
      }
    }

    probe.lastCloud = curCloud;
    probe.lastV = curV;
  }
}

/**
 * Render Atmospheric Convection, Clouds, and Probes onto the Canvas.
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

  // 1. Draw Thermal Temperature Layer (Warm ground rising, cool upper troposphere)
  for (let y = 0; y < GRID_H; y += 2) {
    const row = y * GRID_W;
    const canvasY = h - (y + 2) * scaleY; // Invert Y so ground is at bottom of canvas

    for (let x = 0; x < GRID_W; x += 2) {
      const idx = row + x;
      const t = temp[idx];

      if (t > 0.55) {
        // Buoyant warm thermal air (Warm Accent / Ok)
        const alpha = Math.min(1.0, (t - 0.55) / 0.6);
        ctx.fillStyle = colorAccent;
        ctx.globalAlpha = alpha * 0.65;
        ctx.fillRect(x * scaleX, canvasY, scaleX * 2, scaleY * 2);
      } else if (t < 0.35) {
        // Cool downdraft air
        const alpha = Math.min(1.0, (0.35 - t) / 0.35);
        ctx.fillStyle = colorPanel2;
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillRect(x * scaleX, canvasY, scaleX * 2, scaleY * 2);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // 2. Draw Condensed Cumulus Clouds (White / High Contrast Billows)
  for (let y = 0; y < GRID_H; y++) {
    const row = y * GRID_W;
    const canvasY = h - (y + 1) * scaleY;

    for (let x = 0; x < GRID_W; x++) {
      const c = cloud[row + x];
      if (c > 0.08) {
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = Math.min(1.0, c * 1.4);
        ctx.fillRect(x * scaleX, canvasY, scaleX + 0.5, scaleY + 0.5);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // 3. Ground Boundary Strip
  ctx.fillStyle = colorLineFocus;
  ctx.fillRect(0, h - 3, w, 3);

  // 4. Draw Atmospheric Probes
  for (let p = 0; p < MAX_PROBES; p++) {
    const probe = probes[p];
    if (!probe.active) continue;

    const px = probe.x * scaleX;
    const py = h - probe.y * scaleY;
    const pulse = probe.pulseAnim;
    const isCloud = probe.role === "cloud";

    // Resonant pulse circle expanding on strike
    if (pulse > 0.05) {
      ctx.strokeStyle = isCloud ? colorOk : colorAccent;
      ctx.lineWidth = 1 + pulse * 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 8 + (1.0 - pulse) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Probe Node Body
    ctx.fillStyle = pulse > 0.1 ? (isCloud ? colorOk : colorAccent) : colorPanel2;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pulse > 0.1 ? "#ffffff" : colorLineFocus;
    ctx.lineWidth = pulse > 0.1 ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.stroke();

    // Voice & Pitch Label
    const note = getProbeNote(probe);
    const noteName = midiName(note);

    ctx.font = "bold 9px monospace";
    ctx.fillStyle = pulse > 0.2 ? "#ffffff" : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`P${p + 1}`, px, py - 11);

    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(noteName, px, py + 12);
  }

  // Status readout in corner
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.fillText(`Cloud Cover: ${(totalCloudMass * 100).toFixed(1)}% | Updraft Flux: ${meanHeatFlux.toFixed(2)}`, 10, h - 8);
}

/**
 * Generator Function Contract: generateConvectionBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateConvectionBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const idx = s % MAX_PROBES;
    const note = getProbeNote(probes[idx]);
    const isDownbeat = (s % 8 === 0);
    const vel = isDownbeat ? 112 : 84;
    steps.push({
      note,
      vel,
      notes: [{ note, vel }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "convection",
      probeIdx: idx
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
export function isConvectionRunning() {
  return isConvectionPlaying;
}

export function startConvection() {
  if (isConvectionPlaying) return true;
  isConvectionPlaying = true;
  audio.unlock();
  status("Thermal Convection: Atmospheric simulation active", "ok");
  return true;
}

export function stopConvection() {
  isConvectionPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  status("Thermal Convection: Stopped", "warn");
  return false;
}

export function toggleConvectionRunning() {
  if (isConvectionPlaying) stopConvection();
  else startConvection();
  return isConvectionPlaying;
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateConvectionModel() {
  setModelGenerator(generateConvectionBank);
  setModelRandomizer(randomizeConvection);
  setModelStepHandler((stepIdx) => {
    // In SYNC mode: advance simulation step
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startConvection,
    stop: stopConvection,
    toggle: toggleConvectionRunning,
    isRunning: isConvectionRunning
  });

  stopConvection();
  lastFrameTime = performance.now();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateConvectionModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  stopConvection();
  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function animationTick(now) {
  if (getActiveModel() === "convection") {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;

    if (isConvectionPlaying) {
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
  id: "convection",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.convectPreset || "cumulus_rolls",
    ra: state.convectRa ?? 1.2,
    groundTemp: state.convectGroundTemp ?? 0.95,
    humidity: state.convectHumidity ?? 0.75,
    dewPoint: state.convectDewPoint ?? 0.45,
    span: state.convectSpan ?? 2,
    probes: probes.map(p => ({ x: p.x, y: p.y, active: p.active, role: p.role }))
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) setState("convectPreset", data.preset);
    if (data.ra !== undefined) setState("convectRa", data.ra);
    if (data.groundTemp !== undefined) setState("convectGroundTemp", data.groundTemp);
    if (data.humidity !== undefined) setState("convectHumidity", data.humidity);
    if (data.dewPoint !== undefined) setState("convectDewPoint", data.dewPoint);
    if (data.span !== undefined) setState("convectSpan", data.span);

    if (Array.isArray(data.probes)) {
      for (let i = 0; i < Math.min(MAX_PROBES, data.probes.length); i++) {
        probes[i].x = data.probes[i].x;
        probes[i].y = data.probes[i].y;
        if (data.probes[i].active !== undefined) probes[i].active = data.probes[i].active;
        if (data.probes[i].role) probes[i].role = data.probes[i].role;
      }
    }
    renderCanvas();
  }
});

/**
 * Initialize DOM Elements & Interactive Event Listeners.
 */
export function initConvection() {
  container = document.getElementById("model-convection");
  if (!container) return;

  container.innerHTML = `
    <div class="convect-workbench" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- Controls Toolbar -->
      <div class="convect-toolbar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel2); padding: 8px 12px; border: 1px solid var(--line);">
        <div id="convect-preset-ctrl"></div>
        <div id="convect-ra-ctrl"></div>
        <div id="convect-temp-ctrl"></div>
        <div id="convect-hum-ctrl"></div>
        <div id="convect-dew-ctrl"></div>
        <div id="convect-span-ctrl"></div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button id="convect-plume-btn" class="btn" title="Inject buoyant thermal plume from ground">Inject Plume</button>
          <button id="convect-rnd-btn" class="btn" title="Randomise atmospheric fields with Perlin noise">RND</button>
          <button id="convect-clear-btn" class="btn" title="Clear clouds and calm fluid">Clear Clouds</button>
        </div>
      </div>

      <!-- Interactive Atmospheric Field Canvas -->
      <div class="convect-canvas-wrap" style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="convect-canvas" width="680" height="340" style="display: block; width: 100%; height: auto; cursor: crosshair;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("convect-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // Preset Dropdown
  const presetCtrl = document.getElementById("convect-preset-ctrl");
  if (presetCtrl) {
    presetCtrl.appendChild(
      dropdown({
        label: "Regime",
        tip: "Convective circulation regime preset (Bénard rolls, thunderheads, mist)",
        options: CONVECTION_PRESETS.map(p => ({ value: p.id, label: p.name })),
        value: state.convectPreset || "cumulus_rolls",
        onChange: (val) => {
          setState("convectPreset", val);
          const p = CONVECTION_PRESETS.find(x => x.id === val);
          if (p) {
            setState("convectRa", p.ra);
            setState("convectGroundTemp", p.groundTemp);
            setState("convectHumidity", p.humidity);
            setState("convectDewPoint", p.dewPoint);
            status(`Regime: ${p.name} — ${p.desc}`);
          }
          initConvectionPreset(val);
          renderCanvas();
        }
      })
    );
  }

  // Rayleigh Buoyancy Knob
  const raCtrl = document.getElementById("convect-ra-ctrl");
  if (raCtrl) {
    raCtrl.appendChild(
      knob({
        label: "Buoyancy Ra",
        tip: "Rayleigh buoyancy acceleration driving warm updrafts and convective overturning",
        min: 0.5,
        max: 3.5,
        step: 0.1,
        value: Number(state.convectRa ?? 1.2),
        onChange: (v) => {
          setState("convectRa", v);
          renderCanvas();
        }
      })
    );
  }

  // Ground Temperature Knob
  const tempCtrl = document.getElementById("convect-temp-ctrl");
  if (tempCtrl) {
    tempCtrl.appendChild(
      knob({
        label: "Ground T",
        tip: "Surface plate heating temperature driving thermal bubble generation",
        min: 0.5,
        max: 1.5,
        step: 0.05,
        value: Number(state.convectGroundTemp ?? 0.95),
        onChange: (v) => {
          setState("convectGroundTemp", v);
          renderCanvas();
        }
      })
    );
  }

  // Humidity Knob
  const humCtrl = document.getElementById("convect-hum-ctrl");
  if (humCtrl) {
    humCtrl.appendChild(
      knob({
        label: "Humidity Q",
        tip: "Ambient tropospheric moisture available for cloud condensation",
        min: 0.3,
        max: 1.0,
        step: 0.05,
        value: Number(state.convectHumidity ?? 0.75),
        onChange: (v) => {
          setState("convectHumidity", v);
          renderCanvas();
        }
      })
    );
  }

  // Dew Point Saturation Threshold Knob
  const dewCtrl = document.getElementById("convect-dew-ctrl");
  if (dewCtrl) {
    dewCtrl.appendChild(
      knob({
        label: "Dew Point",
        tip: "Thermodynamic saturation threshold where vapor condenses into clouds and triggers notes",
        min: 0.20,
        max: 0.70,
        step: 0.05,
        value: Number(state.convectDewPoint ?? 0.45),
        onChange: (v) => {
          setState("convectDewPoint", v);
          renderCanvas();
        }
      })
    );
  }

  // Pitch Span Knob
  const spanCtrl = document.getElementById("convect-span-ctrl");
  if (spanCtrl) {
    spanCtrl.appendChild(
      knob({
        label: "Span",
        tip: "Pitch span in octaves mapped across the vertical atmospheric column",
        min: 1,
        max: 4,
        step: 1,
        value: Number(state.convectSpan ?? 2),
        unit: "oct",
        onChange: (v) => {
          setState("convectSpan", v);
          renderCanvas();
        }
      })
    );
  }

  // Buttons
  const plumeBtn = document.getElementById("convect-plume-btn");
  if (plumeBtn) {
    plumeBtn.addEventListener("click", () => {
      injectThermalPlume(GRID_W / 2, 2, 1.2, 5);
      status("Injected powerful thermal plume from ground plate");
      renderCanvas();
    });
  }

  const rndBtn = document.getElementById("convect-rnd-btn");
  if (rndBtn) {
    rndBtn.addEventListener("click", () => {
      randomizeConvection();
    });
  }

  const clearBtn = document.getElementById("convect-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      cloud.fill(0);
      velU.fill(0);
      velV.fill(0);
      status("Cleared clouds and calmed atmospheric circulation");
      renderCanvas();
    });
  }

  setModelRandomizer(randomizeConvection);

  setupCanvasInteraction();
  initConvectionPreset(state.convectPreset || "cumulus_rolls");
  renderCanvas();
}

/**
 * Direct Manipulation: Drag probes to reposition, click to inject hot updrafts or cold downdrafts.
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
    // Invert Y coordinate so ground is at bottom
    const gy = Math.max(0, Math.min(GRID_H - 1, Math.round((1.0 - my / canvas.height) * (GRID_H - 1))));
    return { gx, gy, mx, my };
  }

  function getProbeUnderCursor(mx, my) {
    const scaleX = canvas.width / GRID_W;
    const scaleY = canvas.height / GRID_H;

    for (let p = 0; p < MAX_PROBES; p++) {
      const px = probes[p].x * scaleX;
      const py = canvas.height - probes[p].y * scaleY;
      const dist = Math.hypot(mx - px, my - py);
      if (dist <= 12) {
        return p;
      }
    }
    return -1;
  }

  let isPointerDown = false;

  canvas.addEventListener("mousedown", (e) => {
    isPointerDown = true;
    const { gx, gy, mx, my } = getGridCoords(e);
    draggedProbe = getProbeUnderCursor(mx, my);

    if (draggedProbe !== -1) {
      status(`Repositioning Atmospheric Probe P${draggedProbe + 1}`);
      return;
    }

    // Click in lower half injects warm updraft plume; upper half injects cool downdraft
    const delta = gy < GRID_H / 2 ? 0.75 : -0.55;
    injectThermalPlume(gx, gy, delta, 4);
    renderCanvas();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPointerDown) return;
    const { gx, gy } = getGridCoords(e);

    if (draggedProbe !== -1) {
      probes[draggedProbe].x = gx;
      probes[draggedProbe].y = gy;
      probes[draggedProbe].role = gy >= GRID_H / 2 ? "cloud" : "downdraft";
      renderCanvas();
      return;
    }

    const delta = gy < GRID_H / 2 ? 0.45 : -0.35;
    injectThermalPlume(gx, gy, delta, 3);
    renderCanvas();
  });

  window.addEventListener("mouseup", () => {
    isPointerDown = false;
    draggedProbe = -1;
  });
}
