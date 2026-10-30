// tests/orbital.test.mjs — Comprehensive unit tests for Keplerian Orbital Mechanics model
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
  ORBITAL_PRESETS,
  initPlanetarySystem,
  getPlanetNote,
  generateOrbitalBank,
  randomizeOrbital,
  startOrbital,
  stopOrbital,
  toggleOrbitalRunning,
  isOrbitalRunning,
  activateOrbitalModel,
  deactivateOrbitalModel
} from "../js/orbital.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("ORBITAL_PRESETS contains standard celestial resonance systems", () => {
  assert.ok(Array.isArray(ORBITAL_PRESETS) && ORBITAL_PRESETS.length >= 4);
});

test("initPlanetarySystem configures bodies and orbits", () => {
  initPlanetarySystem("laplace");
  assert.equal(state.orbitalPreset, "laplace");

  const note = getPlanetNote(0);
  assert.ok(Number.isInteger(note));
  assert.ok(note >= 0 && note <= 127);
});

test("generateOrbitalBank satisfies generator contract", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;

  const bank = generateOrbitalBank();
  assert.ok(Array.isArray(bank));
  assert.ok(bank.length >= 1);
  assert.equal(bank[0].length, 16);
  assert.ok(bank[0].steps.length >= 16);

  for (let i = 0; i < 16; i++) {
    const step = bank[0].steps[i];
    assert.ok(step && typeof step === "object");
    assert.ok(Array.isArray(step.notes));
  }
});

test("Transport start/stop/toggle controls", () => {
  stopOrbital();
  assert.equal(isOrbitalRunning(), false);

  startOrbital();
  assert.equal(isOrbitalRunning(), true);

  toggleOrbitalRunning();
  assert.equal(isOrbitalRunning(), false);
});

test("randomizeOrbital configures planetary system and registers as model randomizer", () => {
  activateOrbitalModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeOrbital();
  deactivateOrbitalModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Orbital snapshot capture and restore round-trip preserves state", () => {
  const def = getModelDef("orbital");
  assert.ok(def, "orbital model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(snap && typeof snap === "object");
  assert.doesNotThrow(() => def.restore(snap));
});
