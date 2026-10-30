// tests/kuramoto.test.mjs — Unit tests for Coupled Kuramoto Phase Synchronization Oscillators model
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
  MAX_OSCILLATORS,
  theta,
  omega,
  activeOsc,
  KURAMOTO_PRESETS,
  initOscillators,
  computeOrderParameter,
  stepSimulation,
  getOscillatorNote,
  generateKuramotoBank,
  startKuramoto,
  stopKuramoto,
  toggleKuramotoRunning,
  isKuramotoRunning,
  initKuramoto
} from "../js/kuramoto.js";
import { getModelDef } from "../js/snapshot.js";
import { state } from "../js/state.js";

test("KURAMOTO_PRESETS contains required non-linear phase regimes", () => {
  assert.equal(KURAMOTO_PRESETS.length, 5);
  const ids = KURAMOTO_PRESETS.map(p => p.id);
  assert.ok(ids.includes("near_sync"));
  assert.ok(ids.includes("polyrhythm"));
  assert.ok(ids.includes("critical"));
  assert.ok(ids.includes("bimodal"));
  assert.ok(ids.includes("chaotic"));
});

test("initOscillators configures 8 phase oscillators matching hardware polyphony ceiling", () => {
  initOscillators("near_sync");
  assert.equal(MAX_OSCILLATORS, 8); // FM-1 8 hardware voices

  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    assert.equal(activeOsc[i], 1);
    assert.ok(theta[i] >= 0 && theta[i] <= Math.PI * 2, `Phase theta[${i}] out of bounds`);
    assert.ok(omega[i] > 0, `Natural frequency omega[${i}] must be positive`);
  }
});

test("computeOrderParameter calculates macroscopic coherence r in [0, 1]", () => {
  initOscillators("near_sync");

  // Force all phases identical: r must equal 1.0 (perfect coherence)
  for (let i = 0; i < MAX_OSCILLATORS; i++) theta[i] = 1.0;
  const { r: rMax } = computeOrderParameter();
  assert.ok(Math.abs(rMax - 1.0) < 1e-5, `Perfect sync r must be 1.0, got ${rMax}`);

  // Distribute phases symmetrically: r must equal ~0.0 (incoherent drift)
  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    theta[i] = (i * Math.PI * 2) / MAX_OSCILLATORS;
  }
  const { r: rMin } = computeOrderParameter();
  assert.ok(rMin < 0.1, `Symmetric distribution r must be near 0, got ${rMin}`);
});

test("stepSimulation numerically evolves Kuramoto ODE without errors", () => {
  initOscillators("critical");

  assert.doesNotThrow(() => {
    for (let step = 0; step < 10; step++) {
      stepSimulation(16);
    }
  });

  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    assert.ok(!isNaN(theta[i]), `Theta[${i}] resulted in NaN`);
    assert.ok(theta[i] >= 0 && theta[i] <= Math.PI * 2);
  }
});

test("getOscillatorNote quantizes natural frequencies within valid MIDI range", () => {
  initOscillators("polyrhythm");

  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    const note = getOscillatorNote(i);
    assert.ok(typeof note === "number");
    assert.ok(note >= 0 && note <= 127, `Note ${note} out of MIDI bounds`);
  }
});

test("generateKuramotoBank satisfies generator function contract", () => {
  initOscillators("near_sync");
  const bank = generateKuramotoBank({ length: 64, rate: 3 });

  assert.ok(Array.isArray(bank), "Must return bank array");
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, 3);
  assert.equal(bank[0].steps.length, 64);

  for (const step of bank[0].steps) {
    assert.ok(typeof step.note === "number" && step.note >= 0 && step.note <= 127);
    assert.ok(typeof step.vel === "number" && step.vel > 0);
    assert.equal(step.gate, 1);
    assert.equal(step.source, "kuramoto");
  }
});

test("kuramoto snapshot registration and round-trip restore", () => {
  const def = getModelDef("kuramoto");
  assert.ok(def, "kuramoto model must be registered in snapshot.js");
  assert.equal(def.version, 1);

  const captured = def.capture();
  assert.ok(captured, "Capture must return state object");
  assert.ok(Array.isArray(captured.theta));
  assert.equal(captured.theta.length, MAX_OSCILLATORS);

  assert.doesNotThrow(() => {
    def.restore(captured);
  });
});

test("kuramoto transport handlers toggle running state", () => {
  assert.equal(isKuramotoRunning(), false);

  startKuramoto();
  assert.equal(isKuramotoRunning(), true);

  stopKuramoto();
  assert.equal(isKuramotoRunning(), false);

  toggleKuramotoRunning();
  assert.equal(isKuramotoRunning(), true);

  toggleKuramotoRunning();
  assert.equal(isKuramotoRunning(), false);
});

test("kuramoto getOscillatorNote adheres to global pitchSpan from notes div", () => {
  initOscillators("polyrhythm");

  const notes1 = [];
  state.pitchSpan = 1;
  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    notes1.push(getOscillatorNote(i));
  }

  const notes4 = [];
  state.pitchSpan = 4;
  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    notes4.push(getOscillatorNote(i));
  }

  // Pitch span of 4 should produce a wider pitch spread across oscillators than span 1
  const spread1 = Math.max(...notes1) - Math.min(...notes1);
  const spread4 = Math.max(...notes4) - Math.min(...notes4);
  assert.ok(spread4 >= spread1, `Expected spread4 (${spread4}) >= spread1 (${spread1})`);
});

test("locally implemented controls with Global or notes div counterparts are removed in kuramoto", () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(html) {
      createdHtml = html;
    },
    get innerHTML() {
      return createdHtml;
    }
  };

  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-kuramoto") return dummyContainer;
    return null;
  };

  try {
    initKuramoto();

    // Verify local play button is removed (Global play transport exists)
    assert.ok(!createdHtml.includes('id="kuramoto-play-btn"'), "Local play button must be removed (Global play exists)");

    // Verify local Span slider is removed (Notes div octave spread exists)
    assert.ok(!createdHtml.includes('id="kuramoto-span"'), "Local Span slider must be removed (Notes div octave spread exists)");

    // Verify model-specific controls are preserved
    assert.ok(createdHtml.includes('id="kuramoto-rnd-btn"'), "RND button present in toolbar");
    assert.ok(createdHtml.includes('id="kuramoto-reset-btn"'), "Reset button retained");
    assert.ok(createdHtml.includes('id="kuramoto-preset-select"'), "Preset select retained");
    assert.ok(createdHtml.includes('id="kuramoto-coupling"'), "Coupling slider retained");
    assert.ok(createdHtml.includes('id="kuramoto-sigma"'), "Dispersion slider retained");
    assert.ok(createdHtml.includes('id="kuramoto-noise"'), "Noise slider retained");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

test("randomizeKuramoto randomizes parameters and registers with global randomizer", async () => {
  const { randomizeKuramoto, activateKuramotoModel, deactivateKuramotoModel } = await import("../js/kuramoto.js");
  const { state, getCurrentModelRandomizer } = await import("../js/state.js");

  activateKuramotoModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(rnd, randomizeKuramoto);

  randomizeKuramoto();
  assert.ok(state.kuramotoCoupling >= 0.2 && state.kuramotoCoupling <= 3.5);
  assert.ok(state.kuramotoSigma >= 0.05 && state.kuramotoSigma <= 1.5);
  assert.ok(state.kuramotoNoise >= 0.01 && state.kuramotoNoise <= 0.5);
  assert.ok(typeof state.kuramotoPreset === "string");

  deactivateKuramotoModel();
  assert.equal(getCurrentModelRandomizer(), null);
});


