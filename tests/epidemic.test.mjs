// tests/epidemic.test.mjs — Unit test suite for SIR Epidemic Network Dynamics Sequencer (js/epidemic.js)
import test from "node:test";
import assert from "node:assert/strict";
import {
  initEpidemicGraph,
  getEpidemicNodeNote,
  infectNode,
  generateEpidemicBank,
  randomizeEpidemic,
  randomizeNodePositions,
  getNodePositions,
  syncEpidemicControls,
  initEpidemic,
  EPIDEMIC_PRESETS
} from "../js/epidemic.js";
import { state, refs } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

// Mock minimal browser globals for testing initEpidemic UI controls
if (typeof document === "undefined") {
  const dummyCtx = {
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    moveTo: () => {},
    lineTo: () => {},
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    measureText: () => ({ width: 10 })
  };
  const createDummyEl = () => ({
    appendChild: () => {},
    append: () => {},
    style: {},
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    getContext: () => dummyCtx
  });
  globalThis.document = {
    getElementById: () => createDummyEl(),
    querySelector: () => createDummyEl(),
    querySelectorAll: () => [],
    createElement: () => createDummyEl(),
    createElementNS: () => createDummyEl(),
    documentElement: { style: {} }
  };
}
if (typeof globalThis.getComputedStyle === "undefined") {
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => ""
  });
}

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

test("randomizeEpidemic randomizes model controls and node positions", () => {
  // Initialize controls
  initEpidemic();

  // Track initial values
  const prevNodes = state.epidemicNodes;
  const prevBeta = state.epidemicBeta;
  const prevRadius = state.epidemicRadius;

  randomizeEpidemic();

  // Model controls are randomized within their allowed domains
  assert.ok(state.epidemicNodes >= 16 && state.epidemicNodes <= 96, "Nodes within 16-96");
  assert.ok(state.epidemicBeta >= 5 && state.epidemicBeta <= 95, "Beta within 5-95");
  assert.ok(state.epidemicRadius >= 0.08 && state.epidemicRadius <= 0.45, "Radius within 0.08-0.45");
  assert.ok(state.epidemicRecovery >= 4 && state.epidemicRecovery <= 32, "Recovery within 4-32");
  assert.ok(state.epidemicImmunity >= 6 && state.epidemicImmunity <= 64, "Immunity within 6-64");
  assert.ok(state.epidemicSpan >= 1 && state.epidemicSpan <= 4, "Span within 1-4");
  assert.ok(state.epidemicGateLen >= 40 && state.epidemicGateLen <= 400, "Gate within 40-400");
  assert.ok(EPIDEMIC_PRESETS.some(p => p.id === state.epidemicPreset), "Preset is a valid preset");

  // Controls are registered in refs
  assert.ok(refs.epidemicPreset, "refs.epidemicPreset registered");
  assert.ok(refs.epidemicNodes, "refs.epidemicNodes registered");
  assert.ok(refs.epidemicBeta, "refs.epidemicBeta registered");
  assert.ok(refs.epidemicRadius, "refs.epidemicRadius registered");
  assert.ok(refs.epidemicRecovery, "refs.epidemicRecovery registered");
  assert.ok(refs.epidemicImmunity, "refs.epidemicImmunity registered");
  assert.ok(refs.epidemicSpan, "refs.epidemicSpan registered");
  assert.ok(refs.epidemicGateLen, "refs.epidemicGateLen registered");

  // Node positions are valid within canvas space [0.08, 0.92]
  const pos1 = getNodePositions();
  assert.ok(pos1.x.length >= 16);
  for (let i = 0; i < pos1.x.length; i++) {
    assert.ok(pos1.x[i] >= 0.079 && pos1.x[i] <= 0.921, `Node ${i} X within bounds`);
    assert.ok(pos1.y[i] >= 0.079 && pos1.y[i] <= 0.921, `Node ${i} Y within bounds`);
  }

  // A subsequent randomize produces fresh node positions
  randomizeNodePositions(pos1.x.length);
  const pos2 = getNodePositions();
  let anyDifferent = false;
  for (let i = 0; i < pos1.x.length; i++) {
    if (Math.abs(pos1.x[i] - pos2.x[i]) > 0.001 || Math.abs(pos1.y[i] - pos2.y[i]) > 0.001) {
      anyDifferent = true;
      break;
    }
  }
  assert.ok(anyDifferent, "Node positions are freshly randomized");
});

