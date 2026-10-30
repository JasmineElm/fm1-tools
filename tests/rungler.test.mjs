// tests/rungler.test.mjs — Unit tests for Rob Hordijk Rungler sequencer model
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {},
    devicePixelRatio: 1
  };
}

const dummyCtx = {
  fillRect: () => {},
  strokeRect: () => {},
  clearRect: () => {},
  beginPath: () => {},
  arc: () => {},
  fill: () => {},
  stroke: () => {},
  fillText: () => {},
  save: () => {},
  restore: () => {},
  setTransform: () => {},
  setLineDash: () => {},
  moveTo: () => {},
  lineTo: () => {},
  scale: () => {},
  translate: () => {},
  rotate: () => {},
  measureText: () => ({ width: 10 }),
  canvas: { width: 400, height: 400 }
};

const createDummyEl = () => ({
  getContext: () => dummyCtx,
  style: {
    setProperty: () => {},
    removeProperty: () => {},
    width: "400px",
    height: "400px",
    display: "block"
  },
  classList: {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false
  },
  dataset: {},
  children: [],
  appendChild(c) { this.children.push(c); },
  append(...cs) { this.children.push(...cs); },
  removeChild: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  getAttribute: () => null,
  removeAttribute: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  value: "0",
  textContent: "",
  innerHTML: ""
});

const dummyEl = createDummyEl();

if (typeof document === "undefined") {
  globalThis.document = {
    getElementById: () => dummyEl,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    createElement: () => createDummyEl(),
    createElementNS: () => createDummyEl(),
    documentElement: {
      style: {
        setProperty: () => {},
        removeProperty: () => {}
      },
      getAttribute: () => null
    }
  };
}

if (typeof getComputedStyle === "undefined") {
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => "#000000"
  });
}

import { state, refs, setBank } from "../js/state.js";
import {
  initRungler,
  runglerBits,
  runglerTaps,
  getRunglerDac,
  getRunglerNote,
  generateRunglerBank,
  clockShiftRegister,
  randomizeRungler
} from "../js/rungler.js";
import { getRootMidi } from "../js/scale.js";

test("Rungler notes strictly adhere to global state.pitchSpan from Notes div", () => {
  state.scale = "major";
  state.rootNote = 0; // C
  state.rootOctave = 3; // C3 = 48
  const root = getRootMidi();

  // Test across spans 1, 2, 3, 4 octaves
  for (const span of [1, 2, 3, 4]) {
    state.pitchSpan = span;

    // Minimum DAC val (0) -> base root
    const minNote = getRunglerNote(0);
    assert.equal(minNote.note, root, `At span=${span}, DAC 0 must equal root note`);

    // Maximum DAC val (15) -> upper octave bound
    const maxNote = getRunglerNote(15);
    const maxExpectedRaw = root + span * 12;
    assert.ok(maxNote.note <= maxExpectedRaw, `At span=${span}, note (${maxNote.note}) must not exceed root + ${span} octaves (${maxExpectedRaw})`);
    assert.ok(maxNote.note >= root, `At span=${span}, note (${maxNote.note}) must not be below root (${root})`);
  }
});

test("generateRunglerBank satisfies bank generator contract and obeys state.length and pitchSpan", () => {
  state.length = 16;
  state.pitchSpan = 3;
  state.scale = "pentMinor";

  const bank = generateRunglerBank();
  assert.ok(Array.isArray(bank), "generateRunglerBank must return an array");
  assert.equal(bank.length, 1, "Expected single bank pattern");
  assert.equal(bank[0].length, 16, "Sequence length must match state.length");
  assert.equal(bank[0].steps.length, 64, "Expected 64 steps simulated for pattern");

  const root = getRootMidi();
  const maxMidi = root + 3 * 12;

  for (const step of bank[0].steps) {
    const noteVal = typeof step._savedNote === "object" ? step._savedNote.note : step._savedNote;
    if (noteVal !== undefined && noteVal !== null) {
      assert.ok(noteVal >= root, `Step note ${noteVal} should be >= root ${root}`);
      assert.ok(noteVal <= maxMidi, `Step note ${noteVal} should be <= root + 3 octaves ${maxMidi}`);
    }
  }
});

test("initRungler does not register redundant local runglerSpan knob in refs", () => {
  // Ensure refs does not have a local runglerSpan knob
  refs.runglerSpan = undefined;
  initRungler();
  assert.equal(refs.runglerSpan, undefined, "Local runglerSpan knob must be removed from refs");
});

test("Rungler shift register shifts bits and DAC reflects taps", () => {
  // Set known pattern
  for (let i = 0; i < 16; i++) runglerBits[i] = 0;
  runglerBits[15] = 1;

  const dac = getRunglerDac();
  assert.equal(typeof dac.val, "number");
  assert.ok(dac.val >= 0 && dac.val <= 15, "DAC val must be 0..15");

  clockShiftRegister();
  // Bit 15 shifted out, previous bit 14 moved into 15
  assert.equal(runglerBits[15], 0);
});

test("randomizeRungler randomizes frequencies and shift register", () => {
  randomizeRungler();
  assert.ok(state.runglerFreq1 >= 0.2, "Freq 1 must be randomized within valid bounds");
  assert.ok(state.runglerFreq2 >= 0.2, "Freq 2 must be randomized within valid bounds");
  assert.equal(runglerTaps.length, 4, "Must maintain 4 DAC taps");
});
