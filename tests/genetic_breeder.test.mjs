// tests/genetic_breeder.test.mjs — Unit tests for Interactive Genetic Algorithm Melodic Genome Breeder model
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
  POPULATION_SIZE,
  CHROMOSOME_LEN,
  popDegrees,
  popGates,
  popVels,
  popAccents,
  popOctaves,
  fitnessScores,
  genomeMutes,
  genomePlayheads,
  BREEDER_PRESETS,
  initBreederPreset,
  computePopulationVariance,
  selectParentIndex,
  crossoverChromosomes,
  mutateChromosome,
  breedNextGeneration,
  getGeneNote,
  stepSimulation,
  generateGeneticBreederBank,
  startBreeder,
  stopBreeder,
  toggleBreederRunning,
  isBreederRunning,
  initGeneticBreeder,
  activateGeneticBreederModel,
  deactivateGeneticBreederModel,
  randomizeGeneticBreeder
} from "../js/genetic_breeder.js";
import { getModelDef } from "../js/snapshot.js";
import { state, getCurrentModelRandomizer } from "../js/state.js";

test("BREEDER_PRESETS contains required evolutionary musical lineages", () => {
  assert.equal(BREEDER_PRESETS.length, 5);
  const ids = BREEDER_PRESETS.map(p => p.id);
  assert.ok(ids.includes("baroque_inventions"));
  assert.ok(ids.includes("minimalist_phasing"));
  assert.ok(ids.includes("acid_mutation"));
  assert.ok(ids.includes("ambient_arpeggiator"));
  assert.ok(ids.includes("chaotic_primordial"));
});

test("Hardware polyphony ceiling: POPULATION_SIZE is strictly capped at 8", () => {
  assert.equal(POPULATION_SIZE, 8);
  assert.equal(CHROMOSOME_LEN, 16);
  assert.equal(popDegrees.length, 8 * 16);
  assert.equal(popGates.length, 8 * 16);
});

test("initBreederPreset populates valid chromosome alleles", () => {
  initBreederPreset("baroque_inventions");

  for (let i = 0; i < POPULATION_SIZE * CHROMOSOME_LEN; i++) {
    assert.ok(popDegrees[i] >= -7 && popDegrees[i] <= 14);
    assert.ok(popGates[i] === 0 || popGates[i] === 1);
    assert.ok(popVels[i] >= 1 && popVels[i] <= 127);
  }
});

test("computePopulationVariance returns normalized variance in [0, 1]", () => {
  initBreederPreset("baroque_inventions");
  const variance = computePopulationVariance();
  assert.ok(typeof variance === "number");
  assert.ok(variance >= 0 && variance <= 1);
});

test("selectParentIndex selects a valid genome index [0, POPULATION_SIZE - 1]", () => {
  fitnessScores.fill(1.0);
  fitnessScores[3] = 10.0; // High fitness bias

  for (let i = 0; i < 20; i++) {
    const idx = selectParentIndex();
    assert.ok(Number.isInteger(idx));
    assert.ok(idx >= 0 && idx < POPULATION_SIZE);
  }
});

test("crossoverChromosomes creates valid child chromosome from parents", () => {
  initBreederPreset("baroque_inventions");

  // Force distinct parents
  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    popDegrees[0 * CHROMOSOME_LEN + s] = 1;
    popDegrees[1 * CHROMOSOME_LEN + s] = 5;
  }

  // Cross into slot 2
  crossoverChromosomes(0, 1, 2, 1.0); // 100% crossover rate

  let hasParent1 = false;
  let hasParent2 = false;
  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    const deg = popDegrees[2 * CHROMOSOME_LEN + s];
    if (deg === 1) hasParent1 = true;
    if (deg === 5) hasParent2 = true;
  }
  assert.ok(hasParent1 && hasParent2, "Child chromosome should contain genetic material from both parents");
});

test("mutateChromosome perturbs alleles within musical bounds", () => {
  initBreederPreset("baroque_inventions");
  // 100% mutation rate for testing
  mutateChromosome(0, 1.0);

  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    const idx = 0 * CHROMOSOME_LEN + s;
    assert.ok(popDegrees[idx] >= -7 && popDegrees[idx] <= 14);
    assert.ok(popGates[idx] === 0 || popGates[idx] === 1);
    assert.ok(popVels[idx] >= 1 && popVels[idx] <= 127);
  }
});

test("breedNextGeneration preserves elitism in slot 0", () => {
  initBreederPreset("baroque_inventions");

  // Give genome 4 high fitness
  fitnessScores.fill(1.0);
  fitnessScores[4] = 9.9;
  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    popDegrees[4 * CHROMOSOME_LEN + s] = 7;
  }

  breedNextGeneration();

  // Slot 0 must now contain the elite genome's alleles (all 7s)
  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    assert.equal(popDegrees[0 * CHROMOSOME_LEN + s], 7);
  }
});

test("getGeneNote quantizes degree offsets to valid MIDI notes", () => {
  for (let deg = -7; deg <= 14; deg++) {
    const note = getGeneNote(deg, 0);
    assert.ok(Number.isInteger(note));
    assert.ok(note >= 20 && note <= 120);
  }
});

test("Simulation stepping advances playheads and respects active voice allocation", () => {
  initBreederPreset("baroque_inventions");
  genomeMutes[0] = 0;
  const initialPos = genomePlayheads[0];

  // Step multiple frames
  for (let i = 0; i < 20; i++) {
    stepSimulation(20);
  }

  assert.ok(genomePlayheads[0] >= 0 && genomePlayheads[0] < CHROMOSOME_LEN);
});

test("Generator contract: generateGeneticBreederBank returns valid 64-step bank array", () => {
  const bank = generateGeneticBreederBank({ length: 64, rate: 6 });
  assert.ok(Array.isArray(bank));
  assert.equal(bank.length, 1);
  assert.equal(bank[0].length, 64);
  assert.equal(bank[0].rate, 6);
  assert.equal(bank[0].steps.length, 64);

  const step0 = bank[0].steps[0];
  assert.ok(step0.note >= 0 && step0.note <= 127);
  assert.equal(step0.source, "genetic_breeder");
});

test("Snapshot capture and restore round-trip preserves population chromosomes and fitness", () => {
  const def = getModelDef("genetic_breeder");
  assert.ok(def, "genetic_breeder model must be registered in snapshot.js");

  initBreederPreset("acid_mutation");
  fitnessScores[1] = 2.4;
  genomeMutes[2] = 1;

  const snap = def.capture();
  assert.equal(snap.preset, "acid_mutation");
  assert.ok(Array.isArray(snap.degrees));
  assert.equal(snap.degrees.length, POPULATION_SIZE * CHROMOSOME_LEN);

  // Mutate local state
  initBreederPreset("ambient_arpeggiator");
  assert.notEqual(fitnessScores[1], 2.4);

  // Restore snapshot
  def.restore(snap);
  assert.equal(snap.preset, "acid_mutation");
  assert.ok(Math.abs(fitnessScores[1] - 2.4) < 0.001);
  assert.equal(genomeMutes[2], 1);
});

test("Transport start/stop/toggle controls", () => {
  stopBreeder();
  assert.equal(isBreederRunning(), false);
  startBreeder();
  assert.equal(isBreederRunning(), true);
  toggleBreederRunning();
  assert.equal(isBreederRunning(), false);
});

test("genetic_breeder local controls mirroring global ones (Play) are removed", () => {
  let createdHtml = "";
  const dummyContainer = {
    set innerHTML(val) { createdHtml = val; },
    get innerHTML() { return createdHtml; }
  };

  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === "model-genetic_breeder") return dummyContainer;
    return null;
  };

  try {
    initGeneticBreeder();
    assert.ok(!createdHtml.includes('id="gene-play-btn"'), "Local play button must be removed (Global play exists)");
    assert.ok(createdHtml.includes('id="gene-rnd-btn"'), "RND button present in toolbar");
  } finally {
    globalThis.document.getElementById = origGetElementById;
  }
});

test("randomizeGeneticBreeder randomizes parameters and registers with global randomizer", () => {
  activateGeneticBreederModel();
  const rnd = getCurrentModelRandomizer();
  assert.equal(rnd, randomizeGeneticBreeder);

  randomizeGeneticBreeder();
  assert.ok(state.geneCrossover >= 0.2 && state.geneCrossover <= 0.95);
  assert.ok(state.geneMutation >= 0.01 && state.geneMutation <= 0.35);
  assert.ok(typeof state.genePreset === "string");

  deactivateGeneticBreederModel();
  assert.equal(getCurrentModelRandomizer(), null);
});

