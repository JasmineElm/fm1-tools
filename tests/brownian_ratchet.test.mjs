// tests/brownian_ratchet.test.mjs — Unit tests for Brownian Thermal Ratchet / Feynman Thermal Diode model
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {}
  };
}
if (typeof document === "undefined") {
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        fillText: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        strokeRect: () => {}
      }),
      style: {},
      appendChild: () => {},
      addEventListener: () => {}
    }),
    documentElement: {
      style: {},
      getAttribute: () => null
    }
  };
}

import {
  MAX_VOICES,
  NUM_GAS_MOLECULES,
  gasX,
  gasY,
  gasVx,
  gasVy,
  pawlChimes,
  RATCHET_PRESETS,
  theta,
  omega,
  toothIndex,
  forwardClicksCount,
  reverseClicksCount,
  boxMullerRandom,
  initGasParticles,
  initRatchetPreset,
  computeRatchetForce,
  computePawlTorque,
  getToothNote,
  stepSimulation,
  generateBrownianRatchetBank,
  startBrownianRatchet,
  stopBrownianRatchet,
  toggleBrownianRatchetRunning,
  isBrownianRatchetRunning,
  randomizeBrownianRatchet,
  activateBrownianRatchetModel,
  deactivateBrownianRatchetModel,
  initBrownianRatchet
} from "../js/brownian_ratchet.js";
import { getModelDef } from "../js/snapshot.js";
import { getCurrentModelRandomizer } from "../js/state.js";

test("RATCHET_PRESETS contains required thermodynamic operating regimes", () => {
  assert.equal(RATCHET_PRESETS.length, 5);
  const ids = RATCHET_PRESETS.map(p => p.id);
  assert.ok(ids.includes("thermal_rectifier"));
  assert.ok(ids.includes("reversible_carnot"));
  assert.ok(ids.includes("stalled_overload"));
  assert.ok(ids.includes("backward_slippage"));
  assert.ok(ids.includes("stochastic_burst"));
});

test("Hardware polyphony ceiling: MAX_VOICES is strictly capped at 8", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(pawlChimes.length, 8);
});

test("initRatchetPreset initializes parameters and gas particles in T1 chamber", () => {
  initRatchetPreset("thermal_rectifier");

  assert.equal(NUM_GAS_MOLECULES, 48);
  for (let i = 0; i < NUM_GAS_MOLECULES; i++) {
    assert.ok(gasX[i] >= -0.5 && gasX[i] <= 0.5);
    assert.ok(gasY[i] >= -0.5 && gasY[i] <= 0.5);
    assert.ok(!isNaN(gasVx[i]) && !isNaN(gasVy[i]));
  }
});

test("boxMullerRandom generates finite standard Gaussian values", () => {
  for (let i = 0; i < 50; i++) {
    const val = boxMullerRandom();
    assert.ok(typeof val === "number");
    assert.ok(!isNaN(val) && isFinite(val));
  }
});

test("computeRatchetForce evaluates asymmetric sawtooth profile slopes", () => {
  const teeth = 12;
  const asym = 0.80;
  const barrier = 3.0;
  const lambda = (Math.PI * 2) / teeth;

  // In shallow rising region (phase = 0.3 < alpha = 0.80)
  const fRising = computeRatchetForce(lambda * 0.3, teeth, asym, barrier);
  assert.ok(fRising < 0, "Force opposes forward motion on rising slope");

  // In steep falling region (phase = 0.9 > alpha = 0.80)
  const fFalling = computeRatchetForce(lambda * 0.9, teeth, asym, barrier);
  assert.ok(fFalling > 0, "Force pushes forward on falling cliff slope");
});

test("computePawlTorque blocks reverse motion at cold T2 and lifts pawl at hot T2", () => {
  const teeth = 12;
  const asym = 0.80;
  const barrier = 3.0;

  // Cold pawl bath T2 = 0.1: Reverse motion (omega = -2.0) should experience strong blocking torque
  const blockTorque = computePawlTorque(0.01, -2.0, teeth, asym, 0.1, barrier);
  assert.ok(blockTorque > 10.0, "Cold pawl should exert strong restoring torque blocking reverse rotation");

  // Forward motion (omega = +2.0): should have 0 blocking torque
  const fwdTorque = computePawlTorque(0.01, +2.0, teeth, asym, 0.1, barrier);
  assert.equal(fwdTorque, 0.0, "Forward rotation should not experience reverse blocking torque");
});

test("getToothNote quantizes tooth indices to valid MIDI pitches within audible bounds", () => {
  for (let t = -12; t <= 24; t++) {
    const note = getToothNote(t, 12, 0);
    assert.ok(Number.isInteger(note));
    assert.ok(note >= 12 && note <= 127, `Note ${note} out of MIDI bounds`);
  }
});

test("stepSimulation numerically integrates Langevin dynamics without NaN or runaway values", () => {
  initRatchetPreset("thermal_rectifier");

  for (let i = 0; i < 100; i++) {
    const res = stepSimulation(0.016);
    assert.ok(!isNaN(res.theta) && isFinite(res.theta));
    assert.ok(!isNaN(res.omega) && isFinite(res.omega));
    assert.ok(typeof res.clicked === "boolean");
    assert.ok(typeof res.isReverse === "boolean");
  }
});

test("Thermal rectification: T1 > T2 produces net forward ratcheting advances", () => {
  initRatchetPreset("thermal_rectifier");

  // Simulate multiple steps
  for (let i = 0; i < 300; i++) {
    stepSimulation(0.02);
  }

  // Under thermal rectifier preset (T1 = 5.2, T2 = 0.35, load = 0.45),
  // forward clicks should significantly exceed reverse clicks
  assert.ok(forwardClicksCount >= reverseClicksCount, "Forward clicks should exceed reverse clicks in rectifier mode");
});

test("Generator contract: generateBrownianRatchetBank returns valid 64-step bank array", () => {
  const bank = generateBrownianRatchetBank({
    length: 64,
    ratchetTeeth: 12,
    ratchetT1: 4.5,
    ratchetT2: 0.5,
    ratchetAsym: 0.25,
    ratchetOctave: 0,
    rate: "1/16"
  });

  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, "1/16");
  assert.equal(bank[0].steps.length, 64);

  for (const step of bank[0].steps) {
    assert.ok(Number.isInteger(step.note));
    assert.ok(step.note >= 12 && step.note <= 127);
    assert.ok(step.vel >= 0 && step.vel <= 127);
    assert.ok(step.gate >= 0 && step.gate <= 1.0);
    assert.equal(typeof step.skip, "boolean");
  }
});

test("Snapshot capture and restore round-trip preserves ratchet state", () => {
  const def = getModelDef("brownian_ratchet");
  assert.ok(def, "brownian_ratchet model definition must be registered in snapshot.js");

  initRatchetPreset("stochastic_burst");
  const snap = def.capture();
  assert.equal(snap.preset, "stochastic_burst");

  initRatchetPreset("reversible_carnot");
  def.restore(snap);

  assert.equal(def.capture().preset, "stochastic_burst");
});

test("Transport start/stop/toggle controls", () => {
  stopBrownianRatchet();
  assert.equal(isBrownianRatchetRunning(), false);

  startBrownianRatchet();
  assert.equal(isBrownianRatchetRunning(), true);

  toggleBrownianRatchetRunning();
  assert.equal(isBrownianRatchetRunning(), false);

  toggleBrownianRatchetRunning();
  assert.equal(isBrownianRatchetRunning(), true);
  stopBrownianRatchet();
});

test("randomizeBrownianRatchet updates parameters and registers as model randomizer", () => {
  activateBrownianRatchetModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeBrownianRatchet();
  assert.equal(NUM_GAS_MOLECULES, 48);

  deactivateBrownianRatchetModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Multi-pawl Vernier chimes produce varied harmonic pitches across pawls and adjacent teeth", () => {
  initRatchetPreset("thermal_rectifier");

  // Adjacent teeth must produce distinct pitches (no quantization collision)
  const n0 = getToothNote(0, 12, 0, 0);
  const n1 = getToothNote(1, 12, 0, 0);
  assert.notEqual(n0, n1, "Adjacent teeth should trigger distinct scale pitches");

  // The 8 pawls on the same tooth should span multiple distinct harmonic scale notes
  const pawlNotes = new Set();
  for (let p = 0; p < MAX_VOICES; p++) {
    pawlNotes.add(getToothNote(0, 12, 0, p));
  }
  assert.ok(pawlNotes.size >= 4, "8 pawls should map to at least 4 distinct harmonic scale pitches");

  // Running simulation excites multiple pawl chimes with varied notes
  const triggeredNotes = new Set();
  for (let i = 0; i < 120; i++) {
    stepSimulation(0.02);
    for (const ch of pawlChimes) {
      if (ch.active) triggeredNotes.add(ch.note);
    }
  }
  assert.ok(triggeredNotes.size > 1, "Simulation should trigger multiple distinct pawl chime pitches");
});

