// tests/tracy_ribbon.test.mjs — Unit tests for Electroplankton Tracy Node Grid & Multi-Creature Sequencer
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
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        fillText: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        strokeRect: () => {},
        ellipse: () => {}
      }),
      style: {},
      appendChild: () => {},
      addEventListener: () => {}
    }),
    documentElement: {
      style: {},
      getAttribute: () => null
    }
  };
}

import {
  MAX_VOICES,
  MAX_CREATURES,
  GRID_COLS,
  GRID_ROWS,
  TOTAL_NODES,
  CREATURE_COLORS,
  creatures,
  getNodeColRow,
  getNodeIndex,
  getTracyNodePitch,
  getTracyNote,
  TRACY_PRESETS,
  initTracyPreset,
  generateRandomCreaturePath,
  randomizeTracy,
  stepSimulation,
  generateTracyRibbonBank,
  startTracyRibbon,
  stopTracyRibbon,
  toggleTracyRibbonRunning,
  isTracyRibbonRunning,
  activateTracyRibbonModel,
  deactivateTracyRibbonModel
} from "../js/tracy_ribbon.js";
import { getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";
import { state } from "../js/state.js";

test("Node Grid Dimensions & Constants", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(MAX_CREATURES, 8);
  assert.equal(GRID_COLS, 8);
  assert.equal(GRID_ROWS, 6);
  assert.equal(TOTAL_NODES, 48);
  assert.equal(CREATURE_COLORS.length, 8);
  assert.equal(creatures.length, 8);
});

test("Node Index and Col/Row Bidirectional Mapping", () => {
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const idx = getNodeIndex(c, r);
      assert.ok(idx >= 0 && idx < TOTAL_NODES);
      const mapped = getNodeColRow(idx);
      assert.equal(mapped.col, c);
      assert.equal(mapped.row, r);
    }
  }
});

test("Each creature has distinct color, speed multiplier, and base pitch offset", () => {
  for (let i = 0; i < MAX_CREATURES; i++) {
    const c = creatures[i];
    assert.equal(c.id, i);
    assert.equal(c.color, CREATURE_COLORS[i]);
    assert.ok(typeof c.speed === "number" && c.speed > 0);
    assert.ok(Number.isInteger(c.basePitchOffset));
    assert.ok(Array.isArray(c.nodes));
  }
});

test("TRACY_PRESETS contains multi-creature path constellations", () => {
  assert.equal(TRACY_PRESETS.length, 5);
  const ids = TRACY_PRESETS.map(p => p.id);
  assert.ok(ids.includes("counterpoint"));
  assert.ok(ids.includes("parallel_waves"));
  assert.ok(ids.includes("harmonic_quad"));
  assert.ok(ids.includes("orbital_cross"));
  assert.ok(ids.includes("cascade_canon"));
});

test("initTracyPreset initializes multi-creature routes and parameters", () => {
  initTracyPreset("counterpoint");

  for (let i = 0; i < 4; i++) {
    const c = creatures[i];
    assert.ok(c.nodes.length >= 2, `Creature ${i} must have at least 2 route nodes`);
    for (const nodeIdx of c.nodes) {
      assert.ok(nodeIdx >= 0 && nodeIdx < TOTAL_NODES, `Node index ${nodeIdx} within grid bounds`);
    }
  }
});

test("getTracyNodePitch quantizes grid coordinates to valid scale MIDI pitches", () => {
  state.scale = "pentMinor";
  state.root = 60; // C4
  state.pitchSpan = 2; // 2 octaves

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const pitch = getTracyNodePitch(c, r, 0, 0);
      assert.ok(Number.isInteger(pitch));
      assert.ok(pitch >= 12 && pitch <= 127, `Pitch ${pitch} within MIDI bounds`);
    }
  }

  // Base pitch offsets harmonize across scale degrees
  const p0 = getTracyNodePitch(0, 2, 0, 0);
  const p2 = getTracyNodePitch(0, 2, 2, 0);
  assert.ok(p2 > p0, "Higher scale degree offset should yield higher or harmonized pitch");
});

test("Grid pitches strictly sit within both the active scale and the octave spread", () => {
  state.scale = "pentMinor";
  state.root = 60; // C4
  state.octaveMode = "up";

  // Test across multiple octave spread settings (1, 2, 3, 4 octaves)
  for (const span of [1, 2, 3, 4]) {
    state.pitchSpan = span;
    const minExpected = state.root;
    const maxExpected = state.root + span * 12;

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const pitch = getTracyNodePitch(c, r, 0, 0);
        assert.ok(
          pitch >= minExpected && pitch <= maxExpected,
          `Pitch ${pitch} at (${c}, ${r}) must sit within octave spread [${minExpected}, ${maxExpected}] for span ${span}`
        );
        // Verify pitch is in the pentatonic minor scale intervals [0, 3, 5, 7, 10]
        const relSemitone = ((pitch - state.root) % 12 + 12) % 12;
        assert.ok(
          [0, 3, 5, 7, 10].includes(relSemitone),
          `Pitch ${pitch} (rel ${relSemitone}) must conform to active pentMinor scale`
        );
      }
    }
  }
});

test("Each creature chooses a distinct base pitch from the scale defined in the notes div", () => {
  state.scale = "major";
  state.root = 48; // C3
  state.pitchSpan = 3;

  const basePitches = new Set();
  for (let i = 0; i < MAX_CREATURES; i++) {
    const c = creatures[i];
    const pitch = getTracyNodePitch(0, 0, c.basePitchOffset, 0);
    assert.ok(pitch >= 12 && pitch <= 127);
    // Relative interval must be in major scale [0, 2, 4, 5, 7, 9, 11]
    const rel = ((pitch - state.root) % 12 + 12) % 12;
    assert.ok([0, 2, 4, 5, 7, 9, 11].includes(rel), `Creature ${i} base pitch ${pitch} must be in major scale`);
    basePitches.add(pitch);
  }

  // At least 4 distinct pitch classes across the 8 default creature base pitches
  assert.ok(basePitches.size >= 4, `Creatures must have distinct base pitches (found ${basePitches.size})`);
});

test("getTracyNote compatibility wrapper produces valid pitches", () => {
  for (let x = -0.8; x <= 0.8; x += 0.4) {
    for (let y = -0.7; y <= 0.7; y += 0.4) {
      const note = getTracyNote(x, y, 0);
      assert.ok(Number.isInteger(note));
      assert.ok(note >= 12 && note <= 127);
    }
  }
});

test("stepSimulation advances creatures along their node paths", () => {
  initTracyPreset("parallel_waves");
  state.tracyCreatureCount = 4;
  state.tracySpeed = 1.0;

  let stepTriggerCount = 0;
  for (let i = 0; i < 60; i++) {
    const res = stepSimulation(0.016);
    if (res.triggered) stepTriggerCount++;
  }

  assert.ok(stepTriggerCount > 0, "Creatures traversing node circuits must trigger arrival notes");
});

test("Generator contract: generateTracyRibbonBank returns valid 64-step bank array", () => {
  initTracyPreset("harmonic_quad");

  const bank = generateTracyRibbonBank({
    length: 64,
    tracyCreatureCount: 4,
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
    assert.ok(Array.isArray(step.notes));
    for (const n of step.notes) {
      assert.ok(Number.isInteger(n.note));
      assert.ok(n.note >= 12 && n.note <= 127);
      assert.ok(n.vel >= 0 && n.vel <= 127);
    }
  }
});

test("Snapshot capture and restore round-trip preserves all creature paths and speeds", () => {
  const def = getModelDef("tracy_ribbon");
  assert.ok(def, "tracy_ribbon model definition must be registered in snapshot.js");

  initTracyPreset("counterpoint");
  creatures[0].speed = 1.65;
  creatures[0].basePitchOffset = 3;

  const snap = def.capture();
  assert.equal(snap.preset, "counterpoint");
  assert.ok(Array.isArray(snap.creatures));
  assert.equal(snap.creatures[0].speed, 1.65);
  assert.equal(snap.creatures[0].basePitchOffset, 3);

  initTracyPreset("cascade_canon");
  def.restore(snap);

  const restoredSnap = def.capture();
  assert.equal(restoredSnap.preset, "counterpoint");
  assert.equal(creatures[0].speed, 1.65);
  assert.equal(creatures[0].basePitchOffset, 3);
});

test("Transport start/stop/toggle controls", () => {
  stopTracyRibbon();
  assert.equal(isTracyRibbonRunning(), false);

  startTracyRibbon();
  assert.equal(isTracyRibbonRunning(), true);

  toggleTracyRibbonRunning();
  assert.equal(isTracyRibbonRunning(), false);

  toggleTracyRibbonRunning();
  assert.equal(isTracyRibbonRunning(), true);
  stopTracyRibbon();
});

test("generateRandomCreaturePath creates valid closed looping node circuits", () => {
  for (let trial = 0; trial < 20; trial++) {
    const path = generateRandomCreaturePath();
    assert.ok(Array.isArray(path));
    assert.ok(path.length >= 3 && path.length <= 8, `Path length ${path.length} must be in [3, 8]`);
    for (const idx of path) {
      assert.ok(Number.isInteger(idx));
      assert.ok(idx >= 0 && idx < TOTAL_NODES, `Node index ${idx} within bounds [0, 47]`);
    }
  }
});

test("randomizeTracy randomizes creature count, pitch offsets, and paths", () => {
  initTracyPreset("counterpoint");

  // Record initial state
  const prevCount = state.tracyCreatureCount;
  const prevOffsets = creatures.map(c => c.basePitchOffset);
  const prevNodes = creatures.map(c => [...c.nodes]);

  randomizeTracy();

  // 1. Verify creature count randomized within [1, 8]
  assert.ok(typeof state.tracyCreatureCount === "number");
  assert.ok(state.tracyCreatureCount >= 1 && state.tracyCreatureCount <= 8);

  // 2. Verify pitch offsets randomized
  const newOffsets = creatures.map(c => c.basePitchOffset);
  let anyOffsetDiff = false;
  for (let i = 0; i < MAX_CREATURES; i++) {
    assert.ok(Number.isInteger(newOffsets[i]));
    if (newOffsets[i] !== prevOffsets[i]) anyOffsetDiff = true;
  }
  assert.ok(anyOffsetDiff, "Pitch offsets must be randomized across creatures");

  // 3. Verify closed node loop paths randomized
  for (let i = 0; i < MAX_CREATURES; i++) {
    const c = creatures[i];
    assert.ok(Array.isArray(c.nodes));
    assert.ok(c.nodes.length >= 3, `Creature ${i} must have valid looping route`);
    for (const nodeIdx of c.nodes) {
      assert.ok(nodeIdx >= 0 && nodeIdx < TOTAL_NODES);
    }
  }

  // 4. Verify preset state changed to "custom"
  assert.equal(state.tracyPreset, "custom");
});

test("Global randomize button triggers randomizeTracy when tracy_ribbon is active", () => {
  activateTracyRibbonModel();
  const currentRandomizer = getCurrentModelRandomizer();
  assert.equal(currentRandomizer, randomizeTracy, "Active model randomizer must be randomizeTracy");

  // Call active model randomizer (same as global randomize button dispatch)
  currentRandomizer();

  assert.ok(state.tracyCreatureCount >= 1 && state.tracyCreatureCount <= 8);
  assert.equal(state.tracyPreset, "custom");

  deactivateTracyRibbonModel();
  assert.equal(getCurrentModelRandomizer(), null, "Deactivating model must unbind model randomizer");
});
