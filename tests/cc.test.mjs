// tests/cc.test.mjs — Unit test suite for Centralized Timbre CC Dispatch (js/player.js & js/midi.js)
import test from "node:test";
import assert from "node:assert/strict";
import { dispatchTimbreCc, setControlChangeSink } from "../js/player.js";

test("dispatchTimbreCc clamps normVal to [0, 1] and scales by depth & floor", () => {
  let capturedDest = null;
  let capturedVal = null;

  try {
    setControlChangeSink((dest, val) => {
      capturedDest = dest;
      capturedVal = val;
    });

    // Depth 80, dest 74, normVal = 0.5, floorFactor = 0.25
    // baseline = (127 - 80) * 0.25 = 11.75
    // ccVal = Math.round(0.5 * 80 + 11.75) = Math.round(51.75) = 52
    dispatchTimbreCc(0.5, { depth: 80, dest: 74, minVal: 0, floorFactor: 0.25 });
    assert.equal(capturedDest, 74);
    assert.equal(capturedVal, 52);

    // MinVal clamping test: normVal = 0, floorFactor = 0, minVal = 20
    dispatchTimbreCc(0.0, { depth: 80, dest: 74, minVal: 20, floorFactor: 0 });
    assert.equal(capturedVal, 20);

    // MaxVal clamp: normVal = 2.0 (out of bounds), should clamp norm to 1.0
    // baseline = (127 - 100) * 0 = 0 -> ccVal = 100
    dispatchTimbreCc(2.0, { depth: 100, dest: 74, minVal: 0, floorFactor: 0 });
    assert.equal(capturedVal, 100);

    // If depth <= 0, no message sent
    capturedDest = null;
    capturedVal = null;
    dispatchTimbreCc(0.8, { depth: 0, dest: 74 });
    assert.equal(capturedDest, null);
    assert.equal(capturedVal, null);

  } finally {
    setControlChangeSink(null);
  }
});

test("dispatchTimbreCc respects requireLive option", () => {
  let callCount = 0;

  try {
    setControlChangeSink(() => { callCount++; });
    // In test environment, isLive() is false by default
    dispatchTimbreCc(0.5, { depth: 80, dest: 74, requireLive: true });
    assert.equal(callCount, 0, "Should not dispatch CC when requireLive is true and player is stopped");

    dispatchTimbreCc(0.5, { depth: 80, dest: 74, requireLive: false });
    assert.equal(callCount, 1, "Should dispatch CC when requireLive is false");
  } finally {
    setControlChangeSink(null);
  }
});
