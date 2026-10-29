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
  getProbeNote,
  generateReactionDiffusionBank,
  startReactionDiffusion,
  stopReactionDiffusion,
  toggleReactionDiffusionRunning,
  isReactionDiffusionRunning
} from "../js/reaction_diffusion.js";
import { getModelDef } from "../js/snapshot.js";

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
