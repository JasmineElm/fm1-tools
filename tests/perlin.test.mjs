import test from "node:test";
import assert from "node:assert/strict";
import {
  setPerlinSeed,
  getPerlinSeed,
  perlin2D,
  fbm2D,
  fillPerlin2D,
  generatePerlinGrid
} from "../js/perlin.js";

test("Perlin 2D generator: basic bounds and continuity", () => {
  setPerlinSeed(42);

  // Sample across a grid
  for (let y = 0; y < 10; y += 0.5) {
    for (let x = 0; x < 10; x += 0.5) {
      const val = perlin2D(x, y);
      assert.ok(!Number.isNaN(val), `Perlin returned NaN at (${x}, ${y})`);
      assert.ok(val >= -1.0 && val <= 1.0, `Perlin value ${val} out of bounds [-1, 1] at (${x}, ${y})`);
    }
  }

  // Continuity test: Small delta in input produces small delta in output
  const v1 = perlin2D(2.5, 3.5);
  const v2 = perlin2D(2.501, 3.5);
  assert.ok(Math.abs(v1 - v2) < 0.05, `Discontinuity detected: ${v1} vs ${v2}`);
});

test("Deterministic seeding produces identical noise fields", () => {
  setPerlinSeed(9999);
  const sampleA1 = perlin2D(3.14, 2.71);
  const sampleA2 = perlin2D(10.5, 8.2);

  setPerlinSeed(1234);
  const sampleB1 = perlin2D(3.14, 2.71);
  assert.notEqual(sampleA1, sampleB1, "Different seeds should yield different noise");

  setPerlinSeed(9999);
  const sampleC1 = perlin2D(3.14, 2.71);
  const sampleC2 = perlin2D(10.5, 8.2);
  assert.equal(sampleA1, sampleC1, "Same seed must produce identical output");
  assert.equal(sampleA2, sampleC2, "Same seed must produce identical output");
});

test("fbm2D multi-octave noise bounded and responsive to octaves", () => {
  setPerlinSeed(1337);

  for (let i = 0; i < 20; i++) {
    const x = i * 0.7;
    const y = i * 0.9;
    const val = fbm2D(x, y, { octaves: 4, persistence: 0.5, lacunarity: 2.0 });
    assert.ok(!Number.isNaN(val));
    assert.ok(val >= -1.0 && val <= 1.0, `fbm2D value ${val} out of bounds`);
  }
});

test("fillPerlin2D fills pre-allocated TypedArray in-place with zero GC churn", () => {
  const width = 16;
  const height = 12;
  const buf = new Float32Array(width * height);

  fillPerlin2D(buf, width, height, {
    scale: 0.1,
    octaves: 2,
    min: -0.5,
    max: 0.5,
    seed: 555,
    offsetX: 0,
    offsetY: 0
  });

  assert.equal(buf.length, width * height);

  let hasNonZero = false;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    assert.ok(!Number.isNaN(v));
    assert.ok(v >= -0.5001 && v <= 0.5001, `Value ${v} exceeded target bounds [-0.5, 0.5]`);
    if (Math.abs(v) > 0.001) hasNonZero = true;
  }
  assert.ok(hasNonZero, "Buffer should contain non-trivial noise values");
});

test("fillPerlin2D threshold and power shaping options", () => {
  const width = 20;
  const height = 20;
  const buf = new Float32Array(width * height);

  fillPerlin2D(buf, width, height, {
    scale: 0.15,
    min: 0.0,
    max: 1.0,
    threshold: 0.6,
    thresholdMin: 0.0,
    power: 2.0,
    seed: 777,
    offsetX: 10,
    offsetY: 20
  });

  let zeroCount = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0.0) zeroCount++;
    else nonZeroCount++;
  }

  assert.ok(zeroCount > 0, "Threshold should mask some values to 0");
  assert.ok(nonZeroCount > 0, "Threshold should retain some values above cutoff");
});

test("generatePerlinGrid creates fresh buffer with expected dimensions", () => {
  const grid = generatePerlinGrid(32, 16, { min: 10, max: 20, seed: 101, offsetX: 0, offsetY: 0 });
  assert.equal(grid.length, 32 * 16);
  assert.ok(grid instanceof Float32Array);
  for (let i = 0; i < grid.length; i++) {
    assert.ok(grid[i] >= 9.99 && grid[i] <= 20.01);
  }
});
