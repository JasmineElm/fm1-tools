// billiards.js — Ballistic Billiards Hamiltonian Geometric Chaos Sequencer for FM-1 Pulses.
// Models continuous specular ray reflections and ergodic trajectories within mathematical billiard tables.
//
// Generative Architecture:
// 1. Classical Hamiltonian Dynamical Billiards (Bunimovich Stadium, Sinai Dispersing Billiard, Confocal Ellipse, Cardioid, Polygonal Wedge).
// 2. Specular elastic boundary reflections (v' = v - 2(v · n)n) with optional magnetic Lorentz/Larmor spin curvature.
// 3. Multi-ball polyphony: up to 8 simultaneous balls strictly respecting the M-VAVE FM-1 8-voice hardware ceiling.
// 4. Boundary collision triggers: impact point maps to scale degree, normal impulse maps to velocity, flight path maps to gate.
// 5. Zero GC churn with pre-allocated TypedArray buffers for state, trajectory trails, and spark ripples.
// 6. Direct manipulation slingshot interaction and flat workbench aesthetic.

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
  computeOctaveShift, quantize, createNotesSection
} from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { selectPolyVoices, playVoice, releasePolyVoices, getActiveVoiceCount } from "./poly.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

export const MAX_BODIES = 8;
export const MAX_VOICES = 8;

export const BILLIARDS_PRESETS = [
  {
    id: "stadium",
    name: "Bunimovich Stadium",
    kicker: "Ergodic Chaos · Defocusing Mechanism",
    desc: "Two parallel straight walls joined by semicircular caps. Proven by Leonid Bunimovich (1979) to produce uniform hyperbolic chaos with a positive Lyapunov exponent.",
    balls: 3,
    speed: 1.0,
    spin: 0.0,
    damp: 0.0
  },
  {
    id: "sinai",
    name: "Sinai Scatterer",
    kicker: "Convex Dispersing · Hyperbolic Chaos",
    desc: "A square boundary enclosure with a central circular disk scatterer. Yakov Sinai (1970) proved this creates continuous exponential divergence of nearby trajectories.",
    balls: 3,
    speed: 1.1,
    spin: 0.0,
    damp: 0.0
  },
  {
    id: "ellipse",
    name: "Confocal Ellipse",
    kicker: "Integrable Orbits · Elliptic Caustics",
    desc: "Smooth elliptical boundary conserving angular momentum relative to the two foci. Produces whispering gallery caustics and harmonic Lissajous-like pitch contours.",
    balls: 3,
    speed: 0.9,
    spin: 0.0,
    damp: 0.0
  },
  {
    id: "cardioid",
    name: "Robnik Cardioid",
    kicker: "Mixed Phase Space · KAM Islands",
    desc: "Heart-shaped cardioid boundary with a sharp indentation cusp. Features mixed dynamics with Kolmogorov-Arnold-Moser (KAM) stability islands in a chaotic sea.",
    balls: 2,
    speed: 1.0,
    spin: 0.15,
    damp: 0.0
  },
  {
    id: "wedge",
    name: "Polygonal Wedge",
    kicker: "Rational Triangle · Pseudo-Integrable",
    desc: "A triangular wedge table. Trajectories unfold onto flat higher-genus translation surfaces, producing intricate multi-bounce periodic windings and polyrhythmic arpeggios.",
    balls: 3,
    speed: 1.0,
    spin: 0.0,
    damp: 0.0
  }
];

// Color palette for the 8 billiard balls
export const BALL_COLORS = [
  "#00f0ff", // Ball 1: Cyan
  "#ff007f", // Ball 2: Pink
  "#ffb700", // Ball 3: Amber
  "#39ff14", // Ball 4: Lime
  "#a855f7", // Ball 5: Violet
  "#38bdf8", // Ball 6: Sky
  "#f43f5e", // Ball 7: Rose
  "#eab308"  // Ball 8: Gold
];

// Pre-allocated TypedArray Buffers (Zero GC Churn)
export const posX = new Float32Array(MAX_BODIES);
export const posY = new Float32Array(MAX_BODIES);
export const velX = new Float32Array(MAX_BODIES);
export const velY = new Float32Array(MAX_BODIES);
export const prevPosX = new Float32Array(MAX_BODIES);
export const prevPosY = new Float32Array(MAX_BODIES);
export const ballRadius = new Float32Array(MAX_BODIES);
export const flightDist = new Float32Array(MAX_BODIES);

// Trail ring buffer (32 points per ball)
export const TRAIL_LEN = 32;
export const trailX = new Float32Array(MAX_BODIES * TRAIL_LEN);
export const trailY = new Float32Array(MAX_BODIES * TRAIL_LEN);
export const trailHead = new Int32Array(MAX_BODIES);
export const trailCount = new Int32Array(MAX_BODIES);

// Impact ripple / flash animations
export const sparkX = new Float32Array(MAX_BODIES);
export const sparkY = new Float32Array(MAX_BODIES);
export const sparkLife = new Float32Array(MAX_BODIES); // [0..1]
export const sparkNote = new Array(MAX_BODIES).fill("");

let isBilliardsPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let isSlinging = false;
let slingStartX = 0;
let slingStartY = 0;
let slingCurX = 0;
let slingCurY = 0;
let selectedBallIndex = 0;

// UI DOM references
let billiardsContainer = null;
let canvasEl = null;
let ctx = null;
let presetSelectEl = null;
let ballsCountBadge = null;
let hudElement = null;

export function isBilliardsRunning() {
  return isBilliardsPlaying;
}

export function startBilliards() {
  if (isBilliardsPlaying) return;
  isBilliardsPlaying = true;
  audio.unlock();
  status("Billiards: Playing · Hamiltonian ray optics", "ok");
}

export function stopBilliards() {
  isBilliardsPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  status("stopped");
}

export function toggleBilliardsRunning() {
  if (isBilliardsPlaying) {
    stopBilliards();
    return false;
  } else {
    startBilliards();
    return true;
  }
}

/**
 * Initialize balls and velocities for a given table preset.
 */
export function initBilliardsSystem(presetOrBalls = state.billiardsPreset || "stadium", optSpeed, optPreset) {
  let presetId = presetOrBalls;
  if (typeof presetOrBalls === "number") {
    state.billiardsBalls = Math.max(1, Math.min(MAX_BODIES, presetOrBalls));
    if (typeof optSpeed === "number") state.billiardsSpeed = optSpeed;
    if (typeof optPreset === "string") presetId = optPreset;
    else presetId = state.billiardsPreset || "stadium";
  }
  const p = BILLIARDS_PRESETS.find(pr => pr.id === presetId) || BILLIARDS_PRESETS[0];
  state.billiardsPreset = p.id;
  if (state.billiardsBalls === undefined) state.billiardsBalls = p.balls;
  if (state.billiardsSpeed === undefined) state.billiardsSpeed = p.speed;
  if (state.billiardsDamping === undefined) state.billiardsDamping = p.damp;
  if (state.billiardsSpin === undefined) state.billiardsSpin = p.spin;
  if (state.billiardsBallCollision === undefined) state.billiardsBallCollision = true;
  if (state.billiardsOctave === undefined) state.billiardsOctave = 0;

  const count = Math.max(1, Math.min(MAX_BODIES, state.billiardsBalls || 3));

  for (let i = 0; i < MAX_BODIES; i++) {
    ballRadius[i] = 0.038;
    trailHead[i] = 0;
    trailCount[i] = 0;
    sparkLife[i] = 0;
    flightDist[i] = 0;

    // Distribute balls safely inside the active table geometry
    const angle = (i / count) * Math.PI * 2 + 0.35;
    const r = 0.2 + (i % 3) * 0.12;
    posX[i] = Math.cos(angle) * r;
    posY[i] = Math.sin(angle) * r;

    // Give distinct non-zero initial velocity vectors
    const speed = 0.85 + (i * 0.15);
    const velAngle = angle + Math.PI / 2 + 0.25;
    velX[i] = Math.cos(velAngle) * speed;
    velY[i] = Math.sin(velAngle) * speed;

    prevPosX[i] = posX[i];
    prevPosY[i] = posY[i];
  }
}

/**
 * Resolves pitch from boundary collision coordinate (x, y).
 */
export function getBilliardsNote(x, y, flightD = 0.5, ballIdx = 0) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.max(1, Math.min(4, state.pitchSpan || 2));
  const octaveShift = (state.billiardsOctave || 0) * 12;

  // Compute polar angle around table center normalized [0, 1)
  const angle = Math.atan2(y, x); // [-PI, PI]
  const normAngle = ((angle + Math.PI) / (Math.PI * 2) + 1.0) % 1.0;

  // Segment flight distance subtly modulates octave register (longer flights sound lower/richer)
  const flightOctaveOffset = flightD > 0.8 ? -12 : (flightD < 0.2 ? 12 : 0);

  const rawMidi = root + Math.floor(normAngle * span * 12) + octaveShift + flightOctaveOffset;
  return quantize(rawMidi, intervals, root);
}

/**
 * Advance physics simulation by dt seconds.
 */
export function stepBilliardsSimulation(dt = 0.016) {
  const simSpeed = Math.max(0.1, Math.min(3.0, (state.billiardsSpeed || 1.0) * (state.modelSpeed || 1.0)));
  const totalDt = dt * simSpeed;
  const numBalls = Math.max(1, Math.min(MAX_BODIES, state.billiardsBalls || 3));
  const spin = state.billiardsSpin || 0.0;
  const damp = Math.max(0.0, Math.min(0.05, state.billiardsDamping || 0.0));
  const table = state.billiardsPreset || "stadium";

  // Sub-stepping for precise numerical collision detection
  const subSteps = 6;
  const subDt = totalDt / subSteps;

  let anyTriggered = false;

  for (let s = 0; s < subSteps; s++) {
    for (let i = 0; i < numBalls; i++) {
      // 1. Magnetic Lorentz / Larmor curvature: rotate velocity vector
      if (Math.abs(spin) > 0.001) {
        const dTheta = spin * 3.5 * subDt;
        const cosT = Math.cos(dTheta);
        const sinT = Math.sin(dTheta);
        const vx = velX[i] * cosT - velY[i] * sinT;
        const vy = velX[i] * sinT + velY[i] * cosT;
        velX[i] = vx;
        velY[i] = vy;
      }

      // 2. Candidate step
      const candX = posX[i] + velX[i] * subDt;
      const candY = posY[i] + velY[i] * subDt;
      flightDist[i] += Math.hypot(candX - posX[i], candY - posY[i]);

      // 3. Collision with table boundary
      let collided = false;
      let nx = 0;
      let ny = 0;
      let hitX = candX;
      let hitY = candY;

      const br = ballRadius[i];

      if (table === "stadium") {
        // Bunimovich Stadium: straight walls at y = +-H for |x| <= L, semicircular caps at x = +-L with radius R = H
        const L = 0.45;
        const R_cap = 0.52;

        if (Math.abs(candX) <= L) {
          if (candY > (R_cap - br)) {
            collided = true;
            nx = 0; ny = -1;
            hitY = R_cap - br;
          } else if (candY < -(R_cap - br)) {
            collided = true;
            nx = 0; ny = 1;
            hitY = -(R_cap - br);
          }
        } else if (candX > L) {
          const dx = candX - L;
          const dy = candY;
          const d = Math.hypot(dx, dy);
          if (d > (R_cap - br)) {
            collided = true;
            nx = -dx / Math.max(0.001, d);
            ny = -dy / Math.max(0.001, d);
            hitX = L - nx * (R_cap - br);
            hitY = -ny * (R_cap - br);
          }
        } else {
          // candX < -L
          const dx = candX + L;
          const dy = candY;
          const d = Math.hypot(dx, dy);
          if (d > (R_cap - br)) {
            collided = true;
            nx = -dx / Math.max(0.001, d);
            ny = -dy / Math.max(0.001, d);
            hitX = -L - nx * (R_cap - br);
            hitY = -ny * (R_cap - br);
          }
        }
      } else if (table === "sinai") {
        // Sinai: Square outer box [-W, W] x [-H, H], central circular obstacle at (0, 0)
        const W = 0.82;
        const H = 0.82;
        const R_obs = 0.36;

        // Central obstacle collision (dispersing boundary)
        const distCenter = Math.hypot(candX, candY);
        if (distCenter < (R_obs + br)) {
          collided = true;
          nx = candX / Math.max(0.001, distCenter);
          ny = candY / Math.max(0.001, distCenter);
          hitX = nx * (R_obs + br);
          hitY = ny * (R_obs + br);
        } else {
          // Outer box walls
          if (candX > (W - br)) {
            collided = true; nx = -1; ny = 0; hitX = W - br;
          } else if (candX < -(W - br)) {
            collided = true; nx = 1; ny = 0; hitX = -(W - br);
          } else if (candY > (H - br)) {
            collided = true; nx = 0; ny = -1; hitY = H - br;
          } else if (candY < -(H - br)) {
            collided = true; nx = 0; ny = 1; hitY = -(H - br);
          }
        }
      } else if (table === "ellipse") {
        // Confocal Ellipse: x^2 / a^2 + y^2 / b^2 <= 1
        const a = 0.88;
        const b = 0.58;
        const normDist = (candX * candX) / (a * a) + (candY * candY) / (b * b);
        if (normDist >= 1.0) {
          collided = true;
          // Inward normal is -grad(F)
          const gx = (2 * candX) / (a * a);
          const gy = (2 * candY) / (b * b);
          const gl = Math.hypot(gx, gy);
          nx = -gx / Math.max(0.001, gl);
          ny = -gy / Math.max(0.001, gl);
          const scale = 1.0 / Math.sqrt(normDist);
          hitX = candX * scale + nx * br * 0.5;
          hitY = candY * scale + ny * br * 0.5;
        }
      } else if (table === "cardioid") {
        // Robnik Cardioid / Limaçon table
        const r = Math.hypot(candX, candY);
        const theta = Math.atan2(candY, candX);
        const rBound = 0.52 + 0.32 * Math.cos(theta); // Limaçon
        if (r > (rBound - br)) {
          collided = true;
          const dr_dtheta = -0.32 * Math.sin(theta);
          // Inward normal vector from polar curve
          const tx = dr_dtheta * Math.cos(theta) - rBound * Math.sin(theta);
          const ty = dr_dtheta * Math.sin(theta) + rBound * Math.cos(theta);
          const tl = Math.hypot(tx, ty);
          nx = ty / Math.max(0.001, tl);
          ny = -tx / Math.max(0.001, tl);
          hitX = (rBound - br) * Math.cos(theta);
          hitY = (rBound - br) * Math.sin(theta);
        }
      } else if (table === "wedge") {
        // Triangular Wedge: Equilateral triangle with vertices pointing up
        const side = 1.45;
        const h = (side * Math.sqrt(3)) / 2;
        const yTop = (2 / 3) * h - 0.25;
        const yBottom = -(1 / 3) * h - 0.25;
        const xHalf = side / 2;

        if (candY < (yBottom + br)) {
          collided = true; nx = 0; ny = 1; hitY = yBottom + br;
        } else {
          // Right slanted side: connects (0, yTop) to (xHalf, yBottom)
          // Line equation: (candY - yTop) - m * candX <= 0 where m = (yBottom - yTop) / xHalf
          const mR = (yBottom - yTop) / xHalf;
          const valR = (candY - yTop) - mR * candX;
          if (valR > -br) {
            collided = true;
            const len = Math.hypot(-mR, 1);
            nx = mR / len; ny = -1 / len;
            hitX = candX + nx * br;
            hitY = candY + ny * br;
          } else {
            // Left slanted side
            const mL = (yBottom - yTop) / -xHalf;
            const valL = (candY - yTop) - mL * candX;
            if (valL > -br) {
              collided = true;
              const len = Math.hypot(-mL, 1);
              nx = mL / len; ny = -1 / len;
              hitX = candX + nx * br;
              hitY = candY + ny * br;
            }
          }
        }
      }

      if (collided) {
        // Specular elastic reflection: v' = v - 2(v · n)n
        const dot = velX[i] * nx + velY[i] * ny;
        if (dot < 0) {
          velX[i] = velX[i] - 2 * dot * nx;
          velY[i] = velY[i] - 2 * dot * ny;

          // Apply slight damping restitution if configured
          if (damp > 0) {
            const factor = Math.max(0.95, 1.0 - damp);
            velX[i] *= factor;
            velY[i] *= factor;
          }
        }

        posX[i] = hitX;
        posY[i] = hitY;

        // Sound note trigger on collision
        if (isBilliardsPlaying) {
          const normalImpulse = Math.abs(dot);
          const speed = Math.hypot(velX[i], velY[i]);
          const vel = Math.max(25, Math.min(127, Math.round(55 + normalImpulse * 38 + speed * 18)));
          const durMs = Math.max(70, Math.min(420, Math.round(90 + flightDist[i] * 180)));
          const note = getBilliardsNote(hitX, hitY, flightDist[i], i);

          playVoice(i, note, vel, durMs);
          anyTriggered = true;

          sparkX[i] = hitX;
          sparkY[i] = hitY;
          sparkLife[i] = 1.0;
          sparkNote[i] = midiName(note);
        }

        flightDist[i] = 0;
      } else {
        posX[i] = candX;
        posY[i] = candY;
      }
    }

    // 4. Ball-to-ball elastic collisions (if enabled)
    if (state.billiardsBallCollision && numBalls > 1) {
      for (let i = 0; i < numBalls; i++) {
        for (let j = i + 1; j < numBalls; j++) {
          const dx = posX[j] - posX[i];
          const dy = posY[j] - posY[i];
          const dist = Math.hypot(dx, dy);
          const minDist = ballRadius[i] + ballRadius[j];

          if (dist < minDist && dist > 0.0001) {
            // Elastic collision response
            const nx = dx / dist;
            const ny = dy / dist;
            const kx = velX[i] - velX[j];
            const ky = velY[i] - velY[j];
            const p = 2 * (nx * kx + ny * ky) / 2; // Equal masses

            velX[i] -= p * nx;
            velY[i] -= p * ny;
            velX[j] += p * nx;
            velY[j] += p * ny;

            // Separate overlapping balls
            const overlap = (minDist - dist) * 0.5;
            posX[i] -= nx * overlap;
            posY[i] -= ny * overlap;
            posX[j] += nx * overlap;
            posY[j] += ny * overlap;

            if (isBilliardsPlaying) {
              const midX = (posX[i] + posX[j]) * 0.5;
              const midY = (posY[i] + posY[j]) * 0.5;
              const note = getBilliardsNote(midX, midY, 0.4, i);
              playVoice(i, note, 75, 120);
              anyTriggered = true;

              sparkX[i] = midX;
              sparkY[i] = midY;
              sparkLife[i] = 0.8;
              sparkNote[i] = midiName(note);
            }
          }
        }
      }
    }
  }

  // 5. Update trail history ring buffers
  for (let i = 0; i < numBalls; i++) {
    const head = trailHead[i];
    const offset = i * TRAIL_LEN + head;
    trailX[offset] = posX[i];
    trailY[offset] = posY[i];
    trailHead[i] = (head + 1) % TRAIL_LEN;
    if (trailCount[i] < TRAIL_LEN) trailCount[i]++;

    // Decay spark animation
    if (sparkLife[i] > 0) {
      sparkLife[i] = Math.max(0, sparkLife[i] - totalDt * 3.2);
    }
  }

  return { triggered: anyTriggered };
}

/**
 * Generator Function Contract: generateBilliardsBank(state)
 * Simulates trajectory events into a valid 64-step bank array conforming to FM-1 Pulses contract.
 */
export function generateBilliardsBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st.length || 64));
  const rate = RATE_NAMES[st.rate] || "1/16";
  const numBalls = Math.max(1, Math.min(MAX_BODIES, st.billiardsBalls || 3));
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.max(1, Math.min(4, st.pitchSpan || 2));
  const octaveShift = (st.billiardsOctave || 0) * 12;

  const steps = [];

  // Deterministically sample trajectory bounce notes
  for (let s = 0; s < seqLen; s++) {
    const ballIdx = s % numBalls;
    const progress = s / seqLen;
    const angle = progress * Math.PI * 4 + (ballIdx * 1.618);
    const normAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);

    const rawMidi = root + Math.floor(normAngle * span * 12) + octaveShift;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(40, Math.min(127, Math.round(70 + Math.sin(s * 0.7) * 45)));

    steps.push({
      note,
      vel,
      gate: 0.75,
      skip: false,
      notes: [{ note, vel }]
    });
  }

  return [{
    length: seqLen,
    rate,
    steps
  }];
}

/**
 * Randomize parameters and ball positions.
 */
export function randomizeBilliards() {
  const presetKeys = BILLIARDS_PRESETS.map(p => p.id);
  const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];
  state.billiardsPreset = randomPreset;
  state.billiardsBalls = Math.floor(Math.random() * 5) + 2; // 2..6
  state.billiardsSpeed = parseFloat((0.6 + Math.random() * 1.2).toFixed(2));
  state.billiardsSpin = Math.random() < 0.4 ? parseFloat(((Math.random() - 0.5) * 0.8).toFixed(2)) : 0.0;
  state.billiardsDamping = 0.0;
  state.billiardsOctave = Math.floor(Math.random() * 3) - 1; // -1, 0, 1

  initBilliardsSystem(randomPreset);

  if (presetSelectEl) presetSelectEl.value = randomPreset;
  syncControlsFromState();
  renderBilliardsCanvas();
  updateHud();

  status(`Billiards: Randomised · ${randomPreset}`, "ok");
}

function syncControlsFromState() {
  if (refs.billiardsBalls?.setValue) refs.billiardsBalls.setValue(state.billiardsBalls, false);
  if (refs.billiardsSpeed?.setValue) refs.billiardsSpeed.setValue(state.billiardsSpeed, false);
  if (refs.billiardsSpin?.setValue) refs.billiardsSpin.setValue(state.billiardsSpin, false);
  if (refs.billiardsOctave?.setValue) refs.billiardsOctave.setValue(state.billiardsOctave, false);
}

function updateHud() {
  if (!hudElement) return;
  const numBalls = state.billiardsBalls || 3;
  const preset = state.billiardsPreset || "stadium";
  hudElement.textContent = `${preset.toUpperCase()} · ${numBalls} BALLS · SPEED ${state.billiardsSpeed || 1.0}x`;
}

/**
 * Render the table, trajectory trails, balls, and collision sparks onto the canvas.
 */
export function renderBilliardsCanvas() {
  if (!canvasEl || !ctx) return;

  const w = canvasEl.width;
  const h = canvasEl.height;
  if (w <= 0 || h <= 0) return;

  // Resolve dynamic semantic theme tokens (Zero Gradient Rule)
  const rootStyle = getComputedStyle(document.documentElement);
  const colBg = rootStyle.getPropertyValue("--panel2").trim() || "#18191f";
  const colLine = rootStyle.getPropertyValue("--line").trim() || "#333846";
  const colLineFocus = rootStyle.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colFg = rootStyle.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = rootStyle.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = rootStyle.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = rootStyle.getPropertyValue("--accent2").trim() || "#60a5fa";

  // Solid background fill
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.5;
  const scale = Math.min(w, h) * 0.46;

  const toScreenX = (x) => cx + x * scale;
  const toScreenY = (y) => cy - y * scale;

  const table = state.billiardsPreset || "stadium";

  // 1. Draw Table Boundary
  ctx.save();
  ctx.lineWidth = 2.0;
  ctx.strokeStyle = colLineFocus;
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";

  ctx.beginPath();
  if (table === "stadium") {
    const L = 0.45;
    const R_cap = 0.52;
    // Top line
    ctx.moveTo(toScreenX(-L), toScreenY(R_cap));
    ctx.lineTo(toScreenX(L), toScreenY(R_cap));
    // Right cap
    ctx.arc(toScreenX(L), toScreenY(0), R_cap * scale, Math.PI / 2, -Math.PI / 2, true);
    // Bottom line
    ctx.lineTo(toScreenX(-L), toScreenY(-R_cap));
    // Left cap
    ctx.arc(toScreenX(-L), toScreenY(0), R_cap * scale, -Math.PI / 2, Math.PI / 2, true);
    ctx.closePath();
  } else if (table === "sinai") {
    const W = 0.82;
    const H = 0.82;
    ctx.rect(toScreenX(-W), toScreenY(H), (2 * W) * scale, (2 * H) * scale);
  } else if (table === "ellipse") {
    const a = 0.88;
    const b = 0.58;
    ctx.ellipse(cx, cy, a * scale, b * scale, 0, 0, Math.PI * 2);
  } else if (table === "cardioid") {
    const steps = 120;
    for (let k = 0; k <= steps; k++) {
      const theta = (k / steps) * Math.PI * 2;
      const r = 0.52 + 0.32 * Math.cos(theta);
      const px = toScreenX(r * Math.cos(theta));
      const py = toScreenY(r * Math.sin(theta));
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (table === "wedge") {
    const side = 1.45;
    const hTri = (side * Math.sqrt(3)) / 2;
    const yTop = (2 / 3) * hTri - 0.25;
    const yBottom = -(1 / 3) * hTri - 0.25;
    const xHalf = side / 2;
    ctx.moveTo(toScreenX(0), toScreenY(yTop));
    ctx.lineTo(toScreenX(xHalf), toScreenY(yBottom));
    ctx.lineTo(toScreenX(-xHalf), toScreenY(yBottom));
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  // Draw central circular scatterer for Sinai Billiard
  if (table === "sinai") {
    const R_obs = 0.36;
    ctx.beginPath();
    ctx.arc(cx, cy, R_obs * scale, 0, Math.PI * 2);
    ctx.fillStyle = colLine;
    ctx.fill();
    ctx.strokeStyle = colLineFocus;
    ctx.stroke();
  }
  ctx.restore();

  const numBalls = Math.max(1, Math.min(MAX_BODIES, state.billiardsBalls || 3));

  // 2. Draw Trajectory Trails (Fading Polyline)
  for (let i = 0; i < numBalls; i++) {
    const count = trailCount[i];
    if (count > 1) {
      const head = trailHead[i];
      const baseCol = BALL_COLORS[i % BALL_COLORS.length];

      ctx.save();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = baseCol;

      for (let j = 0; j < count - 1; j++) {
        const idx1 = (head - 1 - j + TRAIL_LEN) % TRAIL_LEN;
        const idx0 = (head - 2 - j + TRAIL_LEN) % TRAIL_LEN;
        const off1 = i * TRAIL_LEN + idx1;
        const off0 = i * TRAIL_LEN + idx0;

        const alpha = Math.max(0.05, 1.0 - (j / count));
        ctx.globalAlpha = alpha * 0.45;

        ctx.beginPath();
        ctx.moveTo(toScreenX(trailX[off0]), toScreenY(trailY[off0]));
        ctx.lineTo(toScreenX(trailX[off1]), toScreenY(trailY[off1]));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 3. Draw Collision Sparks & Ripple Animations
  for (let i = 0; i < numBalls; i++) {
    if (sparkLife[i] > 0) {
      const sx = toScreenX(sparkX[i]);
      const sy = toScreenY(sparkY[i]);
      const life = sparkLife[i];
      const radius = (1.0 - life) * 32 + 6;

      ctx.save();
      ctx.globalAlpha = life;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = BALL_COLORS[i % BALL_COLORS.length];
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Note badge at collision
      if (sparkNote[i]) {
        ctx.fillStyle = colFg;
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(sparkNote[i], sx, sy - radius - 3);
      }
      ctx.restore();
    }
  }

  // 4. Draw Billiard Balls
  for (let i = 0; i < numBalls; i++) {
    const bx = toScreenX(posX[i]);
    const by = toScreenY(posY[i]);
    const rPix = Math.max(5, ballRadius[i] * scale);
    const color = BALL_COLORS[i % BALL_COLORS.length];

    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, rPix, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // Ball index label
    ctx.fillStyle = "#000000";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), bx, by);
    ctx.restore();
  }

  // 5. Draw Slingshot Drag Vector (if user is dragging)
  if (isSlinging) {
    ctx.save();
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = colAccent;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(slingStartX, slingStartY);
    ctx.lineTo(slingCurX, slingCurY);
    ctx.stroke();

    // Aiming circle
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(slingStartX, slingStartY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = colAccent2;
    ctx.stroke();
    ctx.restore();
  }
}

function animLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  stepBilliardsSimulation(dt);
  renderBilliardsCanvas();

  animFrameId = requestAnimationFrame(animLoop);
}

// ---- UI Assembly & Model Initialization ----
export function initBilliards() {
  billiardsContainer = document.getElementById("model-billiards");
  if (!billiardsContainer) return;
  billiardsContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout billiards-layout";

  // --- Left Column: Controls & Presets ---
  const module = document.createElement("div");
  module.className = "module billiards-module";

  // Card 1: Header, Preset Selector, and Actions
  const headerCard = document.createElement("div");
  headerCard.className = "card";
  headerCard.style.padding = "8px 12px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";

  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `<h3 style="margin:0; font-size:11px; font-weight:700; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Ballistic Billiards</h3>`;

  const actionsGroup = document.createElement("div");
  actionsGroup.style.display = "flex";
  actionsGroup.style.gap = "4px";

  const btnRnd = document.createElement("button");
  btnRnd.className = "btn-action primary";
  btnRnd.style.fontSize = "10px";
  btnRnd.style.padding = "3px 8px";
  btnRnd.textContent = "Randomise";
  btnRnd.title = "Randomise billiard table, ball positions, velocities, and parameters (R / G)";
  btnRnd.addEventListener("click", () => {
    randomizeBilliards();
  });

  actionsGroup.append(btnRnd);
  topRow.append(titleGroup, actionsGroup);

  // Preset Selector Dropdown
  const presetRow = document.createElement("div");
  presetRow.style.marginTop = "8px";
  presetRow.style.display = "flex";
  presetRow.style.gap = "6px";
  presetRow.style.alignItems = "center";

  const presetLabel = document.createElement("span");
  presetLabel.style.fontSize = "9px";
  presetLabel.style.color = "var(--dim)";
  presetLabel.style.fontWeight = "700";
  presetLabel.textContent = "TABLE:";

  presetSelectEl = document.createElement("select");
  presetSelectEl.className = "lsystem-select";
  presetSelectEl.style.flex = "1";
  for (const pr of BILLIARDS_PRESETS) {
    const opt = document.createElement("option");
    opt.value = pr.id;
    opt.textContent = pr.name;
    opt.title = pr.desc;
    presetSelectEl.appendChild(opt);
  }
  presetSelectEl.value = state.billiardsPreset || "stadium";
  presetSelectEl.addEventListener("change", (e) => {
    const pid = e.target.value;
    state.billiardsPreset = pid;
    const p = BILLIARDS_PRESETS.find(pr => pr.id === pid);
    if (p) {
      state.billiardsBalls = p.balls;
      state.billiardsSpeed = p.speed;
      state.billiardsSpin = p.spin;
      state.billiardsDamping = p.damp;
      initBilliardsSystem(pid);
      syncControlsFromState();
      renderBilliardsCanvas();
      updateHud();
      status(`Table preset: ${p.name}`, "ok");
    }
  });

  presetRow.append(presetLabel, presetSelectEl);
  headerCard.append(topRow, presetRow);

  // Card 2: Physical Parameters
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "8px 12px";
  paramCard.style.marginTop = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.className = "lsystem-param-grid";

  const kBalls = knob({
    id: "billiardsBalls",
    label: "BALLS",
    min: 1, max: 8, step: 1,
    def: state.billiardsBalls ?? 3,
    title: "Number of concurrent billiard balls (1 to 8 hardware polyphony limit)",
    onChange: (v) => {
      state.billiardsBalls = Math.round(v);
      updateHud();
      renderBilliardsCanvas();
    }
  });

  const kSpeed = knob({
    id: "billiardsSpeed",
    label: "SPEED",
    min: 0.2, max: 3.0, step: 0.05,
    def: state.billiardsSpeed ?? 1.0,
    title: "Ballistic ray traversal speed multiplier",
    onChange: (v) => {
      state.billiardsSpeed = v;
      updateHud();
    }
  });

  const kSpin = knob({
    id: "billiardsSpin",
    label: "SPIN",
    min: -1.0, max: 1.0, step: 0.05,
    def: state.billiardsSpin ?? 0.0,
    title: "Magnetic Lorentz force / spin curvature bending trajectory into Larmor arcs",
    onChange: (v) => {
      state.billiardsSpin = v;
    }
  });

  const kDamp = knob({
    id: "billiardsDamping",
    label: "DAMP",
    min: 0.0, max: 0.05, step: 0.005,
    def: state.billiardsDamping ?? 0.0,
    title: "Boundary collision restitution damping (energy dissipation)",
    onChange: (v) => {
      state.billiardsDamping = v;
    }
  });

  paramGrid.append(kBalls, kSpeed, kSpin, kDamp);

  // Quick Action Buttons
  const btnRow = document.createElement("div");
  btnRow.style.marginTop = "8px";
  btnRow.style.display = "flex";
  btnRow.style.gap = "6px";

  const btnColl = document.createElement("button");
  btnColl.className = "btn-action";
  btnColl.style.flex = "1";
  btnColl.style.fontSize = "9px";
  btnColl.textContent = state.billiardsBallCollision ? "BALL COLL: ON" : "BALL COLL: OFF";
  btnColl.title = "Toggle hard-sphere elastic collisions between balls";
  btnColl.addEventListener("click", () => {
    state.billiardsBallCollision = !state.billiardsBallCollision;
    btnColl.textContent = state.billiardsBallCollision ? "BALL COLL: ON" : "BALL COLL: OFF";
    status(`Ball collisions: ${state.billiardsBallCollision ? "Enabled" : "Disabled"}`);
  });

  const btnReRack = document.createElement("button");
  btnReRack.className = "btn-action";
  btnReRack.style.flex = "1";
  btnReRack.style.fontSize = "9px";
  btnReRack.textContent = "RE-RACK";
  btnReRack.title = "Reset balls to initial symmetric positions";
  btnReRack.addEventListener("click", () => {
    initBilliardsSystem(state.billiardsPreset || "stadium");
    renderBilliardsCanvas();
    status("Billiards re-racked", "ok");
  });

  btnRow.append(btnColl, btnReRack);
  paramCard.append(paramGrid, btnRow);

  // Notes div: Shared pitch quantizer and 8-voice polyphony controls
  const notesSection = createNotesSection({
    id: "billiards-notes",
    title: "Harmonics & Pitch",
    showSpan: true,
    showOctave: true,
    showPolyphony: true,
    octaveKey: "billiardsOctave",
    octaveModeKey: "billiardsOctaveMode",
    onScaleChange: () => {
      renderBilliardsCanvas();
    }
  });
  notesSection.style.marginTop = "8px";

  module.append(headerCard, paramCard, notesSection);

  // --- Right Column: Interactive Billiards Canvas ---
  const canvasPanel = document.createElement("div");
  canvasPanel.className = "billiards-canvas-panel";
  canvasPanel.style.display = "flex";
  canvasPanel.style.flexDirection = "column";
  canvasPanel.style.flex = "1";
  canvasPanel.style.minHeight = "360px";
  canvasPanel.style.position = "relative";

  canvasEl = document.createElement("canvas");
  canvasEl.className = "billiards-canvas";
  canvasEl.style.width = "100%";
  canvasEl.style.height = "100%";
  canvasEl.style.minHeight = "340px";
  canvasEl.style.backgroundColor = "var(--panel2)";
  canvasEl.style.border = "1px solid var(--line)";
  canvasEl.style.borderRadius = "2px";
  canvasEl.style.cursor = "crosshair";
  ctx = canvasEl.getContext("2d");

  hudElement = document.createElement("div");
  hudElement.className = "billiards-hud";
  hudElement.style.position = "absolute";
  hudElement.style.top = "8px";
  hudElement.style.left = "12px";
  hudElement.style.fontSize = "9px";
  hudElement.style.fontWeight = "700";
  hudElement.style.letterSpacing = "0.8px";
  hudElement.style.color = "var(--dim)";
  hudElement.style.pointerEvents = "none";

  const tipText = document.createElement("div");
  tipText.style.position = "absolute";
  tipText.style.bottom = "8px";
  tipText.style.left = "12px";
  tipText.style.fontSize = "8px";
  tipText.style.color = "var(--dim)";
  tipText.style.pointerEvents = "none";
  tipText.textContent = "DRAG ON CANVAS TO SLINGSHOT BALL · COLLISION SPARKS TRIGGER SCALE TONES";

  // Canvas Slingshot Interaction
  function getCanvasCoords(e) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  canvasEl.addEventListener("mousedown", (e) => {
    const p = getCanvasCoords(e);
    isSlinging = true;
    slingStartX = p.x;
    slingStartY = p.y;
    slingCurX = p.x;
    slingCurY = p.y;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isSlinging || !canvasEl) return;
    const p = getCanvasCoords(e);
    slingCurX = p.x;
    slingCurY = p.y;
    renderBilliardsCanvas();
  });

  window.addEventListener("mouseup", () => {
    if (!isSlinging || !canvasEl) return;
    isSlinging = false;

    const dx = slingStartX - slingCurX;
    const dy = slingStartY - slingCurY;
    const dist = Math.hypot(dx, dy);

    if (dist > 8) {
      const cx = canvasEl.width * 0.5;
      const cy = canvasEl.height * 0.5;
      const scale = Math.min(canvasEl.width, canvasEl.height) * 0.46;

      const normX = (slingStartX - cx) / scale;
      const normY = (cy - slingStartY) / scale;

      // Launch ball 0 (or next selected ball)
      const bIdx = selectedBallIndex % Math.max(1, state.billiardsBalls || 3);
      selectedBallIndex++;

      posX[bIdx] = Math.max(-0.8, Math.min(0.8, normX));
      posY[bIdx] = Math.max(-0.8, Math.min(0.8, normY));

      const launchSpeed = Math.min(3.5, dist * 0.025);
      const angle = Math.atan2(-dy, dx); // note canvas inversion
      velX[bIdx] = Math.cos(angle) * launchSpeed;
      velY[bIdx] = Math.sin(angle) * launchSpeed;

      status(`Launched Ball ${bIdx + 1} (speed ${launchSpeed.toFixed(2)})`, "ok");
    }

    renderBilliardsCanvas();
  });

  // Handle Resize
  function resizeCanvas() {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvasEl.width = rect.width * (window.devicePixelRatio || 1);
      canvasEl.height = rect.height * (window.devicePixelRatio || 1);
      renderBilliardsCanvas();
    }
  }

  window.addEventListener("resize", resizeCanvas);
  setTimeout(resizeCanvas, 50);

  canvasPanel.append(canvasEl, hudElement, tipText);
  layout.append(module, canvasPanel);
  billiardsContainer.append(layout);

  initBilliardsSystem(state.billiardsPreset || "stadium");
  updateHud();

  // Snapshot Registration
  registerModel({
    id: "billiards",
    version: 1,
    migrations: {},
    capture: () => ({
      preset: state.billiardsPreset || "stadium",
      balls: state.billiardsBalls || 3,
      speed: state.billiardsSpeed || 1.0,
      spin: state.billiardsSpin || 0.0,
      damp: state.billiardsDamping || 0.0,
      ballCollision: !!state.billiardsBallCollision,
      octave: state.billiardsOctave || 0,
      posX: Array.from(posX.slice(0, state.billiardsBalls || 3)),
      posY: Array.from(posY.slice(0, state.billiardsBalls || 3)),
      velX: Array.from(velX.slice(0, state.billiardsBalls || 3)),
      velY: Array.from(velY.slice(0, state.billiardsBalls || 3))
    }),
    restore: (snap) => {
      if (!snap) return;
      if (snap.preset) state.billiardsPreset = snap.preset;
      if (snap.balls) state.billiardsBalls = snap.balls;
      if (snap.speed !== undefined) state.billiardsSpeed = snap.speed;
      if (snap.spin !== undefined) state.billiardsSpin = snap.spin;
      if (snap.damp !== undefined) state.billiardsDamping = snap.damp;
      if (snap.ballCollision !== undefined) state.billiardsBallCollision = snap.ballCollision;
      if (snap.octave !== undefined) state.billiardsOctave = snap.octave;

      initBilliardsSystem(state.billiardsPreset || "stadium");

      if (Array.isArray(snap.posX) && Array.isArray(snap.posY)) {
        for (let i = 0; i < Math.min(MAX_BODIES, snap.posX.length); i++) {
          posX[i] = snap.posX[i];
          posY[i] = snap.posY[i];
          if (Array.isArray(snap.velX)) velX[i] = snap.velX[i];
          if (Array.isArray(snap.velY)) velY[i] = snap.velY[i];
        }
      }

      if (presetSelectEl) presetSelectEl.value = state.billiardsPreset;
      syncControlsFromState();
      renderBilliardsCanvas();
      updateHud();
    }
  });
}

export function activateBilliardsModel() {
  setModelGenerator(generateBilliardsBank);
  setModelRandomizer(randomizeBilliards);
  setModelTransportHandler({
    start: startBilliards,
    stop: stopBilliards,
    toggle: toggleBilliardsRunning,
    isRunning: isBilliardsRunning
  });

  lastFrameTime = performance.now();
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(animLoop);
  }

  renderBilliardsCanvas();
  updateHud();
}

export function deactivateBilliardsModel() {
  stopBilliards();
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelTransportHandler(null);

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// Register Snapshot Serialization at module level
registerModel({
  id: "billiards",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.billiardsPreset || "stadium",
    balls: state.billiardsBalls || 3,
    speed: state.billiardsSpeed || 1.0,
    spin: state.billiardsSpin || 0.0,
    damp: state.billiardsDamping || 0.0,
    ballCollision: !!state.billiardsBallCollision,
    octave: state.billiardsOctave || 0,
    posX: Array.from(posX.slice(0, state.billiardsBalls || 3)),
    posY: Array.from(posY.slice(0, state.billiardsBalls || 3)),
    velX: Array.from(velX.slice(0, state.billiardsBalls || 3)),
    velY: Array.from(velY.slice(0, state.billiardsBalls || 3))
  }),
  restore: (snap) => {
    if (!snap) return;
    if (snap.preset) state.billiardsPreset = snap.preset;
    if (snap.balls) state.billiardsBalls = snap.balls;
    if (snap.speed !== undefined) state.billiardsSpeed = snap.speed;
    if (snap.spin !== undefined) state.billiardsSpin = snap.spin;
    if (snap.damp !== undefined) state.billiardsDamping = snap.damp;
    if (snap.ballCollision !== undefined) state.billiardsBallCollision = snap.ballCollision;
    if (snap.octave !== undefined) state.billiardsOctave = snap.octave;

    initBilliardsSystem(state.billiardsBalls || 3, state.billiardsSpeed || 1.0, state.billiardsPreset || "stadium");

    if (Array.isArray(snap.posX) && Array.isArray(snap.posY)) {
      for (let i = 0; i < Math.min(MAX_BODIES, snap.posX.length); i++) {
        posX[i] = snap.posX[i];
        posY[i] = snap.posY[i];
        if (Array.isArray(snap.velX)) velX[i] = snap.velX[i];
        if (Array.isArray(snap.velY)) velY[i] = snap.velY[i];
      }
    }

    if (presetSelectEl) presetSelectEl.value = state.billiardsPreset;
    syncControlsFromState();
    renderBilliardsCanvas();
    updateHud();
  }
});
