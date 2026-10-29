// tests/self_avoiding_walk.test.mjs — Unit tests for Polymer Self-Avoiding Walk model
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
  GRID_DIM,
  TOTAL_CELLS,
  MAX_CHAIN_LEN,
  lattice,
  chainX,
  chainY,
  chainDir,
  chainLen,
  sawVoices,
  SAW_PRESETS,
  initSawPreset,
  resetChain,
  getMonomerNote,
  computeRadiusOfGyration,
  triggerCollapseCascade,
  stepMonomer,
  stepSimulation,
  generateSelfAvoidingWalkBank,
  startSelfAvoidingWalk,
  stopSelfAvoidingWalk,
  toggleSelfAvoidingWalkRunning,
  isSelfAvoidingWalkRunning
} from "../js/self_avoiding_walk.js";
import { getModelDef } from "../js/snapshot.js";

test("SAW_PRESETS contains required conformational polymer growth regimes", () => {
  assert.equal(SAW_PRESETS.length, 5);
  const ids = SAW_PRESETS.map(p => p.id);
  assert.ok(ids.includes("spontaneous_globule"));
  assert.ok(ids.includes("directed_filament"));
  assert.ok(ids.includes("helical_hairpin"));
  assert.ok(ids.includes("steric_trap"));
  assert.ok(ids.includes("annealed_crystal"));
});

test("Hardware polyphony ceiling: MAX_VOICES is strictly capped at 8", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(sawVoices.length, 8);
});

test("initSawPreset and resetChain initialize lattice and seed monomer", () => {
  initSawPreset("spontaneous_globule");

  assert.equal(chainLen, 1);
  assert.ok(chainX[0] >= 0 && chainX[0] < GRID_DIM);
  assert.ok(chainY[0] >= 0 && chainY[0] < GRID_DIM);
  assert.equal(lattice[chainY[0] * GRID_DIM + chainX[0]], 1);
});

test("Self-avoidance invariant: steps strictly advance to unoccupied sites without self-intersection", () => {
  initSawPreset("spontaneous_globule");

  for (let s = 0; s < 30; s++) {
    const res = stepMonomer();
    if (res.stepped) {
      const hx = chainX[chainLen - 1];
      const hy = chainY[chainLen - 1];

      // Verify that this position is unique in the chain
      let occurrences = 0;
      for (let i = 0; i < chainLen; i++) {
        if (chainX[i] === hx && chainY[i] === hy) {
          occurrences++;
        }
      }
      assert.equal(occurrences, 1, `Monomer at (${hx}, ${hy}) must not self-intersect`);
    }
  }
});

test("computeRadiusOfGyration calculates physical non-negative metric", () => {
  initSawPreset("directed_filament");

  for (let s = 0; s < 20; s++) {
    stepMonomer();
  }

  const rg = computeRadiusOfGyration();
  assert.ok(!isNaN(rg) && isFinite(rg));
  assert.ok(rg > 0.0, "Radius of gyration of multi-monomer chain must be positive");
});

test("getMonomerNote quantizes lattice coordinates to valid MIDI pitches within audible bounds", () => {
  for (let x = 0; x < GRID_DIM; x += 4) {
    for (let y = 0; y < GRID_DIM; y += 4) {
      for (let d = 0; d < 4; d++) {
        const note = getMonomerNote(x, y, d, 0);
        assert.ok(Number.isInteger(note));
        assert.ok(note >= 12 && note <= 127, `Note ${note} out of MIDI bounds`);
      }
    }
  }
});

test("Steric entrapment: artificially trapped head triggers conformational collapse cascade", () => {
  resetChain(16, 16);

  // Surround the head (16, 16) with occupied walls in all 4 directions
  lattice[(16 - 1) * GRID_DIM + 16] = 99; // Up
  lattice[(16 + 1) * GRID_DIM + 16] = 99; // Down
  lattice[16 * GRID_DIM + (16 + 1)] = 99; // Right
  lattice[16 * GRID_DIM + (16 - 1)] = 99; // Left

  // Next step has 0 valid moves -> must trigger collapse!
  const res = stepMonomer();
  assert.equal(res.stepped, false);
  assert.equal(res.jammed, true);
  assert.equal(res.reason, "steric_jam");
});

test("stepSimulation advances polymer chain and updates telemetry without errors", () => {
  initSawPreset("spontaneous_globule");

  for (let i = 0; i < 50; i++) {
    const res = stepSimulation(0.016);
    assert.ok(typeof res.stepped === "boolean");
    assert.ok(typeof res.jammed === "boolean");
    assert.ok(Number.isInteger(res.chainLen));
    assert.ok(!isNaN(res.radiusOfGyration));
  }
});

test("Generator contract: generateSelfAvoidingWalkBank returns valid 64-step bank array", () => {
  initSawPreset("annealed_crystal");

  const bank = generateSelfAvoidingWalkBank({
    length: 64,
    sawOctave: 0,
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

test("Snapshot capture and restore round-trip preserves polymer chain and parameters", () => {
  const def = getModelDef("self_avoiding_walk");
  assert.ok(def, "self_avoiding_walk model definition must be registered in snapshot.js");

  initSawPreset("steric_trap");
  for (let i = 0; i < 15; i++) stepMonomer();

  const snap = def.capture();
  assert.equal(snap.preset, "steric_trap");
  assert.ok(snap.chain.length > 1);

  initSawPreset("directed_filament");
  def.restore(snap);

  assert.equal(def.capture().preset, "steric_trap");
});

test("Transport start/stop/toggle controls", () => {
  stopSelfAvoidingWalk();
  assert.equal(isSelfAvoidingWalkRunning(), false);

  startSelfAvoidingWalk();
  assert.equal(isSelfAvoidingWalkRunning(), true);

  toggleSelfAvoidingWalkRunning();
  assert.equal(isSelfAvoidingWalkRunning(), false);

  toggleSelfAvoidingWalkRunning();
  assert.equal(isSelfAvoidingWalkRunning(), true);
  stopSelfAvoidingWalk();
});
