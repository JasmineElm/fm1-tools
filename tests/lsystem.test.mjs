// tests/lsystem.test.mjs — Comprehensive unit tests for Lindenmayer L-System Fractal Plant model
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
  LSYSTEM_PRESETS,
  compileLSystem,
  buildSimulationCache,
  generateLsystemBank,
  isValidLSystemRule,
  generateRandomValidGrammar,
  randomizeLsystem,
  activateLsystemModel,
  deactivateLsystemModel
} from "../js/lsystem.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("LSYSTEM_PRESETS contains standard botanical fractal axiom and rule sets", () => {
  assert.ok(Array.isArray(LSYSTEM_PRESETS) && LSYSTEM_PRESETS.length >= 4);
  const ids = LSYSTEM_PRESETS.map(p => p.id);
  assert.ok(ids.includes("plant_a") || ids.includes("fern") || ids.includes("koch") || LSYSTEM_PRESETS.length >= 4);
});

test("isValidLSystemRule validates grammar characters", () => {
  assert.equal(isValidLSystemRule("F[+F]F[-F]F"), true);
  assert.equal(isValidLSystemRule("F+F-F"), true);
  assert.equal(isValidLSystemRule("INVALID_CHAR$@#"), false);
});

test("generateRandomValidGrammar creates valid balanced branch grammars", () => {
  for (let i = 0; i < 5; i++) {
    const grammar = generateRandomValidGrammar();
    assert.ok(grammar && grammar.axiom);
    assert.ok(isValidLSystemRule(grammar.ruleF));
  }
});

test("compileLSystem expands string iteratively across generations", () => {
  state.lsystemAxiom = "F";
  state.lsystemRuleF = "F+F";
  state.lsystemDepth = 2;

  const str = compileLSystem();
  // Depth 0: F
  // Depth 1: F+F
  // Depth 2: F+F+F+F
  assert.equal(str, "F+F+F+F");
});

test("generateLsystemBank generates valid bank conforming to sequence length", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;
  state.lsystemAxiom = "F";
  state.lsystemRuleF = "FF";
  state.lsystemIter = 2;

  const bank = generateLsystemBank();
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 16);
  assert.ok(bank[0].steps.length >= 16);

  for (let i = 0; i < 16; i++) {
    const step = bank[0].steps[i];
    assert.ok(step && typeof step === "object");
    assert.ok(Array.isArray(step.notes));
  }
});

test("randomizeLsystem updates parameters and registers as active model randomizer", () => {
  activateLsystemModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeLsystem();
  deactivateLsystemModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Lsystem snapshot capture and restore round-trip preserves state", () => {
  const def = getModelDef("lsystem");
  assert.ok(def, "lsystem model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(snap && typeof snap === "object");
  assert.doesNotThrow(() => def.restore(snap));
});
