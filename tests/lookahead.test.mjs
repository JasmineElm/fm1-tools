// tests/lookahead.test.mjs — Unit test suite for Web MIDI & Web Audio lookahead scheduling
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for Node test environment
class MockAudioParam {
  constructor(val = 0) {
    this.value = val;
    this.events = [];
  }
  cancelScheduledValues(t) {
    this.events.push({ type: "cancel", time: t });
  }
  setValueAtTime(v, t) {
    this.events.push({ type: "setValue", val: v, time: t });
  }
  linearRampToValueAtTime(v, t) {
    this.events.push({ type: "linearRamp", val: v, time: t });
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push({ type: "exponentialRamp", val: v, time: t });
  }
}

class MockAudioNode {
  constructor() {
    this.gain = new MockAudioParam(1);
    this.frequency = new MockAudioParam(440);
  }
  connect(dest) {
    return dest;
  }
  disconnect() {}
  start(t) {
    this.startTime = t;
  }
  stop(t) {
    this.stopTime = t;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 12.345;
    this.state = "running";
    this.destination = new MockAudioNode();
  }
  createDynamicsCompressor() {
    return {
      threshold: new MockAudioParam(-12),
      knee: new MockAudioParam(12),
      ratio: new MockAudioParam(4),
      attack: new MockAudioParam(0.004),
      release: new MockAudioParam(0.15),
      connect(dest) { return dest; }
    };
  }
  createBiquadFilter() {
    return new MockAudioNode();
  }
  createGain() {
    return new MockAudioNode();
  }
  createOscillator() {
    return new MockAudioNode();
  }
  resume() {}
}

const mockSentMidi = [];
const mockMidiOutput = {
  id: "out-1",
  name: "M-VAVE FM-1",
  cleared: false,
  clear() {
    this.cleared = true;
  },
  send(data, timestamp) {
    mockSentMidi.push({ data: Array.from(data), timestamp });
  }
};

const mockMidiAccess = {
  outputs: new Map([["out-1", mockMidiOutput]]),
  inputs: new Map(),
  onstatechange: null
};

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: "" }
  };
} else {
  globalThis.window.AudioContext = MockAudioContext;
}

if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = {
    requestMIDIAccess: async () => mockMidiAccess
  };
} else {
  globalThis.navigator.requestMIDIAccess = async () => mockMidiAccess;
}

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    documentElement: { style: {} }
  };
}

// Import modules to test
const midi = await import("../js/midi.js");
const audio = await import("../js/audio.js");
const player = await import("../js/player.js");

test("midi: initMidi finds M-VAVE FM-1 mock device", async () => {
  const outputs = await midi.initMidi();
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].name, "M-VAVE FM-1");
  const fm1 = midi.findFm1();
  assert.ok(fm1);
  assert.equal(fm1.name, "M-VAVE FM-1");
});

test("midi: sendNoteOn, sendNoteOff, sendControlChange pass timestamp to output.send", () => {
  mockSentMidi.length = 0;

  // Immediate send (no timestamp or 0)
  midi.sendNoteOn(60, 100, 1);
  assert.equal(mockSentMidi.length, 1);
  assert.deepEqual(mockSentMidi[0].data, [0x90, 60, 100]);
  assert.equal(mockSentMidi[0].timestamp, undefined);

  // Timestamped send
  const targetTs = performance.now() + 50;
  midi.sendNoteOn(64, 90, 1, targetTs);
  assert.equal(mockSentMidi.length, 2);
  assert.deepEqual(mockSentMidi[1].data, [0x90, 64, 90]);
  assert.equal(mockSentMidi[1].timestamp, targetTs);

  // Note Off with timestamp
  const offTs = targetTs + 120;
  midi.sendNoteOff(64, 1, offTs);
  assert.equal(mockSentMidi.length, 3);
  assert.deepEqual(mockSentMidi[2].data, [0x80, 64, 0]);
  assert.equal(mockSentMidi[2].timestamp, offTs);

  // CC with timestamp
  midi.sendControlChange(74, 105, 1, targetTs);
  assert.equal(mockSentMidi.length, 4);
  assert.deepEqual(mockSentMidi[3].data, [0xB0, 74, 105]);
  assert.equal(mockSentMidi[3].timestamp, targetTs);
});

test("midi: sendAllNotesOff clears buffer and dispatches CC #123 and CC #120", () => {
  mockSentMidi.length = 0;
  mockMidiOutput.cleared = false;

  midi.sendAllNotesOff(1);
  assert.equal(mockMidiOutput.cleared, true);
  assert.equal(mockSentMidi.length, 2);
  // CC #123 (All Notes Off)
  assert.deepEqual(mockSentMidi[0].data, [0xB0, 123, 0]);
  // CC #120 (All Sound Off)
  assert.deepEqual(mockSentMidi[1].data, [0xB0, 120, 0]);
});

test("audio: exports getAudioContext and getAudioCurrentTime", () => {
  audio.setMuted(false);
  const ctx = audio.getAudioContext();
  assert.ok(ctx);
  assert.equal(typeof ctx.currentTime, "number");
  assert.equal(audio.getAudioCurrentTime(), ctx.currentTime);
});

test("audio: noteOn and noteOff accept scheduled 'when' parameter", () => {
  audio.setMuted(false);
  const scheduledOn = 15.0;
  const scheduledOff = 15.5;

  audio.noteOn(60, 100, scheduledOn);
  audio.noteOff(60, scheduledOff);

  // Muted check
  audio.setMuted(true);
});

test("player: liveNoteOn, liveNoteOff, and liveControlChange forward timestamps", () => {
  mockSentMidi.length = 0;
  const ts = performance.now() + 45;

  const res = player.liveNoteOn(62, 85, false, ts);
  assert.equal(res, true);
  assert.equal(mockSentMidi.length, 1);
  assert.deepEqual(mockSentMidi[0].data, [0x90, 62, 85]);
  assert.equal(mockSentMidi[0].timestamp, ts);

  const offTs = ts + 100;
  player.liveNoteOff(62, offTs);
  assert.equal(mockSentMidi.length, 2);
  assert.deepEqual(mockSentMidi[1].data, [0x80, 62, 0]);
  assert.equal(mockSentMidi[1].timestamp, offTs);

  player.liveControlChange(74, 95, 1, ts);
  assert.equal(mockSentMidi.length, 3);
  assert.deepEqual(mockSentMidi[2].data, [0xB0, 74, 95]);
  assert.equal(mockSentMidi[2].timestamp, ts);
});

test("player: panicPreview invokes sendAllNotesOff", () => {
  mockSentMidi.length = 0;
  mockMidiOutput.cleared = false;

  player.panicPreview();
  assert.equal(mockMidiOutput.cleared, true);
  assert.ok(mockSentMidi.some(m => m.data[1] === 123));
  assert.ok(mockSentMidi.some(m => m.data[1] === 120));
});
