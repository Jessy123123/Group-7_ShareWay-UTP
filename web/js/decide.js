// Operator: Trip decisions. PMMD looks at each trip of a break, sees the
// bookings, the forecast range and the AI suggestion, and decides: N buses
// (+ standby), one van, or cancel. Cancelling a trip offers its students a
// carpool straight away (carpool.py rules, SIMULATED drivers).
//
// Bookings so far = the SIMULATED students of the trip (dashboard.json, run 1,
// the same ones the student view shows) + the real seats booked on ShareWay.

import {
  $, MONTHS, DAYS, fmtDate, option, segmented, countUp, replay,
} from "./ui.js";
import { db } from "./db.js";
import { getDecision, setDecisions, clearDecision, onDecisions, sharedDecisions } from "./decisions.js";
import { offerCarpools, BUS_TIME, clock } from "./student.js";

const RUN = 0;                         // same simulation run as the student view
const STUDENT_STORE = "shareway.trips.v1";
const MAX_BUSES = 10;

let data;
let L;
let events;
const dc = { eventKey: null, route: "all", sel: null, draft: null, realRiders: new Map(), busy: false };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- numbers for one trip ----------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const tripKey = (t) => `${t.route}|${t.date}`;

/** Bookings as they stand today: the latest snapshot that has already happened. */
function snapshotNow(trip) {
  const left = dayDiff(trip.date, todayIso());
  let pick = data.config.SNAPSHOT_DAYS[0];
  for (const d of data.config.SNAPSHOT_DAYS) if (d >= left) pick = d;
  return { left, snap: trip.snaps.find((s) => s[0] === pick) };
}

/** The demo seat booked in this browser's student view (no Supabase). */
function localSeat(trip) {
  try {
    const mine = JSON.parse(localStorage.getItem(STUDENT_STORE)) ?? [];
    return mine.find((t) => t.key === `bus|${trip.id}`) ?? null;
  } catch { return null; }
}

function info(trip) {
  const { left, snap } = snapshotNow(trip);
  const live = db.enabled ? db.count(trip.route, trip.date) : localSeat(trip) ? 1 : 0;
  return {
    trip, left, live,
    simulated: snap[1], booked: snap[1] + live,
    mid: snap[2], low: snap[3], high: snap[4],
    ai: L.recommend(snap[4]),            // AI: plan for the high end of the forecast range
    decided: getDecision(trip.route, trip.date),
  };
}

function eventTrips() {
  return events.get(dc.eventKey).trips
    .filter((t) => t.run === RUN && (dc.route === "all" || t.route === dc.route))
    .sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route));
}

function planText(p) {
  if (p.action === "cancel") return "Cancel";
  if (p.action === "van") return "1 van";
  return `${p.buses} bus${p.buses > 1 ? "es" : ""}${p.standby ? " + standby" : ""}`;
}

function seatsFor(p) {
  if (p.action === "van") return data.config.VAN_CAPACITY;
  if (p.action === "bus") return (p.buses + (p.standby ? 1 : 0)) * data.config.BUS_CAPACITY;
  return 0;
}

const sameAsAi = (p, ai) => p.action === ai.action && (p.action !== "bus" || (p.buses === ai.buses && p.standby === ai.standby));
const dayLabel = (t) => `${DAYS[t.dow]} ${fmtDate(t.date, true)}`;

// ---------- students to move to carpool ----------

/** Made-up stand-ins for the trip's SIMULATED bookings (same every time). */
function simulatedRiders(trip, n) {
  const stops = Object.keys(data.config.ROUTES[trip.route].stops);
  let h = 2166136261;
  for (const c of `cancel-${trip.route}-${trip.date}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1597334677) >>> 0;
    return { id: `S${String(i + 1).padStart(2, "0")}`, name: `Student S${String(i + 1).padStart(2, "0")}`, town: stops[h % stops.length], simulated: true };
  });
}

/** Everyone with a seat on a cancelled trip: real ShareWay bookings first. */
function ridersFor(x) {
  const real = dc.realRiders.get(tripKey(x.trip)) ?? [];
  const local = !db.enabled && localSeat(x.trip);
  const own = local ? [{ id: "YOU", name: "You (student view, demo)", town: local.town, simulated: false }] : [];
  return [...real, ...own, ...simulatedRiders(x.trip, x.simulated)];
}

async function loadRealRiders(x) {
  const k = tripKey(x.trip);
  if (!db.enabled || !db.isOperator || dc.realRiders.has(k)) return;
  dc.realRiders.set(k, []);
  const res = await db.tripBookings(x.trip.route, x.trip.date);
  dc.realRiders.set(k, res.rows.map((r) => ({
    id: `B${r.id}`, name: r.name || r.email.split("@")[0], email: r.email, town: r.destination, simulated: false,
  })));
  if (dc.sel === k) renderCarpool();
}

// ---------- setup ----------

export function setupDecide(ctx) {
  ({ data, L, events } = ctx);
  const today = todayIso();
  const list = [...events.values()].filter((e) => e.trips.some((t) => t.run === RUN));
  dc.eventKey = (list.find((e) => e.firstDay >= today) ?? list[list.length - 1]).key;

  const fEvent = $("d-event");
  for (const e of list) {
    const [y, m] = e.firstDay.split("-").map(Number);
    fEvent.append(option(e.key, `${e.event} · ${MONTHS[m - 1]} ${y}`, e.key === dc.eventKey));
  }
  fEvent.addEventListener("change", () => { dc.eventKey = fEvent.value; dc.sel = null; renderDecide(); });
  segmented($("d-route"), [["all", "All routes"], ...Object.keys(data.config.ROUTES).map((c) => [c, `${c} · ${data.config.ROUTES[c].name}`])],
    dc.route, (v) => { dc.route = v; dc.sel = null; renderDecide(); });

  $("d-body").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-key]");
    if (!row) return;
    dc.sel = row.dataset.key;
    dc.draft = null;
    renderDecide();
    if (window.innerWidth < 1180) $("d-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("d-accept-all").addEventListener("click", acceptAll);
  $("d-panel").addEventListener("click", onPanelClick);
  $("d-panel").addEventListener("change", onPanelChange);
  $("d-panel").addEventListener("input", onPanelChange);

  onDecisions(() => { if (!$("page-decide").hidden) renderDecide(); });
  db.onChange(() => { dc.realRiders.clear(); if (!$("page-decide").hidden) renderDecide(); });
}

// ---------- render ----------

export function renderDecide() {
  if (!data) return;
  const rows = eventTrips().map(info);
  if (!rows.some((x) => tripKey(x.trip) === dc.sel)) {
    // first trip still waiting for a decision, else the first trip
    dc.sel = tripKey((rows.find((x) => !x.decided) ?? rows[0]).trip);
    dc.draft = null;
  }
  renderKpis(rows);
  renderTable(rows);
  renderPanel(rows.find((x) => tripKey(x.trip) === dc.sel));
  renderCarpool();
}

function renderKpis(rows) {
  const open = rows.filter((x) => !x.decided);
  const running = rows.filter((x) => x.decided && x.decided.action !== "cancel");
  const cancelled = rows.filter((x) => x.decided?.action === "cancel");
  countUp($("dk-open"), open.length);
  $("dk-open-sub").textContent = open.length ? `of ${rows.length} trips · AI suggestion ready` : `all ${rows.length} trips decided`;
  countUp($("dk-buses"), running.reduce((s, x) => s + (x.decided.action === "bus" ? x.decided.buses + (x.decided.standby ? 1 : 0) : 0), 0));
  const vans = running.filter((x) => x.decided.action === "van").length;
  $("dk-buses-sub").textContent = `${vans} van${vans === 1 ? "" : "s"} · ${running.length} trip${running.length === 1 ? "" : "s"} confirmed`;
  countUp($("dk-cancel"), cancelled.length);
  const moved = cancelled.reduce((s, x) => s + x.booked, 0);
  $("dk-cancel-sub").textContent = cancelled.length ? `${moved} student${moved === 1 ? "" : "s"} offered a carpool` : "no trips cancelled";
}

function statusTag(x) {
  if (!x.decided) return '<span class="tag muted-tag">To decide</span>';
  if (x.decided.action === "cancel") return '<span class="tag cancel">Cancelled</span>';
  return `<span class="tag ${x.decided.action}">${planText(x.decided)}</span>`;
}

function renderTable(rows) {
  const body = $("d-body");
  replay(body, "fresh");
  body.innerHTML = rows.map((x) => {
    const k = tripKey(x.trip);
    const warn = x.ai.action === "cancel" && !x.decided ? ' <span class="tag cancel" title="Fewer than the minimum expected">Under ' + data.config.MIN_PASSENGERS + "</span>" : "";
    return `<tr data-key="${k}" class="clickable${k === dc.sel ? " selected" : ""}" tabindex="0">
      <td><strong>${dayLabel(x.trip)}</strong><br><span class="muted small">${x.left > 0 ? `${x.left} days to go` : "departed"}</span></td>
      <td>Route ${x.trip.route}</td>
      <td class="num">${x.booked}${x.live ? `<br><span class="muted small">${x.live} on ShareWay</span>` : ""}</td>
      <td class="num">${Math.round(x.mid)}<br><span class="muted small">${Math.round(x.low)}–${Math.round(x.high)}</span></td>
      <td>${planText(x.ai)}${warn}</td>
      <td>${statusTag(x)}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" class="muted">No trips for this break.</td></tr>';
  $("d-accept-all").disabled = !rows.some((x) => !x.decided) || dc.busy;
}

function renderPanel(x) {
  const panel = $("d-panel");
  if (!x) { panel.innerHTML = ""; return; }
  const draft = dc.draft ?? (x.decided ? { ...x.decided } : { ...x.ai });
  dc.draft = draft;
  const seats = seatsFor(draft);
  const newCancel = draft.action === "cancel" && x.decided?.action !== "cancel";
  const store = sharedDecisions() ? "Saved to Supabase: every student sees it straight away."
    : db.enabled ? "Saved in this browser only. Run supabase/schema.sql again in Supabase to share decisions with students."
      : "Demo mode: saved in this browser, and the student view here reacts to it.";

  let check = "";
  if (draft.action === "cancel") {
    check = x.booked
      ? `<p class="d-check warn">${x.booked} student${x.booked === 1 ? " has" : "s have"} booked. Cancelling offers ${x.booked === 1 ? "them" : "each of them"} a carpool automatically.</p>`
      : '<p class="d-check">Nobody has booked yet.</p>';
  } else if (seats < x.booked) {
    check = `<p class="d-check bad">Only ${seats} seats for ${x.booked} students already booked.</p>`;
  } else if (seats < Math.ceil(x.high)) {
    check = `<p class="d-check warn">${seats} seats is below the high end of the forecast (${Math.ceil(x.high)}). Some students may not get a seat.</p>`;
  } else {
    check = `<p class="d-check good">${seats} seats covers the high end of the forecast (${Math.ceil(x.high)}).</p>`;
  }

  panel.innerHTML = `
    <div class="card-head">
      <div><h2>Route ${x.trip.route} · ${dayLabel(x.trip)}</h2>
      <span class="muted small">${esc(data.config.ROUTES[x.trip.route].name)} · ${x.left > 0 ? `${x.left} days to departure` : "departed"}</span></div>
      <span class="tags">${statusTag(x)}</span>
    </div>
    <div class="table-wrap"><table class="table kv"><tbody>
      <tr><td>Booked so far</td><td>${x.booked}${x.live ? ` <span class="muted small">(${x.live} on ShareWay)</span>` : ""}</td></tr>
      <tr><td>Forecast final passengers</td><td>${Math.round(x.mid)} <span class="muted small">(likely ${Math.round(x.low)}–${Math.round(x.high)})</span></td></tr>
      <tr><td>AI suggests</td><td>${planText(x.ai)} <span class="muted small">(${seatsFor(x.ai)} seats)</span></td></tr>
    </tbody></table></div>
    <div class="d-form">
      <span class="d-label">Your decision</span>
      <div class="segmented" id="d-action" aria-label="Decision"></div>
      <div class="d-bus-row" ${draft.action === "bus" ? "" : "hidden"}>
        <label class="d-inline">Buses
          <span class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="One bus fewer">−</button>
            <input id="d-buses" type="number" min="1" max="${MAX_BUSES}" value="${draft.buses || 1}" aria-label="Number of buses">
            <button type="button" class="icon-btn" data-step="1" aria-label="One more bus">+</button>
          </span>
        </label>
        <label class="d-inline"><input id="d-standby" type="checkbox" ${draft.standby ? "checked" : ""}> Standby bus</label>
      </div>
      ${check}
      <label class="field"><span>Note for students (optional)</span>
        <input id="d-note" type="text" maxlength="120" placeholder="${draft.action === "cancel" ? "e.g. fewer than 5 students booked" : "e.g. bus leaves from Pocket D"}" value="${esc(draft.note ?? "")}">
      </label>
      <div class="card-actions">
        <button type="button" class="btn-ghost" data-act="use-ai" ${sameAsAi(draft, x.ai) ? "disabled" : ""}>Use AI suggestion</button>
        ${x.decided ? '<button type="button" class="btn-ghost" data-act="undo">Undo decision</button>' : ""}
        <button type="button" class="btn${newCancel ? " btn-danger" : ""}" data-act="save" ${dc.busy ? "disabled" : ""}>
          ${newCancel ? "Cancel trip and offer carpools" : x.decided ? "Update decision" : "Confirm decision"}</button>
      </div>
      <p class="muted small">${store}</p>
    </div>`;

  segmented($("d-action"), [["bus", "Bus"], ["van", "Van"], ["cancel", "Cancel trip"]], draft.action, (v) => {
    dc.draft.action = v;
    if (v === "bus" && !dc.draft.buses) dc.draft.buses = Math.max(1, x.ai.buses || 1);
    renderPanel(x);
  });
}

function renderCarpool() {
  const card = $("d-carpool");
  const x = eventTrips().map(info).find((r) => tripKey(r.trip) === dc.sel);
  const show = x?.decided?.action === "cancel";
  card.hidden = !show;
  if (!show) return;
  loadRealRiders(x);
  const offers = offerCarpools(x.trip.date, ridersFor(x));
  const matched = offers.filter((o) => o.match).length;
  $("d-cp-title").textContent = `Carpool for Route ${x.trip.route} · ${dayLabel(x.trip)}`;
  $("d-cp-sub").textContent = offers.length
    ? `${matched} of ${offers.length} student${offers.length === 1 ? "" : "s"} matched with a student driver leaving around ${BUS_TIME}`
    : "Nobody had booked this trip, so nobody needs a carpool.";
  const body = $("d-cp-body");
  replay(body, "fresh");
  body.innerHTML = offers.map(({ rider, match }) => `<tr>
      <td><strong>${esc(rider.name)}</strong>${rider.email ? `<br><span class="muted small">${esc(rider.email)}</span>` : rider.simulated ? '<br><span class="muted small">simulated</span>' : ""}</td>
      <td>${esc(rider.town)}</td>
      <td>${match ? `<span class="tag van">Driver ${match.driver.id}</span>` : '<span class="tag cancel">No driver yet</span>'}</td>
      <td class="num">${match ? clock(match.driver.minute) : "–"}</td>
      <td class="num">${match ? `${match.detour_km} km` : "–"}</td>
    </tr>`).join("") || '<tr><td colspan="5" class="muted">No students to move.</td></tr>';
  $("d-cp-note").textContent = matched < offers.length
    ? "Students without a driver can pick another time on their Carpool page, or PMMD can keep a van for them."
    : "";
}

// ---------- actions ----------

function selected() {
  return eventTrips().map(info).find((x) => tripKey(x.trip) === dc.sel);
}

function onPanelChange(e) {
  if (!dc.draft) return;
  if (e.target.id === "d-note") { dc.draft.note = e.target.value; return; }
  if (e.target.id === "d-buses") {
    dc.draft.buses = Math.min(MAX_BUSES, Math.max(1, Number(e.target.value) || 1));
    if (e.type === "change") renderPanel(selected());
  }
  if (e.target.id === "d-standby") { dc.draft.standby = e.target.checked; renderPanel(selected()); }
}

async function onPanelClick(e) {
  const step = e.target.closest("[data-step]");
  if (step) {
    dc.draft.buses = Math.min(MAX_BUSES, Math.max(1, (dc.draft.buses || 1) + Number(step.dataset.step)));
    renderPanel(selected());
    return;
  }
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const x = selected();
  if (btn.dataset.act === "use-ai") { dc.draft = { ...x.ai, note: dc.draft.note ?? "" }; renderPanel(x); return; }
  if (btn.dataset.act === "undo") {
    await run(() => clearDecision(x.trip.route, x.trip.date), "Decision removed: the AI suggestion is shown again");
    dc.draft = null;
    return;
  }
  if (btn.dataset.act === "save") {
    const d = { route: x.trip.route, date: x.trip.date, ...dc.draft };
    const msg = d.action === "cancel"
      ? `Route ${d.route} on ${dayLabel(x.trip)} cancelled. ${x.booked
        ? `${x.booked} student${x.booked === 1 ? "" : "s"} offered a carpool.` : "Nobody had booked it."}`
      : `Route ${d.route} on ${dayLabel(x.trip)}: ${planText(d)} confirmed`;
    await run(() => setDecisions([d]), msg);
    dc.draft = null;
  }
}

async function acceptAll() {
  const open = eventTrips().map(info).filter((x) => !x.decided);
  if (!open.length) return;
  const cancels = open.filter((x) => x.ai.action === "cancel").length;
  await run(() => setDecisions(open.map((x) => ({ route: x.trip.route, date: x.trip.date, ...x.ai, note: "" }))),
    `${open.length} trips decided as the AI suggested${cancels ? `, ${cancels} cancelled with carpools offered` : ""}`);
}

async function run(fn, okText) {
  dc.busy = true;
  renderDecide();
  const res = await fn();
  dc.busy = false;
  renderDecide();
  toast(res.error ?? okText);
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3200);
}

/** The decisions for the break on the Decide page, as text for the AI assistant. */
export function decideFacts() {
  if (!data || !dc.eventKey) return "";
  const rows = eventTrips().map(info);
  const ev = events.get(dc.eventKey);
  const lines = [`Trip decisions for ${ev.event} (${dc.route === "all" ? "all routes" : `Route ${dc.route}`}):`];
  for (const x of rows) {
    lines.push(`- Route ${x.trip.route} ${x.trip.date}: booked ${x.booked}, forecast ${Math.round(x.mid)} (likely ${Math.round(x.low)}-${Math.round(x.high)}), `
      + `AI suggests ${planText(x.ai)}, PMMD decision: ${x.decided ? planText(x.decided) : "not decided yet"}.`);
  }
  lines.push(`When PMMD cancels a trip, its students are offered a carpool automatically (drivers leaving within ${data.config.MAX_TIME_DIFF_HOURS} h, detour up to ${data.config.MAX_DETOUR_KM} km).`);
  return lines.join("\n");
}
