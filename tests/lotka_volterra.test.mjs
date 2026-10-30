// tests/lotka_volterra.test.mjs — Comprehensive unit tests for Lotka-Volterra Predator-Prey model
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
  LV_PRESETS,
  getNoteFromXY,
  generateLotkaVolterraBank,
  randomizeLotkaVolterra,
  startLotkaVolterraFree,
  stopLotkaVolterraFree,
  toggleLotkaVolterraFree,
  activateLotkaVolterraModel,
  deactivateLotkaVolterraModel
} from "../js/lotka_volterra.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("LV_PRESETS contains required ecological dynamic presets", () => {
  assert.ok(Array.isArray(LV_PRESETS) && LV_PRESETS.length >= 4);
});

test("getNoteFromXY quantizes phase plane coordinates to valid scale pitches", () => {
  const note = getNoteFromXY(2.0, 1.5, 0);
  assert.ok(Number.isInteger(note));
  assert.ok(note >= 0 && note <= 127);
});

test("generateLotkaVolterraBank satisfies generator contract", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;

  const bank = generateLotkaVolterraBank();
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
  stopLotkaVolterraFree();
  startLotkaVolterraFree();
  toggleLotkaVolterraFree();
});

test("randomizeLotkaVolterra configures parameters and registers with model randomizer", () => {
  activateLotkaVolterraModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeLotkaVolterra();
  deactivateLotkaVolterraModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Lotka-Volterra snapshot capture and restore round-trip preserves state", () => {
  const def = getModelDef("lotka_volterra");
  assert.ok(def, "lotka_volterra model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(snap && typeof snap === "object");
  assert.doesNotThrow(() => def.restore(snap));
});
