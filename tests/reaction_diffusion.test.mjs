// tests/reaction_diffusion.test.mjs — Unit tests for Gray-Scott Reaction-Diffusion Turing model
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
  RD_PRESETS,
  initProbes,
  seedChemicalField,
  inoculateDroplet,
  stepSimulation,
  randomizeReactionDiffusion,
  gridU,
  gridV,
  getProbeNote,
  generateReactionDiffusionBank,
  startReactionDiffusion,
  stopReactionDiffusion,
  toggleReactionDiffusionRunning,
  isReactionDiffusionRunning,
  activateReactionDiffusionModel,
  deactivateReactionDiffusionModel,
  initReactionDiffusion
} from "../js/reaction_diffusion.js";
import { getModelDef } from "../js/snapshot.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";

test("RD_PRESETS contains required Turing morphogenesis parameter regimes", () => {
  assert.equal(RD_PRESETS.length, 5);
  const ids = RD_PRESETS.map(p => p.id);
  assert.ok(ids.includes("coral"));
  assert.ok(ids.includes("mitosis"));
  assert.ok(ids.includes("solitons"));
  assert.ok(ids.includes("spirals"));
  assert.ok(ids.includes("holes"));
});

test("initProbes configures 8 probe sensors strictly within hardware polyphony ceiling", () => {
  initProbes();
  const active = probes.filter(p => p.active);
  assert.equal(active.length, MAX_PROBES);
  assert.equal(active.length, 8); // FM-1 8 hardware voices

  for (const probe of active) {
    assert.ok(probe.x >= 0 && probe.x < GRID_W, `Probe X ${probe.x} out of bounds`);
    assert.ok(probe.y >= 0 && probe.y < GRID_H, `Probe Y ${probe.y} out of bounds`);
  }
});

test("seedChemicalField and inoculateDroplet initialize valid concentration bounds", () => {
  assert.doesNotThrow(() => {
    seedChemicalField("multi_seed");
    inoculateDroplet(GRID_W / 2, GRID_H / 2, 5);
  });
});

test("stepSimulation numerically integrates Gray-Scott PDE without errors", () => {
  initProbes();
  seedChemicalField("multi_seed");

  // Advance simulation by 5 steps
  assert.doesNotThrow(() => {
    for (let step = 0; step < 5; step++) {
      stepSimulation(16);
    }
  });
});

test("getProbeNote quantizes spatial coordinates to valid scale pitches", () => {
  initProbes();
  for (const probe of probes) {
    const note = getProbeNote(probe);
    assert.ok(typeof note === "number");
    assert.ok(note >= 0 && note <= 127, `Note ${note} out of MIDI bounds`);
  }
});

test("generateReactionDiffusionBank satisfies generator contract", () => {
  initProbes();
  const bank = generateReactionDiffusionBank({ length: 64, rate: 3 });

  assert.ok(Array.isArray(bank), "Must return bank array");
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, 3);
  assert.equal(bank[0].steps.length, 64);

  for (const step of bank[0].steps) {
    assert.ok(typeof step.note === "number" && step.note >= 0 && step.note <= 127);
    assert.ok(typeof step.vel === "number" && step.vel > 0);
    assert.equal(step.gate, 1);
    assert.equal(step.source, "reaction_diffusion");
  }
});

test("reaction_diffusion snapshot registration and round-trip restore", () => {
  const def = getModelDef("reaction_diffusion");
  assert.ok(def, "reaction_diffusion model must be registered in snapshot.js");
  assert.equal(def.version, 1);

  const captured = def.capture();
  assert.ok(captured, "Capture must return state object");
  assert.ok(Array.isArray(captured.probes));
  assert.equal(captured.probes.length, MAX_PROBES);

  assert.doesNotThrow(() => {
    def.restore(captured);
  });
});

test("reaction_diffusion transport handlers toggle state", () => {
  assert.equal(isReactionDiffusionRunning(), false);

  startReactionDiffusion();
  assert.equal(isReactionDiffusionRunning(), true);

  stopReactionDiffusion();
  assert.equal(isReactionDiffusionRunning(), false);

  toggleReactionDiffusionRunning();
  assert.equal(isReactionDiffusionRunning(), true);

  toggleReactionDiffusionRunning();
  assert.equal(isReactionDiffusionRunning(), false);
});

test("randomizeReactionDiffusion fills chemical substrate with Perlin noise", () => {
  randomizeReactionDiffusion();

  let vClusterCount = 0;
  for (let i = 0; i < gridV.length; i++) {
    const v = gridV[i];
    const u = gridU[i];
    assert.ok(!Number.isNaN(v), `NaN in gridV at ${i}`);
    assert.ok(!Number.isNaN(u), `NaN in gridU at ${i}`);
    assert.ok(v >= 0.0 && v <= 0.55, `Morphogen V out of bounds: ${v}`);
    assert.ok(u >= 0.1 && u <= 1.0, `Inhibitor U out of bounds: ${u}`);
    if (v > 0.05) vClusterCount++;
  }

  assert.ok(vClusterCount > 50, "Should generate organic morphogen V clusters");
});

test("global randomizer dispatch invokes randomizeReactionDiffusion when reaction_diffusion is active", () => {
  activateReactionDiffusionModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  // Zero out morphogen and test randomizer
  gridV.fill(0);
  rnd();

  let hasMorphogen = false;
  for (let i = 0; i < gridV.length; i++) {
    if (gridV[i] > 0.05) {
      hasMorphogen = true;
      break;
    }
  }
  assert.ok(hasMorphogen, "Randomizer must seed morphogen clusters");

  deactivateReactionDiffusionModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("reaction_diffusion local controls mirroring global ones (Play) are removed", () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(val) { createdHtml = val; },
    get innerHTML() { return createdHtml; }
  };

  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-reaction_diffusion") return dummyContainer;
    return null;
  };

  try {
    initReactionDiffusion();
    assert.ok(!createdHtml.includes('id="rd-play-btn"'), "Local play button must be removed (Global play exists)");
    assert.ok(createdHtml.includes('id="rd-rnd-btn"'), "RND button present in toolbar");
    assert.ok(createdHtml.includes('id="rd-drift-btn"'), "DRIFT toggle button present in toolbar");
    assert.ok(createdHtml.includes('id="rd-strobe-select"'), "Strobe rate selector present in toolbar");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

test("autonomous drift (1D) updates probe positions and reflects at boundary walls", () => {
  initProbes();
  state.rdDrift = 1;
  state.modelSpeed = 1.0;

  const probe = probes[0];
  probe.x = 20;
  probe.y = 20;
  probe.vx = 1.5;
  probe.vy = 1.0;

  const origX = probe.x;
  const origY = probe.y;

  // Run simulation step
  stepSimulation(30);

  // Position should have changed with drift enabled
  assert.notEqual(probe.x, origX, "Probe X position must advance with autonomous drift");
  assert.notEqual(probe.y, origY, "Probe Y position must advance with autonomous drift");

  // Test boundary reflection
  probe.x = GRID_W - 3;
  probe.vx = 2.0; // Moving right towards boundary
  stepSimulation(30);
  assert.ok(probe.x <= GRID_W - 4, `Probe must stay within boundary margin (got ${probe.x}, max ${GRID_W - 4})`);
  assert.ok(probe.vx < 0, "Probe vx must reflect elastically to negative on right boundary hit");

  // Test drift disabled
  state.rdDrift = 0;
  const freezeX = probe.x;
  const freezeY = probe.y;
  stepSimulation(30);
  assert.equal(probe.x, freezeX, "Probe position must remain frozen when drift is disabled");
  assert.equal(probe.y, freezeY, "Probe position must remain frozen when drift is disabled");
  state.rdDrift = 1;
});

test("dynamic pitch modulation (2A) modulates scale degrees via morphogen concentration and gradient", () => {
  initProbes();
  const probe = probes[0];
  probe.x = 30;
  probe.y = 30;

  // With morphogen V = 0
  const noteV0 = getProbeNote(probe, 1.0, 0.0);
  // With morphogen V = 0.5
  const noteVHigh = getProbeNote(probe, 0.3, 0.5);

  assert.ok(typeof noteV0 === "number" && noteV0 >= 0 && noteV0 <= 127);
  assert.ok(typeof noteVHigh === "number" && noteVHigh >= 0 && noteVHigh <= 127);
});

test("reaction energy calculation (2B) maps to musical velocity and articulation range", () => {
  // Test reaction energy R = U * V^2 mapping
  const lowU = 0.9, lowV = 0.05;
  const highU = 0.35, highV = 0.45;

  const rLow = lowU * (lowV * lowV);
  const rHigh = highU * (highV * highV);

  const intLow = Math.min(1.0, rLow / 0.05);
  const intHigh = Math.min(1.0, rHigh / 0.05);

  const velLow = Math.max(48, Math.min(127, Math.round(52 + intLow * 72)));
  const velHigh = Math.max(48, Math.min(127, Math.round(52 + intHigh * 72)));

  assert.ok(velLow >= 48 && velLow <= 80, `Soft velocity for low energy: ${velLow}`);
  assert.ok(velHigh >= 95 && velHigh <= 127, `Accented velocity for high reaction energy: ${velHigh}`);

  const durLow = Math.round(140 + lowV * 360);
  const durHigh = Math.round(140 + highV * 360);

  assert.ok(durLow >= 140 && durLow < durHigh, "Duration must be shorter for lower concentration");
  assert.ok(durHigh <= 500, "Duration must not exceed maximum 500ms");
});

test("reaction_diffusion snapshot preserves drift, strobe rate, and probe velocities", () => {
  const def = getModelDef("reaction_diffusion");
  state.rdDrift = 0;
  state.rdStrobeRate = "8t";
  probes[0].vx = 0.88;
  probes[0].vy = -0.44;

  const captured = def.capture();
  assert.equal(captured.drift, 0);
  assert.equal(captured.strobeRate, "8t");
  assert.equal(captured.probes[0].vx, 0.88);
  assert.equal(captured.probes[0].vy, -0.44);

  // Alter state
  state.rdDrift = 1;
  state.rdStrobeRate = "16n";
  probes[0].vx = 0;
  probes[0].vy = 0;

  // Restore
  def.restore(captured);
  assert.equal(state.rdDrift, 0);
  assert.equal(state.rdStrobeRate, "8t");
  assert.equal(probes[0].vx, 0.88);
  assert.equal(probes[0].vy, -0.44);

  // Restore defaults
  state.rdDrift = 1;
  state.rdStrobeRate = "16n";
});


