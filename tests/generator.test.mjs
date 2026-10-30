// tests/generator.test.mjs — Comprehensive unit tests for Generator, Mulberry32 PRNG, and Scale definitions
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {};
}
if (typeof document === "undefined") {
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      addEventListener: () => {}
    }),
    documentElement: { style: {}, getAttribute: () => null }
  };
}

import {
  mulberry32,
  SCALES,
  midiName,
  classicName,
  generateBank
} from "../js/generator.js";

test("mulberry32 generates deterministic pseudorandom floating-point numbers in [0, 1)", () => {
  const seed = 12345;
  const rng1 = mulberry32(seed);
  const rng2 = mulberry32(seed);

  const seq1 = [rng1(), rng1(), rng1(), rng1(), rng1()];
  const seq2 = [rng2(), rng2(), rng2(), rng2(), rng2()];

  assert.deepEqual(seq1, seq2, "Same seed must produce identical PRNG sequence");

  for (const val of seq1) {
    assert.ok(typeof val === "number");
    assert.ok(val >= 0 && val < 1.0);
    assert.ok(!isNaN(val));
  }
});

test("SCALES contains standard musical interval structures", () => {
  assert.ok(Array.isArray(SCALES.major));
  assert.deepEqual(SCALES.major, [0, 2, 4, 5, 7, 9, 11]);

  assert.ok(Array.isArray(SCALES.pentMinor));
  assert.deepEqual(SCALES.pentMinor, [0, 3, 5, 7, 10]);

  assert.ok(Array.isArray(SCALES.chromatic));
  assert.equal(SCALES.chromatic.length, 12);
});

test("midiName converts MIDI note numbers to Scientific Pitch Notation", () => {
  assert.equal(midiName(60), "C4");
  assert.equal(midiName(69), "A4");
  assert.equal(midiName(0), "C-1");
  assert.equal(midiName(127), "G9");
  assert.equal(midiName(61), "C#4");
});

test("classicName formats Euclidean pairs to rhythm names", () => {
  assert.equal(typeof classicName(5, 8), "string");
  assert.equal(classicName(99, 99), null);
});

test("generateBank satisfies bank generator contract for Mene311 model", () => {
  const dummyState = {
    length: 16,
    rate: 1,
    tempo: 120,
    swing: 50,
    gate: 50,
    seed: 42,
    scale: "pentMinor",
    root: 60,
    lfoWave: "sine",
    lfoAmp: 0,
    lfoOffset: 0,
    lfoRate: 1,
    lfoShape: 50,
    gateProb: 100,
    quantSteps: 100,
    bias: 0,
    spread: "uniform",
    octaveMode: "up",
    dejaVu: 0,
    dejaVuLen: 16
  };

  const bank = generateBank(dummyState);
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 16);
  assert.ok(bank[0].steps.length >= 16);

  for (let i = 0; i < 16; i++) {
    const step = bank[0].steps[i];
    assert.ok(step && typeof step === "object");
    assert.ok(Array.isArray(step.notes));
    for (const n of step.notes) {
      assert.ok(Number.isInteger(n.note));
      assert.ok(n.note >= 0 && n.note <= 127);
    }
  }
});
