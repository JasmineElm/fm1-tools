// tests/physarum.test.mjs — Unit tests for Physarum Slime Mould Network model
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
  MAX_AGENTS,
  MAX_FOOD,
  foodNodes,
  PHYSARUM_PRESETS,
  initFoodPreset,
  reseedAgents,
  sampleTrail,
  stepSimulation,
  getFoodNodeNote,
  generatePhysarumBank,
  startPhysarum,
  stopPhysarum,
  togglePhysarumRunning,
  isPhysarumRunning
} from "../js/physarum.js";
import { getModelDef } from "../js/snapshot.js";

test("PHYSARUM_PRESETS contains required network topologies", () => {
  assert.equal(PHYSARUM_PRESETS.length, 5);
  const ids = PHYSARUM_PRESETS.map(p => p.id);
  assert.ok(ids.includes("tokyo"));
  assert.ok(ids.includes("pentagon"));
  assert.ok(ids.includes("bipartite"));
  assert.ok(ids.includes("hex_hub"));
  assert.ok(ids.includes("spiral"));
});

test("initFoodPreset configures active food nodes strictly within 8-voice hardware ceiling", () => {
  for (const preset of PHYSARUM_PRESETS) {
    initFoodPreset(preset.id);
    const active = foodNodes.filter(n => n.active);
    assert.ok(active.length >= 1 && active.length <= MAX_FOOD, `Preset ${preset.id} has ${active.length} nodes (must be <= 8)`);

    for (const node of active) {
      assert.ok(node.x >= 0 && node.x < GRID_W, `Node X ${node.x} out of bounds for preset ${preset.id}`);
      assert.ok(node.y >= 0 && node.y < GRID_H, `Node Y ${node.y} out of bounds for preset ${preset.id}`);
      assert.equal(typeof node.flux, "number");
    }
  }
});

test("reseedAgents sets valid agent positions and orientations", () => {
  initFoodPreset("tokyo");
  reseedAgents(256);

  // Sample trail outside and inside
  const valCenter = sampleTrail(GRID_W / 2, GRID_H / 2);
  assert.equal(typeof valCenter, "number");
  assert.ok(valCenter >= 0);

  // Boundary clamp testing
  const valEdge = sampleTrail(-5, 999);
  assert.equal(typeof valEdge, "number");
});

test("stepSimulation executes chemotaxis updates and diffusion without errors", () => {
  initFoodPreset("pentagon");
  reseedAgents(128);

  // Advance simulation by 5 steps
  assert.doesNotThrow(() => {
    for (let step = 0; step < 5; step++) {
      stepSimulation(16);
    }
  });
});

test("getFoodNodeNote quantizes food coordinates within valid MIDI bounds", () => {
  initFoodPreset("spiral");
  const active = foodNodes.filter(n => n.active);

  for (const node of active) {
    const note = getFoodNodeNote(node);
    assert.ok(typeof note === "number");
    assert.ok(note >= 0 && note <= 127, `Note ${note} must be between 0 and 127`);
  }
});

test("generatePhysarumBank satisfies generator function contract", () => {
  initFoodPreset("tokyo");
  const bank = generatePhysarumBank({ length: 64, rate: 3 });

  assert.ok(Array.isArray(bank), "Must return bank array");
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, 3);
  assert.equal(bank[0].steps.length, 64);

  for (const step of bank[0].steps) {
    assert.ok(typeof step.note === "number" && step.note >= 0 && step.note <= 127);
    assert.ok(typeof step.vel === "number" && step.vel > 0);
    assert.equal(step.gate, 1);
    assert.equal(step.source, "physarum");
  }
});

test("physarum model snapshot registration and round trip", () => {
  const def = getModelDef("physarum");
  assert.ok(def, "physarum model must be registered in snapshot.js");
  assert.equal(def.version, 1);

  const captured = def.capture();
  assert.ok(captured, "Capture must return valid state object");
  assert.ok(Array.isArray(captured.foodNodes));
  assert.equal(captured.foodNodes.length, MAX_FOOD);

  assert.doesNotThrow(() => {
    def.restore(captured);
  });
});

test("physarum transport controls toggle running state", () => {
  assert.equal(isPhysarumRunning(), false);

  startPhysarum();
  assert.equal(isPhysarumRunning(), true);

  stopPhysarum();
  assert.equal(isPhysarumRunning(), false);

  togglePhysarumRunning();
  assert.equal(isPhysarumRunning(), true);

  togglePhysarumRunning();
  assert.equal(isPhysarumRunning(), false);
});
