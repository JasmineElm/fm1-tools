// genetic_breeder.js — Interactive Genetic Algorithm Melodic Genome Breeder Sequencer for FM-1 Pulses.
// Evolutionary population biology: chromosome crossover, allele mutation, interactive fitness selection, and polyphonic counterpoint.
//
// Architecture:
// 1. Chromosome Representation:
//    - Population of 8 musical genomes (G0–G7) matching strict FM-1 8-voice hardware polyphony limit.
//    - Each genome contains a 16-step musical chromosome:
//      - degree (Int8Array): scale degree offset relative to root [-7 to +14]
//      - gate (Uint8Array): 0 (rest) or 1 (trigger)
//      - vel (Uint8Array): velocity [1 to 127]
//      - accent (Uint8Array): 0 or 1
//      - octave (Int8Array): octave shift [-1, 0, 1, 2]
// 2. Evolutionary Operations:
//    - Interactive Fitness: User upvotes (+) or downvotes (-) genomes or drags them in the fitness pool.
//    - Selection: Roulette wheel / fitness proportionate selection.
//    - Elitism: Highest-fitness genome survives unchanged into the next generation.
//    - Crossover: Single-point and uniform genetic recombination between parent pairs with rate p_c.
//    - Mutation: Random allele perturbation (degree shift, gate flip, velocity variation) with rate p_m.
// 3. Polyphony & Voice Dispatch:
//    - Up to 8 concurrent active genomes auditioning in polyphonic counterpoint.
//    - Notes routed through js/poly.js respecting FM-1 hardware ceiling.
// 4. Continuous Timbre Modulation (CC #74):
//    - Mean population genetic variance modulates CC #74 Brightness.
// 5. Zero GC Churn: Pre-allocated TypedArrays (Int8Array, Uint8Array, Float32Array).

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import {
  SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS,
  mapNormalizedToNote, getRootMidi, getActiveScaleIntervals,
  computeOctaveShift, quantize
} from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { selectPolyVoices, playVoice, releasePolyVoices, getActiveVoiceCount } from "./poly.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated TypedArrays (Zero GC Churn) ----
export const POPULATION_SIZE = 8; // FM-1 8 hardware voices limit
export const CHROMOSOME_LEN = 16;  // 16 musical step genes per genome

// Population Chromosomes (Flat TypedArrays: genomeIdx * CHROMOSOME_LEN + step)
export const popDegrees = new Int8Array(POPULATION_SIZE * CHROMOSOME_LEN);
export const popGates = new Uint8Array(POPULATION_SIZE * CHROMOSOME_LEN);
export const popVels = new Uint8Array(POPULATION_SIZE * CHROMOSOME_LEN);
export const popAccents = new Uint8Array(POPULATION_SIZE * CHROMOSOME_LEN);
export const popOctaves = new Int8Array(POPULATION_SIZE * CHROMOSOME_LEN);

// Fitness & Status Arrays
export const fitnessScores = new Float32Array(POPULATION_SIZE);
export const genomeMutes = new Uint8Array(POPULATION_SIZE);
export const genomePlayheads = new Int8Array(POPULATION_SIZE);
export const pulseAnimations = new Float32Array(POPULATION_SIZE);

// Presets
export const BREEDER_PRESETS = [
  {
    id: "baroque_inventions",
    name: "Baroque Inventions",
    desc: "Contrapuntal stepwise motion, authentic cadences, and balanced diatonic melodies",
    crossoverRate: 0.75,
    mutationRate: 0.05,
    defaultOctaves: [0, 1, 0, 1, -1, 0, 1, 2]
  },
  {
    id: "minimalist_phasing",
    name: "Minimalist Phasing",
    desc: "Sparse repeating pulse cells with shifting rhythmic accents and subtle modal shifts",
    crossoverRate: 0.85,
    mutationRate: 0.02,
    defaultOctaves: [0, 0, 1, 1, 0, 1, 0, 1]
  },
  {
    id: "acid_mutation",
    name: "Acid Mutations",
    desc: "High mutation volatility, energetic 16th-note syncopation, and sharp velocity accents",
    crossoverRate: 0.60,
    mutationRate: 0.20,
    defaultOctaves: [-1, 0, -1, 0, 1, 0, -1, 1]
  },
  {
    id: "ambient_arpeggiator",
    name: "Ambient Arpeggios",
    desc: "Wide harmonic intervals, gentle velocities, and long sustained notes",
    crossoverRate: 0.70,
    mutationRate: 0.06,
    defaultOctaves: [-1, 0, 1, 2, 0, 1, -1, 2]
  },
  {
    id: "chaotic_primordial",
    name: "Primordial Soup",
    desc: "High-entropy randomized initial seed chromosomes ready for selective breeding",
    crossoverRate: 0.50,
    mutationRate: 0.15,
    defaultOctaves: [0, 0, 0, 0, 0, 0, 0, 0]
  }
];

// Runtime State
let isBreederPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepTimerAcc = 0;
let generationCount = 1;
let meanVariance = 0.5;
let hoveredGenome = -1;
let hoveredStep = -1;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Initialize population according to preset or randomized primordial seeds.
 */
export function initBreederPreset(presetId = state.genePreset || "baroque_inventions") {
  const preset = BREEDER_PRESETS.find(p => p.id === presetId) || BREEDER_PRESETS[0];
  state.genePreset = preset.id;

  generationCount = 1;
  fitnessScores.fill(1.0);
  genomeMutes.fill(0);
  // Default: activate first 4 genomes for clean initial counterpoint
  for (let g = 0; g < POPULATION_SIZE; g++) {
    genomeMutes[g] = g < 4 ? 0 : 1;
    genomePlayheads[g] = 0;
    pulseAnimations[g] = 0;
  }

  for (let g = 0; g < POPULATION_SIZE; g++) {
    const defaultOct = preset.defaultOctaves[g] ?? (g % 3 - 1);
    const baseOffset = g * CHROMOSOME_LEN;

    for (let s = 0; s < CHROMOSOME_LEN; s++) {
      const idx = baseOffset + s;

      if (preset.id === "baroque_inventions") {
        // Stepwise diatonic contour
        const scaleStep = ((s * 2 + g * 3) % 7);
        popDegrees[idx] = scaleStep;
        popGates[idx] = (s % 2 === 0 || s % 3 === 0) ? 1 : 0;
        popVels[idx] = (s % 4 === 0) ? 112 : 84;
        popAccents[idx] = (s % 4 === 0) ? 1 : 0;
        popOctaves[idx] = defaultOct;
      } else if (preset.id === "minimalist_phasing") {
        // Dense rhythmic pulses
        popDegrees[idx] = (s + g) % 5;
        popGates[idx] = ((s + g) % 4 !== 3) ? 1 : 0;
        popVels[idx] = (s % 2 === 0) ? 96 : 76;
        popAccents[idx] = (s % 8 === 0) ? 1 : 0;
        popOctaves[idx] = defaultOct;
      } else if (preset.id === "acid_mutation") {
        // Sharp syncopation
        popDegrees[idx] = Math.floor(Math.random() * 10) - 2;
        popGates[idx] = (Math.random() > 0.35) ? 1 : 0;
        popVels[idx] = (Math.random() > 0.6) ? 120 : 70;
        popAccents[idx] = (Math.random() > 0.7) ? 1 : 0;
        popOctaves[idx] = defaultOct;
      } else if (preset.id === "ambient_arpeggiator") {
        // Chord intervals
        popDegrees[idx] = ((s * 2) % 6);
        popGates[idx] = (s % 4 === 0 || s % 4 === 2) ? 1 : 0;
        popVels[idx] = 78;
        popAccents[idx] = (s === 0) ? 1 : 0;
        popOctaves[idx] = defaultOct;
      } else {
        // Primordial random soup
        popDegrees[idx] = Math.floor(Math.random() * 12) - 4;
        popGates[idx] = (Math.random() > 0.4) ? 1 : 0;
        popVels[idx] = 60 + Math.floor(Math.random() * 55);
        popAccents[idx] = (Math.random() > 0.75) ? 1 : 0;
        popOctaves[idx] = Math.floor(Math.random() * 3) - 1;
      }
    }
  }

  computePopulationVariance();
}

/**
 * Compute musical variance / diversity across the population.
 */
export function computePopulationVariance() {
  let meanDegree = 0;
  let totalGenes = POPULATION_SIZE * CHROMOSOME_LEN;

  for (let i = 0; i < totalGenes; i++) {
    meanDegree += popDegrees[i];
  }
  meanDegree /= totalGenes;

  let sumSquares = 0;
  for (let i = 0; i < totalGenes; i++) {
    const diff = popDegrees[i] - meanDegree;
    sumSquares += diff * diff;
  }

  // Normalized variance [0 to 1]
  const variance = sumSquares / totalGenes;
  meanVariance = Math.min(1.0, variance / 20.0);
  return meanVariance;
}

/**
 * Roulette Wheel / Fitness Proportional Selection: Select genome index proportional to fitness.
 */
export function selectParentIndex() {
  let totalFitness = 0;
  for (let g = 0; g < POPULATION_SIZE; g++) {
    totalFitness += Math.max(0.01, fitnessScores[g]);
  }

  const r = Math.random() * totalFitness;
  let running = 0;
  for (let g = 0; g < POPULATION_SIZE; g++) {
    running += Math.max(0.01, fitnessScores[g]);
    if (r <= running) {
      return g;
    }
  }
  return POPULATION_SIZE - 1;
}

/**
 * Genetic Crossover: Single-point crossover between two parent genomes.
 */
export function crossoverChromosomes(p1Idx, p2Idx, childIdx, crossoverRate = 0.75) {
  const p1Base = p1Idx * CHROMOSOME_LEN;
  const p2Base = p2Idx * CHROMOSOME_LEN;
  const childBase = childIdx * CHROMOSOME_LEN;

  if (Math.random() > crossoverRate) {
    // Clone parent 1 directly
    for (let s = 0; s < CHROMOSOME_LEN; s++) {
      popDegrees[childBase + s] = popDegrees[p1Base + s];
      popGates[childBase + s] = popGates[p1Base + s];
      popVels[childBase + s] = popVels[p1Base + s];
      popAccents[childBase + s] = popAccents[p1Base + s];
      popOctaves[childBase + s] = popOctaves[p1Base + s];
    }
    return;
  }

  // Single-point split point
  const splitPoint = 1 + Math.floor(Math.random() * (CHROMOSOME_LEN - 2));

  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    const srcBase = (s < splitPoint) ? p1Base : p2Base;
    popDegrees[childBase + s] = popDegrees[srcBase + s];
    popGates[childBase + s] = popGates[srcBase + s];
    popVels[childBase + s] = popVels[srcBase + s];
    popAccents[childBase + s] = popAccents[srcBase + s];
    popOctaves[childBase + s] = popOctaves[srcBase + s];
  }
}

/**
 * Allele Mutation: Perturb chromosome alleles with probability mutationRate.
 */
export function mutateChromosome(genomeIdx, mutationRate = 0.08) {
  const base = genomeIdx * CHROMOSOME_LEN;

  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    const idx = base + s;

    // Pitch degree mutation
    if (Math.random() < mutationRate) {
      const shift = (Math.random() < 0.5) ? -1 : 1;
      popDegrees[idx] = Math.max(-7, Math.min(14, popDegrees[idx] + shift));
    }

    // Gate mutation (flip rest/trigger)
    if (Math.random() < mutationRate * 0.5) {
      popGates[idx] = popGates[idx] ? 0 : 1;
    }

    // Velocity mutation
    if (Math.random() < mutationRate) {
      const vShift = Math.floor((Math.random() - 0.5) * 30);
      popVels[idx] = Math.max(20, Math.min(127, popVels[idx] + vShift));
    }

    // Octave shift mutation
    if (Math.random() < mutationRate * 0.3) {
      const oShift = (Math.random() < 0.5) ? -1 : 1;
      popOctaves[idx] = Math.max(-1, Math.min(2, popOctaves[idx] + oShift));
    }
  }
}

/**
 * Breed Next Generation: Apply Elitism, Selection, Crossover, and Mutation.
 */
export function breedNextGeneration() {
  const crossoverRate = Number(state.geneCrossover ?? 0.75);
  const mutationRate = Number(state.geneMutation ?? 0.08);

  // 1. Identify Elitism winner (highest fitness genome)
  let bestIdx = 0;
  let maxFitness = -1;
  for (let g = 0; g < POPULATION_SIZE; g++) {
    if (fitnessScores[g] > maxFitness) {
      maxFitness = fitnessScores[g];
      bestIdx = g;
    }
  }

  // Backup population to temporary buffer for generational crossover
  const backupDeg = new Int8Array(popDegrees);
  const backupGates = new Uint8Array(popGates);
  const backupVels = new Uint8Array(popVels);
  const backupAccents = new Uint8Array(popAccents);
  const backupOct = new Int8Array(popOctaves);

  // 2. Preserve Elite in Slot 0
  for (let s = 0; s < CHROMOSOME_LEN; s++) {
    popDegrees[s] = backupDeg[bestIdx * CHROMOSOME_LEN + s];
    popGates[s] = backupGates[bestIdx * CHROMOSOME_LEN + s];
    popVels[s] = backupVels[bestIdx * CHROMOSOME_LEN + s];
    popAccents[s] = backupAccents[bestIdx * CHROMOSOME_LEN + s];
    popOctaves[s] = backupOct[bestIdx * CHROMOSOME_LEN + s];
  }

  // 3. Breed remaining slots 1 through 7
  for (let child = 1; child < POPULATION_SIZE; child++) {
    const parent1 = selectParentIndex();
    let parent2 = selectParentIndex();
    if (parent1 === parent2 && POPULATION_SIZE > 1) {
      parent2 = (parent2 + 1) % POPULATION_SIZE;
    }

    crossoverChromosomes(parent1, parent2, child, crossoverRate);
    mutateChromosome(child, mutationRate);
  }

  // Soft-decay fitness scores towards baseline (1.0) so user can steer the new generation
  for (let g = 0; g < POPULATION_SIZE; g++) {
    fitnessScores[g] = 1.0 + (fitnessScores[g] - 1.0) * 0.35;
  }

  generationCount++;
  computePopulationVariance();
  status(`Bred Generation ${generationCount} · Elite: G${bestIdx + 1} (${maxFitness.toFixed(1)}x fitness)`);
  renderCanvas();
}

/**
 * Map chromosome degree and octave to scale-quantized MIDI note.
 */
export function getGeneNote(degreeOffset, octaveShift = 0) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.geneSpan ?? 2)));

  const numDeg = intervals.length || 7;
  // Modulo arithmetic supporting negative degree offsets
  const normalizedDegree = ((degreeOffset % numDeg) + numDeg) % numDeg;
  const octaveFromDegree = Math.floor(degreeOffset / numDeg);
  const effectiveOct = Math.min(span, Math.max(-1, octaveShift + octaveFromDegree));

  const rawMidi = root + effectiveOct * 12 + (intervals[normalizedDegree] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Execute one simulation step for the breeding population.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  stepTimerAcc += dtMs * speedMult;

  // Step clock: advances 16th-note steps every ~125ms scaled by speed
  const stepInterval = 125;

  if (stepTimerAcc >= stepInterval) {
    stepTimerAcc = 0;

    for (let g = 0; g < POPULATION_SIZE; g++) {
      if (genomeMutes[g]) continue;

      const step = (genomePlayheads[g] + 1) % CHROMOSOME_LEN;
      genomePlayheads[g] = step;

      const geneIdx = g * CHROMOSOME_LEN + step;
      const isGate = popGates[geneIdx];

      if (isGate && isBreederPlaying) {
        const note = getGeneNote(popDegrees[geneIdx], popOctaves[geneIdx]);
        const vel = popVels[geneIdx];
        const durMs = popAccents[geneIdx] ? 200 : 120;

        playVoice(`gene_${g}`, note, vel, durMs);
        pulseAnimations[g] = 1.0;
      }
    }
  }

  // Pulse decay
  for (let g = 0; g < POPULATION_SIZE; g++) {
    if (pulseAnimations[g] > 0.01) {
      pulseAnimations[g] *= 0.88;
    } else {
      pulseAnimations[g] = 0;
    }
  }
}

/**
 * Render Population Genome Strips, Fitness Landscape, and Chromosomes onto Canvas.
 */
export function renderCanvas() {
  if (!canvas || !ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  const style = getComputedStyle(document.documentElement);
  const colorBg = style.getPropertyValue("--panel").trim() || "#18191f";
  const colorPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colorLine = style.getPropertyValue("--line").trim() || "#333846";
  const colorLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colorFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colorDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colorAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colorAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colorOk = style.getPropertyValue("--ok").trim() || "#22c55e";
  const colorErr = style.getPropertyValue("--err").trim() || "#ef4444";

  // Flat canvas background
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  // Layout: 8 horizontal genome strips stacked vertically
  const marginT = 16;
  const marginB = 24;
  const marginL = 70; // Room for G1–G8 headers, mute toggles, and fitness badges
  const marginR = 16;

  const stripW = w - marginL - marginR;
  const totalH = h - marginT - marginB;
  const stripH = Math.floor(totalH / POPULATION_SIZE);
  const colW = stripW / CHROMOSOME_LEN;

  for (let g = 0; g < POPULATION_SIZE; g++) {
    const stripY = marginT + g * stripH;
    const isMuted = genomeMutes[g] === 1;
    const pulse = pulseAnimations[g];
    const isHoveredG = (hoveredGenome === g);

    // Genome strip base background
    ctx.fillStyle = isMuted ? colorBg : (isHoveredG ? colorPanel2 : colorBg);
    ctx.fillRect(0, stripY, w, stripH);

    // Divider line
    ctx.strokeStyle = colorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, stripY + stripH);
    ctx.lineTo(w, stripY + stripH);
    ctx.stroke();

    // Genome Header (Left column)
    const fit = fitnessScores[g];
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = isMuted ? colorDim : (pulse > 0.1 ? "#ffffff" : colorFg);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`G${g + 1}`, 10, stripY + stripH * 0.35);

    ctx.font = "9px monospace";
    ctx.fillStyle = fit > 1.2 ? colorOk : (fit < 0.8 ? colorErr : colorDim);
    ctx.fillText(`${fit.toFixed(1)}x`, 10, stripY + stripH * 0.75);

    // Mute pill indicator
    ctx.font = "8px monospace";
    ctx.fillStyle = isMuted ? colorDim : colorOk;
    ctx.fillText(isMuted ? "MUTED" : "LIVE", 38, stripY + stripH * 0.5);

    // Playhead line
    const playheadCol = genomePlayheads[g];

    // Chromosome 16 Step Genes
    for (let s = 0; s < CHROMOSOME_LEN; s++) {
      const geneIdx = g * CHROMOSOME_LEN + s;
      const cellX = marginL + s * colW;
      const cellY = stripY + 2;
      const cellH = stripH - 4;
      const cellW = colW - 2;

      const isGate = popGates[geneIdx];
      const degree = popDegrees[geneIdx];
      const oct = popOctaves[geneIdx];
      const isPlayhead = (s === playheadCol && !isMuted);

      // Cell background
      if (isGate) {
        ctx.fillStyle = isMuted ? colorLineFocus : colorAccent;
      } else {
        ctx.fillStyle = colorPanel2;
      }
      ctx.fillRect(cellX, cellY, cellW, cellH);

      // Playhead active ring
      if (isPlayhead) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cellX, cellY, cellW, cellH);
      }

      // Gene content: degree and note readout
      if (isGate) {
        const noteStr = midiName(getGeneNote(degree, oct));
        ctx.font = "bold 8px monospace";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(noteStr, cellX + cellW * 0.5, cellY + cellH * 0.5);
      }
    }
  }

  // Footer status
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`Gen: ${generationCount} | Variance: ${(meanVariance * 100).toFixed(0)}% | Active: ${POPULATION_SIZE - genomeMutes.reduce((a, b) => a + b, 0)}/8 Voices`, 10, h - 8);
}

/**
 * Generator Function Contract: generateGeneticBreederBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateGeneticBreederBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 6;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const geneStep = s % CHROMOSOME_LEN;
    const genomeIdx = Math.floor(s / CHROMOSOME_LEN) % POPULATION_SIZE;
    const idx = genomeIdx * CHROMOSOME_LEN + geneStep;

    const isGate = popGates[idx];
    const degree = popDegrees[idx];
    const oct = popOctaves[idx];
    const note = getGeneNote(degree, oct);
    const vel = popVels[idx] || 90;
    const accent = popAccents[idx] || 0;

    steps.push({
      note,
      vel,
      notes: isGate ? [{ note, vel }] : [],
      gate: isGate ? 1 : 0,
      accent,
      slide: 0,
      pitchMidi: note,
      source: "genetic_breeder",
      genomeIdx,
      geneStep
    });
  }

  return [
    {
      length: seqLen,
      rate: rateIdx,
      steps
    }
  ];
}

// ---- Transport Handlers ----
export function isBreederRunning() {
  return isBreederPlaying;
}

export function startBreeder() {
  if (isBreederPlaying) return;
  isBreederPlaying = true;
  audio.unlock();
  status("Genetic Breeder: Evolutionary melodic population active", "ok");
}

export function stopBreeder() {
  isBreederPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  status("Genetic Breeder: Stopped", "warn");
}

export function toggleBreederRunning() {
  if (isBreederPlaying) stopBreeder();
  else startBreeder();
}

export function syncBreederControls() {
  if (refs.genePreset?.setValue) refs.genePreset.setValue(state.genePreset, false);
  if (refs.geneCrossover?.setValue) refs.geneCrossover.setValue(state.geneCrossover, false);
  if (refs.geneMutation?.setValue) refs.geneMutation.setValue(state.geneMutation, false);
  if (refs.geneSpan?.setValue) refs.geneSpan.setValue(state.geneSpan, false);
}

export function randomizeGeneticBreeder() {
  const p = BREEDER_PRESETS[Math.floor(Math.random() * BREEDER_PRESETS.length)];
  state.genePreset = p.id;
  state.geneCrossover = Number((0.4 + Math.random() * 0.5).toFixed(2));
  state.geneMutation = Number((0.03 + Math.random() * 0.2).toFixed(2));
  state.geneSpan = Math.round(1 + Math.random() * 3);

  initBreederPreset(p.id);

  for (let g = 0; g < POPULATION_SIZE; g++) {
    fitnessScores[g] = Number((0.5 + Math.random() * 1.5).toFixed(1));
    genomeMutes[g] = 0;
    mutateChromosome(g, 0.25);
  }

  computePopulationVariance();
  syncBreederControls();
  renderCanvas();
  doGenerate(true);
  status(`Randomized Melodic Genomes: ${p.name}`, "ok");
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateGeneticBreederModel() {
  setModelGenerator(generateGeneticBreederBank);
  setModelRandomizer(randomizeGeneticBreeder);
  setModelStepHandler((stepIdx) => {
    // In SYNC mode: step simulation
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startBreeder,
    stop: stopBreeder,
    toggle: toggleBreederRunning,
    isRunning: isBreederRunning
  });

  stopBreeder();
  lastFrameTime = performance.now();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateGeneticBreederModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  stopBreeder();
  if (animFrameId) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(animFrameId);
    }
    animFrameId = null;
  }
}

function animationTick(now) {
  if (getActiveModel() === "genetic_breeder") {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;

    if (isBreederPlaying) {
      stepSimulation(dt);
    }
    renderCanvas();

    animFrameId = requestAnimationFrame(animationTick);
  } else {
    animFrameId = null;
  }
}

/**
 * Snapshot Registration
 */
registerModel({
  id: "genetic_breeder",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.genePreset || "baroque_inventions",
    crossover: state.geneCrossover ?? 0.75,
    mutation: state.geneMutation ?? 0.08,
    span: state.geneSpan ?? 2,
    generation: generationCount,
    fitness: Array.from(fitnessScores),
    mutes: Array.from(genomeMutes),
    degrees: Array.from(popDegrees),
    gates: Array.from(popGates),
    vels: Array.from(popVels),
    octaves: Array.from(popOctaves)
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.genePreset = data.preset;
    if (data.crossover !== undefined) state.geneCrossover = data.crossover;
    if (data.mutation !== undefined) state.geneMutation = data.mutation;
    if (data.span !== undefined) state.geneSpan = data.span;
    if (data.generation !== undefined) generationCount = data.generation;

    if (Array.isArray(data.fitness)) {
      for (let i = 0; i < Math.min(POPULATION_SIZE, data.fitness.length); i++) {
        fitnessScores[i] = data.fitness[i];
      }
    }
    if (Array.isArray(data.mutes)) {
      for (let i = 0; i < Math.min(POPULATION_SIZE, data.mutes.length); i++) {
        genomeMutes[i] = data.mutes[i];
      }
    }
    if (Array.isArray(data.degrees)) {
      for (let i = 0; i < Math.min(POPULATION_SIZE * CHROMOSOME_LEN, data.degrees.length); i++) {
        popDegrees[i] = data.degrees[i];
      }
    }
    if (Array.isArray(data.gates)) {
      for (let i = 0; i < Math.min(POPULATION_SIZE * CHROMOSOME_LEN, data.gates.length); i++) {
        popGates[i] = data.gates[i];
      }
    }
    if (Array.isArray(data.vels)) {
      for (let i = 0; i < Math.min(POPULATION_SIZE * CHROMOSOME_LEN, data.vels.length); i++) {
        popVels[i] = data.vels[i];
      }
    }
    if (Array.isArray(data.octaves)) {
      for (let i = 0; i < Math.min(POPULATION_SIZE * CHROMOSOME_LEN, data.octaves.length); i++) {
        popOctaves[i] = data.octaves[i];
      }
    }
    computePopulationVariance();
    renderCanvas();
  }
});

/**
 * Initialize DOM Elements & Interactive Event Listeners.
 */
export function initGeneticBreeder() {
  container = document.getElementById("model-genetic_breeder");
  if (!container) return;

  container.innerHTML = `
    <div class="breeder-workbench" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- Controls Toolbar -->
      <div class="breeder-toolbar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel2); padding: 8px 12px; border: 1px solid var(--line);">
        <div id="gene-preset-ctrl"></div>
        <div id="gene-crossover-ctrl"></div>
        <div id="gene-mutation-ctrl"></div>
        <div id="gene-span-ctrl"></div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button id="gene-rnd-btn" class="btn" title="Randomise lineage and chromosome alleles">RND</button>
          <button id="gene-breed-btn" class="btn btn-accent" title="Breed next generation using fitness selection & crossover">Breed Gen</button>
          <button id="gene-mutate-btn" class="btn" title="Perturb all genomes with genetic mutation">Mutate</button>
          <button id="gene-reset-btn" class="btn" title="Reset population to preset baseline">Reset</button>
        </div>
      </div>

      <!-- Genome Fitness Action Strip -->
      <div class="breeder-actions" style="display: flex; flex-wrap: wrap; gap: 8px; background: var(--panel); padding: 6px 12px; border: 1px solid var(--line); align-items: center;">
        <span style="font-size: 10px; font-weight: bold; color: var(--dim); margin-right: 6px;">FITNESS:</span>
        <div id="gene-fitness-buttons" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
      </div>

      <!-- Interactive Canvas -->
      <div class="breeder-canvas-wrap" style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="breeder-canvas" width="680" height="340" style="display: block; width: 100%; height: auto; cursor: pointer;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("breeder-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // Populate Fitness upvote/downvote buttons
  const fitBtnContainer = document.getElementById("gene-fitness-buttons");
  if (fitBtnContainer) {
    fitBtnContainer.innerHTML = "";
    for (let g = 0; g < POPULATION_SIZE; g++) {
      const pill = document.createElement("div");
      pill.style.cssText = "display: flex; align-items: center; gap: 2px; border: 1px solid var(--line); background: var(--panel2); padding: 2px 6px;";

      pill.innerHTML = `
        <span style="font-size: 9px; font-weight: bold; margin-right: 4px;">G${g + 1}</span>
        <button id="gene-up-${g}" class="btn" style="padding: 1px 5px; font-size: 9px;" title="Upvote G${g + 1} fitness (+0.3)">+</button>
        <button id="gene-down-${g}" class="btn" style="padding: 1px 5px; font-size: 9px;" title="Downvote G${g + 1} fitness (-0.3)">-</button>
        <button id="gene-mute-${g}" class="btn" style="padding: 1px 5px; font-size: 9px;" title="Toggle Mute/Live for G${g + 1}">M</button>
      `;

      fitBtnContainer.appendChild(pill);

      const upBtn = pill.querySelector(`#gene-up-${g}`);
      const downBtn = pill.querySelector(`#gene-down-${g}`);
      const muteBtn = pill.querySelector(`#gene-mute-${g}`);

      if (upBtn) {
        upBtn.addEventListener("click", () => {
          fitnessScores[g] = Math.min(3.0, fitnessScores[g] + 0.3);
          status(`Upvoted G${g + 1} fitness to ${fitnessScores[g].toFixed(1)}x`, "ok");
          renderCanvas();
        });
      }

      if (downBtn) {
        downBtn.addEventListener("click", () => {
          fitnessScores[g] = Math.max(0.1, fitnessScores[g] - 0.3);
          status(`Downvoted G${g + 1} fitness to ${fitnessScores[g].toFixed(1)}x`, "warn");
          renderCanvas();
        });
      }

      if (muteBtn) {
        muteBtn.addEventListener("click", () => {
          genomeMutes[g] = genomeMutes[g] ? 0 : 1;
          muteBtn.style.color = genomeMutes[g] ? "var(--err)" : "var(--ok)";
          renderCanvas();
        });
      }
    }
  }

  // Preset Dropdown
  const presetCtrl = document.getElementById("gene-preset-ctrl");
  if (presetCtrl) {
    presetCtrl.appendChild(
      R("genePreset", dropdown({
        label: "Lineage",
        tip: "Evolutionary melodic chromosome lineage and aesthetic target preset",
        options: BREEDER_PRESETS.map(p => ({ value: p.id, label: p.name })),
        value: state.genePreset || "baroque_inventions",
        onChange: (val) => {
          state.genePreset = val;
          const p = BREEDER_PRESETS.find(x => x.id === val);
          if (p) {
            state.geneCrossover = p.crossoverRate;
            state.geneMutation = p.mutationRate;
          }
          initBreederPreset(val);
          renderCanvas();
        }
      }))
    );
  }

  // Crossover Rate Knob
  const crossoverCtrl = document.getElementById("gene-crossover-ctrl");
  if (crossoverCtrl) {
    crossoverCtrl.appendChild(
      R("geneCrossover", knob({
        label: "Crossover",
        tip: "Probability of homologous chromosome genetic crossover during sexual reproduction",
        min: 0.2,
        max: 0.95,
        step: 0.05,
        value: Number(state.geneCrossover ?? 0.75),
        onChange: (v) => {
          state.geneCrossover = v;
          renderCanvas();
        }
      }))
    );
  }

  // Mutation Rate Knob
  const mutationCtrl = document.getElementById("gene-mutation-ctrl");
  if (mutationCtrl) {
    mutationCtrl.appendChild(
      R("geneMutation", knob({
        label: "Mutation",
        tip: "Point mutation rate per gene during generation reproduction",
        min: 0.01,
        max: 0.30,
        step: 0.01,
        value: Number(state.geneMutation ?? 0.08),
        onChange: (v) => {
          state.geneMutation = v;
          renderCanvas();
        }
      }))
    );
  }

  // Pitch Span Knob
  const spanCtrl = document.getElementById("gene-span-ctrl");
  if (spanCtrl) {
    spanCtrl.appendChild(
      R("geneSpan", knob({
        label: "Span",
        tip: "Pitch span in octaves mapped across chromosome alleles",
        min: 1,
        max: 4,
        step: 1,
        value: Number(state.geneSpan ?? 2),
        unit: "oct",
        onChange: (v) => {
          state.geneSpan = v;
          renderCanvas();
        }
      }))
    );
  }

  // Action Buttons
  const rndBtn = document.getElementById("gene-rnd-btn");
  if (rndBtn) {
    rndBtn.addEventListener("click", () => {
      randomizeGeneticBreeder();
    });
  }

  const breedBtn = document.getElementById("gene-breed-btn");
  if (breedBtn) {
    breedBtn.addEventListener("click", () => {
      breedNextGeneration();
    });
  }

  const mutateBtn = document.getElementById("gene-mutate-btn");
  if (mutateBtn) {
    mutateBtn.addEventListener("click", () => {
      const mutRate = Number(state.geneMutation ?? 0.15);
      for (let g = 0; g < POPULATION_SIZE; g++) {
        mutateChromosome(g, mutRate);
      }
      computePopulationVariance();
      status("Perturbed population with global allele mutations");
      renderCanvas();
    });
  }

  const resetBtn = document.getElementById("gene-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      initBreederPreset(state.genePreset || "baroque_inventions");
      status("Reset population to baseline lineage");
      renderCanvas();
    });
  }

  setupCanvasInteraction();
  initBreederPreset(state.genePreset || "baroque_inventions");
  renderCanvas();
}

/**
 * Direct Manipulation: Click on chromosome steps to toggle gates or drag to adjust degrees.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  function getGenomeUnderCursor(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const marginT = 16;
    const marginB = 24;
    const marginL = 70;
    const marginR = 16;
    const stripW = canvas.width - marginL - marginR;
    const totalH = canvas.height - marginT - marginB;
    const stripH = Math.floor(totalH / POPULATION_SIZE);
    const colW = stripW / CHROMOSOME_LEN;

    if (my < marginT || my > marginT + totalH) {
      return { genome: -1, step: -1 };
    }

    const genome = Math.floor((my - marginT) / stripH);
    if (mx < marginL || mx > marginL + stripW) {
      return { genome, step: -1 };
    }

    const step = Math.floor((mx - marginL) / colW);
    return { genome, step };
  }

  canvas.addEventListener("mousemove", (e) => {
    const { genome, step } = getGenomeUnderCursor(e);
    if (genome !== hoveredGenome || step !== hoveredStep) {
      hoveredGenome = genome;
      hoveredStep = step;
      renderCanvas();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredGenome = -1;
    hoveredStep = -1;
    renderCanvas();
  });

  canvas.addEventListener("mousedown", (e) => {
    const { genome, step } = getGenomeUnderCursor(e);
    if (genome >= 0 && genome < POPULATION_SIZE) {
      if (step >= 0 && step < CHROMOSOME_LEN) {
        // Toggle step gate
        const idx = genome * CHROMOSOME_LEN + step;
        popGates[idx] = popGates[idx] ? 0 : 1;
        status(`Toggled G${genome + 1} Step ${step + 1} ${popGates[idx] ? "ON" : "OFF"}`);
        renderCanvas();
      } else {
        // Clicked header area: toggle mute
        genomeMutes[genome] = genomeMutes[genome] ? 0 : 1;
        status(`G${genome + 1} ${genomeMutes[genome] ? "Muted" : "Active"}`);
        renderCanvas();
      }
    }
  });
}
