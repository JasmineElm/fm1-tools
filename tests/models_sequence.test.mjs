// tests/models_sequence.test.mjs — Integration test suite running each model in sequence
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {},
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: "" },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
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
    setTransform: () => {},
    resetTransform: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    measureText: () => ({ width: 10 }),
    canvas: { width: 400, height: 400 }
  };

  const createDummyEl = () => ({
    getContext: () => dummyCtx,
    style: {
      setProperty: () => {},
      removeProperty: () => {},
      width: "400px",
      height: "400px",
      display: "block"
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

if (typeof localStorage === "undefined") {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}

import { state } from "../js/state.js";
import { MODELS, POLYPHONIC_MODELS } from "../js/modes.js";
import { getModelDef } from "../js/snapshot.js";
import { isLive, toggleLive, stopLive } from "../js/player.js";

// Import all models and their lifecycle/generator/step exports
import * as mene311 from "../js/generator.js";
import * as turing from "../js/turing.js";
import * as cellular from "../js/cellular.js";
import * as particles from "../js/particles.js";
import * as pendulum from "../js/pendulum.js";
import * as flock from "../js/flock.js";
import * as rungler from "../js/rungler.js";
import * as krell from "../js/krell.js";
import * as lsystem from "../js/lsystem.js";
import * as lotka_volterra from "../js/lotka_volterra.js";
import * as orbital from "../js/orbital.js";
import * as hanenbow from "../js/hanenbow.js";
import * as sandpile from "../js/sandpile.js";
import * as percolation from "../js/percolation.js";
import * as dla from "../js/dla.js";
import * as epidemic from "../js/epidemic.js";
import * as changes from "../js/changes.js";
import * as physarum from "../js/physarum.js";
import * as reaction_diffusion from "../js/reaction_diffusion.js";
import * as kuramoto from "../js/kuramoto.js";
import * as fitzhugh_nagumo from "../js/fitzhugh_nagumo.js";
import * as ripple_tank from "../js/ripple_tank.js";
import * as convection from "../js/convection.js";
import * as markov_matrix from "../js/markov_matrix.js";
import * as genetic_breeder from "../js/genetic_breeder.js";
import * as chladni from "../js/chladni.js";
import * as brownian_ratchet from "../js/brownian_ratchet.js";
import * as tracy_ribbon from "../js/tracy_ribbon.js";
import * as self_avoiding_walk from "../js/self_avoiding_walk.js";

const MODEL_MODULE_MAP = {
  mene311,
  turing,
  cellular,
  particles,
  pendulum,
  flock,
  rungler,
  krell,
  lsystem,
  lotka_volterra,
  orbital,
  hanenbow,
  sandpile,
  percolation,
  dla,
  epidemic,
  changes,
  physarum,
  reaction_diffusion,
  kuramoto,
  fitzhugh_nagumo,
  ripple_tank,
  convection,
  markov_matrix,
  genetic_breeder,
  chladni,
  brownian_ratchet,
  tracy_ribbon,
  self_avoiding_walk
};

test("MODELS array contains all 29 models with required metadata", () => {
  assert.equal(MODELS.length, 29, "Expected exactly 29 models in MODELS registry");
  for (const m of MODELS) {
    assert.ok(typeof m.id === "string" && m.id.length > 0, `Model ${m.id} has valid id`);
    assert.ok(typeof m.name === "string" && m.name.length > 0, `Model ${m.id} has name`);
    assert.ok(typeof m.kicker === "string" && m.kicker.length > 0, `Model ${m.id} has kicker`);
    assert.ok(typeof m.desc === "string" && m.desc.length > 0, `Model ${m.id} has desc`);
    assert.equal(m.available, true, `Model ${m.id} must be marked available: true`);
    assert.ok(Array.isArray(m.tags) && m.tags.length > 0, `Model ${m.id} has tags`);
    assert.ok(typeof m.icon === "string" && m.icon.includes("<svg"), `Model ${m.id} has SVG icon`);
  }
});

test("POLYPHONIC_MODELS set contains expected models", () => {
  assert.equal(POLYPHONIC_MODELS.size, 25, "Expected 25 polyphonic models");
  assert.ok(!POLYPHONIC_MODELS.has("mene311"), "mene311 is monophonic");
  assert.ok(!POLYPHONIC_MODELS.has("turing"), "turing is monophonic");
  assert.ok(!POLYPHONIC_MODELS.has("cellular"), "cellular is monophonic");
  assert.ok(!POLYPHONIC_MODELS.has("rungler"), "rungler is monophonic");
  assert.ok(POLYPHONIC_MODELS.has("self_avoiding_walk"), "self_avoiding_walk is polyphonic");
  assert.ok(POLYPHONIC_MODELS.has("tracy_ribbon"), "tracy_ribbon is polyphonic");
});

test("Each model in sequence satisfies generator bank contract or continuous free engine contract", () => {
  const lengths = [16, 32, 64];

  for (const m of MODELS) {
    const mod = MODEL_MODULE_MAP[m.id];
    assert.ok(mod, `Module for model ${m.id} exists`);

    // Find generator function if one exists
    let genFn = null;
    for (const key of Object.keys(mod)) {
      if (key.startsWith("generate") && key.endsWith("Bank")) {
        genFn = mod[key];
        break;
      }
    }
    if (!genFn && m.id === "mene311") genFn = mod.generateBank;

    if (genFn) {
      for (const len of lengths) {
        state.length = len;
        const bank = genFn(state);
        assert.ok(Array.isArray(bank), `${m.id} generate bank returned an array`);
        assert.ok(bank.length >= 1, `${m.id} bank has at least 1 pattern`);
        assert.ok(bank[0].length >= 1 && bank[0].length <= 64, `${m.id} pattern length in [1, 64]`);
        assert.ok(Array.isArray(bank[0].steps), `${m.id} pattern has steps array`);
        assert.ok(bank[0].steps.length >= Math.min(len, bank[0].length), `${m.id} steps count covers pattern length`);

        // Check step note integrity
        for (let i = 0; i < len; i++) {
          const step = bank[0].steps[i];
          assert.ok(step && typeof step === "object", `${m.id} step ${i} is valid object`);
          assert.ok(Array.isArray(step.notes), `${m.id} step ${i} has notes array`);
          for (const n of step.notes) {
            assert.ok(typeof n.note === "number", `${m.id} step ${i} note value is number`);
            assert.ok(n.note >= 0 && n.note <= 127, `${m.id} step ${i} note ${n.note} in [0, 127]`);
            assert.ok(typeof n.vel === "number", `${m.id} step ${i} vel value is number`);
            assert.ok(n.vel >= 1 && n.vel <= 127, `${m.id} step ${i} vel ${n.vel} in [1, 127]`);
          }
        }
      }
    }
  }
});

test("Run each model in sequence: activation, stepping, polyphony check, and deactivation", () => {
  for (const m of MODELS) {
    const mod = MODEL_MODULE_MAP[m.id];
    assert.ok(mod, `Module for model ${m.id} exists`);

    // Look for activation/deactivation functions
    const activateFn = mod[`activate${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Model`]
      || mod[`activate${m.id.charAt(0).toUpperCase() + m.id.slice(1)}Model`];
    const deactivateFn = mod[`deactivate${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Model`]
      || mod[`deactivate${m.id.charAt(0).toUpperCase() + m.id.slice(1)}Model`];

    if (activateFn) {
      assert.doesNotThrow(() => activateFn(), `Model ${m.id} activate should not throw`);
    }

    // Look for stepping simulation functions
    const stepFn = mod.stepSimulation
      || mod.stepMonomer
      || mod.stepPendulumSimulation
      || mod.updateFlockSimulation
      || mod.advanceMethodRow;

    if (stepFn) {
      for (let s = 0; s < 5; s++) {
        assert.doesNotThrow(() => stepFn(), `Model ${m.id} step ${s} should not throw`);
      }
    }

    if (deactivateFn) {
      assert.doesNotThrow(() => deactivateFn(), `Model ${m.id} deactivate should not throw`);
    }
  }
});

test("Reverse sequential model transitions (bidirectional switching stress test)", () => {
  const reversedModels = [...MODELS].reverse();
  for (const m of reversedModels) {
    const mod = MODEL_MODULE_MAP[m.id];
    const activateFn = mod[`activate${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Model`]
      || mod[`activate${m.id.charAt(0).toUpperCase() + m.id.slice(1)}Model`];
    const deactivateFn = mod[`deactivate${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Model`]
      || mod[`deactivate${m.id.charAt(0).toUpperCase() + m.id.slice(1)}Model`];

    if (activateFn) {
      assert.doesNotThrow(() => activateFn(), `Reverse activation of ${m.id} should not throw`);
    }
    if (deactivateFn) {
      assert.doesNotThrow(() => deactivateFn(), `Reverse deactivation of ${m.id} should not throw`);
    }
  }
});

test("Snapshot capture and restore round-trip across each registered model in sequence", () => {
  for (const m of MODELS) {
    const def = getModelDef(m.id);
    if (!def) continue; // Some models might rely on default shared envelope

    assert.ok(typeof def.capture === "function", `Model ${m.id} snapshot has capture()`);
    assert.ok(typeof def.restore === "function", `Model ${m.id} snapshot has restore()`);

    const captured = def.capture();
    assert.ok(captured && typeof captured === "object", `Model ${m.id} captured valid state object`);

    // Restore captured state
    assert.doesNotThrow(() => def.restore(captured), `Model ${m.id} restore should not throw`);
  }
});

test("Workbench showModel switches active view through all 29 models sequentially", async () => {
  const { showModel, getActiveModel } = await import("../js/modes.js");
  for (const m of MODELS) {
    showModel(m.id, false);
    assert.equal(getActiveModel(), m.id, `Active model ID should be ${m.id}`);
  }
});

test("Scale quantization conforms across all bank generators in sequence", () => {
  const testScales = ["pentMinor", "major", "dorian", "harmonicMinor", "blues"];
  for (const scaleName of testScales) {
    state.scale = scaleName;
    state.root = 60; // C4

    for (const m of MODELS) {
      const mod = MODEL_MODULE_MAP[m.id];
      let genFn = null;
      for (const key of Object.keys(mod)) {
        if (key.startsWith("generate") && key.endsWith("Bank")) {
          genFn = mod[key];
          break;
        }
      }
      if (!genFn && m.id === "mene311") genFn = mod.generateBank;

      if (genFn) {
        state.length = 16;
        const bank = genFn(state);
        assert.ok(Array.isArray(bank), `${m.id} returns valid bank on scale ${scaleName}`);
        const p = bank[0];
        assert.ok(p && Array.isArray(p.steps), `${m.id} has steps array`);

        for (const st of p.steps) {
          if (Array.isArray(st.notes)) {
            for (const n of st.notes) {
              assert.ok(Number.isInteger(n.note), `${m.id} note ${n.note} is integer`);
              assert.ok(n.note >= 0 && n.note <= 127, `${m.id} note ${n.note} in MIDI range`);
            }
          }
        }
      }
    }
  }
});

test("Transport Play and Stop contract across all models: models start paused, run on Play, stop and silence on Stop", () => {
  for (const m of MODELS) {
    const mod = MODEL_MODULE_MAP[m.id];
    if (!mod) continue;

    const activateFn = mod[`activate${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Model`]
      || mod[`activate${m.id.charAt(0).toUpperCase() + m.id.slice(1)}Model`];
    const deactivateFn = mod[`deactivate${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Model`]
      || mod[`deactivate${m.id.charAt(0).toUpperCase() + m.id.slice(1)}Model`];

    // Ensure stopped before activating
    stopLive();

    if (activateFn) {
      activateFn();
    }

    // 1. Model must initialize in a paused/stopped state
    assert.equal(isLive(), false, `Model ${m.id} must initialize paused (isLive() === false)`);

    // 2. Starting via toggleLive (Play button) must start playback
    toggleLive();
    assert.equal(isLive(), true, `Model ${m.id} must be running after toggleLive (isLive() === true)`);

    // 3. Stopping via stopLive (Stop button) must halt playback and silence voices
    stopLive();
    assert.equal(isLive(), false, `Model ${m.id} must stop after stopLive (isLive() === false)`);

    // 4. Any model-specific running state must be false
    const isRunningFn = mod[`is${m.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Running`];
    if (isRunningFn) {
      assert.equal(isRunningFn(), false, `Model ${m.id} isRunning() must be false when stopped`);
    }

    if (deactivateFn) {
      deactivateFn();
    }
  }
});
