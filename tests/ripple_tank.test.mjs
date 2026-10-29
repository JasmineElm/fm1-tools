// tests/ripple_tank.test.mjs — Unit tests for 2D Acoustic Wave Equation Ripple Tank model
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
  GRID_W,
  GRID_H,
  MAX_PICKUPS,
  pickups,
  barriers,
  drippers,
  RIPPLE_PRESETS,
  initTankPreset,
  stepSimulation,
  dropWater,
  getPickupNote,
  generateRippleTankBank,
  startRipple,
  stopRipple,
  toggleRippleRunning,
  isRippleRunning
} from "../js/ripple_tank.js";
import { getModelDef } from "../js/snapshot.js";

test("RIPPLE_PRESETS contains required wave mechanics geometries", () => {
  assert.equal(RIPPLE_PRESETS.length, 5);
  const ids = RIPPLE_PRESETS.map(p => p.id);
  assert.ok(ids.includes("double_slit"));
  assert.ok(ids.includes("elliptic_focus"));
  assert.ok(ids.includes("parabolic_reflector"));
  assert.ok(ids.includes("corner_cube"));
  assert.ok(ids.includes("open_pond"));
});

test("initTankPreset configures 8 hydrophone pickups matching FM-1 hardware polyphony ceiling", () => {
  initTankPreset("double_slit");
  assert.equal(MAX_PICKUPS, 8); // FM-1 8 hardware voices
  assert.equal(pickups.length, 8);

  for (let i = 0; i < MAX_PICKUPS; i++) {
    const p = pickups[i];
    assert.equal(p.active, true);
    assert.ok(p.x >= 0 && p.x < GRID_W, `Pickup ${i} X out of bounds`);
    assert.ok(p.y >= 0 && p.y < GRID_H, `Pickup ${i} Y out of bounds`);
  }
});

test("initTankPreset for double_slit creates center barrier with dual slit apertures", () => {
  initTankPreset("double_slit");

  const wallX = 38;
  let wallCount = 0;
  let slitCount = 0;

  for (let y = 0; y < GRID_H; y++) {
    const isBarrier = barriers[y * GRID_W + wallX];
    if (isBarrier) wallCount++;
    else slitCount++;
  }

  assert.ok(wallCount > 0, "Double slit preset must configure solid barrier segments");
  assert.ok(slitCount > 0, "Double slit preset must contain open apertures / slits");
});

test("dropWater injects localized wave displacement into acoustic field", () => {
  initTankPreset("open_pond");
  dropWater(40, 24, 2.0, 3.0);

  // Advance simulation to observe wave propagation to radial pickups
  for (let s = 0; s < 45; s++) {
    stepSimulation(16);
  }

  // Pickups should detect non-zero acoustic pressure
  let nonZeroSeen = false;
  for (let p = 0; p < MAX_PICKUPS; p++) {
    if (Math.abs(pickups[p].lastHeight) > 0.0001) {
      nonZeroSeen = true;
      break;
    }
  }
  assert.ok(nonZeroSeen, "Pickups must detect propagating acoustic wavefronts");
});

test("stepSimulation numerically integrates 2D FDTD wave equation without NaN/Infinity", () => {
  initTankPreset("elliptic_focus");

  for (let s = 0; s < 20; s++) {
    stepSimulation(16);
  }

  for (let p = 0; p < MAX_PICKUPS; p++) {
    assert.ok(!Number.isNaN(pickups[p].lastHeight), `Pickup ${p} height must not be NaN`);
    assert.ok(Number.isFinite(pickups[p].lastHeight), `Pickup ${p} height must be finite`);
  }
});

test("getPickupNote quantizes spatial coordinates to valid MIDI pitch bounds", () => {
  for (let i = 0; i < MAX_PICKUPS; i++) {
    const note = getPickupNote(pickups[i]);
    assert.ok(Number.isInteger(note), `Pickup note must be an integer`);
    assert.ok(note >= 12 && note <= 127, `Pickup note ${note} must be in valid MIDI range [12, 127]`);
  }
});

test("generateRippleTankBank satisfies the generator function contract", () => {
  const bank = generateRippleTankBank({ length: 64, rate: 3 });
  assert.ok(Array.isArray(bank), "Bank must be an array");
  assert.equal(bank.length, 1);

  const pattern = bank[0];
  assert.equal(pattern.length, 64);
  assert.equal(pattern.rate, 3);
  assert.equal(pattern.steps.length, 64);

  pattern.steps.forEach((step, s) => {
    assert.ok(Number.isInteger(step.note), `Step ${s} note must be an integer`);
    assert.ok(step.vel >= 1 && step.vel <= 127, `Step ${s} velocity out of range`);
    assert.equal(step.gate, 1);
    assert.equal(step.source, "ripple_tank");
    assert.ok(step.pickupIdx >= 0 && step.pickupIdx < 8);
  });
});

test("ripple_tank snapshot registration and round trip restore", () => {
  const def = getModelDef("ripple_tank");
  assert.ok(def, "ripple_tank must be registered in snapshot.js");
  assert.equal(def.id, "ripple_tank");
  assert.equal(def.version, 1);

  initTankPreset("parabolic_reflector");
  pickups[0].x = 55;
  pickups[0].y = 22;

  const captured = def.capture();
  assert.ok(captured);
  assert.ok(Array.isArray(captured.pickups));
  assert.ok(Array.isArray(captured.barriers));

  // Modify then restore
  pickups[0].x = 10;
  def.restore(captured);
  assert.equal(pickups[0].x, 55);
  assert.equal(pickups[0].y, 22);
});

test("ripple_tank transport handlers toggle running state", () => {
  assert.equal(isRippleRunning(), false);
  startRipple();
  assert.equal(isRippleRunning(), true);
  stopRipple();
  assert.equal(isRippleRunning(), false);
  toggleRippleRunning();
  assert.equal(isRippleRunning(), true);
  toggleRippleRunning();
  assert.equal(isRippleRunning(), false);
});
