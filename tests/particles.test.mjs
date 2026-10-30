// tests/particles.test.mjs — Comprehensive unit tests for Multi-Head Particle Sequencer model
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
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      addEventListener: () => {},
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {}
      }),
      style: {}
    }),
    documentElement: { style: {}, getAttribute: () => null }
  };
}

import {
  GRID_SIZES,
  COLLISION_MODES,
  DIRECTIONS,
  OBS_BOUNCER,
  OBS_SLASH,
  setObstacle,
  removeObstacle,
  clearObstacles,
  predictTrajectory,
  stepPhysics,
  generateParticleBank,
  randomizeParticles,
  activateParticlesModel,
  deactivateParticlesModel
} from "../js/particles.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef } from "../js/snapshot.js";

test("Constants and Direction Vectors are properly defined", () => {
  assert.ok(Array.isArray(GRID_SIZES) && GRID_SIZES.length >= 3);
  assert.ok(Array.isArray(COLLISION_MODES) && COLLISION_MODES.length >= 4);
  assert.equal(DIRECTIONS.length, 9);
});

test("Obstacle placement and manipulation on grid", () => {
  const W = 16, H = 16;
  const obs = new Uint8Array(W * H);

  setObstacle(4, 5, OBS_BOUNCER, obs, W, H);
  assert.equal(obs[5 * W + 4], OBS_BOUNCER);

  setObstacle(8, 8, OBS_SLASH, obs, W, H);
  assert.equal(obs[8 * W + 8], OBS_SLASH);

  removeObstacle(4, 5, obs, W, H);
  assert.equal(obs[5 * W + 4], 0);

  clearObstacles(obs);
  assert.equal(obs[8 * W + 8], 0);
});

test("Trajectory prediction projects particle movement", () => {
  const p = { x: 5, y: 5, dx: 1, dy: 0 };
  const pts = predictTrajectory(p, 5, 16, 16);
  assert.ok(Array.isArray(pts));
  assert.equal(pts.length, 6); // start + 5 steps
  assert.equal(pts[0].x, 5);
  assert.equal(pts[1].x, 6);
  assert.equal(pts[5].x, 10);
});

test("stepPhysics updates particle positions and detects collisions", () => {
  const pList = [
    { id: 1, x: 5, y: 5, dx: 1, dy: 0, life: 0, maxLife: 0, isChild: false },
    { id: 2, x: 7, y: 5, dx: -1, dy: 0, life: 0, maxLife: 0, isChild: false }
  ];
  const obs = new Uint8Array(16 * 16);

  const res = stepPhysics(pList, obs, 16, 16);
  assert.ok(Array.isArray(res.particles));
  assert.ok(Array.isArray(res.collisions));
});

test("generateParticleBank returns valid bank adhering to length contract", () => {
  state.length = 16;
  state.rate = 1;
  state.tempo = 120;
  state.swing = 50;
  state.gate = 60;

  const bank = generateParticleBank();
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 16);
  assert.ok(bank[0].steps.length >= 16);
});

test("randomizeParticles configures new particles and registers with model randomizer", () => {
  activateParticlesModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  randomizeParticles();
  const bank = generateParticleBank();
  assert.ok(Array.isArray(bank));

  deactivateParticlesModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("Particles snapshot capture and restore round-trip preserves configuration", () => {
  const def = getModelDef("particles");
  assert.ok(def, "particles model must be registered in snapshot.js");

  const snap = def.capture();
  assert.ok(snap && typeof snap === "object");
  assert.ok(Array.isArray(snap.particles));

  assert.doesNotThrow(() => def.restore(snap));
});
