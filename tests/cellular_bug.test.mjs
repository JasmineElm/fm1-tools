// tests/cellular_bug.test.mjs — Comprehensive unit tests for 2D Cellular + Bug model
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {}
  };
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
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
        fillText: () => {},
        save: () => {},
        restore: () => {},
        moveTo: () => {},
        lineTo: () => {},
        strokeRect: () => {},
        setLineDash: () => {},
        ellipse: () => {},
        closePath: () => {},
        translate: () => {},
        rotate: () => {}
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
  GRID_DIM,
  TOTAL_CELLS,
  MAX_BUGS,
  MAX_VOICES,
  CELLULAR_BUG_PRESETS,
  CA_RULES,
  BUG_MODES,
  TRIGGER_MODES,
  gridState,
  bugX,
  bugY,
  bugDir,
  bugState,
  initCellularBugGrid,
  countNeighbors,
  stepCellularGrid,
  stepBug,
  evaluateBugVoice,
  stepCellularBug,
  generateCellularBugBank,
  isCellularBugRunning,
  startCellularBug,
  stopCellularBug,
  toggleCellularBug,
  applyCellularBugPreset,
  randomizeCellularBug,
  injectGlider,
  activateCellularBugModel,
  deactivateCellularBugModel
} from "../js/cellular_bug.js";

import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("CELLULAR_BUG_PRESETS contains required musical configurations", () => {
  assert.ok(Array.isArray(CELLULAR_BUG_PRESETS) && CELLULAR_BUG_PRESETS.length >= 5);
  const ids = CELLULAR_BUG_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("langton_highway"), "langton_highway preset must exist");
  assert.ok(ids.includes("brian_acid"), "brian_acid preset must exist");
  assert.ok(ids.includes("glider_clash"), "glider_clash preset must exist");
  assert.ok(ids.includes("spiral_turmite"), "spiral_turmite preset must exist");
  assert.ok(ids.includes("chaotic_swarm"), "chaotic_swarm preset must exist");

  for (const p of CELLULAR_BUG_PRESETS) {
    assert.ok(p.bugs >= 1 && p.bugs <= 8, "Preset bug count within 1..8");
    assert.ok(CA_RULES.some((r) => r.id === p.caRule));
    assert.ok(BUG_MODES.some((m) => m.id === p.bugMode));
    assert.ok(TRIGGER_MODES.some((t) => t.id === p.triggerMode));
  }
});

test("Hardware polyphony ceiling: MAX_BUGS and MAX_VOICES capped strictly at 8", () => {
  assert.equal(MAX_BUGS, 8, "MAX_BUGS must be strictly 8 for FM-1 hardware safety");
  assert.equal(MAX_VOICES, 8, "MAX_VOICES must be strictly 8");
  assert.equal(GRID_DIM, 32, "GRID_DIM must be 32x32");
  assert.equal(TOTAL_CELLS, 1024, "TOTAL_CELLS must be 1024");
});

test("initCellularBugGrid populates lattice and symmetrically positions bugs", () => {
  initCellularBugGrid(0.20);
  assert.equal(gridState.length, 1024);

  let activeCount = 0;
  for (let i = 0; i < 1024; i++) {
    if (gridState[i] > 0) activeCount++;
  }
  assert.ok(activeCount > 50, "Random soup seeded active cells");

  for (let b = 0; b < MAX_BUGS; b++) {
    assert.ok(bugX[b] >= 0 && bugX[b] < GRID_DIM, `Bug ${b} x coordinate in bounds`);
    assert.ok(bugY[b] >= 0 && bugY[b] < GRID_DIM, `Bug ${b} y coordinate in bounds`);
    assert.ok(bugDir[b] >= 0 && bugDir[b] < 4, `Bug ${b} direction in 0..3`);
  }
});

test("2D Cellular Automata evolution rules update correctly", () => {
  gridState.fill(0);

  // 1. Conway's Life: 3 live neighbors -> birth (B3)
  gridState[0 * GRID_DIM + 1] = 1;
  gridState[1 * GRID_DIM + 0] = 1;
  gridState[1 * GRID_DIM + 1] = 1;
  // Center (0, 0) has 3 neighbors -> should become live
  stepCellularGrid("conway");
  assert.equal(gridState[0 * GRID_DIM + 0], 1, "Cell (0,0) born via B3 rule");

  // 2. Brian's Brain: 3-state firing (1) -> refractory (2) -> ready (0)
  gridState.fill(0);
  gridState[5 * GRID_DIM + 5] = 1; // Firing cell
  stepCellularGrid("brians_brain");
  assert.equal(gridState[5 * GRID_DIM + 5], 2, "Firing cell transitioned to refractory (2)");
  stepCellularGrid("brians_brain");
  assert.equal(gridState[5 * GRID_DIM + 5], 0, "Refractory cell transitioned to ready (0)");

  // 3. Seeds: all live cells die immediately
  gridState.fill(0);
  gridState[10 * GRID_DIM + 10] = 1;
  stepCellularGrid("seeds");
  assert.equal(gridState[10 * GRID_DIM + 10], 0, "Living cell dies in Seeds rule");
});

test("Bug kinematics & Langton's Ant rule updates position and flips cells", () => {
  gridState.fill(0);
  bugX[0] = 10;
  bugY[0] = 10;
  bugDir[0] = 0; // North

  // On dead cell (0): Turn Right (East = 1), invert cell to 1, step forward to (11, 10)
  const res1 = stepBug(0, "langton", 0.0);
  assert.equal(res1.turned, true);
  assert.equal(bugDir[0], 1, "Bug turned East (1)");
  assert.equal(gridState[10 * GRID_DIM + 10], 1, "Previous cell inverted to 1");
  assert.equal(bugX[0], 11, "Bug stepped forward East to x=11");
  assert.equal(bugY[0], 10, "Bug y remains 10");

  // On live cell (1): Turn Left (North = 0), invert cell to 0, step forward to (11, 9)
  gridState[10 * GRID_DIM + 11] = 1;
  const res2 = stepBug(0, "langton", 0.0);
  assert.equal(res2.turned, true);
  assert.equal(bugDir[0], 0, "Bug turned North (0) on live cell");
});

test("Toroidal wrapping across grid boundaries", () => {
  gridState.fill(0);
  bugX[0] = 0;
  bugY[0] = 0;
  bugDir[0] = 2; // South

  // Turn Right to West (3) and advance -> wraps from x=0 to x=31
  stepBug(0, "langton", 0.0);
  assert.equal(bugX[0], 31, "Wrapped horizontally across left boundary to x=31");
});

test("evaluateBugVoice derives quantized pitches and velocity accents from cluster density", () => {
  state.scale = "pentMinor";
  state.root = 60; // C4
  state.pitchSpan = 2;

  const sparseBug = { x: 5, y: 5, currentCell: 0, clusterDensity: 0, turned: true };
  const v1 = evaluateBugVoice(0, "always", sparseBug);
  assert.ok(v1.note >= 0 && v1.note <= 127);
  assert.equal(v1.vel, 45, "Sparse empty terrain produces baseline velocity 45");

  const denseBug = { x: 16, y: 16, currentCell: 1, clusterDensity: 6, turned: true };
  const v2 = evaluateBugVoice(0, "always", denseBug);
  assert.ok(v2.vel > 100, `Dense cluster produces accented velocity (got ${v2.vel})`);
  assert.ok(v2.note >= 0 && v2.note <= 127);
});

test("injectGlider creates live glider pattern on lattice", () => {
  gridState.fill(0);
  injectGlider(10, 10);

  let active = 0;
  for (let i = 0; i < TOTAL_CELLS; i++) if (gridState[i] === 1) active++;
  assert.equal(active, 5, "Glider must inject exactly 5 live cells");
});

test("Generator contract: generateCellularBugBank returns valid 64-step bank array", () => {
  initCellularBugGrid(0.15);
  state.length = 64;
  state.rate = 3; // 1/16

  const bank = generateCellularBugBank(state);
  assert.ok(Array.isArray(bank), "Must return bank array");
  assert.equal(bank.length, 1);

  const pattern = bank[0];
  assert.equal(pattern.length, 64);
  assert.ok(Array.isArray(pattern.steps));
  assert.equal(pattern.steps.length, 64);

  for (let s = 0; s < 64; s++) {
    const st = pattern.steps[s];
    assert.ok(Array.isArray(st.notes));
    assert.ok(st.notes.length <= MAX_BUGS, "Polyphony strictly <= 8");
    for (const n of st.notes) {
      assert.ok(Number.isInteger(n.note) && n.note >= 0 && n.note <= 127);
      assert.ok(Number.isInteger(n.vel) && n.vel >= 0 && n.vel <= 127);
    }
  }
});

test("Snapshot capture and restore round-trip preserves simulation state deterministically", () => {
  const def = getModelDef("cellular_bug");
  assert.ok(def, "cellular_bug must be registered in snapshot registry");

  applyCellularBugPreset("brian_acid");
  const captured = def.capture();
  assert.ok(captured);
  assert.equal(captured.gridState.length, TOTAL_CELLS);
  assert.equal(captured.caRule, "brians_brain");
  assert.equal(captured.bugMode, "predator");

  // Modify
  gridState.fill(0);
  state.cbugCaRule = "conway";

  // Restore
  def.restore(captured);
  assert.equal(state.cbugCaRule, "brians_brain");
  assert.equal(state.cbugBugMode, "predator");
  assert.deepEqual(Array.from(gridState), captured.gridState);
});

test("Transport start/stop/toggle controls", () => {
  stopCellularBug();
  assert.equal(isCellularBugRunning(), false);

  startCellularBug();
  assert.equal(isCellularBugRunning(), true);

  toggleCellularBug();
  assert.equal(isCellularBugRunning(), false);

  toggleCellularBug();
  assert.equal(isCellularBugRunning(), true);

  stopCellularBug();
  assert.equal(isCellularBugRunning(), false);
});

test("randomizeCellularBug updates parameters and registers as model randomizer", () => {
  activateCellularBugModel();
  const randFn = getCurrentModelRandomizer();
  assert.equal(typeof randFn, "function");

  randomizeCellularBug();
  assert.ok(state.cbugBugs >= 1 && state.cbugBugs <= 8);
  assert.ok(CA_RULES.some((r) => r.id === state.cbugCaRule));
  assert.ok(BUG_MODES.some((m) => m.id === state.cbugBugMode));

  deactivateCellularBugModel();
});
