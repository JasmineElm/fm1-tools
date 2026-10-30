// tests/nodal_graph.test.mjs — Comprehensive unit tests for Nodal Directed Graph model
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
  MAX_NODES,
  MAX_WALKERS,
  MAX_VOICES,
  MAX_EDGES_PER_NODE,
  WALKER_COLORS,
  GRAPH_PRESETS,
  nodeX,
  nodeY,
  nodeRadius,
  nodeInDegree,
  edgeTarget,
  edgeWeight,
  edgeCount,
  walkerNode,
  walkerTarget,
  walkerProgress,
  walkerActive,
  isNodalGraphRunning,
  startNodalGraph,
  stopNodalGraph,
  toggleNodalGraphRunning,
  initNodalGraphSystem,
  getNodalGraphNote,
  stepNodalGraphSimulation,
  generateNodalGraphBank,
  randomizeNodalGraph,
  initNodalGraph,
  activateNodalGraphModel,
  deactivateNodalGraphModel
} from "../js/nodal_graph.js";
import { getModelDef } from "../js/snapshot.js";
import { getCurrentModelRandomizer, state } from "../js/state.js";

test("GRAPH_PRESETS contains the 5 topological graph architectures", () => {
  assert.equal(GRAPH_PRESETS.length, 5);
  const ids = GRAPH_PRESETS.map(p => p.id);
  assert.ok(ids.includes("cycle_chords"));
  assert.ok(ids.includes("hierarchical_tree"));
  assert.ok(ids.includes("scale_free"));
  assert.ok(ids.includes("de_bruijn"));
  assert.ok(ids.includes("random_dag"));
});

test("Hardware polyphony ceiling: MAX_VOICES and MAX_WALKERS capped strictly at 8", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(MAX_WALKERS, 8);
  assert.equal(WALKER_COLORS.length, 8);
  assert.equal(walkerNode.length, 8);
  assert.equal(walkerTarget.length, 8);
  assert.equal(walkerProgress.length, 8);
});

test("initNodalGraphSystem initializes nodes inside valid canvas space and builds directed edges", () => {
  initNodalGraphSystem(12, 1.0, "cycle_chords");

  for (let i = 0; i < 12; i++) {
    assert.ok(!isNaN(nodeX[i]) && isFinite(nodeX[i]));
    assert.ok(!isNaN(nodeY[i]) && isFinite(nodeY[i]));
    assert.ok(nodeX[i] >= 0.05 && nodeX[i] <= 0.95, `Node ${i} X out of bounds: ${nodeX[i]}`);
    assert.ok(nodeY[i] >= 0.05 && nodeY[i] <= 0.95, `Node ${i} Y out of bounds: ${nodeY[i]}`);

    // Cycle chords must have at least 1 outgoing edge
    assert.ok(edgeCount[i] >= 1, `Node ${i} must have outgoing edges`);
    for (let k = 0; k < edgeCount[i]; k++) {
      const tgt = edgeTarget[i * MAX_EDGES_PER_NODE + k];
      assert.ok(tgt >= 0 && tgt < 12, `Target node ${tgt} must be valid`);
      assert.ok(edgeWeight[i * MAX_EDGES_PER_NODE + k] > 0, "Edge weight must be positive");
    }
  }

  // Active walkers must be placed on valid nodes
  for (let w = 0; w < 3; w++) {
    assert.equal(walkerActive[w], 1);
    assert.ok(walkerNode[w] >= 0 && walkerNode[w] < 12);
    assert.ok(walkerTarget[w] >= 0 && walkerTarget[w] < 12);
    assert.ok(walkerProgress[w] >= 0.0 && walkerProgress[w] <= 1.0);
  }
});

test("getNodalGraphNote quantizes topological node coordinates to valid scale MIDI pitches", () => {
  for (let i = 0; i < 12; i++) {
    for (let w = 0; w < 3; w++) {
      const note = getNodalGraphNote(i, w, 0);
      assert.ok(Number.isInteger(note));
      assert.ok(note >= 12 && note <= 127, `Note ${note} out of MIDI bounds`);
    }
  }
});

test("stepNodalGraphSimulation advances walkers and traverses edges across all presets", () => {
  const presets = ["cycle_chords", "hierarchical_tree", "scale_free", "de_bruijn", "random_dag"];

  for (const preset of presets) {
    initNodalGraphSystem(preset);

    for (let step = 0; step < 40; step++) {
      const res = stepNodalGraphSimulation(0.016);
      assert.ok(typeof res.triggered === "boolean");

      const numWalkers = state.nodalGraphWalkers || 3;
      for (let w = 0; w < numWalkers; w++) {
        assert.ok(!isNaN(walkerProgress[w]), `NaN in walkerProgress[${w}] for preset ${preset}`);
        assert.ok(isFinite(walkerProgress[w]));
        assert.ok(walkerNode[w] >= 0 && walkerNode[w] < MAX_NODES);
        assert.ok(walkerTarget[w] >= 0 && walkerTarget[w] < MAX_NODES);
      }
    }
  }
});

test("Generator contract: generateNodalGraphBank returns valid 64-step bank array", () => {
  initNodalGraphSystem(14, 1.0, "random_dag");

  const bank = generateNodalGraphBank({
    length: 64,
    nodalGraphOctave: 0,
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
    assert.ok(Array.isArray(step.notes));
    assert.ok(step.notes.length >= 1);
    assert.ok(step.notes[0].note >= 12 && step.notes[0].note <= 127);
    assert.ok(step.notes[0].vel >= 1 && step.notes[0].vel <= 127);
  }
});

test("Transport start/stop/toggle controls", () => {
  stopNodalGraph();
  assert.equal(isNodalGraphRunning(), false);

  startNodalGraph();
  assert.equal(isNodalGraphRunning(), true);

  toggleNodalGraphRunning();
  assert.equal(isNodalGraphRunning(), false);

  toggleNodalGraphRunning();
  assert.equal(isNodalGraphRunning(), true);
  stopNodalGraph();
});

test("Snapshot capture and restore round-trip preserves state deterministically", () => {
  const def = getModelDef("nodal_graph");
  assert.ok(def, "nodal_graph model definition must be registered in snapshot.js");

  initNodalGraphSystem(15, 1.4, "hierarchical_tree");
  const snap = def.capture();

  assert.equal(snap.preset, "hierarchical_tree");
  assert.equal(snap.speed, 1.4);
  assert.ok(snap.nodeX.length >= 12);
  assert.ok(snap.nodeY.length >= 12);

  initNodalGraphSystem(16, 0.8, "de_bruijn");
  assert.notEqual(def.capture().preset, "hierarchical_tree");

  def.restore(snap);
  const restored = def.capture();
  assert.equal(restored.preset, "hierarchical_tree");
  assert.equal(restored.speed, 1.4);
});

test("randomizeNodalGraph updates parameters and registers as model randomizer", () => {
  activateNodalGraphModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeNodalGraph();
  assert.ok(state.nodalGraphWalkers >= 1 && state.nodalGraphWalkers <= MAX_WALKERS);
  assert.ok(GRAPH_PRESETS.some(p => p.id === state.nodalGraphPreset));

  deactivateNodalGraphModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("initNodalGraph mounts DOM controls without error", () => {
  const container = makeMockEl("div");
  mockContainers.set("model-nodal_graph", container);
  initNodalGraph();
  assert.ok(container.children.length > 0, "initNodalGraph should populate model container");
});

