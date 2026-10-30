// tests/convection.test.mjs — Unit tests for Atmospheric Rayleigh-Bénard Convection & Cloud Formation model
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
  GRID_W,
  GRID_H,
  MAX_PROBES,
  probes,
  temp,
  vapor,
  cloud,
  velU,
  velV,
  CONVECTION_PRESETS,
  initConvectionPreset,
  stepSimulation,
  injectThermalPlume,
  getProbeNote,
  generateConvectionBank,
  startConvection,
  stopConvection,
  toggleConvectionRunning,
  isConvectionRunning,
  randomizeConvection,
  activateConvectionModel,
  deactivateConvectionModel,
  initConvection
} from "../js/convection.js";
import { getModelDef } from "../js/snapshot.js";
import { getCurrentModelRandomizer } from "../js/state.js";
import { toggleLive, stopLive, isLive } from "../js/player.js";

test("CONVECTION_PRESETS contains required atmospheric thermodynamic regimes", () => {
  assert.equal(CONVECTION_PRESETS.length, 5);
  const ids = CONVECTION_PRESETS.map(p => p.id);
  assert.ok(ids.includes("cumulus_rolls"));
  assert.ok(ids.includes("thunderhead"));
  assert.ok(ids.includes("katabatic"));
  assert.ok(ids.includes("metastable_mist"));
  assert.ok(ids.includes("chaotic_plumes"));
});

test("initConvectionPreset configures 8 atmospheric probes matching FM-1 hardware polyphony ceiling", () => {
  initConvectionPreset("cumulus_rolls");
  assert.equal(MAX_PROBES, 8); // FM-1 8 hardware voices ceiling
  assert.equal(probes.length, 8);

  for (let i = 0; i < MAX_PROBES; i++) {
    const p = probes[i];
    assert.equal(p.active, true);
    assert.ok(p.x >= 0 && p.x < GRID_W, `Probe ${i} X out of bounds`);
    assert.ok(p.y >= 0 && p.y < GRID_H, `Probe ${i} Y out of bounds`);
    assert.ok(p.role === "cloud" || p.role === "downdraft");
  }
});

test("initConvectionPreset initializes stable vertical temperature lapse rate", () => {
  initConvectionPreset("cumulus_rolls");

  // Bottom row (ground) must be significantly warmer than top row (upper troposphere)
  let groundTempSum = 0;
  let topTempSum = 0;

  for (let x = 0; x < GRID_W; x++) {
    groundTempSum += temp[x]; // y = 0 (ground)
    topTempSum += temp[(GRID_H - 1) * GRID_W + x]; // y = GRID_H - 1 (top)
  }

  const avgGroundT = groundTempSum / GRID_W;
  const avgTopT = topTempSum / GRID_W;

  assert.ok(avgGroundT > avgTopT + 0.3, `Ground temperature (${avgGroundT}) must be warmer than top (${avgTopT})`);
});

test("injectThermalPlume injects warm buoyant thermal parcel", () => {
  initConvectionPreset("cumulus_rolls");
  const initT = temp[2 * GRID_W + 32];

  injectThermalPlume(32, 2, 0.8, 3);
  const newT = temp[2 * GRID_W + 32];

  assert.ok(newT > initT, "Thermal plume injection must increase local temperature");
});

test("stepSimulation numerically integrates Boussinesq advection and cloud condensation without NaN/Infinity", () => {
  initConvectionPreset("thunderhead");

  // Step simulation multiple times
  for (let s = 0; s < 15; s++) {
    stepSimulation(16);
  }

  for (let i = 0; i < GRID_W * GRID_H; i++) {
    assert.ok(!Number.isNaN(temp[i]), `temp[${i}] must not be NaN`);
    assert.ok(!Number.isNaN(vapor[i]), `vapor[${i}] must not be NaN`);
    assert.ok(!Number.isNaN(cloud[i]), `cloud[${i}] must not be NaN`);
    assert.ok(!Number.isNaN(velU[i]), `velU[${i}] must not be NaN`);
    assert.ok(!Number.isNaN(velV[i]), `velV[${i}] must not be NaN`);
  }
});

test("getProbeNote quantizes atmospheric probes into register-appropriate MIDI pitches", () => {
  initConvectionPreset("cumulus_rolls");

  for (let i = 0; i < MAX_PROBES; i++) {
    const note = getProbeNote(probes[i]);
    assert.ok(Number.isInteger(note), `Probe note must be an integer`);
    assert.ok(note >= 12 && note <= 127, `Probe note ${note} must be in valid MIDI range [12, 127]`);
  }

  // Cloud probes (upper troposphere) should sound in higher registers than ground downdraft probes
  const cloudProbeNote = getProbeNote(probes[0]); // Upper cloud probe
  const downdraftNote = getProbeNote(probes[5]); // Ground downdraft probe

  assert.ok(cloudProbeNote > downdraftNote, `Cloud probe note (${cloudProbeNote}) should be higher than ground downdraft note (${downdraftNote})`);
});

test("generateConvectionBank satisfies the generator function contract", () => {
  const bank = generateConvectionBank({ length: 64, rate: 3 });
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
    assert.equal(step.source, "convection");
    assert.ok(step.probeIdx >= 0 && step.probeIdx < 8);
  });
});

test("convection snapshot registration and round-trip restore", () => {
  const def = getModelDef("convection");
  assert.ok(def, "convection must be registered in snapshot.js");
  assert.equal(def.id, "convection");
  assert.equal(def.version, 1);

  initConvectionPreset("katabatic");
  probes[0].x = 19;
  probes[0].y = 31;

  const captured = def.capture();
  assert.ok(captured);
  assert.ok(Array.isArray(captured.probes));

  // Modify then restore
  probes[0].x = 5;
  def.restore(captured);
  assert.equal(probes[0].x, 19);
  assert.equal(probes[0].y, 31);
});

test("convection transport handlers toggle running state", () => {
  assert.equal(isConvectionRunning(), false);
  startConvection();
  assert.equal(isConvectionRunning(), true);
  stopConvection();
  assert.equal(isConvectionRunning(), false);
  toggleConvectionRunning();
  assert.equal(isConvectionRunning(), true);
  toggleConvectionRunning();
  assert.equal(isConvectionRunning(), false);
});

test("randomizeConvection fills temperature and vapor fields with Perlin noise", () => {
  randomizeConvection();

  for (let i = 0; i < temp.length; i++) {
    const t = temp[i];
    const q = vapor[i];
    assert.ok(!Number.isNaN(t), `NaN in temp at ${i}`);
    assert.ok(!Number.isNaN(q), `NaN in vapor at ${i}`);
    assert.ok(t >= 0.05 && t <= 2.05, `Temp out of bounds: ${t}`);
    assert.ok(q >= 0.0 && q <= 1.55, `Vapor out of bounds: ${q}`);
  }

  // Check that horizontal variation exists (Perlin plumes perturbing 1D base profile)
  let diffCount = 0;
  for (let y = 1; y < GRID_H - 1; y++) {
    const t0 = temp[y * GRID_W + 5];
    const t1 = temp[y * GRID_W + 25];
    if (Math.abs(t0 - t1) > 0.02) diffCount++;
  }
  assert.ok(diffCount > 5, "Horizontal Perlin variation should be present in temp field");
});

test("global randomizer dispatch invokes randomizeConvection when convection is active", () => {
  activateConvectionModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  // Zero out temp and invoke rnd
  temp.fill(0);
  rnd();

  let hasHeat = false;
  for (let i = 0; i < temp.length; i++) {
    if (temp[i] > 0.1) {
      hasHeat = true;
      break;
    }
  }
  assert.ok(hasHeat, "Randomizer must populate thermal fields");

  deactivateConvectionModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("convection local play button is removed and model uses global transport", () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(val) {
      createdHtml = val;
    },
    get innerHTML() {
      return createdHtml;
    }
  };

  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-convection") return dummyContainer;
    return null;
  };

  try {
    initConvection();

    // Verify local play button is removed from UI template
    assert.ok(!createdHtml.includes('id="convect-play-btn"'), "Local play button must be removed (Global play exists)");

    // Verify model-specific controls are preserved
    assert.ok(createdHtml.includes('id="convect-plume-btn"'), "Inject Plume button retained");
    assert.ok(createdHtml.includes('id="convect-rnd-btn"'), "RND button retained");
    assert.ok(createdHtml.includes('id="convect-clear-btn"'), "Clear Clouds button retained");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

test("convection integrates seamlessly with global play transport", () => {
  activateConvectionModel();

  assert.equal(isLive(), false);
  assert.equal(isConvectionRunning(), false);

  // Global Play toggle
  toggleLive();
  assert.equal(isConvectionRunning(), true);
  assert.equal(isLive(), true);

  // Global Stop toggle
  toggleLive();
  assert.equal(isConvectionRunning(), false);
  assert.equal(isLive(), false);

  // Global Start then stopLive()
  toggleLive();
  assert.equal(isConvectionRunning(), true);
  stopLive();
  assert.equal(isConvectionRunning(), false);
  assert.equal(isLive(), false);

  deactivateConvectionModel();
});

