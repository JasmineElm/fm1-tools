// tests/changes.test.mjs — Unit tests for English Change Ringing model
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
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        fillText: () => {}
      }),
      style: {}
    }),
    documentElement: {
      style: {},
      getAttribute: () => null
    }
  };
}

import {
  STAGES,
  METHODS,
  resetToRounds,
  applyPlaceNotation,
  advanceMethodRow,
  swapAdjacentBells,
  applyCallPreset,
  getBellNote,
  generateChangesBank
} from "../js/changes.js";
import { getModelDef } from "../js/snapshot.js";

test("Stages and Methods lists are properly configured", () => {
  assert.equal(STAGES.length, 5);
  assert.equal(STAGES[0].v, 4); // Minimus
  assert.equal(STAGES[4].v, 8); // Major (matches 8-voice hardware)

  assert.equal(METHODS.length, 5);
  const methodIds = METHODS.map(m => m.v);
  assert.ok(methodIds.includes("plain_hunt"));
  assert.ok(methodIds.includes("plain_bob"));
  assert.ok(methodIds.includes("grandsire"));
  assert.ok(methodIds.includes("stedman"));
  assert.ok(methodIds.includes("call_changes"));
});

test("applyPlaceNotation executes mathematical adjacent swaps according to Campanology law", () => {
  // Test Minimus (4 bells)
  const initial = [1, 2, 3, 4];

  // Cross change 'x': (1,2) and (3,4) swap
  const r1 = applyPlaceNotation(initial, "x", 4);
  assert.deepEqual(Array.from(r1), [2, 1, 4, 3]);

  // Place notation '14': 1 and 4 stay, 2 and 3 swap
  const r2 = applyPlaceNotation(r1, "14", 4);
  assert.deepEqual(Array.from(r2), [2, 4, 1, 3]);

  // Cross change 'x' again
  const r3 = applyPlaceNotation(r2, "x", 4);
  assert.deepEqual(Array.from(r3), [4, 2, 3, 1]);

  // Invariance check: no duplicate bells, valid permutation
  for (const row of [r1, r2, r3]) {
    const s = new Set(row);
    assert.equal(s.size, 4);
    assert.ok(s.has(1) && s.has(2) && s.has(3) && s.has(4));
  }

  // Campanology physical law: no bell moves more than 1 place per change!
  for (let b = 1; b <= 4; b++) {
    const posPrev = Array.from(r1).indexOf(b);
    const posNext = Array.from(r2).indexOf(b);
    assert.ok(Math.abs(posPrev - posNext) <= 1, `Bell ${b} moved by ${Math.abs(posPrev - posNext)} places!`);
  }
});

test("Classic Call Change presets produce iconic campanology permutations", () => {
  resetToRounds(8);

  // Queens on 8 bells: Odds then Evens: 1 3 5 7 2 4 6 8
  applyCallPreset("queens");
  const bankQueens = generateChangesBank({ length: 8, changesStage: 8 });
  const bellsQueens = bankQueens[0].steps.map(s => s.bell);
  assert.deepEqual(bellsQueens, [1, 3, 5, 7, 2, 4, 6, 8]);

  // Tittums on 8 bells: Weaving odds and evens: 1 5 2 6 3 7 4 8
  applyCallPreset("tittums");
  const bankTittums = generateChangesBank({ length: 8, changesStage: 8 });
  const bellsTittums = bankTittums[0].steps.map(s => s.bell);
  assert.deepEqual(bellsTittums, [1, 5, 2, 6, 3, 7, 4, 8]);
});

test("getBellNote quantizes pitches within valid MIDI bounds with descending tenor", () => {
  const trebleNote = getBellNote(1, 8); // Bell 1 = Treble (highest)
  const tenorNote = getBellNote(8, 8);  // Bell 8 = Tenor (lowest)

  assert.ok(trebleNote >= 0 && trebleNote <= 127);
  assert.ok(tenorNote >= 0 && tenorNote <= 127);
  assert.ok(trebleNote > tenorNote, `Treble note (${trebleNote}) must be higher pitch than Tenor (${tenorNote})`);
});

test("generateChangesBank satisfies the generator function contract", () => {
  const bank = generateChangesBank({ length: 64, changesStage: 6, changesMethod: "plain_hunt" });
  assert.ok(Array.isArray(bank), "Must return bank array");
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].steps.length, 64);

  // Verify steps format
  for (const step of bank[0].steps) {
    assert.ok(typeof step.note === "number" && step.note >= 0 && step.note <= 127);
    assert.ok(typeof step.vel === "number" && step.vel > 0);
    assert.equal(step.gate, 1);
    assert.ok(step.bell >= 1 && step.bell <= 6);
  }
});

test("changes model snapshot registration and round-trip", () => {
  const def = getModelDef("changes");
  assert.ok(def, "changes model must be registered in snapshot.js");
  assert.equal(def.version, 1);

  const captured = def.capture();
  assert.ok(captured, "Capture must return state object");
  assert.ok(Array.isArray(captured.currentRow));
  assert.equal(typeof captured.stage, "number");

  // Restore without error
  assert.doesNotThrow(() => {
    def.restore(captured);
  });
});

test("changes model transport start/stop/toggle controls", async () => {
  const { startChanges, stopChanges, toggleChangesRunning, isChangesRunning } = await import("../js/changes.js");

  assert.equal(isChangesRunning(), false);

  startChanges();
  assert.equal(isChangesRunning(), true);

  stopChanges();
  assert.equal(isChangesRunning(), false);

  toggleChangesRunning();
  assert.equal(isChangesRunning(), true);

  toggleChangesRunning();
  assert.equal(isChangesRunning(), false);
});
