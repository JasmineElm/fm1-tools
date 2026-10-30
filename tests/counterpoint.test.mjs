// tests/counterpoint.test.mjs — Unit tests for Follower & Counterpoint Generators (Within One Stream)
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal DOM for headless Node test execution
function makeMockElement(tag = "div") {
  const children = [];
  const classListSet = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    title: "",
    value: "",
    type: "",
    style: {},
    dataset: {},
    children,
    classList: {
      add: (...c) => c.forEach((x) => classListSet.add(x)),
      remove: (...c) => c.forEach((x) => classListSet.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classListSet.has(c)) { classListSet.delete(c); return false; }
          classListSet.add(c); return true;
        }
        if (force) classListSet.add(c); else classListSet.delete(c);
        return !!force;
      },
      contains: (c) => classListSet.has(c)
    },
    appendChild(child) {
      if (child) children.push(child);
      return child;
    },
    append(...nodes) {
      for (const n of nodes) if (n) children.push(n);
    },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeMockElement(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 250 }; },
    getContext() {
      return {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textAlign: "",
        textBaseline: "",
        fillRect() {},
        strokeRect() {},
        clearRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        fill() {},
        stroke() {},
        fillText() {},
        save() {},
        restore() {}
      };
    }
  };
  return el;
}

const mockContainer = makeMockElement("div");
const mockSequenceDiv = makeMockElement("div");
globalThis.document = {
  documentElement: makeMockElement("html"),
  getElementById(id) {
    if (id === "model-counterpoint") return mockContainer;
    if (id === "sequence") return mockSequenceDiv;
    return null;
  },
  createElement(tag) {
    return makeMockElement(tag);
  },
  createElementNS(_ns, tag) {
    return makeMockElement(tag);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};

globalThis.window = {
  addEventListener() {},
  location: { hash: "" },
  history: { pushState() {}, replaceState() {} }
};

import {
  MAX_VOICES,
  MAX_STEPS,
  MIN_CHORD_STEPS,
  MAX_CHORD_STEPS,
  CANDIDATE_INTERVALS,
  COUNTERPOINT_PRESETS,
  intervalMask,
  melodyOffsets,
  melodyGates,
  stepAnchorTriggered,
  stepChordDuration,
  setIntervalMaskFromArray,
  getActiveIntervalOffsets,
  getClampedChordInterval,
  getClampedMelodyLength,
  computeChordDurationSteps,
  initMelodyLine,
  evolveMelodyLine,
  getMelodyEvolutionCount,
  getAnchorNote,
  computeFollowerNotesForStep,
  generateCounterpointBank,
  applyCounterpointPreset,
  randomizeCounterpoint,
  initCounterpoint,
  activateCounterpointModel,
  deactivateCounterpointModel
} from "../js/counterpoint.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";
import { getModelDef, ownsKey } from "../js/snapshot.js";
import { MODELS, POLYPHONIC_MODELS, STEP_MODELS, showModel } from "../js/modes.js";

test("COUNTERPOINT_PRESETS and generative mode registrations hide the sequence div", () => {
  assert.equal(COUNTERPOINT_PRESETS.length, 5);
  assert.ok(MODELS.some((m) => m.id === "counterpoint"));
  assert.ok(POLYPHONIC_MODELS.has("counterpoint"));
  assert.ok(!STEP_MODELS.has("counterpoint"), "counterpoint is a generative model and must not be in STEP_MODELS");

  showModel("counterpoint", false);
  assert.equal(mockSequenceDiv.style.display, "none", "sequence div must be hidden when counterpoint is active");
});

test("Hardware polyphony ceiling: MAX_VOICES capped strictly at 8", () => {
  assert.equal(MAX_VOICES, 8);
  assert.equal(MAX_STEPS, 64);
});

test("Melody line length is a controllable parameter bounded to [4, 32] steps", () => {
  assert.equal(getClampedMelodyLength({ cpMelodyLength: 2 }), 4);
  assert.equal(getClampedMelodyLength({ cpMelodyLength: 12 }), 12);
  assert.equal(getClampedMelodyLength({ cpMelodyLength: 64 }), 32);

  state.cpMelodyLength = 10;
  initMelodyLine(state);
  // Pattern repeats across the controllable melody length
  for (let i = 0; i < 10; i++) {
    assert.equal(melodyOffsets[i], melodyOffsets[i + 10]);
  }
});

test("Chords trigger no more frequently than every quarter note (4 steps) and no less frequently than once per two bars (32 steps)", () => {
  assert.equal(MIN_CHORD_STEPS, 4);
  assert.equal(MAX_CHORD_STEPS, 32);
  assert.equal(getClampedChordInterval({ cpAnchorDiv: 1 }), 4);
  assert.equal(getClampedChordInterval({ cpAnchorDiv: 2 }), 4);
  assert.equal(getClampedChordInterval({ cpAnchorDiv: 16 }), 16);
  assert.equal(getClampedChordInterval({ cpAnchorDiv: 48 }), 32);

  for (const preset of COUNTERPOINT_PRESETS) {
    assert.ok(
      preset.anchorDiv >= 4 && preset.anchorDiv <= 32,
      `Preset ${preset.id} anchorDiv (${preset.anchorDiv}) must be in [4, 32]`
    );
  }

  for (const requestedDiv of [2, 4, 8, 16, 32, 64]) {
    generateCounterpointBank({ ...state, cpAnchorDiv: requestedDiv, cpEvolution: 0 });
    const triggerSteps = [];
    for (let i = 0; i < MAX_STEPS; i++) {
      if (stepAnchorTriggered[i] === 1) triggerSteps.push(i);
    }
    assert.ok(triggerSteps.length >= 2, "At least 2 chord triggers across 64 steps (2 bars = 32 steps)");
    for (let t = 1; t < triggerSteps.length; t++) {
      const gap = triggerSteps[t] - triggerSteps[t - 1];
      assert.ok(gap >= 4 && gap <= 32, `Chord trigger interval ${gap} must be between 4 (quarter note) and 32 (two bars)`);
    }
  }
});

test("Chords have a length strictly between quarter note (4 steps) and the next chord trigger", () => {
  for (const interval of [4, 8, 12, 16, 24, 32]) {
    for (const hold of [25, 50, 75, 100]) {
      for (let phrase = 0; phrase < 8; phrase++) {
        const dur = computeChordDurationSteps(interval, phrase, { ...state, cpChordHold: hold, seed: 99 });
        assert.ok(
          dur >= 4 && dur <= interval,
          `Chord duration ${dur} must be between 4 steps (quarter note) and ${interval} steps (next chord trigger)`
        );
      }
    }

    generateCounterpointBank({ ...state, cpAnchorDiv: interval, cpChordHold: 75 });
    for (let i = 0; i < MAX_STEPS; i++) {
      if (stepAnchorTriggered[i] === 1) {
        const dur = stepChordDuration[i];
        assert.ok(dur >= 4 && dur <= interval, `Step ${i} chord duration ${dur} out of [4, ${interval}]`);
      }
    }
  }
});

test("Melody line evolves over time by replacing notes and adding delays", () => {
  setIntervalMaskFromArray([7, 12, 16, 19]);
  state.cpMelodyLength = 16;
  state.cpEvolution = 50;
  initMelodyLine(state);

  const initialOffsets = Array.from(melodyOffsets.slice(0, 16));
  for (let pass = 0; pass < 6; pass++) {
    evolveMelodyLine(state, true);
  }

  assert.equal(getMelodyEvolutionCount(), 6);
  const evolvedOffsets = Array.from(melodyOffsets.slice(0, 16));
  const evolvedGates = Array.from(melodyGates.slice(0, 16));

  const notesChanged = evolvedOffsets.some((v, idx) => v !== initialOffsets[idx]);
  const hasDelayTaps = evolvedGates.some((g) => g === 2);
  assert.ok(notesChanged, "evolveMelodyLine should replace notes in the melody line over time");
  assert.ok(hasDelayTaps, "evolveMelodyLine should add delayed echo notes (melodyGates === 2)");
});

test("Thread A (getAnchorNote) constrains pitch to low foundation register (octaves 1–3, MIDI 24..59)", () => {
  for (const mode of ["root_fifth", "plagal_fifth", "pedal_oct", "bass_walk"]) {
    for (let phrase = 0; phrase < 16; phrase++) {
      const note = getAnchorNote(phrase, { ...state, cpAnchorMode: mode, rootOctave: 2, seed: 42 });
      assert.ok(Number.isInteger(note));
      assert.ok(note >= 24 && note <= 59, `Anchor note ${note} outside octaves 1–3 (24..59)`);
    }
  }
});

test("Thread B (computeFollowerNotesForStep) derives notes relative to Thread A via interval offsets {N_A + 7, 12, 16, 19}", () => {
  setIntervalMaskFromArray([7, 12, 16, 19]);
  const offsets = getActiveIntervalOffsets();
  assert.deepEqual(offsets, [7, 12, 16, 19]);

  const anchorNote = 36; // C2
  initMelodyLine({ ...state, cpMelodyLength: 16, cpFollowMode: "up_arp" });
  for (let step = 0; step < 16; step++) {
    const followers = computeFollowerNotesForStep(step, anchorNote, 1, offsets, {
      ...state,
      scale: "chromatic",
      cpFollowMode: "up_arp",
      polyphony: 4,
      pitchSpan: 3
    });
    assert.ok(followers.length >= 1 && followers.length <= 3);
    for (const f of followers) {
      assert.ok(offsets.includes(f.offset), `Follower offset ${f.offset} must be in {7, 12, 16, 19}`);
      assert.equal(f.note, anchorNote + f.offset);
    }
  }
});

test("Snapshot capture and restore round-trip preserves counterpoint state, melody length, and interval mask", () => {
  const def = getModelDef("counterpoint");
  assert.ok(def, "counterpoint model must be registered in snapshot.js");
  assert.ok(ownsKey("counterpoint", "cpPreset"));
  assert.ok(ownsKey("counterpoint", "cpMelodyLength"));
  assert.ok(ownsKey("counterpoint", "cpAnchorDiv"));

  applyCounterpointPreset("quartal_weave");
  const snap = def.capture();
  assert.equal(snap.preset, "quartal_weave");
  assert.equal(snap.melodyLength, 8);
  assert.equal(snap.anchorDiv, 4);
  assert.deepEqual(snap.intervals, [5, 7, 12, 17, 19]);

  applyCounterpointPreset("koan_fifth_tenth");
  def.restore(snap);

  assert.equal(state.cpPreset, "quartal_weave");
  assert.equal(state.cpMelodyLength, 8);
  assert.deepEqual(getActiveIntervalOffsets(), [5, 7, 12, 17, 19]);
});

test("initCounterpoint, activateCounterpointModel, and randomizeCounterpoint mount and execute without error", () => {
  initCounterpoint();
  assert.ok(mockContainer.children.length > 0, "initCounterpoint should mount workbench into #model-counterpoint");

  activateCounterpointModel();
  assert.equal(typeof getCurrentModelRandomizer(), "function");

  randomizeCounterpoint();
  assert.ok(getActiveIntervalOffsets().length >= 2);
  assert.ok(state.cpAnchorDiv >= 4 && state.cpAnchorDiv <= 32);
  assert.ok(state.cpMelodyLength >= 4 && state.cpMelodyLength <= 32);

  deactivateCounterpointModel();
  assert.equal(getCurrentModelRandomizer(), null);
});
