// tests/modes.test.mjs — Comprehensive unit tests for model tagging and multi-tag filtering
import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser globals for headless Node environment
if (typeof window === "undefined") {
  globalThis.window = {
    location: { hash: "" },
    history: { pushState: () => {} }
  };
}
if (typeof document === "undefined") {
  const elements = new Map();
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          toggle(c, force) {
            if (force === undefined) {
              if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c);
            } else if (force) {
              this.classes.add(c);
            } else {
              this.classes.delete(c);
            }
          },
          contains(c) { return this.classes.has(c); }
        },
        dataset: {},
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] || null },
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        append(...children) { this.children.push(...children); },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        style: {},
        textContent: ""
      };
      return el;
    },
    querySelectorAll: () => []
  };
}

import {
  MODELS,
  FILTER_TAGS,
  MODEL_TAG_MAP,
  filterModelsByTags,
  getSelectedFilterTags,
  setSelectedFilterTags,
  clearSelectedFilterTags,
  toggleFilterTag
} from "../js/modes.js";

test("FILTER_TAGS contains up to 8 well-defined tags", () => {
  assert.ok(Array.isArray(FILTER_TAGS));
  assert.ok(FILTER_TAGS.length <= 8 && FILTER_TAGS.length > 0);
  assert.equal(FILTER_TAGS.length, 8, "Expected exactly 8 curated filter tags");

  for (const tag of FILTER_TAGS) {
    assert.ok(typeof tag.id === "string" && tag.id.length > 0);
    assert.ok(typeof tag.label === "string" && tag.label.length > 0);
  }
});

test("Each of the 8 tags is applicable to at least 3 models", () => {
  for (const tag of FILTER_TAGS) {
    const matching = MODELS.filter((m) => {
      const mTags = MODEL_TAG_MAP[m.id] || [];
      return mTags.includes(tag.id);
    });
    assert.ok(
      matching.length >= 3,
      `Tag "${tag.id}" applies to ${matching.length} models, which is less than the required 3 minimum.`
    );
  }
});

test("All 32 models are classified in MODEL_TAG_MAP with filterTags", () => {
  assert.equal(MODELS.length, 32);
  for (const m of MODELS) {
    const tags = MODEL_TAG_MAP[m.id];
    assert.ok(Array.isArray(tags) && tags.length > 0, `Model ${m.id} must have assigned filter tags`);
    assert.ok(Array.isArray(m.filterTags) && m.filterTags.length > 0);
  }
});

test("filterModelsByTags with no tags returns all 32 models", () => {
  const all1 = filterModelsByTags([]);
  assert.equal(all1.length, 32);

  const all2 = filterModelsByTags();
  assert.equal(all2.length, 32);
});

test("filterModelsByTags with single tag filters accurately", () => {
  const mono = filterModelsByTags(["monophonic"]);
  assert.equal(mono.length, 4);
  const monoIds = mono.map(m => m.id);
  assert.deepEqual(monoIds.sort(), ["cellular", "mene311", "rungler", "turing"].sort());

  const poly = filterModelsByTags(["polyphonic"]);
  assert.equal(poly.length, 28);
  for (const m of poly) {
    assert.ok(MODEL_TAG_MAP[m.id].includes("polyphonic"));
  }

  const grid = filterModelsByTags(["grid-based"]);
  assert.ok(grid.length >= 10);
  for (const m of grid) {
    assert.ok(MODEL_TAG_MAP[m.id].includes("grid-based"));
  }
});

test("filterModelsByTags with multiple tags performs strict AND intersection", () => {
  // monophonic AND grid-based -> cellular
  const monoGrid = filterModelsByTags(["monophonic", "grid-based"]);
  assert.equal(monoGrid.length, 1);
  assert.equal(monoGrid[0].id, "cellular");

  // polyphonic AND physics -> 9 models
  const polyPhysics = filterModelsByTags(["polyphonic", "physics"]);
  assert.ok(polyPhysics.length >= 5);
  for (const m of polyPhysics) {
    const tags = MODEL_TAG_MAP[m.id];
    assert.ok(tags.includes("polyphonic") && tags.includes("physics"));
  }

  // Mutually exclusive: monophonic AND polyphonic -> 0 models
  const empty = filterModelsByTags(["monophonic", "polyphonic"]);
  assert.equal(empty.length, 0);
});

test("Filter tag selection state management and toggling", () => {
  clearSelectedFilterTags();
  assert.deepEqual(getSelectedFilterTags(), []);

  // Toggle tag on
  const res1 = toggleFilterTag("physics");
  assert.equal(res1, true);
  assert.deepEqual(getSelectedFilterTags(), ["physics"]);

  // Toggle second tag on
  const res2 = toggleFilterTag("grid-based");
  assert.equal(res2, true);
  assert.ok(getSelectedFilterTags().includes("physics"));
  assert.ok(getSelectedFilterTags().includes("grid-based"));
  assert.equal(getSelectedFilterTags().length, 2);

  // Toggle tag off
  const res3 = toggleFilterTag("physics");
  assert.equal(res3, false);
  assert.deepEqual(getSelectedFilterTags(), ["grid-based"]);

  // Set selected tags directly
  setSelectedFilterTags(["biological", "autonomous"]);
  assert.deepEqual(getSelectedFilterTags().sort(), ["autonomous", "biological"].sort());

  // Clear all tags
  clearSelectedFilterTags();
  assert.deepEqual(getSelectedFilterTags(), []);
});

import { MODEL_GUIDES } from "../js/model_guides.js";
import { openModelGuide, closeModelGuide } from "../js/modes.js";

test("MODEL_GUIDES contains comprehensive entries for all 32 models", () => {
  for (const m of MODELS) {
    const guide = MODEL_GUIDES[m.id];
    assert.ok(guide, `Guide must exist for model ${m.id}`);
    assert.ok(typeof guide.title === "string" && guide.title.length > 0);
    assert.ok(typeof guide.kicker === "string" && guide.kicker.length > 0);

    // Prompt requirement: "two paragraph description of the model, and description of the controls"
    assert.ok(Array.isArray(guide.paragraphs), `Paragraphs array must exist for model ${m.id}`);
    assert.equal(
      guide.paragraphs.length,
      2,
      `Model ${m.id} must have exactly a two-paragraph description (found ${guide.paragraphs.length})`
    );
    for (const p of guide.paragraphs) {
      assert.ok(typeof p === "string" && p.trim().length > 20);
    }

    assert.ok(Array.isArray(guide.controls), `Controls array must exist for model ${m.id}`);
    assert.ok(guide.controls.length >= 3, `Model ${m.id} must have at least 3 control descriptions`);
    for (const c of guide.controls) {
      assert.ok(typeof c.name === "string" && c.name.length > 0);
      assert.ok(typeof c.desc === "string" && c.desc.length > 0);
    }
  }
});

test("openModelGuide and closeModelGuide function contracts", () => {
  assert.equal(typeof openModelGuide, "function");
  assert.equal(typeof closeModelGuide, "function");

  // Safe to call even with mock elements
  assert.doesNotThrow(() => {
    openModelGuide("particles");
    closeModelGuide();
  });
});

