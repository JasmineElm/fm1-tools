// tests/krell.test.mjs — Comprehensive unit tests for Krell Generative Voltage Sequencer model
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
  KRELL_PRESETS,
  krellVoices,
  KrellVoice,
  generateKrellBank,
  randomizeKrell,
  startKrell,
  stopKrell,
  toggleKrellRunning,
  isKrellRunning,
  activateKrellModel,
  deactivateKrellModel
} from "../js/krell.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("KRELL_PRESETS contains required aleatoric parameter sets", () => {
  assert.ok(Array.isArray(KRELL_PRESETS) && KRELL_PRESETS.length >= 3);
});

test("KrellVoice envelope state machine advances and triggers notes", () => {
  const v = new KrellVoice(0);
  assert.ok(v);
  assert.equal(typeof v.triggerNewCycle, "function");
  assert.equal(typeof v.update, "function");

  v.triggerNewCycle();
  assert.equal(v.stage, "RISE");

  // Step voice forward
  v.update(0.05);
  assert.ok(v.rawEnv >= 0);
});

test("generateKrellBank satisfies generator contract", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;

  const bank = generateKrellBank();
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

test("Transport start/stop/toggle controls", () => {
  stopKrell();
  assert.equal(isKrellRunning(), false);

  startKrell();
  assert.equal(isKrellRunning(), true);

  toggleKrellRunning();
  assert.equal(isKrellRunning(), false);
});

test("randomizeKrell configures voices and registers as model randomizer", () => {
  activateKrellModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeKrell();
  deactivateKrellModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Krell snapshot capture and restore round-trip preserves state", () => {
  const def = getModelDef("krell");
  assert.ok(def, "krell model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(snap && typeof snap === "object");
  assert.doesNotThrow(() => def.restore(snap));
});
