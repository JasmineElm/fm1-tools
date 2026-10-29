// poly.js — Centralized Polyphony Voice Allocation & Voice Ceiling Manager for FM-1 Pulses.
// Enforces strictly <= 8 voices for M-VAVE FM-1 hardware while providing rich voice selection strategies.
//
// Generative Architecture:
// 1. Shared polyphonic voice selection strategies: Lowest, Highest, Extrema, Spread, Cluster, Cycle, Random.
// 2. Centralized 8-voice FIFO stealing ring buffer ensuring hardware buffer safety.
// 3. Dual audio output dispatch: liveNoteOn/liveNoteOff (MIDI) and audio.noteOn/audio.noteOff (browser synth).
// 4. Zero GC churn with typed arrays and reusable buffer slices.

import { state } from "./state.js";
import {
  liveNoteOn, liveNoteOff, panicPreview,
  recordAndCheckSafeNote, resetSafeNoteHistory,
  SAFE_WINDOW_MS, SAFE_MAX_NOTES
} from "./player.js";
import * as audio from "./audio.js";

export { recordAndCheckSafeNote, resetSafeNoteHistory, SAFE_WINDOW_MS, SAFE_MAX_NOTES };

export const MAX_HARDWARE_VOICES = 8;

export const POLY_STRATEGIES = [
  { v: "extrema", t: "Extrema (Shell)" },
  { v: "lowest", t: "Lowest (Bass)" },
  { v: "highest", t: "Highest (Lead)" },
  { v: "spread", t: "Spread (Open)" },
  { v: "cluster", t: "Cluster (Tight)" },
  { v: "cycle", t: "Cycle (Rotate)" },
  { v: "random", t: "Random (Aleatoric)" }
];

let polyCycleOffset = 0;

// Central active voice map: voiceKey/slot -> { note, timeoutId }
const activePolyVoices = new Map();

/**
 * Filter and select up to maxVoices from an array of candidate pitches or candidate objects.
 * 
 * @param {Array<number|Object>} candidates - Array of MIDI note numbers or objects with .note / .pitch
 * @param {number} maxVoices - Maximum allowed polyphony (1 to 8, defaults to state.polyphony || 4)
 * @param {string} strategy - Selection strategy (defaults to state.polyStrategy || "extrema")
 * @returns {Array<number|Object>} Selected candidates (length <= maxVoices)
 */
export function selectPolyVoices(candidates, maxVoices = state.polyphony || 4, strategy = state.polyStrategy || "extrema") {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const K = Math.max(1, Math.min(MAX_HARDWARE_VOICES, Math.round(Number(maxVoices) || 4)));
  if (candidates.length <= K) return candidates.slice();

  const isObj = typeof candidates[0] === "object" && candidates[0] !== null;
  const getPitch = (c) => isObj ? Number(c.note ?? c.pitch ?? 60) : Number(c);

  // Sort ascending by pitch
  const sorted = candidates.slice().sort((a, b) => getPitch(a) - getPitch(b));
  const M = sorted.length;
  if (M <= K) return sorted;

  switch (strategy) {
    case "lowest":
      return sorted.slice(0, K);

    case "highest":
      return sorted.slice(M - K);

    case "extrema": {
      const out = [];
      let left = 0;
      let right = M - 1;
      for (let i = 0; i < K; i++) {
        if (i % 2 === 0) {
          out.push(sorted[left++]);
        } else {
          out.push(sorted[right--]);
        }
      }
      return out.sort((a, b) => getPitch(a) - getPitch(b));
    }

    case "spread": {
      const out = [];
      for (let i = 0; i < K; i++) {
        const idx = Math.round((i * (M - 1)) / (K - 1));
        out.push(sorted[idx]);
      }
      return out;
    }

    case "cluster": {
      let bestIdx = 0;
      let minSpan = Infinity;
      for (let i = 0; i <= M - K; i++) {
        const span = getPitch(sorted[i + K - 1]) - getPitch(sorted[i]);
        if (span < minSpan) {
          minSpan = span;
          bestIdx = i;
        }
      }
      return sorted.slice(bestIdx, bestIdx + K);
    }

    case "cycle": {
      polyCycleOffset = (polyCycleOffset || 0) % M;
      const out = [];
      for (let i = 0; i < K; i++) {
        out.push(sorted[(polyCycleOffset + i) % M]);
      }
      polyCycleOffset = (polyCycleOffset + K) % M;
      return out;
    }

    case "random": {
      const copy = sorted.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = copy[i];
        copy[i] = copy[j];
        copy[j] = temp;
      }
      return copy.slice(0, K).sort((a, b) => getPitch(a) - getPitch(b));
    }

    default:
      return sorted.slice(0, K);
  }
}

let autoVoiceCounter = 0;

/**
 * Play a voice with strict <= 8 voice FIFO stealing, dispatching to both MIDI and Web Audio.
 * Supports timestamp lookahead scheduling into hardware Web MIDI queues and AudioContext.
 * Supports playVoice(slot, note, vel, durMs, [timestamp]) and playVoice(note, vel, durMs, [timestamp]).
 */
export function playVoice(voiceSlotOrNote, noteOrVel = 90, velOrDur = 90, maybeDur, maybeTimestamp = 0) {
  let slot, note, vel, durMs, timestamp = 0;

  if (typeof maybeDur === "number" && (typeof maybeTimestamp === "number" && maybeTimestamp > 0)) {
    // 5 arguments: (slot, note, vel, durMs, timestamp)
    slot = voiceSlotOrNote;
    note = noteOrVel;
    vel = velOrDur;
    durMs = maybeDur;
    timestamp = maybeTimestamp;
  } else if (maybeDur !== undefined) {
    if (typeof voiceSlotOrNote === "string") {
      slot = voiceSlotOrNote;
      note = noteOrVel;
      vel = velOrDur;
      durMs = maybeDur;
      timestamp = typeof maybeTimestamp === "number" ? maybeTimestamp : 0;
    } else {
      slot = `auto_${(autoVoiceCounter++) % MAX_HARDWARE_VOICES}`;
      note = voiceSlotOrNote;
      vel = noteOrVel;
      durMs = velOrDur;
      timestamp = typeof maybeDur === "number" ? maybeDur : 0;
    }
  } else if (typeof voiceSlotOrNote === "string") {
    // Named voice slot: ("lead", note, vel)
    slot = voiceSlotOrNote;
    note = noteOrVel;
    vel = velOrDur;
    durMs = 180;
    timestamp = 0;
  } else {
    // 1 to 3 arguments: (note, [vel], [durMs])
    slot = `auto_${(autoVoiceCounter++) % MAX_HARDWARE_VOICES}`;
    note = voiceSlotOrNote;
    vel = noteOrVel;
    durMs = velOrDur;
    timestamp = 0;
  }

  if (typeof note !== "number" || !isFinite(note) || isNaN(note)) return;

  // Safe mode rate limiter: drop any note after 8th within 500ms to protect FM-1 sound engine
  if (!recordAndCheckSafeNote(timestamp > 0 ? timestamp : undefined)) {
    return;
  }

  const safeNote = Math.min(127, Math.max(0, Math.round(note)));
  const safeVel = Math.min(127, Math.max(1, Math.round(vel)));
  const safeDur = Math.max(30, Math.round(durMs));

  audio.unlock();

  const now = performance.now();
  const startPerfNow = timestamp > 0 ? timestamp : now;
  const offPerfNow = startPerfNow + safeDur;
  const deltaStartMs = Math.max(0, startPerfNow - now);
  const deltaOffMs = Math.max(0, offPerfNow - now);

  const audioCtx = audio.getAudioContext();
  const baseAudioTime = audioCtx ? audioCtx.currentTime : 0;
  const audioStartTime = audioCtx ? baseAudioTime + (deltaStartMs / 1000) : 0;
  const audioOffTime = audioCtx ? baseAudioTime + (deltaOffMs / 1000) : 0;

  // If this voice slot is already playing a note, terminate it first at scheduled timestamp
  if (activePolyVoices.has(slot)) {
    const prev = activePolyVoices.get(slot);
    clearTimeout(prev.timeoutId);
    try { liveNoteOff(prev.note, startPerfNow); } catch (_) {}
    try { audio.noteOff(prev.note, audioStartTime); } catch (_) {}
    activePolyVoices.delete(slot);
  }

  // FIFO Note Stealing if voice count reaches 8
  if (activePolyVoices.size >= MAX_HARDWARE_VOICES) {
    const oldestSlot = activePolyVoices.keys().next().value;
    const oldest = activePolyVoices.get(oldestSlot);
    clearTimeout(oldest.timeoutId);
    try { liveNoteOff(oldest.note, startPerfNow); } catch (_) {}
    try { audio.noteOff(oldest.note, audioStartTime); } catch (_) {}
    activePolyVoices.delete(oldestSlot);
  }

  // Dispatch Note On (fromPoly = true prevents double counting)
  try { liveNoteOn(safeNote, safeVel, true, startPerfNow); } catch (_) {}
  try { audio.noteOn(safeNote, safeVel, audioStartTime); } catch (_) {}

  // Schedule Note Off
  const timeoutDelay = deltaStartMs + safeDur;
  const timeoutId = setTimeout(() => {
    try { liveNoteOff(safeNote, offPerfNow); } catch (_) {}
    try { audio.noteOff(safeNote, audioOffTime); } catch (_) {}
    activePolyVoices.delete(slot);
  }, timeoutDelay);

  activePolyVoices.set(slot, { note: safeNote, timeoutId });
}

/**
 * Release all currently active voices.
 */
export function releasePolyVoices() {
  for (const [, v] of activePolyVoices.entries()) {
    clearTimeout(v.timeoutId);
    try { liveNoteOff(v.note); } catch (_) {}
    try { audio.noteOff(v.note); } catch (_) {}
  }
  activePolyVoices.clear();
  try { panicPreview(); } catch (_) {}
  try { audio.allOff(); } catch (_) {}
}

/**
 * Returns the number of currently sounding polyphonic voices.
 */
export function getActiveVoiceCount() {
  return activePolyVoices.size;
}
