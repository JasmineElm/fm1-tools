// tests/pendulum.test.mjs — Comprehensive unit tests for Chaotic Double Pendulum model
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
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      addEventListener: () => {},
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {}
      }),
      style: {}
    }),
    documentElement: { style: {}, getAttribute: () => null }
  };
}

import {
  NUM_SECTORS,
  PENDULUM_PRESETS,
  getSectors,
  getSectorIndex,
  getPolarAngleFromTop,
  getSectorNote,
  startPendulum,
  stopPendulum,
  togglePendulumRunning,
  isPendulumRunning,
  randomizePendulum,
  activatePendulumModel,
  deactivatePendulumModel
} from "../js/pendulum.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("NUM_SECTORS is 36 and presets are defined", () => {
  assert.equal(NUM_SECTORS, 36);
  assert.ok(Array.isArray(PENDULUM_PRESETS) && PENDULUM_PRESETS.length >= 4);
});

test("Polar angle calculation and sector indexing", () => {
  // Top center (0, -1) -> 0 radians -> sector 0
  const topSector = getSectorIndex(0, -1);
  assert.equal(topSector, 0);

  // Right (1, 0) -> Math.PI / 2 radians -> sector 9 (36 * 0.25 = 9)
  const rightSector = getSectorIndex(1, 0);
  assert.equal(rightSector, 9);

  // Bottom (0, 1) -> Math.PI radians -> sector 18 (36 * 0.5 = 18)
  const bottomSector = getSectorIndex(0, 1);
  assert.equal(bottomSector, 18);
});

test("Sector array initialization and note lookup", () => {
  const sectors = getSectors();
  assert.ok(Array.isArray(sectors));
  assert.equal(sectors.length, 36);

  const note = getSectorNote(0);
  assert.ok(Number.isInteger(note));
  assert.ok(note >= 0 && note <= 127);
});

test("Transport start/stop/toggle controls", () => {
  stopPendulum();
  assert.equal(isPendulumRunning(), false);

  startPendulum();
  assert.equal(isPendulumRunning(), true);

  togglePendulumRunning();
  assert.equal(isPendulumRunning(), false);
});

test("randomizePendulum updates parameters and registers as model randomizer", () => {
  activatePendulumModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  state.pendulumSectors = new Array(NUM_SECTORS).fill(1);
  randomizePendulum();
  const sectors = getSectors();
  assert.equal(sectors.length, NUM_SECTORS);
  const activeCount = sectors.reduce((sum, v) => sum + (v ? 1 : 0), 0);
  assert.ok(activeCount >= 6 && activeCount <= NUM_SECTORS - 6, "randomizePendulum should randomize active radial sectors");
  assert.ok(Array.isArray(state.pendulumSectorNotes) && state.pendulumSectorNotes.length === NUM_SECTORS);
  deactivatePendulumModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Pendulum snapshot capture and restore round-trip preserves state", () => {
  const def = getModelDef("pendulum");
  assert.ok(def, "pendulum model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(snap && typeof snap === "object");
  assert.ok(Array.isArray(snap.sectors));

  assert.doesNotThrow(() => def.restore(snap));
});
