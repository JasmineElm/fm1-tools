// themes.js — FM-1 display themes management.
import { renderScope } from "./scope.js";

export const THEMES = [
  { id: "dark", name: "Dark", icon: "🌙", accent: "#3b82f6" },
  { id: "light", name: "Light", icon: "☀️", accent: "#2563eb" },
];

let cachedPalette = null;
let cachedThemeId = null;

export function applyTheme(id) {
  const themeId = id === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = themeId;
  cachedPalette = null;
  cachedThemeId = null;
  localStorage.setItem("fm1p.theme", themeId);
  document.querySelectorAll(".theme-btn, .swatch").forEach((s) => {
    const isActive = s.dataset.id === themeId;
    s.classList.toggle("active", isActive);
    s.setAttribute("aria-pressed", String(isActive));
  });
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  renderScope();
}

export function buildTheme() {
  const menus = document.querySelectorAll(".swatches, #themes");
  if (!menus.length) return;
  for (const menu of menus) {
    menu.innerHTML = "";
    for (const t of THEMES) {
      const b = document.createElement("button");
      b.className = "theme-btn";
      b.dataset.id = t.id;
      b.textContent = `${t.icon} ${t.name}`;
      b.title = `Switch to ${t.name} theme`;
      b.setAttribute("aria-label", `${t.name} theme`);
      b.addEventListener("click", () => applyTheme(t.id));
      menu.appendChild(b);
    }
  }
  const saved = localStorage.getItem("fm1p.theme");
  applyTheme(saved === "light" ? "light" : "dark");
}

/**
 * Resolve semantic CSS theme tokens dynamically from the document root,
 * with safe dark-workbench fallbacks for headless / Node test environments.
 */
export function getThemePalette() {
  const currentTheme = (typeof document !== "undefined" && document.documentElement?.dataset?.theme) || "dark";
  if (cachedPalette && cachedThemeId === currentTheme) {
    return cachedPalette;
  }
  const style = (typeof getComputedStyle === "function" && typeof document !== "undefined" && document.documentElement)
    ? getComputedStyle(document.documentElement)
    : null;
  const get = (prop, fallback) => (style ? style.getPropertyValue(prop).trim() : "") || fallback;
  cachedThemeId = currentTheme;
  cachedPalette = {
    bg: get("--bg", "#111215"),
    panel: get("--panel", "#18191f"),
    panel2: get("--panel2", "#22252e"),
    line: get("--line", "#333846"),
    lineFocus: get("--line-focus", "#4b5264"),
    fg: get("--fg", "#f3f4f6"),
    dim: get("--dim", "#9ca3af"),
    accent: get("--accent", "#3b82f6"),
    accent2: get("--accent2", "#60a5fa"),
    ok: get("--ok", "#22c55e"),
    err: get("--err", "#ef4444"),
  };
  return cachedPalette;
}
