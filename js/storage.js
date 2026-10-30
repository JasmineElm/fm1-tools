// storage.js — Session snapshots (download / upload).
// The file format, versioning and migrations live in snapshot.js; this module wires
// them to the live app state and DOM. Sequencer-model hidden state registers itself
// from each model's own module.
import { state, locks, getSelected, setSelected, DEFAULT, status, doGenerate } from "./state.js";
import { refreshLockCount } from "./grid.js";
import { getActiveModel, showModel } from "./modes.js";
import { applyTheme } from "./themes.js";
import * as audio from "./audio.js";
import {
  registerModel, getModelDef, pickParams, ownsKey, splitParams,
  buildEnvelope, migrateEnvelope, SnapshotError,
} from "./snapshot.js";

const APP_BUILD = "100";

// Mene311 is fully determined by seed + parameters; it has no hidden state.
registerModel({ id: "mene311", version: 1, migrations: {} });

let onSyncRackCallback = null;
export function onSyncRack(fn) { onSyncRackCallback = fn; }

// Parameters present in a loaded file that this build doesn't know. They are written
// back out on the next export so a newer file survives a round trip through an older app.
let carriedUnknown = {};

export function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// The sequencer model that owns the current state; falls back to Mene311 when a
// non-sequencer tool or the landing page is showing.
function currentModelId() {
  const id = getActiveModel();
  return id && getModelDef(id) ? id : "mene311";
}

export function captureSession(name = "") {
  const modelId = currentModelId();
  const def = getModelDef(modelId);
  return buildEnvelope({
    modelId,
    name,
    params: { ...pickParams(modelId, state), ...carriedUnknown },
    locks: Object.fromEntries(locks),
    selected: getSelected(),
    hidden: def.capture ? def.capture() : {},
    ui: { theme: document.documentElement.dataset.theme || "dark" },
    output: { sound: audio.getSound(), volume: audio.getVolume() },
    build: APP_BUILD,
  });
}

export function applySession(raw) {
  const env = migrateEnvelope(raw);          // throws SnapshotError on anything unsafe
  const id = env.model.id;
  const def = getModelDef(id);

  const { known, unknown } = splitParams(id, env.state.params, DEFAULT);
  for (const k of Object.keys(DEFAULT)) {
    if (!ownsKey(id, k)) continue;           // never touch another model's parameters
    state[k] = k in known ? known[k] : structuredClone(DEFAULT[k]);
  }
  state.seed = state.seed >>> 0;
  carriedUnknown = unknown;

  locks.clear();
  for (const [k, v] of Object.entries(env.state.locks ?? {})) {
    if (Array.isArray(v)) locks.set(k, v.map((n) => ({ ...n })));
  }
  setSelected(Number(env.state.selected) || 0);

  if (def.restore) def.restore(env.state.hidden);

  if (env.ui?.theme) applyTheme(env.ui.theme);
  const vol = Number(env.output?.volume);
  if (typeof env.output?.sound === "string") { audio.setSound(env.output.sound); localStorage.setItem("fm1p.sound", audio.getSound()); }
  if (Number.isFinite(vol)) { audio.setVolume(vol); localStorage.setItem("fm1p.volume", String(audio.getVolume())); }

  if (onSyncRackCallback) onSyncRackCallback();
  showModel(id);                              // (re)activates the model, which regenerates
  if (def.restore) def.restore(env.state.hidden);
  if (id === "mene311") doGenerate(false);
  refreshLockCount();
  return env;
}

function describeError(e) {
  return e instanceof SnapshotError ? e.message : (e?.message || String(e));
}

export function exportState() {
  const env = captureSession();
  const seed = env.state.params.seed >>> 0;
  download(`${env.model.id}-${seed}.fm1p.json`, JSON.stringify(env, null, 2), "application/json");
  status(`exported ${env.model.id} v${env.model.version} · seed ${seed} ✓`);
}

export async function importState(file) {
  try {
    const env = applySession(JSON.parse(await file.text()));
    status(`Loaded ${env.model.id} · seed ${state.seed >>> 0} ✓`, "ok");
    return env;
  } catch (e) {
    status("import failed: " + describeError(e), "err");
  }
}
