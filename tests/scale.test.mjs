// tests/scale.test.mjs — Comprehensive unit tests for Scale Quantization & Note Mapping
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {};
}
if (typeof document === "undefined") {
  const allElements = [];
  function createMockElement(tag = "div") {
    const el = {
      tagName: tag.toUpperCase(),
      classList: {
        classes: new Set(),
        add(...cs) { cs.forEach(c => this.classes.add(c)); },
        remove(...cs) { cs.forEach(c => this.classes.delete(c)); },
        contains(c) { return this.classes.has(c); },
        toggle(c, f) {
          if (f === undefined) { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); }
          else if (f) this.classes.add(c); else this.classes.delete(c);
        }
      },
      style: {},
      dataset: {},
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      setAttribute: () => {},
      getAttribute: () => null,
      addEventListener: () => {},
      querySelector: () => createMockElement(),
      querySelectorAll: (sel) => {
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          return allElements.filter(e => e.classList.contains(cls));
        }
        return [];
      }
    };
    allElements.push(el);
    return el;
  }

  globalThis.document = {
    getElementById: () => null,
    createElement: (tag) => createMockElement(tag),
    createElementNS: (ns, tag) => createMockElement(tag),
    querySelectorAll: (sel) => {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return allElements.filter(e => e.classList.contains(cls));
      }
      return [];
    },
    documentElement: { style: {}, getAttribute: () => null }
  };
}

import {
  getRootMidi,
  getActiveScaleIntervals,
  computeOctaveShift,
  quantize,
  mapNormalizedToNote,
  SCALE_LABELS,
  ROOT_NOTE_OPTIONS,
  ROOT_OCTAVE_OPTIONS,
  createNotesSection,
  setPolyphonyControlsVisible,
  syncAllNotesSections
} from "../js/scale.js";
import { state } from "../js/state.js";
import { SCALES } from "../js/generator.js";

test("getRootMidi converts root note and octave into standard MIDI number", () => {
  state.root = null;
  state.rootNote = 0; // C
  state.rootOctave = 3; // Octave 3 = (3 + 1) * 12 + 0 = 48
  assert.equal(getRootMidi(), 48);

  // A3 = 48 + 9 = 57
  state.root = null;
  state.rootNote = 9; // A
  state.rootOctave = 3;
  assert.equal(getRootMidi(), 57);

  // C4 = (4 + 1) * 12 + 0 = 60
  state.root = null;
  state.rootNote = 0;
  state.rootOctave = 4;
  assert.equal(getRootMidi(), 60);

  // Direct numeric override takes precedence
  state.root = 72;
  assert.equal(getRootMidi(), 72);
  state.root = null;
});

test("getActiveScaleIntervals retrieves standard scale intervals or defaults to pentatonic minor", () => {
  state.scale = "major";
  assert.deepEqual(getActiveScaleIntervals(), SCALES.major);

  state.scale = "dorian";
  assert.deepEqual(getActiveScaleIntervals(), SCALES.dorian);

  // Custom scale
  state.scale = "custom";
  state.customScale = [0, 2, 4, 7, 9];
  assert.deepEqual(getActiveScaleIntervals(), [0, 2, 4, 7, 9]);

  // Non-existent scale falls back to pentMinor
  state.scale = "unknown_scale";
  assert.deepEqual(getActiveScaleIntervals(), SCALES.pentMinor);
});

test("computeOctaveShift respects octave probability and directional modes", () => {
  // 0 chance always yields 0 semitones
  assert.equal(computeOctaveShift(0, "up"), 0);

  // 1.0 chance
  assert.equal(computeOctaveShift(1.0, "up", () => 0), 12);
  assert.equal(computeOctaveShift(1.0, "down", () => 0), -12);

  // "both" direction flips between +12 and -12 based on RNG
  assert.equal(computeOctaveShift(1.0, "both", () => 0.2), 12);
  assert.equal(computeOctaveShift(1.0, "both", () => 0.8), -12);
});

test("quantize maps continuous pitch values to nearest scale interval", () => {
  const root = 60; // C4
  const intervals = [0, 2, 4, 5, 7, 9, 11]; // Major scale

  // Exact degree hits
  assert.equal(quantize(60, intervals, root), 60); // C
  assert.equal(quantize(62, intervals, root), 62); // D
  assert.equal(quantize(64, intervals, root), 64); // E

  // In-between microtonal / chromatic values snap to nearest degree
  assert.equal(quantize(61.1, intervals, root), 62); // C# snaps to D
  assert.equal(quantize(60.4, intervals, root), 60); // Low C# snaps to C
  assert.equal(quantize(63.2, intervals, root), 64); // D# snaps to E
});

test("mapNormalizedToNote maps continuous normalized [0..1] range across pitch span", () => {
  state.root = 60;
  state.scale = "pentMinor";
  state.pitchSpan = 2; // 2 octaves = 24 semitones
  state.octaveMode = "up";
  state.octave = 0; // 0% octave shift chance
  state.quantSteps = 100;

  // Normalized 0 should map to root note (60)
  const lowNote = mapNormalizedToNote({ norm: 0, root: 60, scale: [0, 3, 5, 7, 10], octaveSpread: 2 });
  assert.equal(lowNote, 60);

  // Normalized 1 should map near root + 24 semitones (84)
  const highNote = mapNormalizedToNote({ norm: 1, root: 60, scale: [0, 3, 5, 7, 10], octaveSpread: 2 });
  assert.ok(highNote >= 80 && highNote <= 84);

  // Clamps out-of-range inputs [0..127]
  const clampedLow = mapNormalizedToNote({ norm: -10, root: 0, scale: [0, 2, 4] });
  assert.ok(clampedLow >= 0);

  const clampedHigh = mapNormalizedToNote({ norm: 100, root: 120, scale: [0, 2, 4] });
  assert.ok(clampedHigh <= 127);
});

test("Metadata tables are properly populated", () => {
  assert.ok(Array.isArray(ROOT_NOTE_OPTIONS) && ROOT_NOTE_OPTIONS.length === 12);
  assert.ok(Array.isArray(ROOT_OCTAVE_OPTIONS) && ROOT_OCTAVE_OPTIONS.length >= 4);
  assert.ok(SCALE_LABELS && typeof SCALE_LABELS === "object");
  assert.ok(SCALE_LABELS.major && SCALE_LABELS.pentMinor);
});

test("createNotesSection groups Strategy, Polyphony, and Safe controls in a unified 6-column polyphony row", () => {
  const notes = createNotesSection({ isFullWidth: false });
  assert.ok(notes.sectEl);
  assert.ok(notes.polyStratCtrl, "polyStratCtrl must exist");
  assert.ok(notes.polyCtrl, "polyCtrl must exist");
  assert.ok(notes.safeCtrl, "safeCtrl must exist");

  // Verify 2-col span for each of the 3 controls in the 6-col grid row (2 + 2 + 2 = 6)
  assert.equal(notes.polyStratCtrl.style.gridColumn, "span 2");
  assert.equal(notes.polyCtrl.style.gridColumn, "span 2");
  assert.equal(notes.safeCtrl.style.gridColumn, "span 2");

  // Verify all 3 are classified under .ctrl-poly-group for unified visibility toggling
  assert.ok(notes.polyStratCtrl.classList.contains("ctrl-poly-group"));
  assert.ok(notes.polyCtrl.classList.contains("ctrl-poly-group"));
  assert.ok(notes.safeCtrl.classList.contains("ctrl-poly-group"));

  // Verify setPolyphonyControlsVisible toggles display on all 3 controls
  setPolyphonyControlsVisible(false);
  assert.equal(notes.polyStratCtrl.style.display, "none");
  assert.equal(notes.polyCtrl.style.display, "none");
  assert.equal(notes.safeCtrl.style.display, "none");

  setPolyphonyControlsVisible(true);
  assert.equal(notes.polyStratCtrl.style.display, "");
  assert.equal(notes.polyCtrl.style.display, "");
  assert.equal(notes.safeCtrl.style.display, "");

  // Verify sync updates safeCtrl
  state.safeMode = true;
  notes.sync();
  assert.equal(state.safeMode, true);

  state.safeMode = false;
  notes.sync();
  assert.equal(state.safeMode, false);
});
