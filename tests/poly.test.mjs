// tests/poly.test.mjs — Unit test suite for Centralized Polyphony Voice Allocation (js/poly.js)
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/state.js";
import {
  selectPolyVoices, POLY_STRATEGIES, MAX_HARDWARE_VOICES,
  recordAndCheckSafeNote, resetSafeNoteHistory,
  SAFE_WINDOW_MS, SAFE_MAX_NOTES
} from "../js/poly.js";

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

test("Safe Mode rate limiter allows all notes when safeMode is inactive", () => {
  state.safeMode = false;
  resetSafeNoteHistory();

  // Trigger 20 notes at the exact same millisecond
  for (let i = 0; i < 20; i++) {
    assert.equal(recordAndCheckSafeNote(100), true);
  }
});

test("Safe Mode rate limiter allows 8 notes per 500ms and drops subsequent notes", () => {
  state.safeMode = true;
  resetSafeNoteHistory();

  assert.equal(SAFE_WINDOW_MS, 500);
  assert.equal(SAFE_MAX_NOTES, 8);

  // Trigger 8 notes across 100ms: all 8 must be allowed
  for (let i = 0; i < 8; i++) {
    const allowed = recordAndCheckSafeNote(100 + i * 10);
    assert.equal(allowed, true, `Note ${i + 1} should be allowed`);
  }

  // 9th and 10th note within the 500ms window (e.g. at t = 200ms and t = 400ms): must be dropped!
  assert.equal(recordAndCheckSafeNote(200), false, "Note 9 in 500ms window must be dropped");
  assert.equal(recordAndCheckSafeNote(400), false, "Note 10 in 500ms window must be dropped");
  assert.equal(recordAndCheckSafeNote(599), false, "Note at t=599ms still sees 8 notes in [99, 599] so must be dropped");

  // At t = 601ms, Note 1 (fired at t=100ms) is older than 500ms (window is [101ms, 601ms])
  // So only 7 notes remain in window -> note at t=601ms must be allowed!
  assert.equal(recordAndCheckSafeNote(601), true, "Note after 500ms from 1st note must be allowed");

  // Reset state
  state.safeMode = false;
  resetSafeNoteHistory();
});

