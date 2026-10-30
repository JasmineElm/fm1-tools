// js/nodal_graph.js — Nodal Directed Graph Sequencer Model
// Probabilistic directed state graph with weighted branching edges, variable edge traversal durations, and multi-walker polyphony.

import {
  state, refs, status, doGenerate, RATE_NAMES, setModelGenerator,
  setModelRandomizer
} from "./state.js";
import { panicPreview } from "./player.js";
import { knob, dropdown, toggleBtn, actionBtn } from "./controls.js";
import { getRootMidi, getActiveScaleIntervals, quantize, midiName } from "./scale.js";
import { playVoice, releasePolyVoices } from "./poly.js";
import { registerModel } from "./snapshot.js";
import * as audio from "./audio.js";

export const MAX_NODES = 24;
export const MAX_WALKERS = 8;
export const MAX_VOICES = 8;
export const MAX_EDGES_PER_NODE = 6;

export const WALKER_COLORS = [
  "#00f0ff", // Walker 1: Cyan
  "#ff007f", // Walker 2: Pink
  "#ffb700", // Walker 3: Amber
  "#39ff14", // Walker 4: Lime
  "#a855f7", // Walker 5: Violet
  "#38bdf8", // Walker 6: Sky
  "#f43f5e", // Walker 7: Rose
  "#eab308"  // Walker 8: Gold
];

export const GRAPH_PRESETS = [
  {
    id: "cycle_chords",
    name: "Chordal Cycles",
    desc: "Cyclic ring with diatonic leaps (circle of fifths & thirds)",
    nodes: 12,
    walkers: 3,
    speed: 1.0,
    entropy: 0.20,
    density: 1.0,
    gate: 0.75
  },
  {
    id: "hierarchical_tree",
    name: "Branching Tree",
    desc: "Root-to-leaves cascade with probabilistic cadence returns",
    nodes: 15,
    walkers: 3,
    speed: 1.1,
    entropy: 0.15,
    density: 1.0,
    gate: 0.70
  },
  {
    id: "scale_free",
    name: "Hub Network",
    desc: "Scale-free topology with central melodic anchor hubs",
    nodes: 16,
    walkers: 4,
    speed: 1.0,
    entropy: 0.30,
    density: 1.1,
    gate: 0.80
  },
  {
    id: "de_bruijn",
    name: "De Bruijn Shift",
    desc: "Overlapping binary shift register graph with hypnotic ostinatos",
    nodes: 16,
    walkers: 3,
    speed: 1.25,
    entropy: 0.10,
    density: 1.2,
    gate: 0.65
  },
  {
    id: "random_dag",
    name: "Forward DAG",
    desc: "Directed acyclic graph with weighted leaps and loopbacks",
    nodes: 14,
    walkers: 3,
    speed: 0.95,
    entropy: 0.35,
    density: 1.0,
    gate: 0.85
  }
];

// Pre-allocated simulation buffers (Zero GC Churn)
export const nodeX = new Float32Array(MAX_NODES);
export const nodeY = new Float32Array(MAX_NODES);
export const nodeRadius = new Float32Array(MAX_NODES);
export const nodeInDegree = new Uint8Array(MAX_NODES);
export const nodePulse = new Float32Array(MAX_NODES);
export const nodePulseColor = new Array(MAX_NODES).fill("#3b82f6");
export const nodeSparkNote = new Array(MAX_NODES).fill("");

// Adjacency lists: node i has edgeCount[i] edges, stored at i * MAX_EDGES_PER_NODE + k
export const edgeTarget = new Int16Array(MAX_NODES * MAX_EDGES_PER_NODE);
export const edgeWeight = new Float32Array(MAX_NODES * MAX_EDGES_PER_NODE);
export const edgeLength = new Float32Array(MAX_NODES * MAX_EDGES_PER_NODE);
export const edgeCount = new Uint8Array(MAX_NODES);

// Walker states (1..8)
export const walkerNode = new Int16Array(MAX_WALKERS);
export const walkerTarget = new Int16Array(MAX_WALKERS);
export const walkerProgress = new Float32Array(MAX_WALKERS); // 0.0 to 1.0
export const walkerSpeed = new Float32Array(MAX_WALKERS);
export const walkerWait = new Float32Array(MAX_WALKERS);
export const walkerActive = new Uint8Array(MAX_WALKERS);

let isGraphPlaying = false;
let animFrameId = null;
let lastTimestamp = 0;
let activeNodeCount = 12;

// Canvas & UI elements
let canvasEl = null;
let ctx = null;
let hudElement = null;
let graphContainer = null;
let presetSelectEl = null;
let draggedNode = -1;
let dragHoverNode = -1;

export function isNodalGraphRunning() {
  return isGraphPlaying;
}

export function startNodalGraph() {
  if (isGraphPlaying) return;
  isGraphPlaying = true;
  lastTimestamp = performance.now();
  status("Nodal Graph: Running", "ok");
}

export function stopNodalGraph() {
  isGraphPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  status("stopped");
}

export function toggleNodalGraphRunning() {
  if (isGraphPlaying) {
    stopNodalGraph();
    return false;
  } else {
    startNodalGraph();
    return true;
  }
}

/**
 * Clear edges and reset topology buffers.
 */
function clearGraphTopology() {
  edgeCount.fill(0);
  edgeTarget.fill(-1);
  edgeWeight.fill(0);
  edgeLength.fill(1.0);
  nodeInDegree.fill(0);
}

/**
 * Add a directed edge from u to v.
 */
function addDirectedEdge(u, v, weight = 1.0, length = 1.0) {
  if (u < 0 || u >= MAX_NODES || v < 0 || v >= MAX_NODES) return;
  const count = edgeCount[u];
  if (count >= MAX_EDGES_PER_NODE) return;

  const idx = u * MAX_EDGES_PER_NODE + count;
  edgeTarget[idx] = v;
  edgeWeight[idx] = weight;
  edgeLength[idx] = length;
  edgeCount[u] = count + 1;
  nodeInDegree[v] = Math.min(255, nodeInDegree[v] + 1);
}

/**
 * Initialize graph topology according to the selected preset.
 */
export function initNodalGraphSystem(presetOrNodes = state.nodalGraphPreset || "cycle_chords", optSpeed, optPreset) {
  let presetId = presetOrNodes;
  if (typeof presetOrNodes === "number") {
    state.nodalGraphNodes = Math.max(6, Math.min(MAX_NODES, presetOrNodes));
    if (typeof optSpeed === "number") state.nodalGraphSpeed = optSpeed;
    if (typeof optPreset === "string") presetId = optPreset;
    else presetId = state.nodalGraphPreset || "cycle_chords";
  }

  const p = GRAPH_PRESETS.find(pr => pr.id === presetId) || GRAPH_PRESETS[0];
  state.nodalGraphPreset = p.id;
  if (state.nodalGraphNodes === undefined) state.nodalGraphNodes = p.nodes;
  if (state.nodalGraphWalkers === undefined) state.nodalGraphWalkers = p.walkers;
  if (state.nodalGraphSpeed === undefined) state.nodalGraphSpeed = p.speed;
  if (state.nodalGraphEntropy === undefined) state.nodalGraphEntropy = p.entropy;
  if (state.nodalGraphDensity === undefined) state.nodalGraphDensity = p.density;
  if (state.nodalGraphGate === undefined) state.nodalGraphGate = p.gate;
  if (state.nodalGraphOctave === undefined) state.nodalGraphOctave = 0;

  activeNodeCount = Math.max(6, Math.min(MAX_NODES, state.nodalGraphNodes || p.nodes));
  const numWalkers = Math.max(1, Math.min(MAX_WALKERS, state.nodalGraphWalkers || p.walkers));

  clearGraphTopology();

  // Reset pulses and dimensions
  for (let i = 0; i < MAX_NODES; i++) {
    nodeRadius[i] = 0.042;
    nodePulse[i] = 0.0;
    nodeSparkNote[i] = "";
  }

  // Build topology layouts
  if (p.id === "cycle_chords") {
    // 12-node circular ring with major/minor chord leap edges
    const N = activeNodeCount;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      nodeX[i] = 0.5 + Math.cos(angle) * 0.38;
      nodeY[i] = 0.5 + Math.sin(angle) * 0.38;

      // Primary ring advance: step to adjacent clockwise node
      addDirectedEdge(i, (i + 1) % N, 0.60, 1.0);
      // Diatonic leaps: major third (+4) and perfect fifth (+7)
      addDirectedEdge(i, (i + 4) % N, 0.25, 1.5);
      addDirectedEdge(i, (i + 7) % N, 0.15, 2.0);
    }
  } else if (p.id === "hierarchical_tree") {
    // Binary branching tree: Root -> Layer 1 -> Layer 2 -> Leaves
    const N = activeNodeCount;
    nodeX[0] = 0.5;
    nodeY[0] = 0.15; // Root

    let nodeIdx = 1;
    let layer = 1;
    let layerCount = 2;
    const layerIndices = [[0]];

    while (nodeIdx < N) {
      const currentLayer = [];
      const count = Math.min(layerCount, N - nodeIdx);
      const y = 0.15 + layer * (0.70 / 3.2);

      for (let c = 0; c < count; c++) {
        const x = 0.15 + (c + 0.5) * (0.70 / count);
        nodeX[nodeIdx] = x;
        nodeY[nodeIdx] = y;
        currentLayer.push(nodeIdx);
        nodeIdx++;
      }
      layerIndices.push(currentLayer);
      layer++;
      layerCount *= 2;
    }

    // Connect parent to children
    for (let l = 0; l < layerIndices.length - 1; l++) {
      const parents = layerIndices[l];
      const children = layerIndices[l + 1];
      for (let i = 0; i < children.length; i++) {
        const pIdx = parents[Math.floor(i / 2) % parents.length];
        addDirectedEdge(pIdx, children[i], 0.70, 1.0);
      }
    }

    // Connect leaves and middle nodes back to root or higher cadences
    const lastLayer = layerIndices[layerIndices.length - 1];
    for (const leaf of lastLayer) {
      addDirectedEdge(leaf, 0, 0.55, 1.0); // Return to root cadence
      const randomMid = Math.floor(Math.random() * (N - 1)) + 1;
      addDirectedEdge(leaf, randomMid, 0.45, 1.5);
    }
  } else if (p.id === "scale_free") {
    // Scale-Free Hub Network (Barabási–Albert style)
    const N = activeNodeCount;
    // Central hubs (0 and 1)
    nodeX[0] = 0.42; nodeY[0] = 0.50;
    nodeX[1] = 0.58; nodeY[1] = 0.50;
    addDirectedEdge(0, 1, 0.5, 1.0);
    addDirectedEdge(1, 0, 0.5, 1.0);

    for (let i = 2; i < N; i++) {
      const angle = ((i - 2) / (N - 2)) * Math.PI * 2;
      const dist = 0.28 + ((i % 3) * 0.06);
      nodeX[i] = 0.5 + Math.cos(angle) * dist;
      nodeY[i] = 0.5 + Math.sin(angle) * dist;

      // Preferential attachment to hubs 0 or 1
      const mainHub = i % 2 === 0 ? 0 : 1;
      const altHub = 1 - mainHub;
      addDirectedEdge(i, mainHub, 0.65, 1.0);
      addDirectedEdge(mainHub, i, 0.50, 1.2);

      // Sibling ring edge
      const nextSibling = 2 + ((i - 1) % (N - 2));
      addDirectedEdge(i, nextSibling, 0.35, 1.5);
      if (Math.random() < 0.4) {
        addDirectedEdge(i, altHub, 0.30, 2.0);
      }
    }
  } else if (p.id === "de_bruijn") {
    // 16-node De Bruijn shift register graph
    const N = Math.min(16, activeNodeCount);
    for (let i = 0; i < N; i++) {
      // 4-bit state: b3 b2 b1 b0
      const col = i % 4;
      const row = Math.floor(i / 4);
      nodeX[i] = 0.20 + (col / 3) * 0.60;
      nodeY[i] = 0.20 + (row / 3) * 0.60;

      // Transitions: shift left and append 0 or 1: (i << 1) & 0x0F | bit
      const next0 = ((i << 1) | 0) & 0x0F;
      const next1 = ((i << 1) | 1) & 0x0F;

      addDirectedEdge(i, next0 % N, 0.55, 1.0);
      addDirectedEdge(i, next1 % N, 0.45, 1.0);
    }
  } else if (p.id === "random_dag") {
    // Forward Directed Acyclic Graph + cadence loopbacks
    const N = activeNodeCount;
    for (let i = 0; i < N; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      nodeX[i] = 0.15 + (i / (N - 1)) * 0.70;
      nodeY[i] = 0.30 + ((i % 3) - 1) * 0.20 + Math.sin(i * 1.5) * 0.08;

      // Forward edges
      if (i + 1 < N) addDirectedEdge(i, i + 1, 0.55, 1.0);
      if (i + 2 < N) addDirectedEdge(i, i + 2, 0.35, 1.5);
      if (i + 3 < N) addDirectedEdge(i, i + 3, 0.20, 2.0);

      // Sinks loop back to early nodes
      if (i >= N - 3) {
        addDirectedEdge(i, 0, 0.50, 1.0);
        addDirectedEdge(i, 1, 0.30, 1.5);
        addDirectedEdge(i, 2, 0.20, 2.0);
      }
    }
  }

  // Position walkers at distinct starting nodes
  for (let w = 0; w < MAX_WALKERS; w++) {
    walkerActive[w] = w < numWalkers ? 1 : 0;
    const startNode = (w * 3) % activeNodeCount;
    walkerNode[w] = startNode;
    walkerTarget[w] = pickNextNode(startNode, state.nodalGraphEntropy || 0.2);
    walkerProgress[w] = (w / numWalkers);
    walkerSpeed[w] = 0.8 + (w % 3) * 0.25;
    walkerWait[w] = 0.0;
  }
}

/**
 * Pick the next directed node transition based on edge weights and entropy.
 */
function pickNextNode(fromNode, entropy = 0.2) {
  const count = edgeCount[fromNode];
  if (count === 0) {
    // Dead-end: pick random valid node
    return (fromNode + 1) % activeNodeCount;
  }
  if (count === 1) {
    return edgeTarget[fromNode * MAX_EDGES_PER_NODE];
  }

  const baseOffset = fromNode * MAX_EDGES_PER_NODE;

  // Temperature / entropy softmax weighting
  let totalW = 0;
  const weights = [];
  for (let k = 0; k < count; k++) {
    const rawW = edgeWeight[baseOffset + k];
    // Modulate raw weight by entropy (at entropy = 1.0, all edges equally probable)
    const modulated = Math.pow(Math.max(0.01, rawW), 1.0 - entropy * 0.85);
    weights.push(modulated);
    totalW += modulated;
  }

  const r = Math.random() * totalW;
  let accum = 0;
  for (let k = 0; k < count; k++) {
    accum += weights[k];
    if (r <= accum) {
      return edgeTarget[baseOffset + k];
    }
  }

  return edgeTarget[baseOffset];
}

/**
 * Resolves pitch from node index and coordinates, quantized to scale.
 */
export function getNodalGraphNote(nodeIdx, walkerIdx = 0, octaveShift = 0) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.max(1, Math.min(4, state.pitchSpan || 2));
  const modelOctave = (state.nodalGraphOctave || 0) * 12;
  const optOctave = octaveShift * 12;

  // Compute polar angle around graph center [0, 1)
  const dx = nodeX[nodeIdx] - 0.5;
  const dy = nodeY[nodeIdx] - 0.5;
  const angle = Math.atan2(dy, dx);
  const normAngle = ((angle + Math.PI) / (Math.PI * 2) + 1.0) % 1.0;

  // Walker offset provides harmonic counterpoint
  const walkerOffset = (walkerIdx % 3 === 1) ? 4 : ((walkerIdx % 3 === 2) ? 7 : 0);

  const rawMidi = root + Math.floor(normAngle * span * 12) + modelOctave + optOctave + walkerOffset;
  return quantize(rawMidi, intervals, root);
}

/**
 * Step simulation mechanics by dt seconds.
 */
export function stepNodalGraphSimulation(dt = 0.016) {
  const numWalkers = Math.max(1, Math.min(MAX_WALKERS, state.nodalGraphWalkers || 3));
  const simSpeed = Math.max(0.1, Math.min(3.0, (state.nodalGraphSpeed || 1.0) * (state.modelSpeed || 1.0)));
  const entropy = Math.max(0.0, Math.min(1.0, state.nodalGraphEntropy || 0.2));
  const density = Math.max(0.2, Math.min(3.0, state.nodalGraphDensity || 1.0));
  const gateMult = Math.max(0.1, Math.min(1.0, state.nodalGraphGate || 0.75));

  let anyTriggered = false;

  for (let w = 0; w < numWalkers; w++) {
    if (!walkerActive[w]) continue;

    // Advance walker along its active edge
    const edgeStep = (dt * simSpeed * walkerSpeed[w] * density * 1.35);
    walkerProgress[w] += edgeStep;

    if (walkerProgress[w] >= 1.0) {
      // Arrived at target node!
      const arrivedNode = walkerTarget[w];
      walkerNode[w] = arrivedNode;
      walkerProgress[w] = 0.0;

      // Pick next target node
      const nextTarget = pickNextNode(arrivedNode, entropy);
      walkerTarget[w] = nextTarget;

      // Trigger note on arrival
      if (isGraphPlaying) {
        const inDeg = nodeInDegree[arrivedNode] || 1;
        const vel = Math.max(30, Math.min(127, Math.round(55 + inDeg * 14 + walkerSpeed[w] * 20)));
        const durMs = Math.max(60, Math.min(500, Math.round(140 * gateMult * (1.0 / density))));
        const note = getNodalGraphNote(arrivedNode, w, 0);

        playVoice(w, note, vel, durMs);
        anyTriggered = true;

        nodePulse[arrivedNode] = 1.0;
        nodePulseColor[arrivedNode] = WALKER_COLORS[w % WALKER_COLORS.length];
        nodeSparkNote[arrivedNode] = midiName(note);
      }
    }
  }

  // Decay visual pulse rings
  for (let i = 0; i < activeNodeCount; i++) {
    if (nodePulse[i] > 0) {
      nodePulse[i] = Math.max(0, nodePulse[i] - dt * 3.5);
    }
  }

  return { triggered: anyTriggered };
}

/**
 * Generator Function Contract: generateNodalGraphBank(state)
 * Deterministically steps the graph into a valid 64-step bank array conforming to FM-1 Pulses standard.
 */
export function generateNodalGraphBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st.length || 64));
  const rate = RATE_NAMES[st.rate] || "1/16";
  const numWalkers = Math.max(1, Math.min(MAX_WALKERS, st.nodalGraphWalkers || 3));
  const octaveShift = st.nodalGraphOctave || 0;

  const steps = [];

  // Deterministically traverse graph steps
  let simNode = 0;
  for (let s = 0; s < seqLen; s++) {
    const walkerIdx = s % numWalkers;
    const note = getNodalGraphNote(simNode, walkerIdx, octaveShift);
    const inDeg = nodeInDegree[simNode] || 1;
    const vel = Math.max(35, Math.min(127, Math.round(60 + inDeg * 12 + Math.sin(s * 0.8) * 35)));

    steps.push({
      note,
      vel,
      gate: 0.75,
      skip: false,
      notes: [{ note, vel }]
    });

    // Advance to next edge target
    const count = edgeCount[simNode];
    if (count > 0) {
      const edgeIdx = (s + (st.seed || 1)) % count;
      simNode = edgeTarget[simNode * MAX_EDGES_PER_NODE + edgeIdx];
    } else {
      simNode = (simNode + 1) % activeNodeCount;
    }
  }

  return [{
    length: seqLen,
    rate,
    steps
  }];
}

export function randomizeNodalGraph() {
  const presetKeys = GRAPH_PRESETS.map(p => p.id);
  const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];
  state.nodalGraphPreset = randomPreset;
  state.nodalGraphWalkers = Math.floor(Math.random() * 5) + 2; // 2..6
  state.nodalGraphSpeed = parseFloat((0.65 + Math.random() * 1.1).toFixed(2));
  state.nodalGraphEntropy = parseFloat((0.10 + Math.random() * 0.50).toFixed(2));
  state.nodalGraphDensity = parseFloat((0.80 + Math.random() * 0.60).toFixed(2));
  state.nodalGraphOctave = Math.floor(Math.random() * 3) - 1; // -1, 0, 1

  initNodalGraphSystem(randomPreset);

  if (presetSelectEl) presetSelectEl.value = randomPreset;
  syncControlsFromState();
  renderNodalGraphCanvas();
  updateHud();

  status(`Nodal Graph: Randomised · ${randomPreset}`, "ok");
}

function syncControlsFromState() {
  if (refs.nodalGraphWalkers?.setValue) refs.nodalGraphWalkers.setValue(state.nodalGraphWalkers, false);
  if (refs.nodalGraphSpeed?.setValue) refs.nodalGraphSpeed.setValue(state.nodalGraphSpeed, false);
  if (refs.nodalGraphEntropy?.setValue) refs.nodalGraphEntropy.setValue(state.nodalGraphEntropy, false);
  if (refs.nodalGraphDensity?.setValue) refs.nodalGraphDensity.setValue(state.nodalGraphDensity, false);
  if (refs.nodalGraphOctave?.setValue) refs.nodalGraphOctave.setValue(state.nodalGraphOctave, false);
}

function updateHud() {
  if (!hudElement) return;
  const numWalkers = state.nodalGraphWalkers || 3;
  const preset = state.nodalGraphPreset || "cycle_chords";
  hudElement.textContent = `${preset.toUpperCase()} · ${numWalkers} WALKERS · SPEED ${state.nodalGraphSpeed || 1.0}x`;
}

/**
 * Render the graph nodes, directed edges, flowing walker tokens, and pulse rings.
 */
export function renderNodalGraphCanvas() {
  if (!canvasEl || !ctx) return;

  const width = canvasEl.width;
  const height = canvasEl.height;

  // Dynamic semantic color tokens
  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue("--panel").trim() || "#18191f";
  const panel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const line = style.getPropertyValue("--line").trim() || "#333846";
  const fg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const dim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const accent = style.getPropertyValue("--accent").trim() || "#3b82f6";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 1. Draw directed edges
  ctx.lineWidth = 1.5;
  for (let u = 0; u < activeNodeCount; u++) {
    const count = edgeCount[u];
    const uX = nodeX[u] * width;
    const uY = nodeY[u] * height;

    for (let k = 0; k < count; k++) {
      const v = edgeTarget[u * MAX_EDGES_PER_NODE + k];
      if (v < 0 || v >= activeNodeCount) continue;

      const vX = nodeX[v] * width;
      const vY = nodeY[v] * height;

      // Draw subtle edge line
      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.moveTo(uX, uY);
      ctx.lineTo(vX, vY);
      ctx.stroke();

      // Draw directional arrowhead midpoint
      const midX = (uX + vX) * 0.5;
      const midY = (uY + vY) * 0.5;
      const angle = Math.atan2(vY - uY, vX - uX);
      const arrowSize = 6;

      ctx.fillStyle = dim;
      ctx.beginPath();
      ctx.moveTo(midX + Math.cos(angle) * arrowSize, midY + Math.sin(angle) * arrowSize);
      ctx.lineTo(midX + Math.cos(angle + 2.5) * arrowSize, midY + Math.sin(angle + 2.5) * arrowSize);
      ctx.lineTo(midX + Math.cos(angle - 2.5) * arrowSize, midY + Math.sin(angle - 2.5) * arrowSize);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 2. Draw nodes and pulse highlights
  for (let i = 0; i < activeNodeCount; i++) {
    const nx = nodeX[i] * width;
    const ny = nodeY[i] * height;
    const r = nodeRadius[i] * Math.min(width, height);

    // Pulse animation ring
    if (nodePulse[i] > 0) {
      const pulseR = r + nodePulse[i] * 18;
      ctx.strokeStyle = nodePulseColor[i];
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(nx, ny, pulseR, 0, Math.PI * 2);
      ctx.stroke();

      // Note name banner
      if (nodeSparkNote[i]) {
        ctx.fillStyle = fg;
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(nodeSparkNote[i], nx, ny - r - 6);
      }
    }

    // Node body
    ctx.fillStyle = (i === dragHoverNode) ? line : panel2;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.fill();

    // Node border
    ctx.strokeStyle = (i === draggedNode) ? accent : line;
    ctx.lineWidth = (i === draggedNode) ? 2.5 : 1.5;
    ctx.stroke();

    // In-degree label
    ctx.fillStyle = dim;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${i}`, nx, ny);
  }

  // 3. Draw walkers traversing edges
  const numWalkers = Math.max(1, Math.min(MAX_WALKERS, state.nodalGraphWalkers || 3));
  for (let w = 0; w < numWalkers; w++) {
    if (!walkerActive[w]) continue;

    const u = walkerNode[w];
    const v = walkerTarget[w];
    if (u < 0 || u >= activeNodeCount || v < 0 || v >= activeNodeCount) continue;

    const uX = nodeX[u] * width;
    const uY = nodeY[u] * height;
    const vX = nodeX[v] * width;
    const vY = nodeY[v] * height;

    const prog = walkerProgress[w];
    const wx = uX + (vX - uX) * prog;
    const wy = uY + (vY - uY) * prog;

    // Draw walker token
    const color = WALKER_COLORS[w % WALKER_COLORS.length];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(wx, wy, 6.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function animLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = Math.min(0.1, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;

  stepNodalGraphSimulation(dt);
  renderNodalGraphCanvas();

  animFrameId = requestAnimationFrame(animLoop);
}

export function initNodalGraph() {
  graphContainer = document.getElementById("model-nodal_graph");
  if (!graphContainer) return;

  graphContainer.innerHTML = "";
  graphContainer.className = "model-view nodal-graph-workbench";

  // Build Layout Structure
  const layout = document.createElement("div");
  layout.className = "nodal-graph-layout";
  layout.style.display = "flex";
  layout.style.flexDirection = "column";
  layout.style.gap = "8px";
  layout.style.padding = "10px";

  // Header / Status Banner
  const header = document.createElement("div");
  header.className = "nodal-graph-header";
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";

  hudElement = document.createElement("div");
  hudElement.className = "nodal-graph-hud";
  hudElement.style.fontFamily = "monospace";
  hudElement.style.fontSize = "11px";
  hudElement.style.color = "var(--dim)";
  hudElement.textContent = "CHORDAL CYCLES · 3 WALKERS · SPEED 1.0x";

  header.append(hudElement);

  // Interactive Canvas
  const canvasContainer = document.createElement("div");
  canvasContainer.className = "nodal-graph-canvas-wrap";
  canvasContainer.style.position = "relative";
  canvasContainer.style.width = "100%";
  canvasContainer.style.height = "380px";
  canvasContainer.style.background = "var(--panel)";
  canvasContainer.style.border = "1px solid var(--line)";
  canvasContainer.style.borderRadius = "4px";
  canvasContainer.style.overflow = "hidden";

  canvasEl = document.createElement("canvas");
  canvasEl.width = 720;
  canvasEl.height = 380;
  canvasEl.style.width = "100%";
  canvasEl.style.height = "100%";
  canvasEl.style.display = "block";
  canvasEl.style.cursor = "grab";
  ctx = canvasEl.getContext("2d");

  // Canvas Mouse / Drag Gestures
  function getCanvasCoords(e) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }

  canvasEl.addEventListener("mousedown", (e) => {
    const coords = getCanvasCoords(e);
    for (let i = 0; i < activeNodeCount; i++) {
      const d = Math.hypot(nodeX[i] - coords.x, nodeY[i] - coords.y);
      if (d <= nodeRadius[i] * 1.5) {
        draggedNode = i;
        canvasEl.style.cursor = "grabbing";
        break;
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (draggedNode >= 0) {
      const coords = getCanvasCoords(e);
      nodeX[draggedNode] = Math.max(0.08, Math.min(0.92, coords.x));
      nodeY[draggedNode] = Math.max(0.08, Math.min(0.92, coords.y));
      renderNodalGraphCanvas();
    } else if (canvasEl) {
      const coords = getCanvasCoords(e);
      let hover = -1;
      for (let i = 0; i < activeNodeCount; i++) {
        const d = Math.hypot(nodeX[i] - coords.x, nodeY[i] - coords.y);
        if (d <= nodeRadius[i] * 1.5) {
          hover = i;
          break;
        }
      }
      if (hover !== dragHoverNode) {
        dragHoverNode = hover;
        canvasEl.style.cursor = hover >= 0 ? "pointer" : "grab";
        renderNodalGraphCanvas();
      }
    }
  });

  window.addEventListener("mouseup", () => {
    if (draggedNode >= 0) {
      draggedNode = -1;
      if (canvasEl) canvasEl.style.cursor = "grab";
    }
  });

  canvasContainer.append(canvasEl);

  // Control Bar
  const controlsBar = document.createElement("div");
  controlsBar.className = "nodal-graph-controls";
  controlsBar.style.display = "flex";
  controlsBar.style.flexWrap = "wrap";
  controlsBar.style.gap = "8px";
  controlsBar.style.alignItems = "center";

  // Preset Dropdown
  presetSelectEl = dropdown({
    label: "TOPO",
    options: GRAPH_PRESETS.map(p => ({ value: p.id, label: p.name })),
    value: state.nodalGraphPreset || "cycle_chords",
    onChange: (val) => {
      initNodalGraphSystem(val);
      updateHud();
      renderNodalGraphCanvas();
      doGenerate(true);
    }
  });

  // Walkers Knob (1..8)
  refs.nodalGraphWalkers = knob({
    label: "WLK",
    min: 1,
    max: 8,
    step: 1,
    value: state.nodalGraphWalkers || 3,
    onChange: (val) => {
      state.nodalGraphWalkers = val;
      for (let w = 0; w < MAX_WALKERS; w++) {
        walkerActive[w] = w < val ? 1 : 0;
      }
      updateHud();
      doGenerate(true);
    }
  });

  // Speed Knob (0.25..3.0)
  refs.nodalGraphSpeed = knob({
    label: "SPD",
    min: 0.25,
    max: 3.0,
    step: 0.05,
    value: state.nodalGraphSpeed || 1.0,
    onChange: (val) => {
      state.nodalGraphSpeed = val;
      updateHud();
    }
  });

  // Branching Entropy Knob (0.0..1.0)
  refs.nodalGraphEntropy = knob({
    label: "ENT",
    min: 0.0,
    max: 1.0,
    step: 0.05,
    value: state.nodalGraphEntropy !== undefined ? state.nodalGraphEntropy : 0.2,
    onChange: (val) => {
      state.nodalGraphEntropy = val;
    }
  });

  // Density / Step Duration Knob
  refs.nodalGraphDensity = knob({
    label: "DEN",
    min: 0.5,
    max: 2.5,
    step: 0.1,
    value: state.nodalGraphDensity || 1.0,
    onChange: (val) => {
      state.nodalGraphDensity = val;
    }
  });

  // Octave Offset (-2..+2)
  refs.nodalGraphOctave = knob({
    label: "OCT",
    min: -2,
    max: 2,
    step: 1,
    value: state.nodalGraphOctave || 0,
    onChange: (val) => {
      state.nodalGraphOctave = val;
      doGenerate(true);
    }
  });

  // Transport & Action Buttons
  const runBtn = toggleBtn({
    label: "RUN",
    active: isGraphPlaying,
    onClick: () => {
      const running = toggleNodalGraphRunning();
      runBtn.setActive(running);
    }
  });

  const randBtn = actionBtn({
    label: "RND",
    onClick: () => {
      randomizeNodalGraph();
    }
  });

  controlsBar.append(
    presetSelectEl,
    refs.nodalGraphWalkers,
    refs.nodalGraphSpeed,
    refs.nodalGraphEntropy,
    refs.nodalGraphDensity,
    refs.nodalGraphOctave,
    runBtn,
    randBtn
  );

  layout.append(header, canvasContainer, controlsBar);
  graphContainer.append(layout);

  initNodalGraphSystem(state.nodalGraphPreset || "cycle_chords");
  updateHud();
}

// Module-level Snapshot Registration
registerModel({
  id: "nodal_graph",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.nodalGraphPreset || "cycle_chords",
    nodes: state.nodalGraphNodes || 12,
    walkers: state.nodalGraphWalkers || 3,
    speed: state.nodalGraphSpeed || 1.0,
    entropy: state.nodalGraphEntropy !== undefined ? state.nodalGraphEntropy : 0.2,
    density: state.nodalGraphDensity || 1.0,
    gate: state.nodalGraphGate || 0.75,
    octave: state.nodalGraphOctave || 0,
    nodeX: Array.from(nodeX.slice(0, activeNodeCount)),
    nodeY: Array.from(nodeY.slice(0, activeNodeCount))
  }),
  restore: (snap) => {
    if (!snap) return;
    if (snap.preset) state.nodalGraphPreset = snap.preset;
    if (snap.nodes) state.nodalGraphNodes = snap.nodes;
    if (snap.walkers) state.nodalGraphWalkers = snap.walkers;
    if (snap.speed !== undefined) state.nodalGraphSpeed = snap.speed;
    if (snap.entropy !== undefined) state.nodalGraphEntropy = snap.entropy;
    if (snap.density !== undefined) state.nodalGraphDensity = snap.density;
    if (snap.gate !== undefined) state.nodalGraphGate = snap.gate;
    if (snap.octave !== undefined) state.nodalGraphOctave = snap.octave;

    initNodalGraphSystem(state.nodalGraphNodes || 12, state.nodalGraphSpeed || 1.0, state.nodalGraphPreset || "cycle_chords");

    if (Array.isArray(snap.nodeX) && Array.isArray(snap.nodeY)) {
      for (let i = 0; i < Math.min(MAX_NODES, snap.nodeX.length); i++) {
        nodeX[i] = snap.nodeX[i];
        nodeY[i] = snap.nodeY[i];
      }
    }

    if (presetSelectEl) presetSelectEl.value = state.nodalGraphPreset;
    syncControlsFromState();
    renderNodalGraphCanvas();
    updateHud();
  }
});

export function activateNodalGraphModel() {
  setModelGenerator(generateNodalGraphBank);
  setModelRandomizer(randomizeNodalGraph);

  if (!animFrameId && typeof requestAnimationFrame === "function") {
    lastTimestamp = performance.now();
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function deactivateNodalGraphModel() {
  stopNodalGraph();
  setModelGenerator(null);
  setModelRandomizer(null);
  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}
