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
  stepSimulation,
  generateTracyRibbonBank,
  startTracyRibbon,
  stopTracyRibbon,
  toggleTracyRibbonRunning,
  isTracyRibbonRunning
} from "../js/tracy_ribbon.js";
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
    tracyOctave: 0,
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
