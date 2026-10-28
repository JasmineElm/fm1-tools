// tests/dla.test.mjs — Unit test suite for DLA Dendritic Crystal Sequencer (js/dla.js)
import test from "node:test";
import assert from "node:assert/strict";
import { initDlaLattice, getDlaNote, generateDlaBank, DLA_PRESETS } from "../js/dla.js";
import { state } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("DLA presets list contains required growth geometries", () => {
  const ids = DLA_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("center"), "Center radial seed preset present");
  assert.ok(ids.includes("forest"), "Forest baseline seed preset present");
  assert.ok(ids.includes("ring"), "Ring cavity seed preset present");
  assert.ok(ids.includes("quad"), "Quad seeds preset present");
});

test("initDlaLattice initializes center seed and parameters", () => {
  state.dlaPreset = "center";
  initDlaLattice("center");
  // Test note derivation at the center
  const note = getDlaNote(64, 64);
  assert.ok(typeof note === "number" && note >= 0 && note <= 127);
});

test("getDlaNote quantizes polar coordinates within valid MIDI bounds", () => {
  state.dlaSpan = 3;
  // Test cardinal directions around center (64, 64)
  const nNorth = getDlaNote(64, 30);
  const nSouth = getDlaNote(64, 98);
  const nEast = getDlaNote(98, 64);
  const nWest = getDlaNote(30, 64);

  [nNorth, nSouth, nEast, nWest].forEach((n) => {
    assert.ok(Number.isInteger(n));
    assert.ok(n >= 12 && n <= 127);
  });
});

test("generateDlaBank satisfies generator function contract", () => {
  state.length = 16;
  const bank = generateDlaBank(state);
  assert.ok(Array.isArray(bank), "Returns array of bank patterns");
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 16);
  assert.equal(bank[0].steps.length, 16);

  bank[0].steps.forEach((st, idx) => {
    assert.ok(Array.isArray(st.notes), `Step ${idx} has notes array`);
    assert.ok(st.notes.length > 0, `Step ${idx} has at least 1 note`);
    assert.ok(typeof st.notes[0].note === "number", `Step ${idx} note is a number`);
    assert.ok(st.notes[0].note >= 0 && st.notes[0].note <= 127);
  });
});

test("dla model snapshot registration and round trip", () => {
  const def = getModelDef("dla");
  assert.ok(def, "Model 'dla' is registered in snapshot registry");
  assert.equal(def.version, 1);

  state.dlaPreset = "forest";
  state.dlaStickiness = 45;
  state.dlaWalkers = 128;
  state.dlaSpeed = 16;
  state.dlaSpan = 3;
  state.dlaGateLen = 220;
  state.dlaVelocity = 105;
  state.dlaCcDepth = 75;

  const captured = def.capture();
  assert.equal(captured.preset, "forest");
  assert.equal(captured.stickiness, 45);
  assert.equal(captured.walkers, 128);
  assert.equal(captured.speed, 16);

  // Alter state
  state.dlaPreset = "center";
  state.dlaStickiness = 90;

  // Restore state
  def.restore(captured);
  assert.equal(state.dlaPreset, "forest");
  assert.equal(state.dlaStickiness, 45);
});
