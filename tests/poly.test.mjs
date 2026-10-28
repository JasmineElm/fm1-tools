// tests/poly.test.mjs — Unit test suite for Centralized Polyphony Voice Allocation (js/poly.js)
import test from "node:test";
import assert from "node:assert/strict";
import { selectPolyVoices, POLY_STRATEGIES, MAX_HARDWARE_VOICES } from "../js/poly.js";

test("selectPolyVoices returns all candidates when count <= maxVoices", () => {
  const notes = [48, 55, 60];
  const res = selectPolyVoices(notes, 4, "lowest");
  assert.deepEqual(res, [48, 55, 60]);
});

test("selectPolyVoices enforces hardware max voice ceiling <= 8", () => {
  const notes = [36, 40, 43, 48, 52, 55, 60, 64, 67, 72];
  const res = selectPolyVoices(notes, 16, "lowest");
  assert.equal(res.length, MAX_HARDWARE_VOICES);
  assert.deepEqual(res, [36, 40, 43, 48, 52, 55, 60, 64]);
});

test("selectPolyVoices lowest strategy selects lowest pitches", () => {
  const notes = [72, 60, 48, 64, 36];
  const res = selectPolyVoices(notes, 3, "lowest");
  assert.deepEqual(res, [36, 48, 60]);
});

test("selectPolyVoices highest strategy selects highest pitches", () => {
  const notes = [72, 60, 48, 64, 36];
  const res = selectPolyVoices(notes, 3, "highest");
  assert.deepEqual(res, [60, 64, 72]);
});

test("selectPolyVoices extrema strategy selects lowest and highest pitches alternating", () => {
  const notes = [36, 48, 60, 67, 72, 84];
  const res = selectPolyVoices(notes, 4, "extrema");
  // Sorted notes: [36, 48, 60, 67, 72, 84]
  // Extrema picks: 36 (left 0), 84 (right 5), 48 (left 1), 72 (right 4)
  // Returned sorted: [36, 48, 72, 84]
  assert.deepEqual(res, [36, 48, 72, 84]);
});

test("selectPolyVoices cluster strategy finds the tightest pitch span", () => {
  // Pitches: 36, 60, 62, 63, 84.
  // Cluster of 3: [60, 62, 63] has span 3, much tighter than [36, 60, 62] (span 26)
  const notes = [84, 36, 62, 60, 63];
  const res = selectPolyVoices(notes, 3, "cluster");
  assert.deepEqual(res, [60, 62, 63]);
});

test("selectPolyVoices spread strategy selects evenly spaced pitches across range", () => {
  const notes = [36, 48, 60, 72, 84];
  const res = selectPolyVoices(notes, 3, "spread");
  // Indices: 0, round(1*4/2)=2, 4 -> 36, 60, 84
  assert.deepEqual(res, [36, 60, 84]);
});

test("selectPolyVoices handles candidate objects with .note property", () => {
  const candidates = [
    { note: 72, vel: 100 },
    { note: 36, vel: 90 },
    { note: 60, vel: 80 },
    { note: 48, vel: 70 }
  ];
  const res = selectPolyVoices(candidates, 2, "lowest");
  assert.equal(res.length, 2);
  assert.equal(res[0].note, 36);
  assert.equal(res[1].note, 48);
});
