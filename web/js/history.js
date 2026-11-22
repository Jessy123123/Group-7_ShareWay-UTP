// Operator: booking history. Every seat booked and cancelled on ShareWay,
// read from Supabase (operators can see all bookings; see supabase/schema.sql).

import { $, num, MONTHS, COLORS, option, countUp, replay, setChart, axisTitle } from "./ui.js";
import { db } from "./db.js";

const hs = { rows: [], loaded: false, loading: false, error: "", event: "all", route: "all", status: "all", q: "", routeNames: {} };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtDay(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function fmtTime(ts) {
  const t = new Date(ts);
  return `${fmtDay(t.toISOString())}, ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

function filtered() {
  const q = hs.q.trim().toLowerCase();
  return hs.rows.filter((r) => (hs.event === "all" || `${r.event}|${r.date.slice(0, 4)}` === hs.event)
    && (hs.route === "all" || r.route === hs.route)
    && (hs.status === "all" || r.status === hs.status)
    && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.destination.toLowerCase().includes(q)));
}

async function load() {
  if (!db.enabled || !db.isOperator || hs.loading) return;
  hs.loading = true;
  $("h-refresh").disabled = true;
  const res = await db.allBookings();
  hs.loading = false;
  $("h-refresh").disabled = false;
  hs.rows = res.rows;
  hs.error = res.error ?? "";
  hs.loaded = true;
  fillEventFilter();
  draw();
}

function fillEventFilter() {
  const sel = $("h-event");
  const keys = [...new Map(hs.rows.map((r) => [`${r.event}|${r.date.slice(0, 4)}`, `${r.event} · ${r.date.slice(0, 4)}`])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = "";
  sel.append(option("all", "All breaks", hs.event === "all"));
  for (const [k, label] of keys) sel.append(option(k, label, k === hs.event));
  if (![...sel.options].some((o) => o.value === hs.event)) { hs.event = "all"; sel.value = "all"; }
}

function draw() {
  const rows = filtered();
  const active = rows.filter((r) => r.status === "booked");
  countUp($("h-total"), rows.length);
  $("h-total-sub").textContent = hs.rows.length === rows.length ? "all bookings" : `of ${hs.rows.length} in total`;
  countUp($("h-active"), active.length);
  $("h-active-sub").textContent = `${new Set(active.map((r) => `${r.route}|${r.date}`)).size} trips with seats booked`;
  countUp($("h-cancel"), rows.length - active.length);
  $("h-cancel-sub").textContent = rows.length ? `${Math.round((100 * (rows.length - active.length)) / rows.length)}% of bookings` : "–";
  countUp($("h-students"), new Set(rows.map((r) => r.email)).size);

  // bookings made per day (booked and cancelled stacked)
  const days = [...new Set(rows.map((r) => r.created.slice(0, 10)))].sort();
  const per = (status) => days.map((d) => rows.filter((r) => r.created.slice(0, 10) === d && r.status === status).length);
  setChart("history", "c-history", {
    type: "bar",
    data: {
      labels: days.map((d) => fmtDay(d).replace(/ \d{4}$/, "")),
      datasets: [
        { label: "Still booked", data: per("booked"), backgroundColor: COLORS.accent, borderRadius: 4, maxBarThickness: 28, stack: "s" },
        { label: "Cancelled", data: per("cancelled"), backgroundColor: COLORS.grey, borderRadius: 4, maxBarThickness: 28, stack: "s" },
      ],
    },
    options: {
      scales: {
        x: { stacked: true, grid: { display: false }, title: axisTitle("Day the booking was made") },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: axisTitle("Bookings") },
      },
      plugins: { tooltip: { mode: "index", intersect: false } },
    },
  });

  drawBreakdowns(rows);

  const body = $("h-body");
  replay(body, "fresh");
  let empty = "";
  if (!db.enabled) empty = "Booking history needs the Supabase database. In demo mode, bookings stay in each visitor's browser.";
  else if (!db.isOperator) empty = "Sign in with an operator account to see every booking.";
  else if (hs.error) empty = `Couldn't load bookings: ${hs.error}`;
  else if (!hs.loaded) empty = "Loading bookings…";
  else if (!hs.rows.length) empty = "No bookings yet. They appear here as soon as students book seats.";
  else if (!rows.length) empty = "No bookings match these filters.";
  body.innerHTML = empty
    ? `<tr><td colspan="7"><div class="empty"><strong>${hs.rows.length ? "Nothing to show" : "No bookings"}</strong><span>${esc(empty)}</span></div></td></tr>`
    : rows.slice(0, 500).map((r) => `<tr>
        <td>${fmtTime(r.created)}</td>
        <td><strong>${esc(r.name || r.email.split("@")[0])}</strong><br><span class="muted small">${esc(r.email)}</span></td>
        <td>${fmtDay(r.date)}<br><span class="muted small">${esc(r.event)}</span></td>
        <td>Route ${r.route}</td>
        <td>${esc(r.destination)}</td>
        <td>${r.status === "booked" ? '<span class="tag bus">Booked</span>' : '<span class="tag cancel">Cancelled</span>'}</td>
        <td>${r.cancelled ? fmtTime(r.cancelled) : '<span class="muted">–</span>'}</td>
      </tr>`).join("");
  $("h-note").textContent = rows.length > 500 ? `Showing the newest 500 of ${num.format(rows.length)}` : "Newest first";
  $("h-csv").disabled = !rows.length;
}

const LEAD_BUCKETS = [["4+ weeks", 28, Infinity], ["2–4 weeks", 14, 27], ["1–2 weeks", 7, 13], ["Under 1 week", 0, 6]];

function drawBreakdowns(rows) {
  const quiet = { grid: { display: false } };

  // seats by route, stacked booked / cancelled
  const routes = [...new Set([...Object.keys(hs.routeNames), ...rows.map((r) => r.route)])].sort();
  const byRoute = (status) => routes.map((code) => rows.filter((r) => r.route === code && r.status === status).length);
  setChart("h-route", "c-h-route", {
    type: "bar",
    data: {
      labels: routes.map((c) => (hs.routeNames[c] ? `${c} · ${hs.routeNames[c]}` : c)),
      datasets: [
        { label: "Still booked", data: byRoute("booked"), backgroundColor: COLORS.accent, borderRadius: 4, maxBarThickness: 46, stack: "s" },
        { label: "Cancelled", data: byRoute("cancelled"), backgroundColor: COLORS.grey, borderRadius: 4, maxBarThickness: 46, stack: "s" },
      ],
    },
    options: {
      scales: { x: { stacked: true, ...quiet }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: axisTitle("Bookings") } },
      plugins: { tooltip: { mode: "index", intersect: false } },
    },
  });

  // how many days before departure each booking was made
  const lead = (r) => Math.round((Date.parse(`${r.date}T00:00:00`) - Date.parse(r.created)) / 86400000);
  const leadCounts = LEAD_BUCKETS.map(([, lo, hi]) => rows.filter((r) => { const d = lead(r); return d >= lo && d <= hi; }).length);
  setChart("h-lead", "c-h-lead", {
    type: "bar",
    data: {
      labels: LEAD_BUCKETS.map((b) => b[0]),
      datasets: [{ label: "Bookings", data: leadCounts, backgroundColor: COLORS.primary, borderRadius: 6, maxBarThickness: 46 }],
    },
    options: {
      scales: { x: { ...quiet, title: axisTitle("Booked … before departure") }, y: { beginAtZero: true, ticks: { precision: 0 }, title: axisTitle("Bookings") } },
      plugins: { tooltip: { callbacks: { label: (i) => ` ${i.raw} booking${i.raw === 1 ? "" : "s"}` } } },
    },
  });

  // most popular stops (top 8)
  const counts = new Map();
  for (const r of rows) counts.set(r.destination, (counts.get(r.destination) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  setChart("h-stops", "c-h-stops", {
    type: "bar",
    data: {
      labels: top.map((t) => t[0]),
      datasets: [{ label: "Bookings", data: top.map((t) => t[1]), backgroundColor: COLORS.green, borderRadius: 6, maxBarThickness: 24 }],
    },
    options: {
      indexAxis: "y",
      scales: { x: { beginAtZero: true, ticks: { precision: 0 }, title: axisTitle("Bookings") }, y: { ...quiet, ticks: { font: { size: 12 } } } },
    },
  });
}

function downloadCsv() {
  const rows = filtered();
  const cols = ["booked_at", "student", "email", "event", "departure_date", "route", "destination", "status", "cancelled_at"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(","), ...rows.map((r) => [r.created, r.name, r.email, r.event, r.date, r.route, r.destination, r.status, r.cancelled]
    .map(cell).join(","))];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shareway_bookings_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function setupHistory({ data }) {
  hs.routeNames = Object.fromEntries(Object.entries(data.config.ROUTES).map(([c, r]) => [c, r.name]));
  for (const code of Object.keys(data.config.ROUTES)) {
    $("h-route").append(option(code, `Route ${code} · ${data.config.ROUTES[code].name}`));
  }
  $("h-event").addEventListener("change", (e) => { hs.event = e.target.value; draw(); });
  $("h-route").addEventListener("change", (e) => { hs.route = e.target.value; draw(); });
  $("h-status").addEventListener("change", (e) => { hs.status = e.target.value; draw(); });
  $("h-search").addEventListener("input", (e) => { hs.q = e.target.value; draw(); });
  $("h-refresh").addEventListener("click", load);
  $("h-csv").addEventListener("click", downloadCsv);
}

/** Called when the History page opens or the signed-in account changes. */
export function renderHistory() {
  draw();
  load();
}
