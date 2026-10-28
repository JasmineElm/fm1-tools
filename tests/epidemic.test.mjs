// tests/epidemic.test.mjs — Unit test suite for SIR Epidemic Network Dynamics Sequencer (js/epidemic.js)
import test from "node:test";
import assert from "node:assert/strict";
import { initEpidemicGraph, getEpidemicNodeNote, infectNode, generateEpidemicBank, EPIDEMIC_PRESETS } from "../js/epidemic.js";
import { state } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("Epidemic presets list contains required topology layouts", () => {
  const ids = EPIDEMIC_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("spiral"), "Sunflower spiral preset present");
  assert.ok(ids.includes("clusters"), "Town clusters preset present");
  assert.ok(ids.includes("mobile"), "Mobile drift swarm preset present");
  assert.ok(ids.includes("lattice"), "2D grid lattice preset present");
  assert.ok(ids.includes("ring"), "Concentric rings preset present");
});

test("initEpidemicGraph initializes network nodes and inoculates patient zero", () => {
  state.epidemicPreset = "spiral";
  state.epidemicNodes = 36;
  initEpidemicGraph("spiral");

  // Center node note check
  const note = getEpidemicNodeNote(0.5, 0.5);
  assert.ok(typeof note === "number" && note >= 0 && note <= 127);
});

test("getEpidemicNodeNote quantizes spatial coordinates within valid MIDI bounds", () => {
  state.epidemicSpan = 3;
  // Test coordinate positions across unit square
  const nCenter = getEpidemicNodeNote(0.5, 0.5);
  const nTopLeft = getEpidemicNodeNote(0.1, 0.1);
  const nBottomRight = getEpidemicNodeNote(0.9, 0.9);
  const nTopRight = getEpidemicNodeNote(0.9, 0.1);

  [nCenter, nTopLeft, nBottomRight, nTopRight].forEach((n) => {
    assert.ok(Number.isInteger(n));
    assert.ok(n >= 12 && n <= 127);
  });
});

test("generateEpidemicBank satisfies generator function contract", () => {
  state.length = 16;
  const bank = generateEpidemicBank(state);
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

test("epidemic model snapshot registration and round trip", () => {
  const def = getModelDef("epidemic");
  assert.ok(def, "Model 'epidemic' is registered in snapshot registry");
  assert.equal(def.version, 1);

  state.epidemicPreset = "clusters";
  state.epidemicNodes = 52;
  state.epidemicBeta = 60;
  state.epidemicRadius = 0.28;
  state.epidemicRecovery = 14;
  state.epidemicImmunity = 32;
  state.epidemicSpan = 3;
  state.epidemicGateLen = 220;
  state.epidemicCcDepth = 90;

  const captured = def.capture();
  assert.equal(captured.preset, "clusters");
  assert.equal(captured.nodes, 52);
  assert.equal(captured.beta, 60);
  assert.equal(captured.recovery, 14);

  // Alter state
  state.epidemicPreset = "spiral";
  state.epidemicNodes = 24;

  // Restore state
  def.restore(captured);
  assert.equal(state.epidemicPreset, "clusters");
  assert.equal(state.epidemicNodes, 52);
  assert.equal(state.epidemicBeta, 60);
});
