// tests/flock.test.mjs — Unit test suite for Flocking Swarm Chord Engine
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {},
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {}
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
        stroke: () => {},
        fillText: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        setLineDash: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {}
      }),
      style: {},
      append: () => {},
      appendChild: () => {},
      addEventListener: () => {}
    }),
    documentElement: {
      style: {
        getPropertyValue: () => "#18191f"
      }
    }
  };
}

import {
  randomizeAttractorPositions,
  randomizeFlock,
  getAttractors,
  activateFlockModel,
  deactivateFlockModel,
  FLOCK_PRESETS
} from "../js/flock.js";
import { getCurrentModelRandomizer } from "../js/state.js";

test("randomizeAttractorPositions generates bounded non-overlapping chord nodes", () => {
  randomizeAttractorPositions(4);
  const attractors = getAttractors();

  assert.equal(attractors.length, 4);

  // Bounds verification: each node sits within canvas margins [60, 540] x [60, 360]
  for (const a of attractors) {
    assert.ok(typeof a.x === "number" && a.x >= 50 && a.x <= 550, `Node x (${a.x}) within bounds`);
    assert.ok(typeof a.y === "number" && a.y >= 50 && a.y <= 370, `Node y (${a.y}) within bounds`);
    assert.ok(a.degreeOffset >= 0 && a.degreeOffset <= 6, "Degree offset within diatonic range [0, 6]");
  }

  // Separation verification: nodes must maintain minimum distance
  for (let i = 0; i < attractors.length; i++) {
    for (let j = i + 1; j < attractors.length; j++) {
      const dist = Math.hypot(attractors[i].x - attractors[j].x, attractors[i].y - attractors[j].y);
      assert.ok(dist >= 50, `Attractors ${i} and ${j} too close: dist = ${dist}px`);
    }
  }
});

test("randomizeFlock produces varied attractor node coordinates", () => {
  randomizeFlock();
  const att1 = getAttractors().map(a => ({ x: a.x, y: a.y }));

  randomizeFlock();
  const att2 = getAttractors().map(a => ({ x: a.x, y: a.y }));

  assert.ok(att1.length >= 3 && att1.length <= 5);
  assert.ok(att2.length >= 3 && att2.length <= 5);

  // Positions must change between randomizations
  const same = (att1.length === att2.length) && att1.every((a, i) => Math.hypot(a.x - att2[i].x, a.y - att2[i].y) < 1);
  assert.ok(!same, "Consecutive randomizations must generate different chord node positions");
});

test("Global randomize button triggers randomizeFlock when flock is active", () => {
  activateFlockModel();
  const randomizer = getCurrentModelRandomizer();
  assert.equal(randomizer, randomizeFlock, "Active model randomizer must be randomizeFlock");

  // Call active model randomizer as the Global Randomize button would
  randomizer();

  const attractors = getAttractors();
  assert.ok(attractors.length >= 3 && attractors.length <= 5);

  deactivateFlockModel();
  assert.equal(getCurrentModelRandomizer(), null, "Deactivating model must unbind randomizer");
});
