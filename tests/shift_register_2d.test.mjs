// tests/shift_register_2d.test.mjs — Comprehensive unit tests for 2D Shift Register model
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
  GRID_SIZE,
  TOTAL_CELLS,
  MAX_VOICES,
  MAX_TAPS,
  SR2D_PRESETS,
  CLOCK_RATIOS,
  FEEDBACK_LOGICS,
  FEEDBACK_TARGETS,
  READ_MODES,
  TRIGGER_CONDS,
  gridBits,
  prevBits,
  tapCoords,
  carryBit,
  initShiftRegister2dGrid,
  evaluateFeedbackLogic,
  shiftMatrix,
  injectFeedback,
  evaluateVoice,
  stepShiftRegister2d,
  generateShiftRegister2dBank,
  isShiftRegister2dRunning,
  startShiftRegister2d,
  stopShiftRegister2d,
  toggleShiftRegister2d,
  applyShiftRegister2dPreset,
  randomizeShiftRegister2d,
  activateShiftRegister2dModel,
  deactivateShiftRegister2dModel
} from "../js/shift_register_2d.js";

import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("SR2D_PRESETS contains required musical configurations", () => {
  assert.ok(Array.isArray(SR2D_PRESETS) && SR2D_PRESETS.length >= 5);
  const ids = SR2D_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("techno_ostinato"), "techno_ostinato preset must exist");
  assert.ok(ids.includes("triadex_muse"), "triadex_muse preset must exist");
  assert.ok(ids.includes("toroidal_warp"), "toroidal_warp preset must exist");
  assert.ok(ids.includes("euclidean_matrix"), "euclidean_matrix preset must exist");
  assert.ok(ids.includes("fibonacci_chaos"), "fibonacci_chaos preset must exist");

  for (const p of SR2D_PRESETS) {
    assert.ok(p.voices >= 1 && p.voices <= 8, "Preset voices within 1..8");
    assert.ok(p.taps.length === 8, "Preset taps array has 4 (x,y) pairs");
    assert.ok(CLOCK_RATIOS.some((r) => r.id === p.clockRatio));
    assert.ok(FEEDBACK_LOGICS.some((l) => l.id === p.feedbackLogic));
    assert.ok(READ_MODES.some((m) => m.id === p.readMode));
  }
});

test("Hardware polyphony ceiling: MAX_VOICES capped strictly at 8", () => {
  assert.equal(MAX_VOICES, 8, "MAX_VOICES must be strictly 8 for FM-1 hardware limit");
  assert.equal(GRID_SIZE, 8, "GRID_SIZE must be 8");
  assert.equal(TOTAL_CELLS, 64, "TOTAL_CELLS must be 64");
  assert.equal(MAX_TAPS, 4, "MAX_TAPS must be 4");
});

test("initShiftRegister2dGrid initializes bit matrix and feedback taps within valid bounds", () => {
  initShiftRegister2dGrid("alternating");
  assert.equal(gridBits.length, 64);
  for (let i = 0; i < 64; i++) {
    assert.ok(gridBits[i] === 0 || gridBits[i] === 1);
  }
  for (let t = 0; t < MAX_TAPS; t++) {
    const x = tapCoords[t * 2];
    const y = tapCoords[t * 2 + 1];
    assert.ok(x >= 0 && x < 8, `Tap ${t} x coordinate in bounds`);
    assert.ok(y >= 0 && y < 8, `Tap ${t} y coordinate in bounds`);
  }
});

test("Toroidal shift mechanics: horizontal and vertical shifts wrap correctly", () => {
  // Clear grid and place a single bit at (0, 0)
  gridBits.fill(0);
  gridBits[0] = 1; // (0, 0)

  // Shift right by 1
  shiftMatrix(true, false, "right", "down");
  assert.equal(gridBits[1], 1, "Bit shifted right to (1, 0)");
  assert.equal(gridBits[0], 0, "Original (0, 0) is now 0");

  // Shift right 7 more times -> should wrap back to (0, 0)
  for (let i = 0; i < 7; i++) {
    shiftMatrix(true, false, "right", "down");
  }
  assert.equal(gridBits[0], 1, "Bit toroidally wrapped back to (0, 0)");

  // Shift down by 1 -> row 1, col 0 -> index 8
  shiftMatrix(false, true, "right", "down");
  assert.equal(gridBits[8], 1, "Bit shifted down to (0, 1)");

  // Shift down 7 more times -> should wrap back to (0, 0)
  for (let i = 0; i < 7; i++) {
    shiftMatrix(false, true, "right", "down");
  }
  assert.equal(gridBits[0], 1, "Bit toroidally wrapped down back to (0, 0)");
});

test("Feedback logic functions evaluate correct Boolean outputs", () => {
  // Configure taps to specific bit values
  // T1=(0,0), T2=(1,0), T3=(2,0), T4=(3,0)
  tapCoords[0] = 0; tapCoords[1] = 0;
  tapCoords[2] = 1; tapCoords[3] = 0;
  tapCoords[4] = 2; tapCoords[5] = 0;
  tapCoords[6] = 3; tapCoords[7] = 0;

  // Bits: 1, 0, 1, 0 -> sum = 2
  gridBits.fill(0);
  gridBits[0] = 1;
  gridBits[1] = 0;
  gridBits[2] = 1;
  gridBits[3] = 0;

  // XOR of (1 ^ 0 ^ 1 ^ 0) = 0
  assert.equal(evaluateFeedbackLogic("xor"), 0);

  // XNOR of (1 ^ 0 ^ 1 ^ 0) = 1
  assert.equal(evaluateFeedbackLogic("xnor"), 1);

  // Majority of (1, 0, 1, 0) -> 2 ones >= 2 -> 1
  assert.equal(evaluateFeedbackLogic("majority"), 1);

  // Serial Adder + Carry (Muse): sum = 1 + 0 + carry(0) = 1, next carry = 0
  assert.equal(evaluateFeedbackLogic("add_carry"), 1);

  // Rule 90: b0 ^ b2 = 1 ^ 1 = 0
  assert.equal(evaluateFeedbackLogic("rule90"), 0);
});

test("injectFeedback accurately sets target cells", () => {
  gridBits.fill(0);
  injectFeedback(1, "origin");
  assert.equal(gridBits[0], 1);

  gridBits.fill(0);
  injectFeedback(1, "column_0");
  for (let y = 0; y < 8; y++) {
    assert.equal(gridBits[y * 8 + 0], 1, `Col 0 cell (${0}, ${y}) set`);
  }

  gridBits.fill(0);
  injectFeedback(1, "row_0");
  for (let x = 0; x < 8; x++) {
    assert.equal(gridBits[0 * 8 + x], 1, `Row 0 cell (${x}, ${0}) set`);
  }

  gridBits.fill(0);
  injectFeedback(1, "diagonal");
  for (let k = 0; k < 8; k++) {
    assert.equal(gridBits[k * 8 + k], 1, `Diagonal cell (${k}, ${k}) set`);
  }
});

test("evaluateVoice derives quantized pitches and valid velocities across all read modes", () => {
  initShiftRegister2dGrid("alternating");
  state.scale = "pentMinor";
  state.root = 60; // C4
  state.pitchSpan = 2;

  const modes = ["row_scan", "cross_sum", "tap_probes", "diagonal"];
  for (const mode of modes) {
    for (let v = 0; v < MAX_VOICES; v++) {
      const res = evaluateVoice(v, mode, "always", 0);
      assert.ok(typeof res === "object");
      assert.ok(res.note >= 0 && res.note <= 127, `Note ${res.note} in MIDI range for ${mode} v${v}`);
      assert.ok(res.vel >= 30 && res.vel <= 127, `Velocity ${res.vel} in range for ${mode} v${v}`);
      assert.ok(res.probeX >= 0 && res.probeX < 8);
      assert.ok(res.probeY >= 0 && res.probeY < 8);
    }
  }
});

test("Generator contract: generateShiftRegister2dBank returns valid bank array with 64 steps", () => {
  initShiftRegister2dGrid("alternating");
  state.length = 64;
  state.rate = 3; // 1/16

  const bank = generateShiftRegister2dBank(state);
  assert.ok(Array.isArray(bank), "generateShiftRegister2dBank must return an array");
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
  const def = getModelDef("shift_register_2d");
  assert.ok(def, "shift_register_2d must be registered in snapshot.js");

  applyShiftRegister2dPreset("triadex_muse");
  const captured = def.capture();
  assert.ok(captured);
  assert.equal(captured.gridBits.length, 64);
  assert.equal(captured.clockRatio, "3:4");
  assert.equal(captured.feedbackLogic, "add_carry");

  // Modify grid
  gridBits.fill(0);
  state.sr2dClockRatio = "1:1";

  // Restore
  def.restore(captured);
  assert.equal(state.sr2dClockRatio, "3:4");
  assert.equal(state.sr2dFeedbackLogic, "add_carry");
  assert.deepEqual(Array.from(gridBits), captured.gridBits);
});

test("Transport start/stop/toggle controls", () => {
  stopShiftRegister2d();
  assert.equal(isShiftRegister2dRunning(), false);

  startShiftRegister2d();
  assert.equal(isShiftRegister2dRunning(), true);

  toggleShiftRegister2d();
  assert.equal(isShiftRegister2dRunning(), false);

  toggleShiftRegister2d();
  assert.equal(isShiftRegister2dRunning(), true);

  stopShiftRegister2d();
  assert.equal(isShiftRegister2dRunning(), false);
});

test("randomizeShiftRegister2d updates parameters and registers as model randomizer", () => {
  activateShiftRegister2dModel();
  const randFn = getCurrentModelRandomizer();
  assert.equal(typeof randFn, "function");

  randomizeShiftRegister2d();
  assert.ok(state.sr2dVoices >= 1 && state.sr2dVoices <= 8);
  assert.ok(CLOCK_RATIOS.some((r) => r.id === state.sr2dClockRatio));
  assert.ok(FEEDBACK_LOGICS.some((l) => l.id === state.sr2dFeedbackLogic));

  deactivateShiftRegister2dModel();
});
