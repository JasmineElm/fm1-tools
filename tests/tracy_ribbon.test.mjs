// tests/tracy_ribbon.test.mjs — Unit tests for Electroplankton Tracy Ribbon model
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
  MAX_CTRL_POINTS,
  SPLINE_SAMPLES,
  MAX_TAIL_NODES,
  ctrlX,
  ctrlY,
  numCtrlPoints,
  lutX,
  lutY,
  lutCurv,
  lutDist,
  totalArcLength,
  creatureS,
  creatureSpeed,
  creatureHeading,
  tailX,
  tailY,
  dropletVoices,
  TRACY_PRESETS,
  initTracyPreset,
  setControlPoints,
  buildSplineLut,
  sampleSplineAtS,
  getTracyNote,
  stepSimulation,
  generateTracyRibbonBank,
  startTracyRibbon,
  stopTracyRibbon,
  toggleTracyRibbonRunning,
  isTracyRibbonRunning
} from "../js/tracy_ribbon.js";
import { getModelDef } from "../js/snapshot.js";

test("TRACY_PRESETS contains required organic and geometric vector paths", () => {
  assert.equal(TRACY_PRESETS.length, 5);
  const ids = TRACY_PRESETS.map(p => p.id);
  assert.ok(ids.includes("figure_eight"));
  assert.ok(ids.includes("clover_rosette"));
  assert.ok(ids.includes("trefoil_knot"));
  assert.ok(ids.includes("elliptical_orbit"));
  assert.ok(ids.includes("meandering_river"));
});

test("Hardware polyphony ceiling: MAX_VOICES is strictly capped at 8", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(dropletVoices.length, 8);
});

test("initTracyPreset initializes control points and builds arc-length lookup table", () => {
  initTracyPreset("figure_eight");

  assert.ok(numCtrlPoints >= 4);
  assert.ok(totalArcLength > 0.5, "Total arc length must be positive");

  for (let i = 0; i < SPLINE_SAMPLES; i++) {
    assert.ok(!isNaN(lutX[i]) && !isNaN(lutY[i]));
    assert.ok(lutX[i] >= -1.0 && lutX[i] <= 1.0);
    assert.ok(lutY[i] >= -1.0 && lutY[i] <= 1.0);
    assert.ok(!isNaN(lutCurv[i]) && lutCurv[i] >= 0);
  }
});

test("sampleSplineAtS evaluates position, curvature, and tangent heading on closed loop", () => {
  initTracyPreset("clover_rosette");

  for (let s = 0; s <= 1.0; s += 0.1) {
    const pt = sampleSplineAtS(s);
    assert.ok(!isNaN(pt.x) && !isNaN(pt.y));
    assert.ok(pt.x >= -1.0 && pt.x <= 1.0);
    assert.ok(pt.y >= -1.0 && pt.y <= 1.0);
    assert.ok(typeof pt.curv === "number" && pt.curv >= 0);
    assert.ok(typeof pt.heading === "number" && isFinite(pt.heading));
  }

  // Periodic continuity: sample(0.0) should match sample(1.0)
  const pStart = sampleSplineAtS(0.0);
  const pEnd = sampleSplineAtS(1.0);
  assert.ok(Math.abs(pStart.x - pEnd.x) < 0.01);
  assert.ok(Math.abs(pStart.y - pEnd.y) < 0.01);
});

test("getTracyNote quantizes 2D coordinates to valid scale MIDI pitches within audible bounds", () => {
  for (let x = -0.9; x <= 0.9; x += 0.3) {
    for (let y = -0.9; y <= 0.9; y += 0.3) {
      const note = getTracyNote(x, y, 0);
      assert.ok(Number.isInteger(note));
      assert.ok(note >= 12 && note <= 127, `Note ${note} out of MIDI bounds`);
    }
  }
});

test("stepSimulation advances creature arc length and updates tail kinematics", () => {
  initTracyPreset("figure_eight");

  const initialS = creatureS;
  for (let i = 0; i < 50; i++) {
    const res = stepSimulation(0.016);
    assert.ok(typeof res.triggered === "boolean");
    assert.ok(!isNaN(res.s) && res.s >= 0 && res.s <= 1.0);
    assert.ok(Number.isInteger(res.noteIndex));
  }

  // S should have advanced forward
  assert.notEqual(creatureS, initialS);

  // Tail segments should have valid positions
  for (let i = 0; i < 4; i++) {
    assert.ok(!isNaN(tailX[i]) && !isNaN(tailY[i]));
    assert.ok(tailX[i] >= -1.2 && tailX[i] <= 1.2);
    assert.ok(tailY[i] >= -1.2 && tailY[i] <= 1.2);
  }
});

test("Curvature modulates locomotion velocity: creature slows through sharp bends", () => {
  initTracyPreset("clover_rosette");

  // Sample across the rosette to find a sharp bend and a straighter segment
  let maxCurv = -1;
  let minCurv = 999;
  let sAtMax = 0;
  let sAtMin = 0;

  for (let s = 0; s < 1.0; s += 0.05) {
    const pt = sampleSplineAtS(s);
    if (pt.curv > maxCurv) { maxCurv = pt.curv; sAtMax = s; }
    if (pt.curv < minCurv) { minCurv = pt.curv; sAtMin = s; }
  }

  assert.ok(maxCurv > minCurv, "Rosette must have distinct curvature variations");
});

test("Generator contract: generateTracyRibbonBank returns valid 64-step bank array", () => {
  initTracyPreset("trefoil_knot");

  const bank = generateTracyRibbonBank({
    length: 64,
    tracyDivs: 16,
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
    assert.ok(step.gate >= 0 && step.gate <= 1.0);
    assert.equal(typeof step.skip, "boolean");
  }
});

test("Snapshot capture and restore round-trip preserves ribbon path and creature state", () => {
  const def = getModelDef("tracy_ribbon");
  assert.ok(def, "tracy_ribbon model definition must be registered in snapshot.js");

  initTracyPreset("meandering_river");
  const snap = def.capture();
  assert.equal(snap.preset, "meandering_river");
  assert.ok(snap.points.length >= 4);

  initTracyPreset("elliptical_orbit");
  def.restore(snap);

  assert.equal(def.capture().preset, "meandering_river");
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
