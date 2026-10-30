// js/counterpoint.js — Follower & Counterpoint Generators (Within One Stream)
// Generative dual-thread counterpoint engine inspired by SSEYO Koan "Follow" voices:
// - Thread A (Anchor Chords): Triggers no more frequently than every quarter note (4 steps) and no less
//   frequently than once per two bars (32 steps), with chord length between 1 quarter note (4 steps) and
//   the next chord trigger, constrained to foundation degrees in octaves 1–3.
// - Thread B (Evolving Follower Melody): Controllable melody line length (4–32 steps) bounded by interval
//   offsets relative to Thread A's held root (e.g. N_B in {N_A + 7, N_A + 12, N_A + 16, N_A + 19}),
//   continuously evolving over time by replacing notes and adding rhythmic delays.

import {
  state, refs, R, status, doGenerate, scheduleRegen, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { panicPreview, setModelStepHandler, setModelTransportHandler } from "./player.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { getRootMidi, getActiveScaleIntervals, quantize, midiName, SCALES } from "./scale.js";
import { selectPolyVoices, playVoice, releasePolyVoices } from "./poly.js";
import { getActiveModel } from "./modes.js";
import { registerModel } from "./snapshot.js";
import { getThemePalette } from "./themes.js";
import * as audio from "./audio.js";

export const MAX_VOICES = 8;
export const MAX_STEPS = 64;
export const MIN_CHORD_STEPS = 4;  // Quarter note (4 x 1/16 steps)
export const MAX_CHORD_STEPS = 32; // Two bars (32 x 1/16 steps)
export const NUM_INTERVAL_SLOTS = 13;

// Candidate interval offsets (in semitones above Thread A anchor note N_A)
export const CANDIDATE_INTERVALS = new Int8Array([
  0, 3, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 24
]);

export const INTERVAL_LABELS = [
  "+0", "+3", "+4", "+5", "+7", "+9", "+11", "+12", "+14", "+16", "+17", "+19", "+24"
];

export const INTERVAL_NAMES = [
  "Unison (+0)", "Min 3rd (+3)", "Maj 3rd (+4)", "Fourth (+5)",
  "Fifth (+7)", "Maj 6th (+9)", "Maj 7th (+11)", "Octave (+12)",
  "Ninth (+14)", "Tenth (+16)", "Eleventh (+17)", "Twelfth (+19)", "2 Oct (+24)"
];

// Active interval mask (1 = enabled, 0 = disabled). Default: {+7, +12, +16, +19}
export const intervalMask = new Uint8Array(NUM_INTERVAL_SLOTS);

export const THREAD_COLORS = [
  "#00f0ff", // Thread A (Anchor Chord): Cyan
  "#ff007f", // Thread B Primary Melody: Pink
  "#ffb700", // Thread B Delayed Echo: Amber
  "#39ff14", // Thread B Harmony 1: Lime
  "#a855f7", // Thread B Harmony 2: Violet
  "#38bdf8", // Thread B Harmony 3: Sky
  "#f43f5e", // Thread B Harmony 4: Rose
  "#eab308"  // Thread B Harmony 5: Gold
];

export const ANCHOR_MODES = [
  { id: "root_fifth", name: "Root & Fifth (I–V)" },
  { id: "plagal_fifth", name: "Plagal & Fifth (I–IV–V)" },
  { id: "pedal_oct", name: "Pedal Root & Octave" },
  { id: "bass_walk", name: "Diatonic Bass Walk" }
];

export const FOLLOW_MODES = [
  { id: "contrary", name: "Contrary Counterpoint" },
  { id: "up_arp", name: "Ascending Follower" },
  { id: "pendulum", name: "Pendulum Wave" },
  { id: "obligato", name: "Koan Stochastic Follow" }
];

export const COUNTERPOINT_PRESETS = [
  {
    id: "koan_fifth_tenth",
    name: "Koan Anchor & 10th Follow",
    desc: "Half-note chords (8 steps) in octaves 1–3; 16-step evolving melody in {+7, +12, +16, +19}",
    melodyLength: 16,
    anchorDiv: 8,
    chordHold: 85,
    evolution: 35,
    anchorMode: "root_fifth",
    followMode: "contrary",
    intervals: [7, 12, 16, 19]
  },
  {
    id: "baroque_species",
    name: "Fourth-Species Syncopation",
    desc: "Quarter-note to bar cantus firmus chords with evolving pendulum suspensions and delays",
    melodyLength: 12,
    anchorDiv: 8,
    chordHold: 90,
    evolution: 40,
    anchorMode: "plagal_fifth",
    followMode: "pendulum",
    intervals: [4, 7, 9, 12, 16]
  },
  {
    id: "ambient_bloom",
    name: "Eno Generative Obligato",
    desc: "Slow two-bar (32-step) pedal chords with spacious 24-step evolving delay melody",
    melodyLength: 24,
    anchorDiv: 24,
    chordHold: 80,
    evolution: 50,
    anchorMode: "pedal_oct",
    followMode: "obligato",
    intervals: [7, 12, 14, 16, 19, 24]
  },
  {
    id: "quartal_weave",
    name: "Quartal / Quintal Interlock",
    desc: "Quarter-note (4-step) quartal chords coupled with an 8-step evolving motif",
    melodyLength: 8,
    anchorDiv: 4,
    chordHold: 100,
    evolution: 30,
    anchorMode: "plagal_fifth",
    followMode: "up_arp",
    intervals: [5, 7, 12, 17, 19]
  },
  {
    id: "polyrhythmic_hocket",
    name: "Multi-Follower Hocket",
    desc: "One-bar (16-step) walking chords with a 14-step polymetric evolving delay line",
    melodyLength: 14,
    anchorDiv: 16,
    chordHold: 75,
    evolution: 55,
    anchorMode: "bass_walk",
    followMode: "contrary",
    intervals: [3, 7, 12, 16, 19]
  }
];

// Pre-allocated buffers for zero-GC simulation and canvas rendering
export const stepAnchorNotes = new Int16Array(MAX_STEPS);
export const stepAnchorTriggered = new Uint8Array(MAX_STEPS);
export const stepChordDuration = new Uint8Array(MAX_STEPS);
export const stepAnchorActive = new Uint8Array(MAX_STEPS);
export const stepFollowerNotes = new Int16Array(MAX_STEPS * MAX_VOICES);
export const stepFollowerOffsets = new Int8Array(MAX_STEPS * MAX_VOICES);
export const stepFollowerCounts = new Uint8Array(MAX_STEPS);

// Evolving Melody Line Buffers (up to 32 steps)
export const melodyOffsets = new Int8Array(MAX_STEPS);
export const melodyGates = new Uint8Array(MAX_STEPS);      // 0 = rest, 1 = primary note, 2 = delayed echo
export const melodyVelScale = new Float32Array(MAX_STEPS); // velocity scaling (e.g. 1.0 primary, 0.65 delay)
export const melodyDelaySource = new Int8Array(MAX_STEPS); // index of source step when melodyGates[i] === 2

let melodyInitialized = false;
let melodyEvolutionCount = 0;
let isCounterpointPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepAccumMs = 0;
let currentPlayStep = 0;
let heldAnchorNote = 36;
let heldAnchorMotionDir = 1;
let stepsSinceChordTrigger = 0;
let currentChordInterval = 8;
let currentChordDurSteps = 8;

let containerEl = null;
let canvasEl = null;
let ctx = null;
let hudEl = null;

// UI Control References
let ctrlPreset = null;
let ctrlMelodyLen = null;
let ctrlAnchorDiv = null;
let ctrlChordHold = null;
let ctrlEvolution = null;
let ctrlAnchorMode = null;
let ctrlFollowMode = null;

/**
 * Sets the active interval mask from an array of semitone offsets (e.g. [7, 12, 16, 19]).
 */
export function setIntervalMaskFromArray(arr) {
  intervalMask.fill(0);
  if (Array.isArray(arr)) {
    for (const val of arr) {
      const idx = CANDIDATE_INTERVALS.indexOf(Number(val));
      if (idx !== -1) intervalMask[idx] = 1;
    }
  }
  let anyActive = false;
  for (let i = 0; i < NUM_INTERVAL_SLOTS; i++) {
    if (intervalMask[i]) { anyActive = true; break; }
  }
  if (!anyActive) {
    for (const d of [7, 12, 16, 19]) {
      const idx = CANDIDATE_INTERVALS.indexOf(d);
      if (idx !== -1) intervalMask[idx] = 1;
    }
  }
}

/**
 * Returns the currently enabled semitone interval offsets for Thread B relative to Thread A.
 */
export function getActiveIntervalOffsets() {
  const out = [];
  for (let i = 0; i < NUM_INTERVAL_SLOTS; i++) {
    if (intervalMask[i]) out.push(CANDIDATE_INTERVALS[i]);
  }
  return out.length > 0 ? out : [7, 12, 16, 19];
}

// Initialize default mask: {+7, +12, +16, +19}
setIntervalMaskFromArray([7, 12, 16, 19]);

/**
 * Deterministic hash helper for repeatable seeded counterpoint choices.
 */
function seededHash(seed, a, b = 0) {
  let h = (seed ^ (a * 374761393) ^ (b * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Clamps the chord trigger interval (in 16th-note steps) strictly to:
 * - No more frequently than every quarter note (>= 4 steps)
 * - No less frequently than once per two bars (<= 32 steps)
 */
export function getClampedChordInterval(s = state) {
  const raw = Math.round(Number(s?.cpAnchorDiv) || 8);
  return Math.max(MIN_CHORD_STEPS, Math.min(MAX_CHORD_STEPS, raw));
}

/**
 * Clamps the controllable melody line length (in steps) to [4, 32].
 */
export function getClampedMelodyLength(s = state) {
  const raw = Math.round(Number(s?.cpMelodyLength) || 16);
  return Math.max(4, Math.min(32, raw));
}

/**
 * Computes the chord duration (in steps) for a chord triggered with `stepsUntilNextChord` steps
 * before the next chord trigger.
 * Strictly bounded between 1 quarter note (4 steps) and `stepsUntilNextChord`.
 */
export function computeChordDurationSteps(stepsUntilNextChord, phraseIdx = 0, s = state) {
  const maxSteps = Math.max(MIN_CHORD_STEPS, Math.min(MAX_CHORD_STEPS, Math.round(stepsUntilNextChord)));
  const holdPct = Math.max(25, Math.min(100, Number(s?.cpChordHold ?? 85))) / 100;
  const seed = Number(s?.seed) || 1;
  // Subtle musical breathing around holdPct while strictly respecting [4, maxSteps]
  const jitter = (seededHash(seed, phraseIdx, 41) - 0.5) * 0.16;
  const ratio = Math.max(0, Math.min(1, holdPct + jitter));
  const dur = Math.round(MIN_CHORD_STEPS + (maxSteps - MIN_CHORD_STEPS) * ratio);
  return Math.max(MIN_CHORD_STEPS, Math.min(maxSteps, dur));
}

/**
 * Initializes the Thread B evolving melody line buffer across `cpMelodyLength` steps.
 */
export function initMelodyLine(s = state) {
  const melodyLen = getClampedMelodyLength(s);
  const offsets = getActiveIntervalOffsets();
  const numOffsets = offsets.length;
  const followMode = s?.cpFollowMode || "contrary";
  const seed = Number(s?.seed) || 1;

  melodyOffsets.fill(offsets[0] ?? 7);
  melodyGates.fill(0);
  melodyVelScale.fill(1.0);
  melodyDelaySource.fill(-1);

  for (let i = 0; i < MAX_STEPS; i++) {
    const mIdx = i % melodyLen;
    let pickIdx = 0;
    if (followMode === "contrary") {
      pickIdx = (numOffsets - 1) - (mIdx % numOffsets);
    } else if (followMode === "up_arp") {
      pickIdx = mIdx % numOffsets;
    } else if (followMode === "pendulum") {
      const cycle = Math.max(1, numOffsets * 2 - 2);
      const pos = mIdx % cycle;
      pickIdx = pos < numOffsets ? pos : cycle - pos;
    } else {
      pickIdx = Math.floor(seededHash(seed, mIdx, 97) * numOffsets);
    }

    melodyOffsets[i] = offsets[pickIdx % numOffsets];
    // Leave occasional space so delays have room to weave in
    const isActive = (mIdx % 4 !== 3) || (seededHash(seed, mIdx, 53) < 0.5);
    melodyGates[i] = isActive ? 1 : 0;
    melodyVelScale[i] = (mIdx % 2 === 0) ? 1.0 : 0.85;
  }

  melodyInitialized = true;
  melodyEvolutionCount = 0;
}

/**
 * Evolves the Thread B melody line over time:
 * 1. Replaces notes with new consonant interval offsets from the active mask.
 * 2. Adds rhythmic delays (echoing an active note 2 or 3 steps later at attenuated velocity).
 */
export function evolveMelodyLine(s = state, forceMutation = false) {
  if (!melodyInitialized) initMelodyLine(s);

  const melodyLen = getClampedMelodyLength(s);
  const offsets = getActiveIntervalOffsets();
  const evoRate = Math.max(0, Math.min(100, Number(s?.cpEvolution ?? 35))) / 100;
  if (!forceMutation && evoRate <= 0) return false;

  melodyEvolutionCount++;
  const seed = (Number(s?.seed) || 1) + melodyEvolutionCount * 7919;

  // 1. Replace a note in the melody line with a fresh interval offset
  const replaceIdx = Math.floor(seededHash(seed, melodyEvolutionCount, 13) * melodyLen);
  const currentOffset = melodyOffsets[replaceIdx];
  let nextOffset = offsets[Math.floor(seededHash(seed, melodyEvolutionCount, 29) * offsets.length)];
  if (offsets.length > 1 && nextOffset === currentOffset) {
    const altIdx = (offsets.indexOf(currentOffset) + 1) % offsets.length;
    nextOffset = offsets[altIdx];
  }
  melodyOffsets[replaceIdx] = nextOffset;
  melodyGates[replaceIdx] = 1;
  melodyVelScale[replaceIdx] = 0.95;
  melodyDelaySource[replaceIdx] = -1;

  // 2. Add a rhythmic delay tap (2 or 3 steps after an active primary note)
  const delayStep = seededHash(seed, melodyEvolutionCount, 61) < 0.5 ? 2 : 3;
  const srcIdx = replaceIdx;
  const targetIdx = (srcIdx + delayStep) % melodyLen;
  if (targetIdx !== srcIdx) {
    melodyOffsets[targetIdx] = melodyOffsets[srcIdx];
    melodyGates[targetIdx] = 2; // 2 = delayed echo note
    melodyVelScale[targetIdx] = 0.65;
    melodyDelaySource[targetIdx] = srcIdx;
  }

  // Mirror across MAX_STEPS for bank rendering
  for (let i = melodyLen; i < MAX_STEPS; i++) {
    const m = i % melodyLen;
    melodyOffsets[i] = melodyOffsets[m];
    melodyGates[i] = melodyGates[m];
    melodyVelScale[i] = melodyVelScale[m];
    melodyDelaySource[i] = melodyDelaySource[m];
  }

  return true;
}

/**
 * Returns the number of melody evolution passes executed since initialization.
 */
export function getMelodyEvolutionCount() {
  return melodyEvolutionCount;
}

/**
 * Computes Thread A (Anchor/Root) MIDI note for a given anchor phrase index.
 * Constrained to root/fifth (or foundation degrees) in octaves 1–3 (MIDI 24..59).
 */
export function getAnchorNote(anchorPhraseIdx, s = state) {
  const root = getRootMidi();
  const intervals = (s?.scale && SCALES[s.scale]) ? SCALES[s.scale] : getActiveScaleIntervals();
  const mode = s?.cpAnchorMode || "root_fifth";
  const seed = Number(s?.seed) || 1;

  const pitchClass = ((root % 12) + 12) % 12;
  const userOct = Math.max(1, Math.min(3, Number(s?.rootOctave ?? 2)));
  const baseRoot = 12 * (userOct + 1) + pitchClass; // Octave 1 -> 24..35, Octave 2 -> 36..47, Octave 3 -> 48..59

  let semitoneOffset = 0;
  if (mode === "root_fifth") {
    const choices = [0, 0, 7, 0, 7, 12];
    const pick = Math.floor(seededHash(seed, anchorPhraseIdx, 11) * choices.length);
    semitoneOffset = choices[(anchorPhraseIdx + pick) % choices.length];
  } else if (mode === "plagal_fifth") {
    const choices = [0, 5, 7, 0, 7, 5, 12, 7];
    semitoneOffset = choices[anchorPhraseIdx % choices.length];
  } else if (mode === "pedal_oct") {
    semitoneOffset = (anchorPhraseIdx % 4 === 3) ? 12 : 0;
  } else {
    const walkDegrees = [0, 7, 5, 3, 0, 7, 10, 12];
    const idx = (anchorPhraseIdx + Math.floor(seededHash(seed, anchorPhraseIdx, 23) * 2)) % walkDegrees.length;
    semitoneOffset = walkDegrees[idx];
  }

  const rawAnchor = quantize(baseRoot + semitoneOffset, intervals, root);
  return Math.max(24, Math.min(59, rawAnchor));
}

/**
 * Computes Thread A chord notes (root + consonant fifth/triad voicing in octaves 1–3)
 * for a given anchor root note.
 */
export function getAnchorChordNotes(anchorNote, s = state) {
  const root = getRootMidi();
  const intervals = (s?.scale && SCALES[s.scale]) ? SCALES[s.scale] : getActiveScaleIntervals();
  const maxPoly = Math.max(1, Math.min(MAX_VOICES, Number(s?.polyphony ?? state.polyphony) || 4));

  const chord = [anchorNote];
  if (maxPoly >= 3) {
    const fifth = Math.max(24, Math.min(59, quantize(anchorNote + 7, intervals, root)));
    if (!chord.includes(fifth)) chord.push(fifth);
  }
  if (maxPoly >= 5) {
    const tenth = Math.max(24, Math.min(64, quantize(anchorNote + 12, intervals, root)));
    if (!chord.includes(tenth)) chord.push(tenth);
  }
  return chord;
}

/**
 * Computes Thread B (Follower/Melody) note(s) for a given step relative to the currently held Thread A note N_A.
 * Bounded by N_B in {N_A + delta} and quantized to the active scale.
 */
export function computeFollowerNotesForStep(stepIdx, anchorNote, anchorMotionDir, offsets, s = state) {
  if (!melodyInitialized) initMelodyLine(s);

  const root = getRootMidi();
  const intervals = (s?.scale && SCALES[s.scale]) ? SCALES[s.scale] : getActiveScaleIntervals();
  const followMode = s?.cpFollowMode || "contrary";
  const seed = Number(s?.seed) || 1;
  const spanSemitones = Math.max(12, Math.min(48, (Number(s?.pitchSpan) || 3) * 12));
  const maxPoly = Math.max(1, Math.min(MAX_VOICES, Number(s?.polyphony ?? state.polyphony) || 4));
  const melodyLen = getClampedMelodyLength(s);
  const numOffsets = offsets.length;
  const mStep = ((stepIdx % melodyLen) + melodyLen) % melodyLen;

  // Use evolved melody offset if it belongs to the active offset set, otherwise derive from followMode
  let primaryDelta = melodyOffsets[mStep];
  if (!offsets.includes(primaryDelta)) {
    let primaryIdx = 0;
    if (followMode === "contrary") {
      primaryIdx = anchorMotionDir >= 0
        ? (numOffsets - 1) - (mStep % numOffsets)
        : (mStep % numOffsets);
    } else if (followMode === "up_arp") {
      primaryIdx = mStep % numOffsets;
    } else if (followMode === "pendulum") {
      const cycle = Math.max(1, numOffsets * 2 - 2);
      const pos = mStep % cycle;
      primaryIdx = pos < numOffsets ? pos : cycle - pos;
    } else {
      primaryIdx = Math.floor(seededHash(seed, mStep, 97) * numOffsets);
    }
    primaryDelta = offsets[primaryIdx % numOffsets];
  }

  const primaryIdx = Math.max(0, offsets.indexOf(primaryDelta));
  const gateType = melodyGates[mStep] || 1;
  const velScale = melodyVelScale[mStep] || 1.0;

  const followerBudget = Math.max(1, maxPoly - 1);
  const activeFollowers = (mStep % 2 === 0 && gateType === 1)
    ? Math.min(followerBudget, Math.max(1, Math.ceil(followerBudget * 0.5)))
    : 1;

  const results = [];
  for (let f = 0; f < activeFollowers; f++) {
    const offIdx = (primaryIdx + f * 2) % numOffsets;
    const delta = f === 0 ? primaryDelta : offsets[offIdx];
    const targetRaw = Math.min(anchorNote + spanSemitones, anchorNote + delta);
    const qNote = Math.max(12, Math.min(127, quantize(targetRaw, intervals, root)));
    if (!results.some((item) => item.note === qNote)) {
      results.push({
        note: qNote,
        offset: delta,
        isDelay: gateType === 2 && f === 0,
        velScale: f === 0 ? velScale : velScale * 0.85,
        threadId: (f % (MAX_VOICES - 1)) + 1
      });
    }
  }

  return results;
}

/**
 * Generator Function Contract: generateCounterpointBank(state)
 * Merges Thread A (Chords every 4..32 steps with duration 4..nextChord) and Thread B (Evolving Melody).
 */
export function generateCounterpointBank(s = state) {
  if (!melodyInitialized) initMelodyLine(s);

  const seqLen = Math.max(1, Math.min(MAX_STEPS, Math.round(Number(s?.length) || 64)));
  const anchorDiv = getClampedChordInterval(s); // Strictly in [4, 32]
  const melodyLen = getClampedMelodyLength(s);   // Strictly in [4, 32]
  const maxPoly = Math.max(1, Math.min(MAX_VOICES, Math.round(Number(s?.polyphony) || 4)));
  const polyStrat = s?.polyStrategy || "extrema";
  const baseVel = Math.max(1, Math.min(127, Math.round(Number(s?.velocity) || 100)));
  const offsets = getActiveIntervalOffsets();

  stepAnchorNotes.fill(0);
  stepAnchorTriggered.fill(0);
  stepChordDuration.fill(0);
  stepAnchorActive.fill(0);
  stepFollowerNotes.fill(0);
  stepFollowerOffsets.fill(0);
  stepFollowerCounts.fill(0);

  const steps = [];
  let prevAnchor = getAnchorNote(0, s);
  let activeChordDur = computeChordDurationSteps(anchorDiv, 0, s);

  for (let i = 0; i < MAX_STEPS; i++) {
    // Evolve melody at each phrase wraparound inside the generative bank
    if (i > 0 && (i % melodyLen) === 0 && (Number(s?.cpEvolution ?? 35) > 0)) {
      evolveMelodyLine(s);
    }

    const anchorPhraseIdx = Math.floor(i / anchorDiv);
    const stepInChordCycle = i % anchorDiv;
    const isAnchorAttack = stepInChordCycle === 0;
    const anchorNote = getAnchorNote(anchorPhraseIdx, s);
    const anchorMotionDir = anchorNote >= prevAnchor ? 1 : -1;

    if (isAnchorAttack) {
      prevAnchor = anchorNote;
      activeChordDur = computeChordDurationSteps(anchorDiv, anchorPhraseIdx, s);
      stepChordDuration[i] = activeChordDur;
    } else {
      stepChordDuration[i] = 0;
    }

    const isChordSustaining = stepInChordCycle < activeChordDur;
    stepAnchorNotes[i] = anchorNote;
    stepAnchorTriggered[i] = isAnchorAttack ? 1 : 0;
    stepAnchorActive[i] = isChordSustaining ? 1 : 0;

    // Evaluate Thread B (Follower/Melody) notes relative to Thread A's currently held note N_A
    const followers = computeFollowerNotesForStep(i, anchorNote, anchorMotionDir, offsets, s);

    const anchorVel = Math.max(40, Math.min(127, baseVel + 10));
    const followerBaseVel = Math.max(35, Math.min(127, Math.round(baseVel * ((i % 2 === 0) ? 0.92 : 0.8))));

    const candidates = [];
    if (isAnchorAttack) {
      const chordPitches = getAnchorChordNotes(anchorNote, s);
      for (let cIdx = 0; cIdx < chordPitches.length; cIdx++) {
        candidates.push({
          note: chordPitches[cIdx],
          vel: Math.max(40, anchorVel - cIdx * 8),
          isAnchor: true,
          offset: 0
        });
      }
    } else if (isChordSustaining && maxPoly >= 2) {
      candidates.push({
        note: anchorNote,
        vel: Math.max(35, anchorVel - 20),
        isAnchor: true,
        offset: 0
      });
    }

    for (let f = 0; f < followers.length; f++) {
      const fn = followers[f];
      candidates.push({
        note: fn.note,
        vel: Math.max(30, Math.round(followerBaseVel * (fn.velScale ?? 1.0)) - f * 8),
        isAnchor: false,
        offset: fn.offset
      });
    }

    const selected = selectPolyVoices(candidates, maxPoly, polyStrat);

    let fCount = 0;
    for (const c of selected) {
      if (!c.isAnchor && fCount < MAX_VOICES) {
        stepFollowerNotes[i * MAX_VOICES + fCount] = c.note;
        stepFollowerOffsets[i * MAX_VOICES + fCount] = c.offset;
        fCount++;
      }
    }
    if (fCount === 0 && followers.length > 0) {
      stepFollowerNotes[i * MAX_VOICES] = followers[0].note;
      stepFollowerOffsets[i * MAX_VOICES] = followers[0].offset;
      fCount = 1;
    }
    stepFollowerCounts[i] = fCount;

    const stepNotes = selected.map((c) => ({ note: c.note, vel: c.vel }));
    const primaryNote = stepNotes[0]?.note ?? anchorNote;
    const primaryVel = stepNotes[0]?.vel ?? followerBaseVel;

    steps.push({
      note: primaryNote,
      vel: primaryVel,
      notes: stepNotes,
      gate: (Number(s?.gate) || 75) / 100,
      rate: Number(s?.rate) ?? 2,
      chordTriggered: isAnchorAttack,
      chordDurationSteps: isAnchorAttack ? activeChordDur : 0,
      locked: false,
      echo: false,
      skip: false
    });
  }

  renderCounterpointCanvas();
  updateHud();

  return [{
    length: seqLen,
    steps,
    rate: Number(s?.rate) ?? 2
  }];
}

/**
 * Real-time generative simulation step for Counterpoint.
 * Advances the internal step clock, triggers chords every 4..32 steps with duration 4..nextChord,
 * evolves the melody line over time, and dispatches voices within the 8-voice ceiling.
 */
export function stepSimulation(dtMs = 16) {
  const bpm = Math.max(30, Math.min(300, Number(state.tempo) || 120));
  const speed = Math.max(0.2, Math.min(4.0, Number(state.modelSpeed) || 1.0));
  const stepDurMs = (60000 / (bpm * 4)) / speed; // 16th-note step duration in ms

  stepAccumMs += dtMs;
  if (stepAccumMs < stepDurMs) return;
  stepAccumMs %= stepDurMs;

  const anchorDiv = getClampedChordInterval(state);
  const melodyLen = getClampedMelodyLength(state);
  const maxPoly = Math.max(1, Math.min(MAX_VOICES, Math.round(Number(state.polyphony) || 4)));
  const baseVel = Math.max(1, Math.min(127, Math.round(Number(state.velocity) || 100)));
  const offsets = getActiveIntervalOffsets();

  currentPlayStep = (currentPlayStep + 1) % MAX_STEPS;

  // Evolve the melody line when wrapping around the melody length
  if ((currentPlayStep % melodyLen) === 0) {
    const evoPct = Number(state.cpEvolution ?? 35);
    if (evoPct > 0 && Math.random() * 100 <= evoPct) {
      evolveMelodyLine(state);
    }
  }

  // Check if Thread A triggers a new chord (every anchorDiv in [4, 32] steps)
  const isChordTrigger = (currentPlayStep % anchorDiv) === 0;
  if (isChordTrigger) {
    const phraseIdx = Math.floor(currentPlayStep / anchorDiv);
    const nextAnchor = getAnchorNote(phraseIdx, state);
    heldAnchorMotionDir = nextAnchor >= heldAnchorNote ? 1 : -1;
    heldAnchorNote = nextAnchor;
    currentChordInterval = anchorDiv;
    currentChordDurSteps = computeChordDurationSteps(anchorDiv, phraseIdx, state);
    stepsSinceChordTrigger = 0;

    if (isCounterpointPlaying) {
      const chordPitches = getAnchorChordNotes(heldAnchorNote, state);
      const chordDurMs = Math.round(currentChordDurSteps * stepDurMs * 0.95);
      for (let c = 0; c < chordPitches.length; c++) {
        playVoice(`cp_chord_${c}`, chordPitches[c], Math.max(45, Math.min(127, baseVel + 10 - c * 8)), chordDurMs);
      }
    }
  } else {
    stepsSinceChordTrigger++;
  }

  // Trigger Thread B evolving melody note(s)
  const mStep = currentPlayStep % melodyLen;
  if (melodyGates[mStep] > 0 && isCounterpointPlaying) {
    const followers = computeFollowerNotesForStep(currentPlayStep, heldAnchorNote, heldAnchorMotionDir, offsets, state);
    const noteDurMs = Math.max(60, Math.round(stepDurMs * (melodyGates[mStep] === 2 ? 0.65 : 0.85)));
    const maxFollowerVoices = Math.max(1, maxPoly - 2);
    for (let f = 0; f < Math.min(followers.length, maxFollowerVoices); f++) {
      const fn = followers[f];
      const vel = Math.max(35, Math.min(127, Math.round(baseVel * (fn.velScale ?? 0.9)) - f * 8));
      playVoice(`cp_mel_${f}`, fn.note, vel, noteDurMs);
    }
  }

  // Refresh telemetry arrays and canvas
  generateCounterpointBank(state);
}

function animationTick(now) {
  if (!lastFrameTime) lastFrameTime = now;
  const dt = Math.min(100, Math.max(0, now - lastFrameTime));
  lastFrameTime = now;

  if (isCounterpointPlaying) {
    stepSimulation(dt);
  }

  if (isCounterpointPlaying && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  } else {
    animFrameId = null;
  }
}

export function isCounterpointRunning() {
  return isCounterpointPlaying;
}

export function startCounterpoint() {
  if (isCounterpointPlaying) return;
  isCounterpointPlaying = true;
  lastFrameTime = typeof performance !== "undefined" ? performance.now() : Date.now();
  stepAccumMs = 0;
  audio.unlock();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
  status("Counterpoint generative engine running", "ok");
}

export function stopCounterpoint() {
  isCounterpointPlaying = false;
  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
  }
  animFrameId = null;
  releasePolyVoices();
  panicPreview();
  status("Counterpoint stopped");
}

export function toggleCounterpointRunning() {
  if (isCounterpointPlaying) {
    stopCounterpoint();
    return false;
  }
  startCounterpoint();
  return true;
}

/**
 * Apply a curated Counterpoint preset.
 */
export function applyCounterpointPreset(presetId) {
  const preset = COUNTERPOINT_PRESETS.find((p) => p.id === presetId) || COUNTERPOINT_PRESETS[0];
  state.cpPreset = preset.id;
  state.cpMelodyLength = preset.melodyLength ?? 16;
  state.cpAnchorDiv = preset.anchorDiv ?? 8;
  state.cpChordHold = preset.chordHold ?? 85;
  state.cpEvolution = preset.evolution ?? 35;
  state.cpAnchorMode = preset.anchorMode;
  state.cpFollowMode = preset.followMode;
  setIntervalMaskFromArray(preset.intervals);
  initMelodyLine(state);

  syncControlsFromState();
  doGenerate(false);
  status(`Counterpoint preset: ${preset.name}`, "ok");
}

/**
 * Randomize Counterpoint parameters and interval offset mask.
 */
export function randomizeCounterpoint() {
  const chordDivs = [4, 8, 12, 16, 24, 32]; // Strictly between 1/4 note (4) and 2 bars (32)
  const melodyLens = [6, 8, 12, 16, 20, 24, 32];
  state.cpAnchorDiv = chordDivs[Math.floor(Math.random() * chordDivs.length)];
  state.cpMelodyLength = melodyLens[Math.floor(Math.random() * melodyLens.length)];
  state.cpChordHold = Math.round(40 + Math.random() * 60);
  state.cpEvolution = Math.round(20 + Math.random() * 65);
  state.cpAnchorMode = ANCHOR_MODES[Math.floor(Math.random() * ANCHOR_MODES.length)].id;
  state.cpFollowMode = FOLLOW_MODES[Math.floor(Math.random() * FOLLOW_MODES.length)].id;

  const picked = [7, 12];
  for (let i = 0; i < NUM_INTERVAL_SLOTS; i++) {
    const semitone = CANDIDATE_INTERVALS[i];
    if (semitone > 0 && Math.random() < 0.35 && !picked.includes(semitone)) {
      picked.push(semitone);
    }
  }
  setIntervalMaskFromArray(picked);
  initMelodyLine(state);

  syncControlsFromState();
  doGenerate(true);
  status(`Counterpoint randomized · Chords /${state.cpAnchorDiv} · Melody ${state.cpMelodyLength} st · Offsets {${getActiveIntervalOffsets().map((d) => "+" + d).join(", ")}}`, "ok");
}

function updateHud() {
  if (!hudEl) return;
  const offsets = getActiveIntervalOffsets().map((d) => `+${d}`).join(", ");
  const anchorDiv = getClampedChordInterval(state);
  const melodyLen = getClampedMelodyLength(state);
  const evo = Math.round(Number(state.cpEvolution ?? 35));
  hudEl.textContent = `CHORDS: /${anchorDiv} (4–${anchorDiv} ST) · MELODY: ${melodyLen} ST · EVO: ${evo}% · {${offsets}}`;
}

function syncControlsFromState() {
  if (ctrlPreset?.setValue) ctrlPreset.setValue(state.cpPreset || "koan_fifth_tenth", false);
  if (ctrlMelodyLen?.setValue) ctrlMelodyLen.setValue(getClampedMelodyLength(state), false);
  if (ctrlAnchorDiv?.setValue) ctrlAnchorDiv.setValue(getClampedChordInterval(state), false);
  if (ctrlChordHold?.setValue) ctrlChordHold.setValue(state.cpChordHold ?? 85, false);
  if (ctrlEvolution?.setValue) ctrlEvolution.setValue(state.cpEvolution ?? 35, false);
  if (ctrlAnchorMode?.setValue) ctrlAnchorMode.setValue(state.cpAnchorMode || "root_fifth", false);
  if (ctrlFollowMode?.setValue) ctrlFollowMode.setValue(state.cpFollowMode || "contrary", false);
}

/**
 * Render the interactive Counterpoint & Interval Offset Matrix canvas.
 * Adheres strictly to the Flat Workbench Aesthetic (zero CSS or Canvas gradients).
 */
export function renderCounterpointCanvas() {
  if (!canvasEl || !ctx) return;
  const w = canvasEl.width;
  const h = canvasEl.height;
  if (!w || !h) return;

  const {
    panel: colBg,
    panel2: colPanel2,
    line: colLine,
    lineFocus: colLineFocus,
    fg: colFg,
    dim: colDim,
    accent: colAccent
  } = getThemePalette();

  // 1. Solid flat background
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  // 2. Top Interactive Strip: Follower Interval Offset Matrix {N_A + delta}
  const stripY = 8;
  const stripH = 34;
  const padX = 12;
  const slotW = (w - padX * 2) / NUM_INTERVAL_SLOTS;

  for (let i = 0; i < NUM_INTERVAL_SLOTS; i++) {
    const sx = padX + i * slotW;
    const isOn = intervalMask[i] === 1;

    ctx.fillStyle = isOn ? colAccent : colPanel2;
    ctx.fillRect(sx + 1.5, stripY, slotW - 3, stripH);

    ctx.strokeStyle = isOn ? colFg : colLine;
    ctx.lineWidth = isOn ? 1.5 : 1;
    ctx.strokeRect(sx + 1.5, stripY, slotW - 3, stripH);

    ctx.fillStyle = isOn ? "#ffffff" : colDim;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(INTERVAL_LABELS[i], sx + slotW * 0.5, stripY + stripH * 0.5);
  }

  // Divider below interval strip
  const scoreTop = stripY + stripH + 12;
  const scoreBottom = h - 14;
  const scoreH = scoreBottom - scoreTop;
  const midSplitY = scoreTop + scoreH * 0.62;

  ctx.strokeStyle = colLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, midSplitY);
  ctx.lineTo(w - padX, midSplitY);
  ctx.stroke();

  const melodyLen = getClampedMelodyLength(state);
  const anchorDiv = getClampedChordInterval(state);
  const displaySteps = 32; // Two-bar (32-step) generative horizon
  const stepW = (w - padX * 2) / displaySteps;

  // Lane labels
  ctx.fillStyle = colDim;
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`THREAD B · EVOLVING MELODY (${melodyLen} STEPS · PRIMARY & DELAY ECHOES)`, padX + 4, scoreTop + 10);
  ctx.fillText(`THREAD A · SUSTAINED CHORDS (EVERY ${anchorDiv} STEPS · OCT 1–3)`, padX + 4, midSplitY + 12);

  // Draw melody loop boundary marker when melodyLen < 32
  if (melodyLen < displaySteps) {
    const loopX = padX + melodyLen * stepW;
    ctx.strokeStyle = colAccent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(loopX, scoreTop);
    ctx.lineTo(loopX, midSplitY);
    ctx.stroke();
  }

  // Pitch bounds for vertical mapping
  let minAnchor = 24, maxAnchor = 60;
  let minFollow = 48, maxFollow = 96;
  for (let i = 0; i < displaySteps; i++) {
    const a = stepAnchorNotes[i];
    if (a > 0) {
      if (a < minAnchor) minAnchor = a;
      if (a > maxAnchor) maxAnchor = a;
    }
    const fc = stepFollowerCounts[i];
    for (let f = 0; f < fc; f++) {
      const fn = stepFollowerNotes[i * MAX_VOICES + f];
      if (fn > 0) {
        if (fn < minFollow) minFollow = fn;
        if (fn > maxFollow) maxFollow = fn;
      }
    }
  }
  const anchorSpan = Math.max(12, maxAnchor - minAnchor + 6);
  const followSpan = Math.max(12, maxFollow - minFollow + 6);

  const mapAnchorY = (note) => {
    const norm = Math.max(0, Math.min(1, (note - (minAnchor - 3)) / anchorSpan));
    return scoreBottom - 8 - norm * (scoreBottom - midSplitY - 24);
  };

  const mapFollowY = (note) => {
    const norm = Math.max(0, Math.min(1, (note - (minFollow - 3)) / followSpan));
    return midSplitY - 10 - norm * (midSplitY - scoreTop - 26);
  };

  const activeStep32 = ((currentPlayStep % displaySteps) + displaySteps) % displaySteps;

  // 3. Draw Thread A (Chords) & Thread B (Evolving Melody + Delays)
  for (let i = 0; i < displaySteps; i++) {
    const x = padX + i * stepW;
    const anchorNote = stepAnchorNotes[i];
    const ay = mapAnchorY(anchorNote);
    const isAttack = stepAnchorTriggered[i] === 1;
    const isChordSustaining = stepAnchorActive[i] === 1;
    const isNow = i === activeStep32;
    const mIdx = i % melodyLen;
    const gateType = melodyGates[mIdx];

    // Draw Thread A chord block only while chord is sustaining (between 4 steps and next chord trigger)
    if (isChordSustaining) {
      ctx.fillStyle = isNow ? "#ffffff" : THREAD_COLORS[0];
      ctx.fillRect(x + (isAttack ? 2 : 0), ay - 6, Math.max(2, stepW - 1), 12);

      if (isAttack && stepW * anchorDiv >= 26) {
        ctx.fillStyle = "#111215";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`${midiName(anchorNote)} (${stepChordDuration[i]}st)`, x + 4, ay + 0.5);
      }
    }

    // Draw Thread B Follower melody notes and harmonic tether lines to Thread A
    if (gateType > 0) {
      const fCount = stepFollowerCounts[i];
      for (let f = 0; f < fCount; f++) {
        const fNote = stepFollowerNotes[i * MAX_VOICES + f];
        const fOffset = stepFollowerOffsets[i * MAX_VOICES + f];
        const fy = mapFollowY(fNote);
        const isDelayTap = gateType === 2 && f === 0;
        const col = isDelayTap ? THREAD_COLORS[2] : THREAD_COLORS[(f % (THREAD_COLORS.length - 1)) + 1];

        // Harmonic tether line connecting Follower N_B to Anchor N_A
        ctx.strokeStyle = isNow ? colFg : colLineFocus;
        ctx.lineWidth = isNow ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x + stepW * 0.5, ay - 6);
        ctx.lineTo(x + stepW * 0.5, fy + 4);
        ctx.stroke();

        // Follower note pill
        ctx.fillStyle = isNow ? "#ffffff" : col;
        const bw = Math.max(4, stepW - 3);
        ctx.fillRect(x + 1.5, fy - 4, bw, 8);

        if ((isNow || stepW >= 18) && f === 0) {
          ctx.fillStyle = colFg;
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(isDelayTap ? `D+${fOffset}` : `+${fOffset}`, x + stepW * 0.5, fy - 9);
        }
      }
    }

    // Playhead column outline
    if (isNow) {
      ctx.strokeStyle = colFg;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, scoreTop, Math.max(2, stepW - 1), scoreH);
    }
  }
}

/**
 * Initialize DOM & controls for the Counterpoint model.
 */
export function initCounterpoint() {
  containerEl = document.getElementById("model-counterpoint");
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "chladni-wrap";

  // Header
  const header = document.createElement("div");
  header.className = "chladni-header";
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span class="chladni-title">Follower &amp; Counterpoint</span>
      <span class="chladni-tag">Generative Chord &amp; Evolving Melody Stream</span>
    </div>
  `;

  hudEl = document.createElement("div");
  hudEl.style.fontSize = "10px";
  hudEl.style.fontFamily = "monospace";
  hudEl.style.color = "var(--dim)";
  header.appendChild(hudEl);

  // Interactive Canvas
  canvasEl = document.createElement("canvas");
  canvasEl.className = "chladni-canvas";
  canvasEl.width = 720;
  canvasEl.height = 250;
  canvasEl.style.width = "100%";
  canvasEl.style.height = "auto";
  canvasEl.style.display = "block";
  canvasEl.style.cursor = "pointer";
  canvasEl.title = "Top row: Click interval offsets (+0..+24) to toggle Thread B follower harmonics. Score: Click any step to audition.";
  ctx = canvasEl.getContext("2d");

  canvasEl.addEventListener("pointerdown", (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / (rect.width || canvasEl.width);
    const scaleY = canvasEl.height / (rect.height || canvasEl.height);
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const padX = 12;

    // 1. Check click on top Interval Offset Matrix strip
    if (my >= 4 && my <= 46) {
      const slotW = (canvasEl.width - padX * 2) / NUM_INTERVAL_SLOTS;
      const idx = Math.floor((mx - padX) / slotW);
      if (idx >= 0 && idx < NUM_INTERVAL_SLOTS) {
        intervalMask[idx] = intervalMask[idx] ? 0 : 1;
        if (!intervalMask.some((v) => v === 1)) {
          intervalMask[idx] = 1;
        }
        const semitone = CANDIDATE_INTERVALS[idx];
        const anchor = stepAnchorNotes[Math.max(0, currentPlayStep % 32)] || getAnchorNote(0, state);
        const previewPitch = quantize(anchor + semitone, getActiveScaleIntervals(), getRootMidi());
        playVoice("cp_preview", previewPitch, 95, 160);
        doGenerate(false);
        status(`Follower interval ${INTERVAL_NAMES[idx]} ${intervalMask[idx] ? "enabled" : "disabled"}`, "ok");
      }
      return;
    }

    // 2. Click on score step to audition merged Anchor Chord + Follower Melody
    const displaySteps = 32;
    const stepW = (canvasEl.width - padX * 2) / displaySteps;
    const stepIdx = Math.floor((mx - padX) / stepW);
    if (stepIdx >= 0 && stepIdx < displaySteps) {
      currentPlayStep = stepIdx;
      const anchor = stepAnchorNotes[stepIdx];
      if (anchor > 0) playVoice("cp_aud_0", anchor, 95, 220);
      const fc = stepFollowerCounts[stepIdx];
      for (let f = 0; f < fc; f++) {
        const fn = stepFollowerNotes[stepIdx * MAX_VOICES + f];
        if (fn > 0) playVoice(`cp_aud_${f + 1}`, fn, 85, 150);
      }
      renderCounterpointCanvas();
    }
  });

  // Compact Controls Strip
  const controlsCard = document.createElement("div");
  controlsCard.className = "chladni-card";
  controlsCard.style.marginTop = "8px";
  controlsCard.style.display = "grid";
  controlsCard.style.gridTemplateColumns = "repeat(auto-fit, minmax(125px, 1fr))";
  controlsCard.style.gap = "10px";
  controlsCard.style.alignItems = "center";

  ctrlPreset = R("cpPreset", dropdown({
    label: "Preset",
    options: COUNTERPOINT_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    value: state.cpPreset || "koan_fifth_tenth",
    onInput: (val) => applyCounterpointPreset(val),
    tip: "Curated Thread A (Chords) + Thread B (Evolving Melody) counterpoint configurations"
  }));

  ctrlMelodyLen = R("cpMelodyLength", knob({
    label: "Melody Len",
    min: 4,
    max: 32,
    step: 1,
    value: getClampedMelodyLength(state),
    def: 16,
    format: (v) => `${Math.round(v)} st`,
    onInput: (v) => {
      state.cpMelodyLength = Math.max(4, Math.min(32, Math.round(v)));
      initMelodyLine(state);
      scheduleRegen();
    },
    tip: "Controllable Thread B melody line length in steps (4 to 32 steps)"
  }));

  ctrlAnchorDiv = R("cpAnchorDiv", knob({
    label: "Chord Rate",
    min: MIN_CHORD_STEPS,
    max: MAX_CHORD_STEPS,
    step: 4,
    value: getClampedChordInterval(state),
    def: 8,
    format: (v) => `/${Math.round(v)}`,
    onInput: (v) => {
      state.cpAnchorDiv = Math.max(MIN_CHORD_STEPS, Math.min(MAX_CHORD_STEPS, Math.round(v)));
      scheduleRegen();
    },
    tip: "Steps between Thread A chord triggers: minimum 4 steps (quarter note), maximum 32 steps (two bars)"
  }));

  ctrlChordHold = R("cpChordHold", knob({
    label: "Chord Len",
    min: 25,
    max: 100,
    step: 5,
    value: state.cpChordHold ?? 85,
    def: 85,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state.cpChordHold = Math.round(v);
      scheduleRegen();
    },
    tip: "Chord hold duration between 1 quarter note (4 steps) and the next chord trigger"
  }));

  ctrlEvolution = R("cpEvolution", knob({
    label: "Evolution",
    min: 0,
    max: 100,
    step: 5,
    value: state.cpEvolution ?? 35,
    def: 35,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state.cpEvolution = Math.round(v);
      scheduleRegen();
    },
    tip: "Rate at which the melody line evolves over time by replacing notes and adding rhythmic delays"
  }));

  ctrlAnchorMode = R("cpAnchorMode", dropdown({
    label: "Thread A",
    options: ANCHOR_MODES.map((m) => ({ value: m.id, label: m.name })),
    value: state.cpAnchorMode || "root_fifth",
    onInput: (val) => {
      state.cpAnchorMode = val;
      scheduleRegen();
    },
    tip: "Harmonic foundation degree constraint for Thread A chords in octaves 1–3"
  }));

  ctrlFollowMode = R("cpFollowMode", dropdown({
    label: "Thread B",
    options: FOLLOW_MODES.map((m) => ({ value: m.id, label: m.name })),
    value: state.cpFollowMode || "contrary",
    onInput: (val) => {
      state.cpFollowMode = val;
      initMelodyLine(state);
      scheduleRegen();
    },
    tip: "Initial melodic contour rule for Thread B across active interval offsets {N_A + Δ}"
  }));

  const btnRnd = actionBtn("Randomize", () => {
    randomizeCounterpoint();
  }, "Randomize counterpoint threads, melody length, chord rate, and interval offsets (R or G)");

  controlsCard.append(
    ctrlPreset,
    ctrlMelodyLen,
    ctrlAnchorDiv,
    ctrlChordHold,
    ctrlEvolution,
    ctrlAnchorMode,
    ctrlFollowMode,
    btnRnd
  );

  wrap.append(header, canvasEl, controlsCard);
  containerEl.appendChild(wrap);

  onRegen(() => {
    if (getActiveModel() === "counterpoint") {
      renderCounterpointCanvas();
      updateHud();
    }
  });

  initMelodyLine(state);
  updateHud();
  renderCounterpointCanvas();
}

export function activateCounterpointModel() {
  if (containerEl) containerEl.style.display = "block";
  stopCounterpoint();
  if (!melodyInitialized) initMelodyLine(state);
  setModelGenerator(generateCounterpointBank);
  setModelRandomizer(randomizeCounterpoint);
  setModelStepHandler((stepIdx) => {
    currentPlayStep = stepIdx;
    renderCounterpointCanvas();
  });
  setModelTransportHandler({
    start: startCounterpoint,
    stop: stopCounterpoint,
    toggle: toggleCounterpointRunning,
    isRunning: isCounterpointRunning
  });
  syncControlsFromState();
  doGenerate(false);
}

export function deactivateCounterpointModel() {
  stopCounterpoint();
  setModelTransportHandler(null);
  setModelStepHandler(null);
  setModelRandomizer(null);
  setModelGenerator(null);
  if (containerEl) containerEl.style.display = "none";
}

// Register Snapshot Serialization
registerModel({
  id: "counterpoint",
  version: 1,
  migrations: {},
  capture() {
    return {
      preset: state.cpPreset || "koan_fifth_tenth",
      melodyLength: getClampedMelodyLength(state),
      anchorDiv: getClampedChordInterval(state),
      chordHold: state.cpChordHold ?? 85,
      evolution: state.cpEvolution ?? 35,
      anchorMode: state.cpAnchorMode || "root_fifth",
      followMode: state.cpFollowMode || "contrary",
      intervals: getActiveIntervalOffsets(),
      melodyOffsets: Array.from(melodyOffsets.slice(0, 32)),
      melodyGates: Array.from(melodyGates.slice(0, 32))
    };
  },
  restore(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.preset) state.cpPreset = String(payload.preset);
    if (payload.melodyLength !== undefined) {
      state.cpMelodyLength = Math.max(4, Math.min(32, Number(payload.melodyLength) || 16));
    }
    if (payload.anchorDiv !== undefined) {
      state.cpAnchorDiv = Math.max(MIN_CHORD_STEPS, Math.min(MAX_CHORD_STEPS, Number(payload.anchorDiv) || 8));
    }
    if (payload.chordHold !== undefined) {
      state.cpChordHold = Math.max(25, Math.min(100, Number(payload.chordHold) || 85));
    }
    if (payload.evolution !== undefined) {
      state.cpEvolution = Math.max(0, Math.min(100, Number(payload.evolution) || 35));
    }
    if (payload.anchorMode) state.cpAnchorMode = String(payload.anchorMode);
    if (payload.followMode) state.cpFollowMode = String(payload.followMode);
    if (Array.isArray(payload.intervals)) {
      setIntervalMaskFromArray(payload.intervals);
    }
    initMelodyLine(state);
    if (Array.isArray(payload.melodyOffsets)) {
      for (let i = 0; i < Math.min(32, payload.melodyOffsets.length); i++) {
        melodyOffsets[i] = payload.melodyOffsets[i];
      }
    }
    if (Array.isArray(payload.melodyGates)) {
      for (let i = 0; i < Math.min(32, payload.melodyGates.length); i++) {
        melodyGates[i] = payload.melodyGates[i];
      }
    }
    syncControlsFromState();
    renderCounterpointCanvas();
    updateHud();
  }
});
