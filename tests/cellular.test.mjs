// tests/cellular.test.mjs — Unit test suite for Cellular Automata grid Perlin randomization
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals
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
    createElement: () => ({
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {}
      }),
      style: {},
      appendChild: () => {}
    }),
    documentElement: { style: {} }
  };
}

import {
  randomizeGrid,
  randomizeCa,
  DEFAULT_GRID_SIZE
} from "../js/cellular.js";
import { state } from "../js/state.js";

test("randomizeGrid populates cellular grid using Perlin noise", async () => {
  state.seed = 42;
  randomizeGrid(25);

  // Read current CA bank to check active cell count
  const { getBank } = await import("../js/state.js");
  const bank = getBank();
  assert.ok(Array.isArray(bank));
  assert.ok(bank[0]?.steps?.length > 0);
});

test("randomizeGrid produces deterministic patterns for identical seeds", async () => {
  const { getModelDef } = await import("../js/snapshot.js");
  const def = getModelDef("cellular");
  assert.ok(def);

  state.seed = 123456;
  randomizeGrid(20);
  const snap1 = def.capture();

  state.seed = 987654;
  randomizeGrid(20);
  const snap2 = def.capture();

  // Different seeds must produce different patterns
  assert.notDeepEqual(snap1.seedCells, snap2.seedCells);

  // Same seed must reproduce identical pattern
  state.seed = 123456;
  randomizeGrid(20);
  const snap3 = def.capture();
  assert.deepEqual(snap1.seedCells, snap3.seedCells);
});
