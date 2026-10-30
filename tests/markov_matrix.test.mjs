// tests/markov_matrix.test.mjs — Unit tests for High-Order Markov Transition Matrix Melodic Memory model
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
        fillText: () => {}
      }),
      style: {}
    }),
    documentElement: {
      style: {},
      getAttribute: () => null
    }
  };
}

import {
  NUM_STATES,
  MAX_WALKERS,
  transitionWeights,
  normalizedProbs,
  walkers,
  MARKOV_PRESETS,
  initMarkovPreset,
  normalizeTransitionMatrix,
  getTransitionProbabilities,
  sampleNextState,
  getStateNote,
  stepSimulation,
  generateMarkovMatrixBank,
  startMarkov,
  stopMarkov,
  toggleMarkovRunning,
  isMarkovRunning,
  initMarkovMatrix,
  randomizeMarkovMatrix,
  activateMarkovMatrixModel,
  deactivateMarkovMatrixModel
} from "../js/markov_matrix.js";
import { getModelDef } from "../js/snapshot.js";
import { getCurrentModelRandomizer } from "../js/state.js";
import { toggleLive, stopLive, isLive } from "../js/player.js?v=1";
import { state } from "../js/state.js";

test("MARKOV_PRESETS contains required musical transition corpora", () => {
  assert.equal(MARKOV_PRESETS.length, 5);
  const ids = MARKOV_PRESETS.map(p => p.id);
  assert.ok(ids.includes("bach_chorale"));
  assert.ok(ids.includes("pentatonic_gamelan"));
  assert.ok(ids.includes("blues_walk"));
  assert.ok(ids.includes("fibonacci_spiral"));
  assert.ok(ids.includes("aleatoric_diffuse"));
});

test("Hardware polyphony ceiling: MAX_WALKERS is strictly capped at 8", () => {
  assert.equal(MAX_WALKERS, 8);
  assert.equal(walkers.length, 8);
  assert.equal(NUM_STATES, 8);
});

test("Row normalization ensures every state's outgoing transitions sum to 1.0", () => {
  initMarkovPreset("bach_chorale");
  normalizeTransitionMatrix();

  for (let r = 0; r < NUM_STATES; r++) {
    let rowSum = 0;
    for (let c = 0; c < NUM_STATES; c++) {
      rowSum += normalizedProbs[r * NUM_STATES + c];
    }
    assert.ok(
      Math.abs(rowSum - 1.0) < 0.0001,
      `Row ${r} sum ${rowSum} did not normalize to 1.0`
    );
  }
});

test("Boltzmann temperature scaling modulates entropy between deterministic loops and aleatoric diffusion", () => {
  initMarkovPreset("bach_chorale");
  const fromState = 6; // Leading tone typically resolves strongly to 0 (tonic)

  // Low temperature (concentrated probability)
  const lowTempProbs = getTransitionProbabilities(fromState, 0.2);
  let maxLow = -1;
  let maxLowIdx = -1;
  for (let c = 0; c < NUM_STATES; c++) {
    if (lowTempProbs[c] > maxLow) {
      maxLow = lowTempProbs[c];
      maxLowIdx = c;
    }
  }
  // Low temp should heavily peak on state 0 (> 0.95)
  assert.equal(maxLowIdx, 0);
  assert.ok(maxLow > 0.9, `Low temp peak probability ${maxLow} should exceed 0.9`);

  // High temperature (diffuse uniform probability)
  const highTempProbs = getTransitionProbabilities(fromState, 2.5);
  for (let c = 0; c < NUM_STATES; c++) {
    // Each state should be closer to 1/8 = 0.125
    assert.ok(
      highTempProbs[c] > 0.04 && highTempProbs[c] < 0.35,
      `High temp prob ${highTempProbs[c]} not diffuse`
    );
  }
});

test("High-order N-gram memory biases transitions when order > 1", () => {
  initMarkovPreset("bach_chorale");
  const history = new Int8Array([0, 2, 1, 0]); // s_t = 0, s_{t-1} = 2
  const probs1 = getTransitionProbabilities(0, 1.0, history, 1);
  const probs2 = getTransitionProbabilities(0, 1.0, history, 2);

  // Order 2 should reward return/inhibition to state 2
  assert.notEqual(probs1[2], probs2[2]);
});

test("sampleNextState samples valid state indices [0, NUM_STATES - 1]", () => {
  const probs = new Float32Array([0, 0, 0, 1.0, 0, 0, 0, 0]);
  const sampled = sampleNextState(probs);
  assert.equal(sampled, 3);
});

test("getStateNote produces scale-quantized MIDI notes within audible pitch range", () => {
  for (let s = 0; s < NUM_STATES; s++) {
    const note = getStateNote(s, 1);
    assert.ok(Number.isInteger(note));
    assert.ok(note >= 24 && note <= 108);
  }
});

test("Simulation stepping executes without error and respects active voice allocation", () => {
  initMarkovPreset("pentatonic_gamelan");
  // Step multiple frames
  for (let i = 0; i < 20; i++) {
    stepSimulation(20);
  }

  // Active walkers should have valid states
  for (let w = 0; w < MAX_WALKERS; w++) {
    if (walkers[w].active) {
      assert.ok(walkers[w].currentState >= 0 && walkers[w].currentState < NUM_STATES);
    }
  }
});

test("Generator contract: generateMarkovMatrixBank returns valid 64-step bank array", () => {
  const bank = generateMarkovMatrixBank({ length: 64, rate: 2 });
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, 2);
  assert.equal(bank[0].steps.length, 64);

  const step0 = bank[0].steps[0];
  assert.ok(step0.note >= 0 && step0.note <= 127);
  assert.equal(step0.gate, 1);
  assert.equal(step0.source, "markov_matrix");
});

test("Snapshot capture and restore round-trip preserves Markov parameters", () => {
  const def = getModelDef("markov_matrix");
  assert.ok(def, "markov_matrix model must be registered in snapshot.js");

  initMarkovPreset("blues_walk");
  const snap = def.capture();
  assert.equal(snap.preset, "blues_walk");
  assert.ok(Array.isArray(snap.weights));
  assert.equal(snap.weights.length, NUM_STATES * NUM_STATES);

  // Mutate local state
  initMarkovPreset("fibonacci_spiral");
  assert.notEqual(transitionWeights[0], snap.weights[0]);

  // Restore snapshot
  def.restore(snap);
  assert.ok(Math.abs(transitionWeights[0] - snap.weights[0]) < 0.001);
});

test("Transport start/stop/toggle controls", () => {
  stopMarkov();
  assert.equal(isMarkovRunning(), false);
  startMarkov();
  assert.equal(isMarkovRunning(), true);
  toggleMarkovRunning();
  assert.equal(isMarkovRunning(), false);
});

test("markov_matrix local controls mirroring global ones (Play, Span) are removed", () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(val) {
      createdHtml = val;
    },
    get innerHTML() {
      return createdHtml;
    }
  };

  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-markov_matrix") return dummyContainer;
    return null;
  };

  try {
    initMarkovMatrix();

    // Verify local Play button is removed (Global play exists)
    assert.ok(!createdHtml.includes('id="markov-play-btn"'), "Local play button must be removed (Global play exists)");

    // Verify local Span slider is removed (Notes div octave spread exists)
    assert.ok(!createdHtml.includes('id="markov-span-ctrl"'), "Local Span knob must be removed (Notes div octave spread exists)");

    // Verify model-specific controls are preserved
    assert.ok(createdHtml.includes('id="markov-preset-ctrl"'), "Preset select retained");
    assert.ok(createdHtml.includes('id="markov-temp-ctrl"'), "Temperature knob retained");
    assert.ok(createdHtml.includes('id="markov-order-ctrl"'), "Memory order knob retained");
    assert.ok(createdHtml.includes('id="markov-walkers-ctrl"'), "Walkers knob retained");
    assert.ok(createdHtml.includes('id="markov-drift-ctrl"'), "Drift knob retained");
    assert.ok(createdHtml.includes('id="markov-rnd-btn"'), "Randomise button present in toolbar");
    assert.ok(createdHtml.includes('id="markov-mutate-btn"'), "Mutate button retained");
    assert.ok(createdHtml.includes('id="markov-reset-btn"'), "Reset button retained");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

test("randomizeMarkovMatrix randomises transition probabilities in the matrix with normalised rows", () => {
  initMarkovPreset("bach_chorale");
  const baselineWeights = Float32Array.from(transitionWeights);

  randomizeMarkovMatrix();

  // Ensure weights changed from baseline
  let hasDifference = false;
  for (let i = 0; i < NUM_STATES * NUM_STATES; i++) {
    if (Math.abs(transitionWeights[i] - baselineWeights[i]) > 0.001) {
      hasDifference = true;
      break;
    }
  }
  assert.ok(hasDifference, "randomizeMarkovMatrix should alter transitionWeights");

  // Verify all rows sum to 1.0 in normalizedProbs and weights are non-uniform
  for (let r = 0; r < NUM_STATES; r++) {
    let rowSum = 0;
    let minP = 1.0;
    let maxP = 0.0;
    for (let c = 0; c < NUM_STATES; c++) {
      const p = normalizedProbs[r * NUM_STATES + c];
      rowSum += p;
      if (p < minP) minP = p;
      if (p > maxP) maxP = p;
    }
    assert.ok(
      Math.abs(rowSum - 1.0) < 0.0001,
      `Row ${r} sum ${rowSum} in normalizedProbs must equal 1.0`
    );
    // Should have contrast between preferred and non-preferred transitions
    assert.ok(
      maxP > minP,
      `Row ${r} should have non-uniform transition probabilities (max ${maxP} vs min ${minP})`
    );
  }
});

test("global randomizer dispatch invokes randomizeMarkovMatrix when markov_matrix is active", () => {
  activateMarkovMatrixModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(typeof rnd, "function");

  // Mutate transition weights
  rnd();
  let nonZeroCount = 0;
  for (let i = 0; i < NUM_STATES * NUM_STATES; i++) {
    if (transitionWeights[i] > 0) nonZeroCount++;
  }
  assert.equal(nonZeroCount, NUM_STATES * NUM_STATES);

  deactivateMarkovMatrixModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

test("markov_matrix integrates seamlessly with global play transport", () => {
  activateMarkovMatrixModel();

  assert.equal(isLive(), false);
  assert.equal(isMarkovRunning(), false);

  // Global Play toggle
  toggleLive();
  assert.equal(isMarkovRunning(), true);
  assert.equal(isLive(), true);

  // Global Stop toggle
  toggleLive();
  assert.equal(isMarkovRunning(), false);
  assert.equal(isLive(), false);

  // Global Start then stopLive()
  toggleLive();
  assert.equal(isMarkovRunning(), true);
  stopLive();
  assert.equal(isMarkovRunning(), false);
  assert.equal(isLive(), false);

  deactivateMarkovMatrixModel();
});

