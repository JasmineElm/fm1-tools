// tests/boolean_euclidean.test.mjs — Comprehensive unit tests for Boolean Euclidean Logic model
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {}
  };
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
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
        strokeRect: () => {},
        setLineDash: () => {},
        ellipse: () => {},
        closePath: () => {}
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
  MAX_STREAMS,
  MAX_VOICES,
  BEUCLID_PRESETS,
  BOOLEAN_OPERATORS,
  streamK,
  streamN,
  streamRot,
  streamDegree,
  streamMute,
  initBooleanEuclideanStreams,
  evaluateStreamHit,
  evaluateBooleanLogic,
  stepBooleanEuclidean,
  generateBooleanEuclideanBank,
  isBooleanEuclideanRunning,
  startBooleanEuclidean,
  stopBooleanEuclidean,
  toggleBooleanEuclidean,
  applyBooleanEuclideanPreset,
  randomizeBooleanEuclidean,
  activateBooleanEuclideanModel,
  deactivateBooleanEuclideanModel
} from "../js/boolean_euclidean.js";

import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("BEUCLID_PRESETS contains required musical configurations", () => {
  assert.ok(Array.isArray(BEUCLID_PRESETS) && BEUCLID_PRESETS.length >= 5);
  const ids = BEUCLID_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("tresillo_coincidence"), "tresillo_coincidence preset must exist");
  assert.ok(ids.includes("bossa_interlock"), "bossa_interlock preset must exist");
  assert.ok(ids.includes("afro_bell_12"), "afro_bell_12 preset must exist");
  assert.ok(ids.includes("pygmy_polyrhythm"), "pygmy_polyrhythm preset must exist");
  assert.ok(ids.includes("euclid_acid_xor"), "euclid_acid_xor preset must exist");

  for (const p of BEUCLID_PRESETS) {
    assert.ok(BOOLEAN_OPERATORS.some((o) => o.id === p.op));
    assert.ok(p.streamA.k >= 1 && p.streamA.n >= 2);
    assert.ok(p.streamB.k >= 1 && p.streamB.n >= 2);
  }
});

test("Hardware polyphony ceiling: MAX_VOICES capped strictly at 8", () => {
  assert.equal(MAX_VOICES, 8, "MAX_VOICES must be strictly 8 for FM-1 hardware buffer safety");
  assert.equal(MAX_STREAMS, 4, "MAX_STREAMS must be 4");
});

test("initBooleanEuclideanStreams initializes stream registers within bounds", () => {
  initBooleanEuclideanStreams();
  for (let s = 0; s < MAX_STREAMS; s++) {
    assert.ok(streamK[s] >= 1 && streamK[s] <= 32);
    assert.ok(streamN[s] >= 2 && streamN[s] <= 32);
    assert.ok(streamRot[s] >= 0);
    assert.equal(streamMute[s], 0);
  }
});

test("evaluateStreamHit produces exact Euclidean pulse distribution", () => {
  // Test E(3, 8) Tresillo
  streamK[0] = 3;
  streamN[0] = 8;
  streamRot[0] = 0;
  streamMute[0] = 0;

  let hits = 0;
  for (let t = 0; t < 8; t++) {
    const hit = evaluateStreamHit(0, t);
    if (hit) hits++;
  }
  assert.equal(hits, 3, "E(3,8) must produce exactly 3 hits in 8 steps");

  // Test E(5, 16)
  streamK[1] = 5;
  streamN[1] = 16;
  streamRot[1] = 0;
  streamMute[1] = 0;

  let hits16 = 0;
  for (let t = 0; t < 16; t++) {
    if (evaluateStreamHit(1, t)) hits16++;
  }
  assert.equal(hits16, 5, "E(5,16) must produce exactly 5 hits in 16 steps");
});

test("evaluateBooleanLogic computes correct Boolean truth tables", () => {
  // XOR: 1^0 = 1, 1^1 = 0, 0^0 = 0
  assert.equal(evaluateBooleanLogic("xor", 1, 0, 0, 0), 1);
  assert.equal(evaluateBooleanLogic("xor", 1, 1, 0, 0), 0);
  assert.equal(evaluateBooleanLogic("xor", 0, 0, 0, 0), 0);

  // AND: 1&1 = 1, 1&0 = 0
  assert.equal(evaluateBooleanLogic("and", 1, 1, 0, 0), 1);
  assert.equal(evaluateBooleanLogic("and", 1, 0, 0, 0), 0);

  // OR: 1|0 = 1, 0|0 = 0
  assert.equal(evaluateBooleanLogic("or", 1, 0, 0, 0), 1);
  assert.equal(evaluateBooleanLogic("or", 0, 0, 0, 0), 0);

  // NAND: !(1&1) = 0, !(1&0) = 1
  assert.equal(evaluateBooleanLogic("nand", 1, 1, 0, 0), 0);
  assert.equal(evaluateBooleanLogic("nand", 1, 0, 0, 0), 1);

  // MAJORITY (>= 2 streams active)
  assert.equal(evaluateBooleanLogic("majority", 1, 1, 0, 0), 1);
  assert.equal(evaluateBooleanLogic("majority", 1, 0, 0, 0), 0);
  assert.equal(evaluateBooleanLogic("majority", 1, 1, 1, 0), 1);

  // PARITY (odd parity)
  assert.equal(evaluateBooleanLogic("parity", 1, 0, 0, 0), 1);
  assert.equal(evaluateBooleanLogic("parity", 1, 1, 0, 0), 0);
  assert.equal(evaluateBooleanLogic("parity", 1, 1, 1, 0), 1);
});

test("stepBooleanEuclidean derives scale quantized notes and coincidence velocity accents", () => {
  state.scale = "pentMinor";
  state.root = 60; // C4
  state.pitchSpan = 2;
  state.beuclidOp = "xor";
  state.beuclidVoices = 4;
  state.beuclidBoost = 80;

  const res = stepBooleanEuclidean(state, false);
  assert.ok(typeof res === "object");
  assert.ok(Array.isArray(res.selected));
  assert.ok(res.selected.length <= MAX_VOICES);

  for (const item of res.selected) {
    assert.ok(item.note >= 0 && item.note <= 127);
    assert.ok(item.vel >= 30 && item.vel <= 127);
  }
});

test("Generator contract: generateBooleanEuclideanBank returns valid 64-step bank array", () => {
  initBooleanEuclideanStreams();
  state.length = 64;
  state.rate = 3; // 1/16

  const bank = generateBooleanEuclideanBank(state);
  assert.ok(Array.isArray(bank), "generateBooleanEuclideanBank must return array");
  assert.equal(bank.length, 1);

  const pattern = bank[0];
  assert.equal(pattern.length, 64);
  assert.ok(Array.isArray(pattern.steps));
  assert.equal(pattern.steps.length, 64);

  for (let s = 0; s < 64; s++) {
    const st = pattern.steps[s];
    assert.ok(Array.isArray(st.notes));
    assert.ok(st.notes.length <= MAX_VOICES, "Voices strictly <= 8");
    for (const n of st.notes) {
      assert.ok(Number.isInteger(n.note) && n.note >= 0 && n.note <= 127);
      assert.ok(Number.isInteger(n.vel) && n.vel >= 0 && n.vel <= 127);
    }
  }
});

test("Snapshot capture and restore round-trip preserves state deterministically", () => {
  const def = getModelDef("boolean_euclidean");
  assert.ok(def, "boolean_euclidean must be registered in snapshot registry");

  applyBooleanEuclideanPreset("afro_bell_12");
  const captured = def.capture();
  assert.ok(captured);
  assert.equal(captured.op, "xor");
  assert.equal(captured.streamK.length, MAX_STREAMS);

  // Modify
  state.beuclidOp = "and";

  // Restore
  def.restore(captured);
  assert.equal(state.beuclidOp, "xor");
  assert.deepEqual(Array.from(streamK), captured.streamK);
});

test("Transport start/stop/toggle controls", () => {
  stopBooleanEuclidean();
  assert.equal(isBooleanEuclideanRunning(), false);

  startBooleanEuclidean();
  assert.equal(isBooleanEuclideanRunning(), true);

  toggleBooleanEuclidean();
  assert.equal(isBooleanEuclideanRunning(), false);

  toggleBooleanEuclidean();
  assert.equal(isBooleanEuclideanRunning(), true);

  stopBooleanEuclidean();
  assert.equal(isBooleanEuclideanRunning(), false);
});

test("randomizeBooleanEuclidean updates parameters and registers as model randomizer", () => {
  activateBooleanEuclideanModel();
  const randFn = getCurrentModelRandomizer();
  assert.equal(typeof randFn, "function");

  randomizeBooleanEuclidean();
  assert.ok(state.beuclidVoices >= 1 && state.beuclidVoices <= 8);
  assert.ok(BOOLEAN_OPERATORS.some((o) => o.id === state.beuclidOp));

  deactivateBooleanEuclideanModel();
});
