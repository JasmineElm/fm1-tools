// tests/hanenbow.test.mjs — Unit test suite for Hanenbow movable launch node and boundary visibility
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {},
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: "" },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

if (typeof document === "undefined") {
  const dummyCtx = {
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
    clearRect: () => {},
    closePath: () => {},
    setLineDash: () => {},
    setTransform: () => {},
    resetTransform: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    measureText: () => ({ width: 10 }),
    canvas: { width: 800, height: 540 }
  };

  const createDummyEl = () => ({
    getContext: () => dummyCtx,
    style: {
      setProperty: () => {},
      removeProperty: () => {},
      width: "800px",
      height: "540px",
      display: "block"
    },
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 540 }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {}
  });

  globalThis.document = {
    getElementById: () => createDummyEl(),
    querySelector: () => createDummyEl(),
    querySelectorAll: () => [],
    createElement: () => createDummyEl(),
    documentElement: { style: {} }
  };
}

import {
  CAN_PAD,
  CAN_MIN_X,
  CAN_MAX_X,
  CAN_MIN_Y,
  CAN_MAX_Y,
  MIN_LEAF_LEN,
  MAX_LEAF_LEN,
  LEAF_LEN_DIVISOR,
  LEAF_LINE_WIDTH,
  BASE_PERIOD_SEC,
  LEAF_INCREMENT_THRESHOLD,
  getLeafLength,
  setLeafLength,
  getLeafCycleCount,
  setLeafCycleCount,
  getLeafAssessedPeriod,
  updateLeafPitch,
  getLeafNote,
  getCannon,
  setCannonPosition,
  generateHanenbowBank
} from "../js/hanenbow.js";
import { getModelDef } from "../js/snapshot.js";
import { state } from "../js/state.js";

test("Hanenbow cannon boundaries guarantee full node visibility within canvas", () => {
  // Reference canvas coordinate space is 800 x 540
  // Pad is set to 36px to accommodate:
  // - 14px base radius + 2px stroke + pulse ring up to 24px
  // - 24px barrel length + 6px pulse + tip radius
  // - "LAUNCH" text label offset by 22px
  assert.equal(CAN_PAD, 36);
  assert.equal(CAN_MIN_X, 36);
  assert.equal(CAN_MAX_X, 800 - 36);
  assert.equal(CAN_MIN_Y, 36);
  assert.equal(CAN_MAX_Y, 540 - 36);
});

test("setCannonPosition sets coordinate within canvas limits", () => {
  setCannonPosition(350, 220);
  const cannon = getCannon();
  assert.equal(cannon.x, 350);
  assert.equal(cannon.y, 220);
});

test("setCannonPosition clamps coordinates to stay strictly within visible bounds", () => {
  // Out of bounds negative / below min
  setCannonPosition(-100, -50);
  let cannon = getCannon();
  assert.equal(cannon.x, CAN_MIN_X);
  assert.equal(cannon.y, CAN_MIN_Y);

  // Out of bounds above canvas maximum
  setCannonPosition(1200, 900);
  cannon = getCannon();
  assert.equal(cannon.x, CAN_MAX_X);
  assert.equal(cannon.y, CAN_MAX_Y);
});

test("Snapshot capture and restore preserves and clamps custom cannon position", () => {
  const modelDef = getModelDef("hanenbow");
  assert.ok(modelDef, "hanenbow model registered in snapshot registry");

  // Set position to custom location and capture
  setCannonPosition(420, 180);
  const snap = modelDef.capture();
  assert.equal(snap.cannon.x, 420);
  assert.equal(snap.cannon.y, 180);

  // Restore with out of bounds coordinates
  modelDef.restore({
    cannon: { x: -999, y: 9999, angle: -0.5, speed: 600 }
  });

  const cannon = getCannon();
  assert.equal(cannon.x, CAN_MIN_X);
  assert.equal(cannon.y, CAN_MAX_Y);
  assert.equal(cannon.angle, -0.5);
  assert.equal(cannon.speed, 600);
});

test("generateHanenbowBank returns valid bank with custom cannon position", () => {
  setCannonPosition(200, 150);
  const bank = generateHanenbowBank(state);
  assert.ok(Array.isArray(bank), "bank must be an array");
  assert.equal(bank.length, 16);
  assert.ok(bank[0].steps.length > 0, "bank must contain steps");
  assert.equal(typeof bank[0].rate, "number");
});

test("common leaf line width uses divisor on minimum leaf length", () => {
  assert.ok(MIN_LEAF_LEN > 0, "minimum leaf length is defined");
  assert.ok(LEAF_LEN_DIVISOR > 0, "leaf length divisor is defined");
  assert.equal(LEAF_LINE_WIDTH, MIN_LEAF_LEN / LEAF_LEN_DIVISOR);
  // With MIN_LEAF_LEN = 48 and divisor = 6, uniform line width is 8px
  assert.equal(MIN_LEAF_LEN, 48);
  assert.equal(LEAF_LEN_DIVISOR, 6);
  assert.equal(LEAF_LINE_WIDTH, 8);
});

test("resizing leaf changes length of leaf only and clamps within bounds", () => {
  // Set leaf 0 to mid length
  setLeafLength(0, 120);
  assert.equal(getLeafLength(0), 120);

  // Common line width remains strictly constant regardless of length
  assert.equal(LEAF_LINE_WIDTH, 8);

  // Clamping below MIN_LEAF_LEN
  setLeafLength(0, 10);
  assert.equal(getLeafLength(0), MIN_LEAF_LEN);
  assert.equal(LEAF_LINE_WIDTH, 8);

  // Clamping above MAX_LEAF_LEN
  setLeafLength(0, 500);
  assert.equal(getLeafLength(0), MAX_LEAF_LEN);
  assert.equal(LEAF_LINE_WIDTH, 8);
});

test("assessed period equals base 5s * user-control multiplier (0.25 to 4.0) * (leaf length / 100)", () => {
  assert.equal(BASE_PERIOD_SEC, 5.0);

  // Leaf length 100, control 1.0 -> 5.0 * 1.0 * (100 / 100) = 5.0s
  setLeafLength(0, 100);
  state.hanenbowTimingPeriod = 1.0;
  assert.equal(getLeafAssessedPeriod(0), 5.0);

  // Leaf length 48 (minimum), control 1.0 -> 5.0 * 1.0 * (48 / 100) = 2.4s
  setLeafLength(0, 48);
  assert.equal(getLeafAssessedPeriod(0), 2.4);

  // Leaf length 200, control 0.25 -> 5.0 * 0.25 * (200 / 100) = 2.5s
  setLeafLength(0, 200);
  state.hanenbowTimingPeriod = 0.25;
  assert.equal(getLeafAssessedPeriod(0), 2.5);

  // Leaf length 200, control 4.0 -> 5.0 * 4.0 * (200 / 100) = 40.0s
  state.hanenbowTimingPeriod = 4.0;
  assert.equal(getLeafAssessedPeriod(0), 40.0);
});

test("pitch increments on leaf hits and drops when hit count falls below 0.5 of threshold", () => {
  // Configure leaf 1: length 100, period multiplier 1.0 -> assessed period = 5.0s
  setLeafLength(1, 100);
  state.hanenbowTimingPeriod = 1.0;
  setLeafCycleCount(1, 0);

  const t0 = 100.0; // base timestamp

  // Hit 1: initial trigger
  updateLeafPitch(1, true, t0);
  assert.equal(getLeafCycleCount(1), 0); // initial hit starts cycle tracking

  // Hit 2: hit within assessed period increments pitch
  updateLeafPitch(1, true, t0 + 1.0);
  assert.equal(getLeafCycleCount(1), 1);

  // Hit 3: another hit within assessed period increments pitch again
  updateLeafPitch(1, true, t0 + 2.5);
  assert.equal(getLeafCycleCount(1), 2);

  // Sustained hit rate: hit at t0 + 6.0s (within 5.0s of previous hit at t0 + 2.5s)
  // Hits in last 5s [1.0s, 6.0s] are at 2.5s and 6.0s (>= 0.5 threshold)
  updateLeafPitch(1, false, t0 + 6.0);
  assert.equal(getLeafCycleCount(1), 2, "pitch remains elevated when hit rate is maintained");

  // Inactivity: assessed period of 5.0s elapses with NO hits (hits in [3.0s, 8.0s] = 0 < 0.5 threshold)
  // Pitch should drop again by 1 step (from 2 down to 1)
  updateLeafPitch(1, false, t0 + 8.0);
  assert.equal(getLeafCycleCount(1), 1, "pitch drops by 1 step when hits drop below 0.5 of increment threshold");

  // Further inactivity: another assessed period of 5.0s elapses with NO hits
  // Pitch drops again from 1 to 0
  updateLeafPitch(1, false, t0 + 13.5);
  assert.equal(getLeafCycleCount(1), 0, "pitch drops back to base pitch (0)");

  // Pitch never drops below base 0
  updateLeafPitch(1, false, t0 + 25.0);
  assert.equal(getLeafCycleCount(1), 0, "pitch clamped at base pitch");
});


