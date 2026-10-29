// perlin.js — Fast, Zero-GC 2D Improved Perlin Noise & Fractal Brownian Motion (fBm) Generator for FM-1 Pulses.
// Plain ES module, zero external runtime dependencies, TypedArray in-place buffer filling.

// Standard permutation table for Ken Perlin's Improved Noise (doubled to 512 to avoid modulo wrapping)
const DEFAULT_PERM = new Uint8Array([
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
  8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
  35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
  134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
  55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
  18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
  250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
  189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
  172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
  228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
  107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
  138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
]);

const P = new Uint16Array(512);

function initPermutation(permSource) {
  for (let i = 0; i < 256; i++) {
    P[i] = permSource[i];
    P[i + 256] = permSource[i];
  }
}
initPermutation(DEFAULT_PERM);

let currentSeed = 1337;

/**
 * Seed the Perlin noise generator using Mulberry32 PRNG to shuffle the permutation table.
 * Passing null or undefined selects a non-deterministic random seed.
 */
export function setPerlinSeed(seed) {
  if (seed === undefined || seed === null) {
    currentSeed = (Math.random() * 2147483647) | 0;
  } else {
    currentSeed = (Number(seed) >>> 0) || 1;
  }

  // Mulberry32 PRNG
  let s = currentSeed;
  function nextRand() {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Fisher-Yates shuffle
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }

  initPermutation(base);
  return currentSeed;
}

export function getPerlinSeed() {
  return currentSeed;
}

/**
 * Ken Perlin's quintic fade curve: 6t^5 - 15t^4 + 10t^3.
 * Guarantees zero 1st and 2nd derivatives at boundaries.
 */
function fade(t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/**
 * Linear interpolation.
 */
function lerp(a, b, t) {
  return a + t * (b - a);
}

/**
 * Fast 2D gradient dot product with 8 symmetric direction vectors.
 */
function grad2D(hash, x, y) {
  const h = hash & 7;
  switch (h) {
    case 0: return  x + y;
    case 1: return -x + y;
    case 2: return  x - y;
    case 3: return -x - y;
    case 4: return  x * 1.41421356;
    case 5: return -x * 1.41421356;
    case 6: return  y * 1.41421356;
    case 7: return -y * 1.41421356;
    default: return 0.0;
  }
}

/**
 * 2D Improved Perlin Noise calculation.
 * Returns a continuous value roughly bounded in [-1.0, 1.0].
 */
export function perlin2D(x, y) {
  const X0 = Math.floor(x);
  const Y0 = Math.floor(y);

  const xi = X0 & 255;
  const yi = Y0 & 255;

  const xf = x - X0;
  const yf = y - Y0;

  const u = fade(xf);
  const v = fade(yf);

  const aa = P[P[xi] + yi];
  const ba = P[P[xi + 1] + yi];
  const ab = P[P[xi] + yi + 1];
  const bb = P[P[xi + 1] + yi + 1];

  const g00 = grad2D(aa, xf, yf);
  const g10 = grad2D(ba, xf - 1.0, yf);
  const g01 = grad2D(ab, xf, yf - 1.0);
  const g11 = grad2D(bb, xf - 1.0, yf - 1.0);

  const x1 = lerp(g00, g10, u);
  const x2 = lerp(g01, g11, u);

  // Normalization factor (~0.707) brings peaks strictly into [-1.0, 1.0]
  return lerp(x1, x2, v) * 0.70710678;
}

/**
 * Multi-octave Fractal Brownian Motion (fBm) in 2D.
 * Synthesizes multiple harmonic octaves for natural organic textures.
 * Returns normalized value in [-1.0, 1.0].
 */
export function fbm2D(x, y, options = {}) {
  const octaves = Math.max(1, Math.min(6, options.octaves ?? 3));
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2.0;

  let total = 0.0;
  let frequency = 1.0;
  let amplitude = 1.0;
  let maxAmp = 0.0;

  for (let o = 0; o < octaves; o++) {
    total += perlin2D(x * frequency, y * frequency) * amplitude;
    maxAmp += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return maxAmp > 0 ? total / maxAmp : 0.0;
}

/**
 * In-place 2D Perlin / fBm noise filler for pre-allocated simulation buffers.
 * Designed for zero GC churn in high-rate animation and audio dispatch loops.
 *
 * @param {Float32Array|Float64Array|Uint8Array|Array} targetArray Destination grid buffer (length >= width * height).
 * @param {number} width Grid width in columns.
 * @param {number} height Grid height in rows.
 * @param {Object} options Configuration parameters:
 *   - scale: Spatial frequency scaling (default: 0.08).
 *   - octaves: Harmonic octave count (default: 3).
 *   - persistence: Harmonic amplitude decay (default: 0.5).
 *   - lacunarity: Harmonic frequency multiplier (default: 2.0).
 *   - min: Minimum target value mapped from -1.0 (default: 0.0).
 *   - max: Maximum target value mapped from +1.0 (default: 1.0).
 *   - offsetX: Horizontal spatial coordinate offset.
 *   - offsetY: Vertical spatial coordinate offset.
 *   - seed: Optional custom seed number. If supplied, temporarily re-seeds.
 *   - threshold: Optional cutoff threshold in [0, 1]. Values below become thresholdMin (default: min).
 *   - thresholdMin: Value written when below threshold (default: min).
 *   - power: Exponent for non-linear contrast shaping (default: 1.0).
 *   - additive: If true, adds generated noise to existing array values (default: false).
 *   - clampMin: Optional lower boundary clamp.
 *   - clampMax: Optional upper boundary clamp.
 * @returns {Float32Array|Uint8Array|Array} The filled destination buffer.
 */
export function fillPerlin2D(targetArray, width, height, options = {}) {
  const len = width * height;
  const buf = targetArray || new Float32Array(len);

  if (options.seed !== undefined && options.seed !== null) {
    setPerlinSeed(options.seed);
  }

  const scale = Number(options.scale ?? options.frequency ?? 0.08);
  const octaves = Math.max(1, Math.min(6, options.octaves ?? 3));
  const persistence = Number(options.persistence ?? 0.5);
  const lacunarity = Number(options.lacunarity ?? 2.0);
  const minVal = Number(options.min ?? 0.0);
  const maxVal = Number(options.max ?? 1.0);
  const valRange = maxVal - minVal;

  const offX = Number(options.offsetX ?? (Math.random() * 1000.0));
  const offY = Number(options.offsetY ?? (Math.random() * 1000.0));

  const hasThresh = options.threshold !== undefined;
  const thresh = hasThresh ? Number(options.threshold) : 0.0;
  const threshMin = options.thresholdMin !== undefined ? Number(options.thresholdMin) : minVal;

  const power = Number(options.power ?? 1.0);
  const isAdditive = !!options.additive;
  const hasClampMin = options.clampMin !== undefined;
  const hasClampMax = options.clampMax !== undefined;
  const cMin = hasClampMin ? Number(options.clampMin) : -Infinity;
  const cMax = hasClampMax ? Number(options.clampMax) : Infinity;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const sy = y * scale + offY;

    for (let x = 0; x < width; x++) {
      const sx = x * scale + offX;
      let raw = 0.0;

      if (octaves === 1) {
        raw = perlin2D(sx, sy);
      } else {
        let total = 0.0;
        let freq = 1.0;
        let amp = 1.0;
        let maxAmp = 0.0;
        for (let o = 0; o < octaves; o++) {
          total += perlin2D(sx * freq, sy * freq) * amp;
          maxAmp += amp;
          freq *= lacunarity;
          amp *= persistence;
        }
        raw = maxAmp > 0 ? total / maxAmp : 0.0;
      }

      // Map raw [-1, +1] into normalized [0, 1]
      let norm = (raw + 1.0) * 0.5;
      if (norm < 0.0) norm = 0.0;
      else if (norm > 1.0) norm = 1.0;

      const idx = rowOffset + x;

      // Threshold cutoff gate on normalized noise field
      if (hasThresh && norm < thresh) {
        if (isAdditive) {
          let val = buf[idx] + threshMin;
          if (hasClampMin && val < cMin) val = cMin;
          if (hasClampMax && val > cMax) val = cMax;
          buf[idx] = val;
        } else {
          let val = threshMin;
          if (hasClampMin && val < cMin) val = cMin;
          if (hasClampMax && val > cMax) val = cMax;
          buf[idx] = val;
        }
        continue;
      }

      // Power shaping
      if (power !== 1.0) {
        norm = Math.pow(norm, power);
      }

      const out = minVal + norm * valRange;

      if (isAdditive) {
        let val = buf[idx] + out;
        if (hasClampMin && val < cMin) val = cMin;
        if (hasClampMax && val > cMax) val = cMax;
        buf[idx] = val;
      } else {
        let val = out;
        if (hasClampMin && val < cMin) val = cMin;
        if (hasClampMax && val > cMax) val = cMax;
        buf[idx] = val;
      }
    }
  }

  return buf;
}

/**
 * Allocate and generate a fresh Float32Array filled with 2D Perlin noise.
 */
export function generatePerlinGrid(width, height, options = {}) {
  const buf = new Float32Array(width * height);
  return fillPerlin2D(buf, width, height, options);
}

// Attach to global window object for universal browser workbench availability
if (typeof window !== "undefined") {
  window.perlinNoise = {
    setPerlinSeed,
    getPerlinSeed,
    perlin2D,
    fbm2D,
    fillPerlin2D,
    generatePerlinGrid
  };
}
