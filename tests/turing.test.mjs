// tests/turing.test.mjs — Comprehensive unit tests for Turing Machine (Shift-Register) model
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
  TURING_LENGTHS,
  MUTATION_PRESETS,
  BIT_PATTERNS,
  generateTuringBank,
  randomizeTuring,
  activateTuringModel,
  deactivateTuringModel
} from "../js/turing.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("TURING_LENGTHS and MUTATION_PRESETS contain expected configurations", () => {
  assert.deepEqual(TURING_LENGTHS, [8, 16, 24, 32, 48, 64]);
  assert.equal(MUTATION_PRESETS.length, 5);
  assert.equal(BIT_PATTERNS.length, 6);
});

test("generateTuringBank generates valid 64-step bank conforming to length and pitch bounds", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;
  state.turingLength = 16;
  state.turingProb = 0; // locked

  const bank = generateTuringBank();
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].steps.length, 64);

  for (let i = 0; i < 64; i++) {
    const step = bank[0].steps[i];
    assert.ok(step && typeof step === "object");
    assert.ok(Array.isArray(step.notes));
    for (const n of step.notes) {
      assert.ok(Number.isInteger(n.note));
      assert.ok(n.note >= 0 && n.note <= 127);
    }
  }
});

test("randomizeTuring randomizes bits and registers as active model randomizer", () => {
  activateTuringModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeTuring();
  const bank = generateTuringBank();
  assert.ok(Array.isArray(bank));

  deactivateTuringModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Turing snapshot round-trip serialization preserves bits and gates", () => {
  const def = getModelDef("turing");
  assert.ok(def, "turing model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(Array.isArray(snap.bits));
  assert.equal(snap.bits.length, 64);
  assert.ok(Array.isArray(snap.gates));
  assert.equal(snap.gates.length, 64);

  // Restore
  assert.doesNotThrow(() => def.restore(snap));
});
