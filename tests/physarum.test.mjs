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
  randomizeFoodNodePositions,
  reseedAgents,
  sampleTrail,
  stepSimulation,
  getFoodNodeNote,
  generatePhysarumBank,
  startPhysarum,
  stopPhysarum,
  togglePhysarumRunning,
  isPhysarumRunning,
  randomizePhysarum,
  trailField,
  activatePhysarumModel,
  deactivatePhysarumModel,
  initPhysarum
} from "../js/physarum.js";
import { getModelDef } from "../js/snapshot.js";
import { state, refs, getCurrentModelRandomizer } from "../js/state.js";

test("PHYSARUM_PRESETS contains required network topologies", () => {
  assert.equal(PHYSARUM_PRESETS.length, 6);
  const ids = PHYSARUM_PRESETS.map(p => p.id);
  assert.ok(ids.includes("tokyo"));
  assert.ok(ids.includes("pentagon"));
  assert.ok(ids.includes("bipartite"));
  assert.ok(ids.includes("hex_hub"));
  assert.ok(ids.includes("spiral"));
  assert.ok(ids.includes("random"));
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

test("randomizePhysarum fills trail field with Perlin noise", () => {
  randomizePhysarum();

  let nonZeroCount = 0;
  for (let i = 0; i < trailField.length; i++) {
    const v = trailField[i];
    assert.ok(!Number.isNaN(v), `NaN in trailField at ${i}`);
    assert.ok(v >= 0.0 && v <= 1.05, `trailField value out of bounds: ${v}`);
    if (v > 0.01) nonZeroCount++;
  }

  assert.ok(nonZeroCount > 50, "Should generate organic attractant trails");
});

test("global randomizer dispatch invokes randomizePhysarum when physarum is active", () => {
  activatePhysarumModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  // Zero out trailField and invoke rnd
  trailField.fill(0);
  rnd();

  let hasTrail = false;
  for (let i = 0; i < trailField.length; i++) {
    if (trailField[i] > 0.01) {
      hasTrail = true;
      break;
    }
  }
  assert.ok(hasTrail, "Randomizer must populate trail field");

  deactivatePhysarumModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("randomizeFoodNodePositions distributes nodes within grid boundaries", () => {
  const positions = randomizeFoodNodePositions(6);
  assert.equal(positions.length, 6);
  const activeNodes = foodNodes.filter(n => n.active);
  assert.equal(activeNodes.length, 6);

  for (const node of activeNodes) {
    assert.ok(node.x >= 8 && node.x <= GRID_W - 8, `Node x ${node.x} within bounds`);
    assert.ok(node.y >= 8 && node.y <= GRID_H - 8, `Node y ${node.y} within bounds`);
  }
});

test("randomizePhysarum randomizes node positions and alters controls in the notes div", () => {
  initFoodPreset("tokyo");
  const initialX = foodNodes[0].x;
  const initialY = foodNodes[0].y;

  // Set known initial values in notes div state
  state.scale = "chromatic";
  state.rootNote = 0; // C
  state.rootOctave = 1;
  state.pitchSpan = 1;

  randomizePhysarum();

  // 1. Food node positions must have been randomized
  const activeNodes = foodNodes.filter(n => n.active);
  assert.ok(activeNodes.length >= 1 && activeNodes.length <= MAX_FOOD);
  const changedPosition = foodNodes.some(n => n.active && (n.x !== initialX || n.y !== initialY));
  assert.ok(changedPosition, "Food node positions must be randomized");

  // 2. Controls in the notes div must have been altered
  assert.ok(typeof state.scale === "string", "Scale must be a valid scale name");
  assert.notEqual(state.scale, "custom");
  assert.ok(typeof state.rootNote === "number" && state.rootNote >= 0 && state.rootNote <= 11, "Root note 0-11");
  assert.ok(typeof state.rootOctave === "number" && state.rootOctave >= 2 && state.rootOctave <= 5, "Root octave 2-5");
  assert.ok(typeof state.pitchSpan === "number" && state.pitchSpan >= 1 && state.pitchSpan <= 4, "Pitch span 1-4");
  assert.ok(typeof state.quantSteps === "number" && state.quantSteps >= 50 && state.quantSteps <= 100, "Quant steps 50-100");
  assert.ok(typeof state.octave === "number" && state.octave >= 0 && state.octave <= 100, "Octave 0-100");
  assert.ok(["up", "down", "both"].includes(state.octaveMode), "Octave mode valid");
  assert.ok(typeof state.polyphony === "number" && state.polyphony >= 1 && state.polyphony <= 8, "Polyphony 1-8");
  assert.ok(typeof state.polyStrategy === "string", "Poly strategy valid");

  // 3. Preset state updated to 'random'
  assert.equal(state.physarumPreset, "random");
});

test("locally implemented controls with Global or notes div counterparts are removed", () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(html) {
      createdHtml = html;
    },
    get innerHTML() {
      return createdHtml;
    }
  };

  // Mock document.getElementById to return dummy container
  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-physarum") return dummyContainer;
    return null;
  };

  try {
    initPhysarum();

    // Verify local play button is removed
    assert.ok(!createdHtml.includes('id="physarum-play-btn"'), "Local play button must be removed (Global play exists)");

    // Verify local RND button is removed
    assert.ok(!createdHtml.includes('id="physarum-rnd-btn"'), "Local RND button must be removed (Global randomise exists)");

    // Verify local Span slider is removed
    assert.ok(!createdHtml.includes('id="physarum-span"'), "Local Span slider must be removed (Notes div octave spread exists)");

    // Verify remaining model-specific controls are preserved
    assert.ok(createdHtml.includes('id="physarum-reseed-btn"'), "Re-Seed button retained");
    assert.ok(createdHtml.includes('id="physarum-clear-btn"'), "Clear button retained");
    assert.ok(createdHtml.includes('id="physarum-preset-select"'), "Preset select retained");
    assert.ok(createdHtml.includes('id="physarum-sens-dist"'), "Sens Dist retained");
    assert.ok(createdHtml.includes('id="physarum-sens-ang"'), "Sens Ang retained");
    assert.ok(createdHtml.includes('id="physarum-decay"'), "Decay retained");
    assert.ok(createdHtml.includes('id="physarum-thresh"'), "Thresh retained");
    assert.ok(createdHtml.includes('id="physarum-agents"'), "Agents retained");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

