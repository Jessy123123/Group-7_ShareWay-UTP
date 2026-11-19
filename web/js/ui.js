// Shared helpers for the operator pages (app.js) and the student pages (student.js).

export const $ = (id) => document.getElementById(id);
export const num = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 });
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
export const COLORS = {
  primary: color("--primary"), accent: color("--accent"), green: color("--green"),
  amber: color("--amber"), red: color("--red"), grey: color("--grey-bar"),
  text: color("--text"), text2: color("--text-2"), text3: color("--text-3"), border: color("--border"),
};

export const charts = {};

export function fmtDate(iso, withYear = false) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function option(value, label, selected = false) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
}

export function segmented(el, items, current, onPick) {
  el.innerHTML = "";
  for (const [value, label] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = value === current ? "active" : "";
    b.addEventListener("click", () => {
      [...el.children].forEach((c) => c.classList.toggle("active", c === b));
      onPick(value);
    });
    el.append(b);
  }
}

export function areaGradient(hex, alphaTop = 0.22) {
  return (ctx) => {
    const { chart } = ctx;
    if (!chart.chartArea) return "transparent";
    const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
    g.addColorStop(0, hexAlpha(hex, alphaTop));
    g.addColorStop(1, hexAlpha(hex, 0));
    return g;
  };
}

export function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------- animation helpers ----------

export const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Count a number up (or down) from what the element showed before. */
export function countUp(el, to, format = (v) => num.format(v), ms = 750) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  if (REDUCED || from === to) { el.textContent = format(to); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = format(from + (to - from) * (1 - (1 - t) ** 3));
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/** Restart a one-shot CSS animation class on an element. */
export function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function setChart(key, canvasId, config) {
  if (charts[key]) charts[key].destroy();
  charts[key] = new Chart($(canvasId), config);
  return charts[key];
}

export function axisTitle(text) {
  return { display: true, text, color: COLORS.text3, font: { size: 11 } };
}

export function setupChartDefaults() {
  Chart.defaults.font.family = '"Poppins", system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = COLORS.text2;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = COLORS.text;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "600" };
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.scale.grid.color = COLORS.border;
  Chart.defaults.scale.border.display = false;
  Chart.defaults.elements.line.tension = 0.35;
  Chart.defaults.animation.duration = REDUCED ? 0 : 650;
  Chart.defaults.animation.easing = "easeOutQuart";
}
