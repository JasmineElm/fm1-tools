// tests/billiards.test.mjs — Comprehensive unit tests for Ballistic Billiards model
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {},
    addEventListener: () => {}
  };
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
}
function makeMockEl(tag = "div") {
  const children = [];
  return {
    tagName: tag.toUpperCase(),
    className: "",
    style: {},
    dataset: {},
    children,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: (c) => { children.push(c); return c; },
    append: (...cs) => { children.push(...cs); },
    addEventListener: () => {},
    getBoundingClientRect: () => ({ width: 440, height: 440, left: 0, top: 0 }),
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
    })
  };
}
const mockContainers = new Map();
if (typeof document === "undefined") {
  globalThis.document = {
    getElementById: (id) => mockContainers.get(id) || null,
    createElement: (tag) => makeMockEl(tag),
    createElementNS: (_ns, tag) => makeMockEl(tag),
    documentElement: {
      style: {},
      getAttribute: () => null
    }
  };
}

import {
  MAX_BODIES,
  MAX_VOICES,
  BILLIARDS_PRESETS,
  BALL_COLORS,
  posX,
  posY,
  velX,
  velY,
  ballRadius,
  flightDist,
  TRAIL_LEN,
  trailX,
  trailY,
  isBilliardsRunning,
  startBilliards,
  stopBilliards,
  toggleBilliardsRunning,
  initBilliardsSystem,
  getBilliardsNote,
  stepBilliardsSimulation,
  generateBilliardsBank,
  randomizeBilliards,
  initBilliards,
  activateBilliardsModel,
  deactivateBilliardsModel
} from "../js/billiards.js";
import { getModelDef } from "../js/snapshot.js";
import { getCurrentModelRandomizer, state } from "../js/state.js";

test("BILLIARDS_PRESETS contains the 5 mathematical dynamical tables", () => {
  assert.equal(BILLIARDS_PRESETS.length, 5);
  const ids = BILLIARDS_PRESETS.map(p => p.id);
  assert.ok(ids.includes("stadium"));
  assert.ok(ids.includes("sinai"));
  assert.ok(ids.includes("ellipse"));
  assert.ok(ids.includes("cardioid"));
  assert.ok(ids.includes("wedge"));
});

test("Hardware polyphony ceiling: MAX_VOICES and MAX_BODIES capped strictly at 8", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(MAX_BODIES, 8);
  assert.equal(BALL_COLORS.length, 8);
  assert.equal(posX.length, 8);
  assert.equal(posY.length, 8);
  assert.equal(velX.length, 8);
  assert.equal(velY.length, 8);
});

test("initBilliardsSystem initializes balls inside boundary with valid coordinates", () => {
  initBilliardsSystem(4, 1.2, "stadium");

  for (let i = 0; i < 4; i++) {
    assert.ok(!isNaN(posX[i]) && isFinite(posX[i]));
    assert.ok(!isNaN(posY[i]) && isFinite(posY[i]));
    assert.ok(!isNaN(velX[i]) && isFinite(velX[i]));
    assert.ok(!isNaN(velY[i]) && isFinite(velY[i]));

    // Coordinates should be centered around origin within table domain [-1.2, 1.2]
    assert.ok(Math.abs(posX[i]) <= 1.2);
    assert.ok(Math.abs(posY[i]) <= 1.2);

    // Initial velocity should not be zero
    const speed = Math.hypot(velX[i], velY[i]);
    assert.ok(speed > 0.01, `Ball ${i} speed should be non-zero`);
  }
});

test("getBilliardsNote quantizes collision geometry to valid MIDI notes within audible bounds", () => {
  const notes = [];
  for (let b = 0; b < 8; b++) {
    const note = getBilliardsNote(Math.cos(b), Math.sin(b), 0.5, b);
    assert.ok(Number.isInteger(note));
    assert.ok(note >= 12 && note <= 127, `Note ${note} must be valid MIDI within [12, 127]`);
    notes.push(note);
  }
  assert.equal(notes.length, 8);
});

test("stepBilliardsSimulation updates particle mechanics without numerical breakdown across all presets", () => {
  const presets = ["stadium", "sinai", "ellipse", "cardioid", "wedge"];

  for (const preset of presets) {
    initBilliardsSystem(preset);

    for (let step = 0; step < 50; step++) {
      const res = stepBilliardsSimulation(0.016);
      assert.ok(typeof res.triggered === "boolean");

      const balls = state.billiardsBalls || 3;
      for (let i = 0; i < balls; i++) {
        assert.ok(!isNaN(posX[i]), `NaN detected in posX[${i}] for preset ${preset}`);
        assert.ok(!isNaN(posY[i]), `NaN detected in posY[${i}] for preset ${preset}`);
        assert.ok(!isNaN(velX[i]), `NaN detected in velX[${i}] for preset ${preset}`);
        assert.ok(!isNaN(velY[i]), `NaN detected in velY[${i}] for preset ${preset}`);
        assert.ok(isFinite(posX[i]));
        assert.ok(isFinite(posY[i]));
      }
    }
  }
});

test("Generator contract: generateBilliardsBank returns valid bank array with 64 steps", () => {
  initBilliardsSystem(4, 1.0, "stadium");

  const bank = generateBilliardsBank({
    length: 64,
    billiardsOctave: 0,
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

test("Transport start/stop/toggle controls", () => {
  stopBilliards();
  assert.equal(isBilliardsRunning(), false);

  startBilliards();
  assert.equal(isBilliardsRunning(), true);

  toggleBilliardsRunning();
  assert.equal(isBilliardsRunning(), false);

  toggleBilliardsRunning();
  assert.equal(isBilliardsRunning(), true);
  stopBilliards();
});

test("Snapshot capture and restore round-trip preserves state deterministically", () => {
  const def = getModelDef("billiards");
  assert.ok(def, "billiards model definition must be registered in snapshot.js");

  initBilliardsSystem(5, 1.8, "sinai");
  const snap = def.capture();

  assert.equal(snap.balls, 5);
  assert.equal(snap.preset, "sinai");
  assert.equal(snap.speed, 1.8);
  assert.equal(snap.posX.length, 5);
  assert.equal(snap.posY.length, 5);

  initBilliardsSystem(2, 0.5, "wedge");
  assert.notEqual(def.capture().preset, "sinai");

  def.restore(snap);
  const restored = def.capture();
  assert.equal(restored.preset, "sinai");
  assert.equal(restored.balls, 5);
  assert.equal(restored.speed, 1.8);
});

test("randomizeBilliards updates parameters and registers as model randomizer", () => {
  activateBilliardsModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeBilliards();
  assert.ok(state.billiardsBalls >= 1 && state.billiardsBalls <= MAX_BODIES);
  assert.ok(BILLIARDS_PRESETS.some(p => p.id === state.billiardsPreset));

  deactivateBilliardsModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("initBilliards mounts DOM controls without error", () => {
  const container = makeMockEl("div");
  mockContainers.set("model-billiards", container);
  initBilliards();
  assert.ok(container.children.length > 0, "initBilliards should populate model container");
});
