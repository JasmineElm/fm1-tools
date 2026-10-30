// tests/sandpile.test.mjs — Comprehensive unit tests for Bak-Tang-Wiesenfeld Abelian Sandpile (SOC) model
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
        stroke: () => {},
        moveTo: () => {},
        lineTo: () => {},
        strokeRect: () => {},
        setLineDash: () => {}
      }),
      style: {}
    }),
    documentElement: { style: {}, getAttribute: () => null }
  };
}

import {
  SANDPILE_PRESETS,
  initSandpileGrid,
  dropGrains,
  runAvalancheCascade,
  generateSandpileBank,
  randomizeSandpile,
  startSandpile,
  stopSandpile,
  toggleSandpileRunning,
  isSandpileRunning,
  activateSandpileModel,
  deactivateSandpileModel
} from "../js/sandpile.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("SANDPILE_PRESETS contains standard SOC lattice configurations", () => {
  assert.ok(Array.isArray(SANDPILE_PRESETS));
  assert.ok(SANDPILE_PRESETS.length >= 4);
  const ids = SANDPILE_PRESETS.map(p => p.id);
  assert.ok(ids.includes("empty"));
  assert.ok(ids.includes("critical"));
  assert.ok(ids.includes("checker"));
});

test("initSandpileGrid and avalanche cascade dynamics", () => {
  state.sandpileGridSize = 25;
  initSandpileGrid("empty");

  // Drop 4 grains at center
  const cx = 12;
  const cy = 12;
  dropGrains(cx, cy, 4);

  // Run avalanche cascade
  const toppled = runAvalancheCascade(100, false);
  assert.ok(toppled >= 1, "Center cell with 4 grains should topple");

  // Critical state toppling cascade
  initSandpileGrid("critical");
  dropGrains(cx, cy, 1);
  const cascadeToppled = runAvalancheCascade(250, false);
  assert.ok(cascadeToppled >= 1, "Adding a grain to critical state (z=3) should trigger a cascade");
});

test("generateSandpileBank satisfies generator contract", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;
  state.sandpileGridSize = 21;

  const bank = generateSandpileBank();
  assert.ok(Array.isArray(bank));
  assert.ok(bank.length >= 1);
  assert.equal(bank[0].length, 16);
  assert.equal(bank[0].steps.length, 16);

  for (let i = 0; i < 16; i++) {
    const step = bank[0].steps[i];
    assert.ok(step && typeof step === "object");
    assert.ok(Array.isArray(step.notes));
    assert.ok(typeof step.velocity === "number");
    assert.ok(typeof step.gate === "number");
  }
});

test("Transport start/stop/toggle controls", () => {
  stopSandpile();
  assert.equal(isSandpileRunning(), false);

  startSandpile();
  assert.equal(isSandpileRunning(), true);

  toggleSandpileRunning();
  assert.equal(isSandpileRunning(), false);
});

test("randomizeSandpile configures parameters and registers as model randomizer", () => {
  activateSandpileModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeSandpile();
  deactivateSandpileModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Snapshot capture and restore for sandpile", () => {
  const modelDef = getModelDef("sandpile");
  assert.ok(modelDef, "sandpile model snapshot definition must exist");

  state.sandpileGridSize = 29;
  state.sandpilePreset = "critical";
  state.sandpileDropRate = 14;
  state.sandpileDropAmount = 2;
  state.sandpileDropPattern = "cross";

  const snap = modelDef.capture();
  assert.equal(snap.size, 29);
  assert.equal(snap.preset, "critical");
  assert.equal(snap.dropRate, 14);

  // Mutate state
  state.sandpilePreset = "empty";
  state.sandpileDropRate = 5;

  // Restore snapshot
  modelDef.restore(snap);
  assert.equal(state.sandpilePreset, "critical");
  assert.equal(state.sandpileDropRate, 14);
});
