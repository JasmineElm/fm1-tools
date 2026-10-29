// tests/chladni.test.mjs — Unit tests for Chladni Resonant Cymatics Plate model
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
        fillText: () => {}
      }),
      style: {}
    }),
    documentElement: {
      style: {},
      getAttribute: () => null
    }
  };
}

import {
  MAX_PROBES,
  NUM_SAND_GRAINS,
  sandX,
  sandY,
  sandVx,
  sandVy,
  probes,
  CHLADNI_PRESETS,
  initChladniPreset,
  scatterSandGrains,
  computeDisplacement,
  computeForce,
  bowImpulse,
  getProbeNote,
  stepSimulation,
  generateChladniBank,
  startChladni,
  stopChladni,
  toggleChladniRunning,
  isChladniRunning
} from "../js/chladni.js";
import { getModelDef } from "../js/snapshot.js";

test("CHLADNI_PRESETS contains required 2D standing wave modal figures", () => {
  assert.equal(CHLADNI_PRESETS.length, 5);
  const ids = CHLADNI_PRESETS.map(p => p.id);
  assert.ok(ids.includes("concentric_cross"));
  assert.ok(ids.includes("diamond_clover"));
  assert.ok(ids.includes("stellar_mandala"));
  assert.ok(ids.includes("hyperbolic_rosette"));
  assert.ok(ids.includes("asymmetric_bell"));
});

test("Hardware polyphony ceiling: MAX_PROBES is strictly capped at 8", () => {
  assert.equal(MAX_PROBES, 8);
  assert.equal(probes.length, 8);
});

test("initChladniPreset resets sand grains and configures radial probes", () => {
  initChladniPreset("concentric_cross");

  for (let i = 0; i < NUM_SAND_GRAINS; i++) {
    assert.ok(sandX[i] >= -0.5 && sandX[i] <= 0.5);
    assert.ok(sandY[i] >= -0.5 && sandY[i] <= 0.5);
  }

  for (let p = 0; p < MAX_PROBES; p++) {
    assert.ok(probes[p].x >= -0.5 && probes[p].x <= 0.5);
    assert.ok(probes[p].y >= -0.5 && probes[p].y <= 0.5);
  }
});

test("computeDisplacement evaluates symmetric standing wave fields", () => {
  // Center point (0, 0)
  const centerDisp = computeDisplacement(0, 0, 1, 2, 1.0, 1.0);
  // cos(0) * cos(0) - cos(0) * cos(0) = 0
  assert.ok(Math.abs(centerDisp) < 0.0001, "Center of symmetric plate should evaluate to zero displacement");
});

test("computeForce calculates negative gradient of vibrational energy", () => {
  const { fx, fy, amp } = computeForce(0.1, 0.2, 2, 3, 1.0, 1.0);
  assert.ok(typeof fx === "number");
  assert.ok(typeof fy === "number");
  assert.ok(typeof amp === "number");
  assert.ok(!isNaN(fx) && !isNaN(fy) && !isNaN(amp));
});

test("bowImpulse imparts kinetic excitation to nearby sand and probes", () => {
  initChladniPreset("diamond_clover");
  const p0 = probes[0];
  p0.pulseAnim = 0;

  bowImpulse(p0.x, p0.y, 1.5);
  assert.equal(p0.pulseAnim, 1.0);
});

test("getProbeNote quantizes spatial coordinates to valid MIDI notes within scale bounds", () => {
  for (let p = 0; p < MAX_PROBES; p++) {
    const note = getProbeNote(p);
    assert.ok(Number.isInteger(note));
    assert.ok(note >= 20 && note <= 120);
  }
});

test("Simulation stepping updates sand grain kinematics without NaN or runaway values", () => {
  initChladniPreset("stellar_mandala");

  // Step 25 frames
  for (let f = 0; f < 25; f++) {
    stepSimulation(20);
  }

  for (let i = 0; i < NUM_SAND_GRAINS; i++) {
    assert.ok(!isNaN(sandX[i]) && !isNaN(sandY[i]));
    assert.ok(sandX[i] >= -0.48 && sandX[i] <= 0.48);
    assert.ok(sandY[i] >= -0.48 && sandY[i] <= 0.48);
  }
});

test("Generator contract: generateChladniBank returns valid 64-step bank array", () => {
  const bank = generateChladniBank({ length: 64, rate: 3 });
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, 3);
  assert.equal(bank[0].steps.length, 64);

  const step0 = bank[0].steps[0];
  assert.ok(step0.note >= 0 && step0.note <= 127);
  assert.equal(step0.source, "chladni");
});

test("Snapshot capture and restore round-trip preserves modal figures and probe positions", () => {
  const def = getModelDef("chladni");
  assert.ok(def, "chladni model must be registered in snapshot.js");

  initChladniPreset("hyperbolic_rosette");
  probes[0].x = 0.35;
  probes[0].y = -0.22;

  const snap = def.capture();
  assert.equal(snap.preset, "hyperbolic_rosette");
  assert.equal(snap.m, 4);
  assert.equal(snap.n, 4);

  // Mutate local state
  initChladniPreset("asymmetric_bell");
  assert.notEqual(probes[0].x, 0.35);

  // Restore snapshot
  def.restore(snap);
  assert.ok(Math.abs(probes[0].x - 0.35) < 0.001);
  assert.ok(Math.abs(probes[0].y - (-0.22)) < 0.001);
});

test("Transport start/stop/toggle controls", () => {
  stopChladni();
  assert.equal(isChladniRunning(), false);
  startChladni();
  assert.equal(isChladniRunning(), true);
  toggleChladniRunning();
  assert.equal(isChladniRunning(), false);
});
