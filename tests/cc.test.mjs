// tests/cc.test.mjs — Unit test verifying that continuous MIDI CC dispatch is disabled for FM-1 firmware
import test from "node:test";
import assert from "node:assert/strict";
import { dispatchTimbreCc, setControlChangeSink } from "../js/player.js";

test("dispatchTimbreCc is a strict no-op to adhere to FM-1 firmware constraints", () => {
  let callCount = 0;

  try {
    setControlChangeSink(() => {
      callCount++;
    });

    dispatchTimbreCc(0.5, { depth: 80, dest: 74, minVal: 0, floorFactor: 0.25 });
    dispatchTimbreCc(1.0, { depth: 100, dest: 74 });
    dispatchTimbreCc(0.0, { depth: 127, dest: 74 });

    assert.equal(callCount, 0, "dispatchTimbreCc must not dispatch any MIDI CC to FM-1 hardware");
  } finally {
    setControlChangeSink(null);
  }
});
