// tests/fitzhugh_nagumo.test.mjs — Unit tests for FitzHugh-Nagumo Neuromorphic Spiking Network model
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
  MAX_NEURONS,
  v,
  w,
  s,
  W,
  nodeX,
  nodeY,
  I_bias,
  I_stim,
  activeNeuron,
  FHN_PRESETS,
  initNetwork,
  stepSimulation,
  injectStimulus,
  resetMembranes,
  getNeuronNote,
  generateFitzhughNagumoBank,
  startFhn,
  stopFhn,
  toggleFhnRunning,
  isFhnRunning,
  randomizeNeuronPositions,
  getNeuronPositions,
  randomizeFitzhughNagumo,
  syncFhnControls,
  activateFitzhughNagumoModel,
  deactivateFitzhughNagumoModel
} from "../js/fitzhugh_nagumo.js";
import { getModelDef } from "../js/snapshot.js";
import { state, refs, getCurrentModelRandomizer } from "../js/state.js";

test("FHN_PRESETS contains required neuromorphic topology regimes", () => {
  assert.equal(FHN_PRESETS.length, 6);
  const ids = FHN_PRESETS.map(p => p.id);
  assert.ok(ids.includes("synfire"));
  assert.ok(ids.includes("cpg"));
  assert.ok(ids.includes("bursting_hub"));
  assert.ok(ids.includes("quiescent_resonator"));
  assert.ok(ids.includes("chaotic_recurrent"));
  assert.ok(ids.includes("random"));
});

test("initNetwork configures 8 biological neurons matching FM-1 hardware polyphony ceiling", () => {
  initNetwork("synfire");
  assert.equal(MAX_NEURONS, 8); // FM-1 8-voice hardware limit

  for (let i = 0; i < MAX_NEURONS; i++) {
    assert.equal(activeNeuron[i], 1);
    assert.ok(v[i] >= -2.5 && v[i] <= 2.5, `Neuron membrane potential v[${i}] out of bounds`);
    assert.ok(w[i] >= -2.0 && w[i] <= 2.5, `Neuron recovery variable w[${i}] out of bounds`);
  }

  // Synfire topology verification: unidirectional forward excitatory synaptic connection
  for (let i = 0; i < MAX_NEURONS; i++) {
    const next = (i + 1) % MAX_NEURONS;
    assert.ok(W[i * MAX_NEURONS + next] > 0, `Neuron ${i} should have excitatory connection to ${next}`);
  }
});

test("initNetwork for CPG configures reciprocal half-center inhibition", () => {
  initNetwork("cpg");

  // Neurons 0..3 (Group A) must inhibit Neurons 4..7 (Group B)
  for (let i = 0; i < 4; i++) {
    for (let j = 4; j < 8; j++) {
      assert.ok(W[i * MAX_NEURONS + j] < 0, `Neuron ${i} must have inhibitory synapse to ${j}`);
      assert.ok(W[j * MAX_NEURONS + i] < 0, `Neuron ${j} must have inhibitory synapse to ${i}`);
    }
  }
});

test("stepSimulation numerically integrates FitzHugh-Nagumo ODEs without NaN/Infinity", () => {
  initNetwork("synfire");

  for (let s = 0; s < 10; s++) {
    stepSimulation(16);
  }

  for (let i = 0; i < MAX_NEURONS; i++) {
    assert.ok(!Number.isNaN(v[i]), `v[${i}] must not be NaN`);
    assert.ok(!Number.isNaN(w[i]), `w[${i}] must not be NaN`);
    assert.ok(Number.isFinite(v[i]), `v[${i}] must be finite`);
    assert.ok(Number.isFinite(w[i]), `w[${i}] must be finite`);
  }
});

test("injectStimulus depolarizes neuron membrane and triggers action potential", () => {
  initNetwork("quiescent_resonator");
  // In quiescent mode, neurons sit sub-threshold
  v[0] = -1.1;
  w[0] = -0.5;

  injectStimulus(0, 2.5);
  assert.equal(I_stim[0], 2.5);

  // Advance simulation to observe depolarization
  for (let s = 0; s < 5; s++) {
    stepSimulation(16);
  }

  // Depolarized upstroke
  assert.ok(v[0] > -0.5, "Injected stimulus must depolarize membrane potential");
});

test("getNeuronNote quantizes biological neuron voice indices to valid MIDI pitches", () => {
  for (let i = 0; i < MAX_NEURONS; i++) {
    const note = getNeuronNote(i);
    assert.ok(Number.isInteger(note), `Note ${note} must be an integer`);
    assert.ok(note >= 12 && note <= 127, `Note ${note} must be within valid MIDI range [12, 127]`);
  }
});

test("generateFitzhughNagumoBank satisfies the generator function contract", () => {
  const bank = generateFitzhughNagumoBank({ length: 64, rate: 3 });
  assert.ok(Array.isArray(bank), "Bank must be an array");
  assert.equal(bank.length, 1);

  const pattern = bank[0];
  assert.equal(pattern.length, 64);
  assert.equal(pattern.rate, 3);
  assert.equal(pattern.steps.length, 64);

  pattern.steps.forEach((step, s) => {
    assert.ok(Number.isInteger(step.note), `Step ${s} note must be an integer`);
    assert.ok(step.vel >= 1 && step.vel <= 127, `Step ${s} velocity out of range`);
    assert.equal(step.gate, 1);
    assert.equal(step.source, "fitzhugh_nagumo");
    assert.ok(step.neuronIdx >= 0 && step.neuronIdx < 8);
  });
});

test("fitzhugh_nagumo snapshot registration and round-trip restore", () => {
  const def = getModelDef("fitzhugh_nagumo");
  assert.ok(def, "fitzhugh_nagumo model must be registered in snapshot.js");
  assert.equal(def.id, "fitzhugh_nagumo");
  assert.equal(def.version, 1);

  initNetwork("bursting_hub");
  v[0] = 1.35;
  w[0] = 0.82;

  const captured = def.capture();
  assert.ok(captured);
  assert.ok(Array.isArray(captured.v));
  assert.ok(Array.isArray(captured.w));
  assert.ok(Array.isArray(captured.W));

  // Reset then restore
  resetMembranes();
  assert.ok(Math.abs(v[0] - (-1.1)) < 0.0001, "v[0] must be reset to -1.1");

  def.restore(captured);
  assert.ok(Math.abs(v[0] - 1.35) < 0.001);
  assert.ok(Math.abs(w[0] - 0.82) < 0.001);
});

test("fitzhugh_nagumo transport handlers toggle running state", () => {
  assert.equal(isFhnRunning(), false);
  startFhn();
  assert.equal(isFhnRunning(), true);
  stopFhn();
  assert.equal(isFhnRunning(), false);
  toggleFhnRunning();
  assert.equal(isFhnRunning(), true);
  toggleFhnRunning();
  assert.equal(isFhnRunning(), false);
});

test("randomizeNeuronPositions distributes nodes within valid normalized bounds", () => {
  const positions = randomizeNeuronPositions();
  assert.equal(positions.length, MAX_NEURONS);

  for (let i = 0; i < MAX_NEURONS; i++) {
    assert.ok(nodeX[i] >= 0.12 && nodeX[i] <= 0.88, `nodeX[${i}] out of bounds: ${nodeX[i]}`);
    assert.ok(nodeY[i] >= 0.12 && nodeY[i] <= 0.88, `nodeY[${i}] out of bounds: ${nodeY[i]}`);
    assert.equal(positions[i].x, nodeX[i]);
    assert.equal(positions[i].y, nodeY[i]);
  }

  const snapshotPos = getNeuronPositions();
  assert.equal(snapshotPos.x.length, MAX_NEURONS);
  assert.equal(snapshotPos.y.length, MAX_NEURONS);
  for (let i = 0; i < MAX_NEURONS; i++) {
    assert.equal(snapshotPos.x[i], nodeX[i]);
    assert.equal(snapshotPos.y[i], nodeY[i]);
  }
});

test("randomizeFitzhughNagumo randomizes node positions and local model controls", () => {
  // Mock controls in refs to verify syncFhnControls
  let updatedStim = null;
  let updatedWeight = null;
  let updatedRec = null;
  let updatedNoise = null;
  let updatedSpan = null;
  let updatedPreset = null;

  refs.fhnStimulus = { setValue: (v) => { updatedStim = v; } };
  refs.fhnWeight = { setValue: (v) => { updatedWeight = v; } };
  refs.fhnRecovery = { setValue: (v) => { updatedRec = v; } };
  refs.fhnNoise = { setValue: (v) => { updatedNoise = v; } };
  refs.fhnSpan = { setValue: (v) => { updatedSpan = v; } };
  refs.fhnPreset = { setValue: (v) => { updatedPreset = v; } };

  // Set known initial states
  state.fhnStimulus = 1.0;
  state.fhnWeight = 1.0;
  state.fhnRecovery = 0.08;
  state.fhnNoise = 0.04;
  state.fhnSpan = 2;
  state.pitchSpan = 2;
  state.fhnPreset = "synfire";

  const prevX = Array.from(nodeX);
  const prevY = Array.from(nodeY);

  randomizeFitzhughNagumo();

  // Controls must be randomized
  assert.ok(typeof state.fhnStimulus === "number" && state.fhnStimulus >= 0.4 && state.fhnStimulus <= 1.7);
  assert.ok(typeof state.fhnWeight === "number" && state.fhnWeight >= 0.4 && state.fhnWeight <= 2.2);
  assert.ok(typeof state.fhnRecovery === "number" && state.fhnRecovery >= 0.03 && state.fhnRecovery <= 0.15);
  assert.ok(typeof state.fhnNoise === "number" && state.fhnNoise >= 0.01 && state.fhnNoise <= 0.25);
  assert.ok(typeof state.fhnSpan === "number" && state.fhnSpan >= 1 && state.fhnSpan <= 4);
  assert.equal(state.pitchSpan, state.fhnSpan);
  assert.ok(FHN_PRESETS.map(p => p.id).includes(state.fhnPreset));

  // Controls in refs must have been synced
  assert.equal(updatedStim, state.fhnStimulus);
  assert.equal(updatedWeight, state.fhnWeight);
  assert.equal(updatedRec, state.fhnRecovery);
  assert.equal(updatedNoise, state.fhnNoise);
  assert.equal(updatedSpan, state.fhnSpan);
  assert.equal(updatedPreset, state.fhnPreset);

  // Node positions must be randomized within [0.12, 0.88]
  for (let i = 0; i < MAX_NEURONS; i++) {
    assert.ok(nodeX[i] >= 0.12 && nodeX[i] <= 0.88);
    assert.ok(nodeY[i] >= 0.12 && nodeY[i] <= 0.88);
  }

  // Clean up refs mock
  delete refs.fhnStimulus;
  delete refs.fhnWeight;
  delete refs.fhnRecovery;
  delete refs.fhnNoise;
  delete refs.fhnSpan;
  delete refs.fhnPreset;
});

test("model lifecycle registers and unregisters randomizeFitzhughNagumo", () => {
  activateFitzhughNagumoModel();
  const currentRandomizer = getCurrentModelRandomizer();
  assert.equal(currentRandomizer, randomizeFitzhughNagumo);

  deactivateFitzhughNagumoModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("fitzhugh_nagumo local controls mirroring global ones (Play) are removed", async () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(val) { createdHtml = val; },
    get innerHTML() { return createdHtml; }
  };

  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-fitzhugh_nagumo") return dummyContainer;
    return null;
  };

  try {
    const { initFitzhughNagumo } = await import("../js/fitzhugh_nagumo.js");
    initFitzhughNagumo();
    assert.ok(!createdHtml.includes('id="fhn-play-btn"'), "Local play button must be removed (Global play exists)");
    assert.ok(createdHtml.includes('id="fhn-rnd-btn"'), "RND button present in toolbar");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

