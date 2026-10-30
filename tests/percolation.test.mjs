// tests/percolation.test.mjs — Unit test suite for Percolation Cluster Conduction model
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
    canvas: { width: 400, height: 400 }
  };

  const createDummyEl = () => ({
    getContext: () => dummyCtx,
    style: {
      setProperty: () => {},
      removeProperty: () => {}
    },
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    },
    dataset: {},
    appendChild: () => {},
    append: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    value: "0",
    textContent: "",
    innerHTML: ""
  });

  const dummyEl = createDummyEl();

  globalThis.document = {
    getElementById: () => dummyEl,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    createElement: () => createDummyEl(),
    documentElement: {
      style: {
        setProperty: () => {},
        removeProperty: () => {}
      },
      getAttribute: () => null
    }
  };
}

import { state } from "../js/state.js";
import {
  PERCOLATION_PRESETS,
  activatePercolationModel,
  deactivatePercolationModel,
  generatePercolationBank,
  isPercolationRunning,
  startPercolation,
  stopPercolation,
  togglePercolationRunning,
  reseedPercolation,
  recomputePercolationClusters,
  sparkPercolationCell
} from "../js/percolation.js";
import { getModelDef } from "../js/snapshot.js";
import { getActiveVoiceCount, releasePolyVoices } from "../js/poly.js";

test("Percolation Presets exist and contain valid configurations", () => {
  assert.ok(Array.isArray(PERCOLATION_PRESETS));
  assert.ok(PERCOLATION_PRESETS.length >= 5);
  for (const preset of PERCOLATION_PRESETS) {
    assert.ok(preset.id, "Preset must have an id");
    assert.ok(preset.name, "Preset must have a name");
  }
});

test("generatePercolationBank returns valid bank adhering to generator contract", () => {
  state.length = 32;
  const bank = generatePercolationBank(state);

  assert.ok(Array.isArray(bank), "Bank must be an array");
  assert.equal(bank.length, 16, "Bank must have 16 patterns");

  for (let p = 0; p < 16; p++) {
    const pat = bank[p];
    assert.ok(pat, `Pattern ${p} must exist`);
    assert.equal(pat.length, 32, `Pattern ${p} length must match state.length`);
    assert.ok(Array.isArray(pat.steps), `Pattern ${p} steps must be an array`);
    assert.equal(pat.steps.length, 32, `Pattern ${p} steps.length must be 32`);
    for (const step of pat.steps) {
      assert.ok(typeof step.on === "boolean", "step.on must be boolean");
      assert.ok(typeof step.note === "number", "step.note must be number");
      assert.ok(step.note >= 0 && step.note <= 127, "step.note must be valid MIDI range");
    }
  }
});

test("Percolation snapshot capture and restore round-trips state cleanly", () => {
  const modelDef = getModelDef("percolation");
  assert.ok(modelDef, "Percolation model must be registered with snapshot registry");

  state.percolationGridDim = "24x16";
  state.percolationProb = 65;
  state.percolationScanMode = "fluid";
  state.percolationPitchMapping = "y-invert";
  state.percolationSpan = 3;
  state.percolationGateLen = 220;

  reseedPercolation();
  const snap = modelDef.capture();

  assert.equal(snap.dim, "24x16");
  assert.equal(snap.prob, 65);
  assert.equal(snap.scan, "fluid");
  assert.equal(snap.mapping, "y-invert");
  assert.equal(snap.span, 3);
  assert.equal(snap.gateLen, 220);
  assert.ok(Array.isArray(snap.cells));

  // Change state
  state.percolationProb = 30;
  state.percolationScanMode = "top-down";

  // Restore
  modelDef.restore(snap);
  assert.equal(state.percolationProb, 65);
  assert.equal(state.percolationScanMode, "fluid");
});

test("sparkPercolationCell triggers chord without throwing and allocates voices", () => {
  releasePolyVoices();
  reseedPercolation();
  recomputePercolationClusters();

  // Trigger interactive spark on cell 0
  assert.doesNotThrow(() => {
    sparkPercolationCell(0);
  });

  releasePolyVoices();
  assert.equal(getActiveVoiceCount(), 0);
});

test("Percolation activation and deactivation handles step conduction and transport", () => {
  activatePercolationModel();

  assert.equal(isPercolationRunning(), false);
  startPercolation();
  assert.equal(isPercolationRunning(), true);
  stopPercolation();
  assert.equal(isPercolationRunning(), false);

  deactivatePercolationModel();
});
