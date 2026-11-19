// ShareWay UTP dashboard. Data: data/dashboard.json (built by src/export_web.py).
import { createLogic, round, dayOfWeek } from "./logic.js";
import {
  $, num, MONTHS, DAYS, COLORS, charts, fmtDate, addDays, option, segmented, areaGradient, hexAlpha,
  REDUCED, countUp, replay, setChart, axisTitle, setupChartDefaults,
} from "./ui.js";
import { setupStudent, renderStudent } from "./student.js";

// page id: [title, subtitle, view]
const PAGES = {
  overview: ["Dashboard", "Demand forecast and vehicle plan for each break", "operator"],
  forecast: ["What-if forecast", "Type in a trip and see the forecast and the vehicles to book", "operator"],
  carpool: ["Carpool matching", "Students the buses can't serve, paired with student drivers", "operator"],
  emissions: ["CO₂ and cost saved", "A shared trip compared with every student travelling alone", "operator"],
  student: ["Plan my trip home", "University bus, carpool or going alone: compare your options", "student"],
  "student-carpool": ["Carpool", "Find a ride home, or share your spare seats", "student"],
  "student-trips": ["My trips", "What you've booked and what you've saved", "student"],
};
const HOME = { operator: "overview", student: "student" };
const ROLE = { operator: "Transport planner", student: "Student" };
const VIEW_KEY = "shareway.view";

function savedView() {
  try { return localStorage.getItem(VIEW_KEY) === "student" ? "student" : "operator"; } catch { return "operator"; }
}

let data;
let L;

function routeName(code) {
  return `Route ${code} · ${data.config.ROUTES[code].name}`;
}

function planText(rec) {
  if (rec.action === "cancel") return "Cancel";
  if (rec.action === "van") return "1 van";
  return `${rec.buses} bus${rec.buses > 1 ? "es" : ""}`;
}

function planTag(rec) {
  const tag = `<span class="tag ${rec.action}">${planText(rec)}</span>`;
  return rec.standby ? `${tag} <span class="tag standby">+ standby</span>` : tag;
}

// ---------- navigation ----------

let currentPage = "overview";

function showPage(page) {
  if (!PAGES[page]) page = HOME[savedView()];
  currentPage = page;
  const view = PAGES[page][2];
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode: not remembered */ }

  for (const p of Object.keys(PAGES)) $(`page-${p}`).hidden = p !== page;
  document.querySelectorAll(".nav-group").forEach((g) => { g.hidden = g.dataset.view !== view; });
  document.querySelectorAll(".view-switch button").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on);
  });
  document.body.dataset.view = view;
  $("profile-role").textContent = ROLE[view];
  $("avatar").textContent = view === "student" ? "ME" : "G7";
  document.querySelectorAll(".nav-item").forEach((b) => {
    const on = b.dataset.page === page;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
  });
  $("page-title").textContent = PAGES[page][0];
  $("page-sub").textContent = PAGES[page][1];
  if (page === "carpool") renderCarpool();
  if (view === "student") renderStudent(page);
  window.scrollTo({ top: 0 });

  // cards rise in one after another, and the charts draw again
  const el = $(`page-${page}`);
  el.querySelectorAll(".card").forEach((c, i) => c.style.setProperty("--i", i));
  replay(el, "enter");
  clearTimeout(el._enterTimer);
  el._enterTimer = setTimeout(() => el.classList.remove("enter"), 1500);
  if (!REDUCED) {
    for (const ch of Object.values(charts)) {
      if (el.contains(ch.canvas)) { ch.reset(); ch.update(); }
    }
  }
}

function setupNav() {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => { location.hash = b.dataset.page; }));
  document.querySelectorAll(".view-switch button").forEach((b) =>
    b.addEventListener("click", () => { location.hash = HOME[b.dataset.view]; }));
  $("home-link").addEventListener("click", (e) => {
    e.preventDefault();
    location.hash = HOME[PAGES[currentPage][2]];
  });
  window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
}

// ---------- overview ----------

const ov = { eventKey: null, route: "all", run: 0, days: 7, tripId: null, view: "curve" };
let events = new Map();

function buildEvents() {
  for (const t of data.trips) {
    const firstDay = addDays(t.date, -t.offset);
    const key = `${t.event}|${firstDay}`;
    if (!events.has(key)) events.set(key, { key, event: t.event, firstDay, trips: [] });
    events.get(key).trips.push(t);
  }
  events = new Map([...events.entries()].sort((a, b) => a[1].firstDay.localeCompare(b[1].firstDay)));
}

function setupOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const list = [...events.values()];
  ov.eventKey = (list.find((e) => e.firstDay >= today) ?? list[list.length - 1]).key;

  const fEvent = $("f-event");
  for (const e of list) {
    const [y, m] = e.firstDay.split("-").map(Number);
    fEvent.append(option(e.key, `${e.event} · ${MONTHS[m - 1]} ${y}`, e.key === ov.eventKey));
  }
  const fRoute = $("f-route");
  fRoute.append(option("all", "All routes", true));
  for (const code of Object.keys(data.config.ROUTES)) fRoute.append(option(code, routeName(code)));

  const runs = [...new Set(data.trips.map((t) => t.run))].sort((a, b) => a - b);
  for (const r of runs) $("f-run").append(option(r, `Simulation ${r + 1} of ${runs.length}`, r === ov.run));

  for (const d of data.config.SNAPSHOT_DAYS) {
    $("f-days").append(option(d, `${d} day${d > 1 ? "s" : ""} before departure`, d === ov.days));
  }

  fEvent.addEventListener("change", () => { ov.eventKey = fEvent.value; ov.tripId = null; renderOverview(); });
  fRoute.addEventListener("change", () => { ov.route = fRoute.value; ov.tripId = null; renderOverview(); });
  $("f-run").addEventListener("change", (e) => { ov.run = Number(e.target.value); ov.tripId = null; renderOverview(); });
  $("f-days").addEventListener("change", (e) => { ov.days = Number(e.target.value); renderOverview(); });
  $("f-trip").addEventListener("change", (e) => { ov.tripId = Number(e.target.value); renderOverview(); });

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    ov.view = t.dataset.view;
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("active", x === t);
      x.setAttribute("aria-selected", x === t);
    });
    $("view-curve").hidden = ov.view !== "curve";
    $("view-plan").hidden = ov.view !== "plan";
  }));
}

function selectedTrips() {
  const ev = events.get(ov.eventKey);
  return ev.trips
    .filter((t) => t.run === ov.run && (ov.route === "all" || t.route === ov.route))
    .sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route))
    .map((t) => {
      const snap = t.snaps.find((s) => s[0] === ov.days);
      return { ...t, bookings: snap[1], predicted: snap[2], rec: L.recommend(snap[2]) };
    });
}

function maeAt(model, days) {
  const acc = data.accuracy.by_days_before;
  return acc.series[model][acc.days.indexOf(days)];
}

function renderOverview() {
  const ev = events.get(ov.eventKey);
  const trips = selectedTrips();
  if (!trips.some((t) => t.id === ov.tripId)) {
    ov.tripId = trips.reduce((a, b) => (b.final > a.final ? b : a), trips[0]).id; // busiest trip
  }

  // KPIs
  const predTotal = trips.reduce((s, t) => s + t.predicted, 0);
  const actualTotal = trips.reduce((s, t) => s + t.final, 0);
  const count = (a) => trips.filter((t) => t.rec.action === a).length;
  const buses = trips.reduce((s, t) => s + t.rec.buses, 0);
  const standby = trips.filter((t) => t.rec.standby).length;

  countUp($("k-pred"), round(predTotal));
  $("k-pred-sub").textContent = `Actual (simulated): ${num.format(actualTotal)}`;
  countUp($("k-trips"), trips.length);
  $("k-trips-sub").textContent = `${count("bus")} bus · ${count("van")} van · ${count("cancel")} cancelled`;
  countUp($("k-buses"), buses);
  $("k-buses-sub").textContent = `${standby} standby · ${count("van")} van${count("van") === 1 ? "" : "s"}`;
  countUp($("k-mae"), maeAt("Random Forest", ov.days), (v) => `±${v.toFixed(1)}`);
  $("k-mae-sub").textContent = `passengers per trip, ${ov.days} day${ov.days > 1 ? "s" : ""} out`;

  // Trip picker
  const fTrip = $("f-trip");
  fTrip.innerHTML = "";
  for (const t of trips) {
    fTrip.append(option(t.id, `${fmtDate(t.date)} · Route ${t.route}`, t.id === ov.tripId));
  }

  renderBars(trips);
  renderTrip(trips.find((t) => t.id === ov.tripId));
  renderCurve(ev, trips, predTotal, actualTotal);
  renderPlan(trips);
}

function renderBars(trips) {
  const labels = trips.map((t) => (ov.route === "all" ? [fmtDate(t.date), `Route ${t.route}`] : fmtDate(t.date)));
  const sel = trips.findIndex((t) => t.id === ov.tripId);
  const fade = (c, i) => (i === sel ? c : hexAlpha(c, 0.55));
  setChart("bars", "c-bars", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Forecast", data: trips.map((t) => round(t.predicted)), backgroundColor: trips.map((_, i) => fade(COLORS.accent, i)), borderRadius: 4, maxBarThickness: 14 },
        { label: "Actual (simulated)", data: trips.map((t) => t.final), backgroundColor: trips.map((_, i) => fade(COLORS.grey, i)), borderRadius: 4, maxBarThickness: 14 },
      ],
    },
    options: {
      onClick: (_, els) => {
        if (!els.length) return;
        ov.tripId = trips[els[0].index].id;
        renderOverview();
      },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, title: axisTitle("Passengers") },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => { const t = trips[items[0].dataIndex]; return `${fmtDate(t.date, true)} · Route ${t.route}`; },
            afterBody: (items) => `Plan: ${planText(trips[items[0].dataIndex].rec)}`,
          },
        },
      },
    },
  });
}

function snapLabels() {
  return [...data.config.SNAPSHOT_DAYS.map((d) => `${d}d`), "Depart"];
}

function renderTrip(trip) {
  const snaps = trip.snaps;
  const idx = snaps.findIndex((s) => s[0] === ov.days);
  const point = (i) => (i === idx ? 5 : 2.5);
  setChart("trip", "c-trip", {
    type: "line",
    data: {
      labels: snapLabels(),
      datasets: [
        {
          label: "Bookings so far", data: snaps.map((s) => s[1]), borderColor: COLORS.accent,
          backgroundColor: areaGradient(COLORS.accent), fill: true, borderWidth: 2.5,
          pointRadius: snaps.map((_, i) => point(i)), pointBackgroundColor: COLORS.accent,
        },
        {
          label: "Forecast final", data: snaps.map((s) => s[2]), borderColor: COLORS.primary,
          borderWidth: 2, pointRadius: snaps.map((_, i) => point(i)), pointBackgroundColor: COLORS.primary,
        },
        {
          label: "Actual final (simulated)", data: snapLabels().map(() => trip.final), borderColor: COLORS.text,
          borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0,
        },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, title: axisTitle("Days before departure") },
        y: { beginAtZero: true, title: axisTitle("Passengers") },
      },
      plugins: {
        tooltip: {
          callbacks: { title: (items) => `${fmtDate(trip.date, true)} · Route ${trip.route} · ${items[0].label}` },
          filter: (item) => item.raw !== null,
        },
      },
    },
  });
}

function renderCurve(ev, trips, predTotal, actualTotal) {
  const days = data.config.SNAPSHOT_DAYS;
  const sums = days.map((d) => trips.reduce((s, t) => s + t.snaps.find((x) => x[0] === d)[1], 0));
  const idx = days.indexOf(ov.days);
  const n = days.length + 1; // + departure
  const known = sums.map((v, i) => (i <= idx ? v : null)).concat(null);
  const later = sums.map((v, i) => (i >= idx ? v : null)).concat(null);
  const forecast = Array.from({ length: n }, (_, i) => (i >= idx ? round(predTotal) : null));
  const actual = Array.from({ length: n }, (_, i) => (i === n - 1 ? actualTotal : null));

  const routeText = ov.route === "all" ? "all routes" : routeName(ov.route);
  $("w-title").textContent = `Bookings for ${ev.event}`;
  $("w-sub").textContent = `Break starts ${fmtDate(ev.firstDay, true)} · ${routeText} · ${trips.length} trips · `
    + "final passengers end up below bookings because some students don't show up";
  countUp($("b-value"), round(predTotal), (v) => num.format(v), 1000);
  $("b-label").textContent = `Forecast passengers, ${ov.days} day${ov.days > 1 ? "s" : ""} before`;

  setChart("curve", "c-curve", {
    type: "line",
    data: {
      labels: snapLabels(),
      datasets: [
        {
          label: "Bookings so far", data: known, borderColor: COLORS.accent, backgroundColor: areaGradient(COLORS.accent, 0.28),
          fill: true, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: COLORS.accent, tension: 0.25,
        },
        {
          label: "Bookings still to come (simulated)", data: later, borderColor: COLORS.grey, borderWidth: 2,
          pointRadius: 2, pointBackgroundColor: COLORS.grey, tension: 0.25,
        },
        {
          label: "Forecast final passengers", data: forecast, borderColor: COLORS.green, borderDash: [6, 5],
          borderWidth: 2.5, pointRadius: 0, tension: 0,
        },
        {
          label: "Actual final (simulated)", data: actual, borderColor: COLORS.text, backgroundColor: COLORS.text,
          pointRadius: 6, pointStyle: "rectRot", showLine: false,
        },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, title: axisTitle("Days before departure") },
        y: { beginAtZero: true, title: axisTitle("Students (all trips)") },
      },
      plugins: {
        legend: {
          display: true, position: "bottom", align: "end",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 11.5 } },
        },
        tooltip: { filter: (item) => item.raw !== null },
      },
    },
  });
}

function renderPlan(trips) {
  replay($("plan-body"), "fresh");
  $("plan-body").innerHTML = trips.map((t) => `
    <tr>
      <td>${DAYS[t.dow]} ${fmtDate(t.date, true)}</td>
      <td>Route ${t.route}</td>
      <td class="num">${t.bookings}</td>
      <td class="num"><strong>${round(t.predicted)}</strong></td>
      <td>${planTag(t.rec)}</td>
      <td class="num">${t.final}</td>
    </tr>`).join("");
}

// ---------- what-if forecast ----------

const wf = { route: "B", date: null, holiday: 0, days: 7, bookings: 40 };

function setupForecast() {
  const today = new Date().toISOString().slice(0, 10);
  const next = data.breaks.filter((b) => b.first_day >= today).sort((a, b) => a.first_day.localeCompare(b.first_day))[0]
    ?? data.breaks[data.breaks.length - 1];
  wf.date = addDays(next.first_day, -1);
  wf.holiday = next.is_holiday;

  segmented($("w-route"), Object.keys(data.config.ROUTES).map((c) => [c, `${c} · ${data.config.ROUTES[c].name}`]),
    wf.route, (v) => { wf.route = v; renderForecast(); });

  const days = $("w-days");
  days.min = Math.min(...data.config.SNAPSHOT_DAYS);
  days.max = Math.max(...data.config.SNAPSHOT_DAYS);
  days.value = wf.days;
  $("w-book").value = wf.bookings;
  $("w-date").value = wf.date;
  $("w-holiday").value = String(wf.holiday);

  $("w-date").addEventListener("change", (e) => {
    if (!e.target.value) return;
    wf.date = e.target.value;
    // pick the trip type of the nearest break or holiday; it can still be changed by hand
    const near = [0, 1].map((h) => ({ h, o: L.departureOffset(wf.date, h) }))
      .sort((a, b) => Math.abs(a.o.days) - Math.abs(b.o.days))[0];
    wf.holiday = near.h;
    $("w-holiday").value = String(wf.holiday);
    renderForecast();
  });
  $("w-holiday").addEventListener("change", (e) => { wf.holiday = Number(e.target.value); renderForecast(); });
  days.addEventListener("input", (e) => { wf.days = Number(e.target.value); renderForecast(); });
  $("w-book").addEventListener("input", (e) => { wf.bookings = Number(e.target.value); renderForecast(); });

  renderAccuracy();
}

function renderForecast() {
  $("w-days-out").textContent = `${wf.days} day${wf.days === 1 ? "" : "s"}`;
  $("w-book-out").textContent = wf.bookings;

  const near = L.departureOffset(wf.date, wf.holiday);
  const when = near.days === 0 ? "on the first day of"
    : `${Math.abs(near.days)} day${Math.abs(near.days) === 1 ? "" : "s"} ${near.days < 0 ? "before" : "after"} the first day of`;
  $("w-context").textContent = `${DAYS[dayOfWeek(wf.date)]} ${fmtDate(wf.date, true)}, ${when} ${near.event}.`
    + (Math.abs(near.days) > 7 ? " This is far from any break in the calendar, so the forecast is less reliable." : "");

  const pred = L.predictFinal(wf.route, wf.days, wf.bookings, wf.date, wf.holiday);
  const rec = L.recommend(pred);
  const demand = Math.max(0, Math.ceil(pred));
  countUp($("r-pred"), round(pred), (v) => Math.round(v), 400);

  const badge = $("r-badge");
  const text = rec.action === "cancel"
    ? `Cancel the trip (under ${data.config.MIN_PASSENGERS} passengers) and offer carpools`
    : rec.action === "van" ? "Send 1 van"
      : `Send ${rec.buses} bus${rec.buses > 1 ? "es" : ""}${rec.standby ? " and keep 1 on standby" : ""}`;
  if (badge.textContent !== text) {
    badge.className = `badge ${rec.action}`;
    badge.textContent = text;
    replay(badge, "pop");
  }

  const cap = data.config.BUS_CAPACITY;
  const vehicles = [];
  if (rec.action === "van") vehicles.push({ kind: "van", name: "Van", load: demand, cap: data.config.VAN_CAPACITY });
  for (let i = 0; i < rec.buses; i++) {
    vehicles.push({ kind: "bus", name: `Bus ${i + 1}`, load: Math.min(cap, demand - i * cap), cap });
  }
  if (rec.standby) vehicles.push({ kind: "bus standby", name: "Standby", load: 0, cap });
  // Keep the same cards when the fleet is unchanged so the seat bars slide
  const fleet = $("r-fleet");
  const shape = vehicles.map((v) => v.kind).join(",");
  if (fleet.dataset.shape !== shape) {
    fleet.dataset.shape = shape;
    fleet.innerHTML = vehicles.map((v) => `
      <div class="vehicle ${v.kind} pop">
        <header>${v.name}<span></span></header>
        <div class="bar"><i style="width:0%"></i></div>
      </div>`).join("");
  }
  requestAnimationFrame(() => {
    [...fleet.children].forEach((card, i) => {
      const v = vehicles[i];
      card.querySelector("header span").textContent = v.kind.includes("standby") ? "if needed" : `${v.load}/${v.cap}`;
      card.querySelector(".bar i").style.width = `${(100 * v.load) / v.cap}%`;
    });
  });

  const webMae = data.accuracy.overall["Web model (compact)"];
  $("r-note").textContent = `An estimate, not a guarantee: on trips it never saw, this forecast was off by about `
    + `${round(webMae, 1)} passengers on average. It uses a smaller copy of the trained Random Forest so it can run in the browser.`;
}

function renderAccuracy() {
  const acc = data.accuracy;
  const styles = {
    Baseline: { c: COLORS.grey, dash: [] },
    "Linear Regression": { c: COLORS.amber, dash: [] },
    "Random Forest": { c: COLORS.primary, dash: [] },
    "Web model (compact)": { c: COLORS.accent, dash: [5, 4] },
  };
  const names = Object.keys(acc.by_days_before.series);
  $("acc-sub").textContent = `Average error in passengers on ${acc.test_trips} simulated trips the models never saw `
    + `(a trip has ${acc.mean_final} passengers on average). Lower is better.`;
  $("acc-legend").innerHTML = names.map((n) =>
    `<span><i class="${styles[n]?.dash.length ? "dash" : "dot"}" style="${styles[n]?.dash.length
      ? `border-color:${styles[n].c}` : `background:${styles[n]?.c}`}"></i>${n} (±${round(acc.overall[n], 1)})</span>`).join("");

  setChart("acc", "c-acc", {
    type: "line",
    data: {
      labels: acc.by_days_before.days.map((d) => `${d}d`),
      datasets: names.map((n) => ({
        label: n, data: acc.by_days_before.series[n], borderColor: styles[n]?.c ?? COLORS.text2,
        backgroundColor: styles[n]?.c, borderDash: styles[n]?.dash ?? [], borderWidth: n === "Random Forest" ? 3 : 2,
        pointRadius: 3, tension: 0,
      })),
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, title: axisTitle("Forecast made … days before departure") },
        y: { beginAtZero: true, title: axisTitle("Average error (passengers)") },
      },
      plugins: { tooltip: { callbacks: { label: (i) => ` ${i.dataset.label}: ±${i.raw}` } } },
    },
  });
}

// ---------- carpool ----------

const TRAVEL_DAY = [2026, 11, 15]; // 15 Dec 2026, the day before the Sept 2026 sem break (SIMULATED)
let towns = {};
const cp = { passengers: [], drivers: [], nextP: 1, nextD: 1 };
let map;
let mapLayer;

function setupCarpool() {
  for (const r of Object.values(data.config.ROUTES)) Object.assign(towns, r.stops);
  towns["Teluk Intan"] = [4.0259, 101.0213];
  towns = Object.fromEntries(Object.entries(towns).sort((a, b) => a[0].localeCompare(b[0])));

  // Same made-up example as carpool.py's demo() (SIMULATED)
  const P = [["Kuala Lumpur", "09:00"], ["Kuala Lumpur", "11:00"], ["Kuala Lumpur", "10:00"], ["Teluk Intan", "09:00"], ["Ipoh", "10:00"]];
  const D = [["Kuala Lumpur", "09:00", 2, true], ["Kuala Lumpur", "14:00", 3, true], ["Kuala Lumpur", "09:00", 3, false], ["Ipoh", "10:00", 1, true]];
  cp.passengers = P.map(([town, time]) => ({ id: `P${cp.nextP++}`, town, time }));
  cp.drivers = D.map(([town, time, seats, willing]) => ({ id: `D${cp.nextD++}`, town, time, seats, willing }));

  $("add-p").addEventListener("click", () => {
    cp.passengers.push({ id: `P${cp.nextP++}`, town: "Kuala Lumpur", time: "09:00" });
    renderCarpool();
  });
  $("add-d").addEventListener("click", () => {
    cp.drivers.push({ id: `D${cp.nextD++}`, town: "Kuala Lumpur", time: "09:00", seats: 3, willing: true });
    renderCarpool();
  });
  $("m-rules").textContent = `Leave within ${data.config.MAX_TIME_DIFF_HOURS} h, detour up to ${data.config.MAX_DETOUR_KM} km`;
}

function townSelect(value) {
  return `<select data-k="town" aria-label="Destination">${Object.keys(towns)
    .map((t) => `<option${t === value ? " selected" : ""}>${t}</option>`).join("")}</select>`;
}

function renderEditTables() {
  $("p-body").innerHTML = cp.passengers.map((p, i) => `
    <tr data-i="${i}" data-list="passengers">
      <td><strong>${p.id}</strong></td>
      <td>${townSelect(p.town)}</td>
      <td><input type="time" data-k="time" value="${p.time}" aria-label="Departure time"></td>
      <td><button class="icon-btn" data-remove title="Remove ${p.id}" aria-label="Remove ${p.id}">×</button></td>
    </tr>`).join("");
  $("d-body").innerHTML = cp.drivers.map((d, i) => `
    <tr data-i="${i}" data-list="drivers">
      <td><strong>${d.id}</strong></td>
      <td>${townSelect(d.town)}</td>
      <td><input type="time" data-k="time" value="${d.time}" aria-label="Departure time"></td>
      <td><input type="number" data-k="seats" min="0" max="6" value="${d.seats}" aria-label="Spare seats"></td>
      <td><input type="checkbox" data-k="willing" ${d.willing ? "checked" : ""} aria-label="Offering seats"></td>
      <td><button class="icon-btn" data-remove title="Remove ${d.id}" aria-label="Remove ${d.id}">×</button></td>
    </tr>`).join("");
}

function onEditTable(e) {
  const tr = e.target.closest("tr[data-list]");
  if (!tr) return;
  const list = cp[tr.dataset.list];
  const i = Number(tr.dataset.i);
  if (e.type === "click" && e.target.closest("[data-remove]")) {
    list.splice(i, 1);
    renderCarpool();
    return;
  }
  const k = e.target.dataset.k;
  if (!k || e.type !== "change") return;
  list[i][k] = k === "willing" ? e.target.checked : k === "seats" ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
  renderCarpool(false);
}

function toMs(time) {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return Date.UTC(TRAVEL_DAY[0], TRAVEL_DAY[1], TRAVEL_DAY[2], h, m);
}

function renderCarpool(rebuildTables = true) {
  if (rebuildTables) renderEditTables();
  const passengers = cp.passengers.map((p) => ({
    passenger_id: p.id, departure_time: toMs(p.time), dest_lat: towns[p.town][0], dest_lon: towns[p.town][1],
  }));
  const drivers = cp.drivers.map((d) => ({
    driver_id: d.id, departure_time: toMs(d.time), dest_lat: towns[d.town][0], dest_lon: towns[d.town][1],
    spare_seats: d.seats, willing: d.willing,
  }));
  const matches = L.match(passengers, drivers);
  const townOf = (id) => [...cp.passengers, ...cp.drivers].find((x) => x.id === id)?.town;

  replay($("m-body"), "fresh");
  $("m-body").innerHTML = matches.length ? matches.map((m) => `
    <tr>
      <td><strong>${m.passenger_id}</strong> <span class="muted">→ ${townOf(m.passenger_id)}</span></td>
      <td><strong>${m.driver_id}</strong> <span class="muted">→ ${townOf(m.driver_id)}</span></td>
      <td class="num">${m.time_diff_hours === 0 ? "same time" : `${round(m.time_diff_hours * 60)} min`}</td>
      <td class="num">${m.detour_km} km</td>
    </tr>`).join("") : `<tr><td colspan="4" class="muted">No carpool matches found.</td></tr>`;

  const matchedIds = new Set(matches.map((m) => m.passenger_id));
  const unmatched = cp.passengers.filter((p) => !matchedIds.has(p.id));
  $("m-unmatched").textContent = unmatched.length
    ? `Not matched: ${unmatched.map((p) => `${p.id} (${p.town})`).join(", ")}. They need a bus, a van or another driver.`
    : cp.passengers.length ? "Everyone has a ride." : "";

  const offering = cp.drivers.filter((d) => d.willing && d.seats > 0);
  const used = new Set(matches.map((m) => m.driver_id));
  const seats = offering.reduce((s, d) => s + d.seats, 0);
  const avg = (k) => matches.reduce((s, m) => s + m[k], 0) / matches.length;
  $("m-matched").textContent = `${matches.length}/${cp.passengers.length}`;
  $("m-matched-sub").textContent = `${unmatched.length} still need a ride`;
  $("m-drivers").textContent = `${used.size}/${offering.length}`;
  $("m-drivers-sub").textContent = `${seats - matches.length} of ${seats} seats still free`;
  $("m-time").textContent = matches.length ? `${round(avg("time_diff_hours") * 60)} min` : "–";
  $("m-time-sub").textContent = "between passenger and driver";
  $("m-detour").textContent = matches.length ? `${round(avg("detour_km"), 1)} km` : "–";
  $("m-detour-sub").textContent = "extra driving per passenger";

  if (currentPage === "carpool") renderMap(matches);
}

function renderMap(matches) {
  const Lf = window.L; // Leaflet (the logic module is the local "L")
  if (!Lf) return;
  if (!map) {
    map = Lf.map("map", { scrollWheelZoom: false, attributionControl: true });
    Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapLayer = Lf.layerGroup().addTo(map);
  }
  map.invalidateSize();
  mapLayer.clearLayers();

  const utp = data.config.UTP;
  const pts = [utp];
  for (const m of matches) {
    const p = towns[cp.passengers.find((x) => x.id === m.passenger_id).town];
    const d = towns[cp.drivers.find((x) => x.id === m.driver_id).town];
    Lf.polyline([utp, p, d], { color: COLORS.primary, weight: 2.5, opacity: 0.8, className: "route-line" }).addTo(mapLayer);
  }

  const byTown = {};
  for (const p of cp.passengers) (byTown[p.town] ??= { p: [], d: [] }).p.push(p);
  for (const d of cp.drivers) (byTown[d.town] ??= { p: [], d: [] }).d.push(d);
  for (const [town, who] of Object.entries(byTown)) {
    const [lat, lon] = towns[town];
    pts.push([lat, lon]);
    if (who.p.length) {
      Lf.circleMarker([lat, lon - 0.05], { radius: 6 + who.p.length, color: "#fff", weight: 2, fillColor: COLORS.accent, fillOpacity: 1 })
        .bindTooltip(`<div class="map-pin"><strong>${town}</strong><br>Passengers: ${who.p.map((x) => x.id).join(", ")}</div>`)
        .addTo(mapLayer);
    }
    if (who.d.length) {
      const active = who.d.some((x) => x.willing && x.seats > 0);
      Lf.circleMarker([lat, lon + 0.05], { radius: 6 + who.d.length, color: "#fff", weight: 2, fillColor: active ? COLORS.green : COLORS.grey, fillOpacity: 1 })
        .bindTooltip(`<div class="map-pin"><strong>${town}</strong><br>Drivers: ${who.d
          .map((x) => `${x.id}${x.willing ? ` (${x.seats} seats)` : " (not offering)"}`).join(", ")}</div>`)
        .addTo(mapLayer);
    }
  }
  Lf.circleMarker(utp, { radius: 9, color: "#fff", weight: 3, fillColor: COLORS.primary, fillOpacity: 1 })
    .bindTooltip('<div class="map-pin"><strong>UTP</strong><br>Everyone starts here</div>')
    .addTo(mapLayer);
  map.fitBounds(pts, { padding: [30, 30], maxZoom: 9 });
}

// ---------- emissions ----------

const em = { vehicle: "bus", baseline: "car", stop: "B|Kuala Lumpur", km: 0, n: 40, detour: 2 };
const N_MAX = { bus: 88, van: 20, carpool: 4 };

function setupEmissions() {
  segmented($("e-vehicle"), [["bus", "Bus"], ["van", "Van"], ["carpool", "Carpool"]], em.vehicle, (v) => {
    em.vehicle = v;
    if (v === "carpool") em.n = Math.min(em.n, 3);
    if (v === "van") em.n = Math.min(em.n, 8);
    renderEmissions();
  });
  segmented($("e-baseline"), [["car", "Driving alone"], ["ehailing", "E-hailing"]], em.baseline, (v) => {
    em.baseline = v;
    renderEmissions();
  });

  const sel = $("e-stop");
  for (const [code, r] of Object.entries(data.config.ROUTES)) {
    const g = document.createElement("optgroup");
    g.label = `Route ${code} · ${r.name}`;
    for (const stop of Object.keys(r.stops)) g.append(option(`${code}|${stop}`, stop, `${code}|${stop}` === em.stop));
    sel.append(g);
  }
  const other = document.createElement("optgroup");
  other.label = "Off route";
  other.append(option("town|Teluk Intan", "Teluk Intan"));
  other.append(option("custom", "Custom distance"));
  sel.append(other);
  em.km = L.stopKm("B", "Kuala Lumpur");

  sel.addEventListener("change", () => {
    em.stop = sel.value;
    const [code, stop] = em.stop.split("|");
    if (code === "town") em.km = L.distanceKm(data.config.UTP, [4.0259, 101.0213]);
    else if (code !== "custom") em.km = L.stopKm(code, stop);
    renderEmissions();
  });
  $("e-km").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    if (!(v > 0)) return;
    em.km = v;
    em.stop = "custom";
    sel.value = "custom";
    renderEmissions(false);
  });
  $("e-n").addEventListener("input", (e) => { em.n = Number(e.target.value); renderEmissions(); });
  $("e-detour").addEventListener("input", (e) => { em.detour = Number(e.target.value); renderEmissions(); });
}

function renderEmissions(updateKm = true) {
  const nInput = $("e-n");
  nInput.max = N_MAX[em.vehicle];
  em.n = Math.min(em.n, N_MAX[em.vehicle]);
  nInput.value = em.n;
  if (updateKm) $("e-km").value = round(em.km, 1);
  $("e-n-out").textContent = em.n;
  $("e-detour-row").hidden = em.vehicle !== "carpool";
  $("e-detour-out").textContent = `${em.detour} km`;

  const detour = em.vehicle === "carpool" ? em.detour : 0;
  const s = L.co2Saved(em.n, em.km, em.vehicle, em.baseline, detour);
  const alone = em.baseline === "car" ? "driving alone" : "e-hailing alone";

  const kg = $("s-kg");
  countUp(kg, s.kg_co2, (v) => `${v.toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`, 500);
  kg.classList.toggle("neg", s.kg_co2 < 0);
  $("s-kg-sub").textContent = `${s.solo_kg} kg ${alone} vs ${s.shared_kg} kg shared`;
  const rm = $("s-rm");
  countUp(rm, s.rm_saved, (v) => `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 500);
  rm.classList.toggle("neg", s.rm_saved < 0);
  $("s-rm-sub").textContent = `RM ${round(s.rm_saved / em.n, 2).toFixed(2)} each · all ${em.n} students together`;

  const roadKm = round(em.km * data.emissions.ROAD_FACTOR);
  const vehicleWord = em.vehicle === "carpool" ? "car" : em.vehicle;
  let note = `About ${roadKm} km by road (straight line × ${data.emissions.ROAD_FACTOR}), ${s.vehicles} ${vehicleWord}${s.vehicles > 1 ? (vehicleWord === "bus" ? "es" : "s") : ""}.`;
  if (s.kg_co2 < 0) {
    note += ` The shared trip emits more CO₂ than everyone ${alone}: a nearly empty ${vehicleWord} burns more fuel than a few cars. This is why trips under ${data.config.MIN_PASSENGERS} passengers are cancelled.`;
  }
  if (em.vehicle === "carpool") note += " The driver is going home anyway, so only the detour adds CO₂; riders split petrol and tolls with the driver.";
  $("s-note").textContent = note;

  drawCompare("kg", "c-kg", s.solo_kg, s.shared_kg, "kg CO₂", alone);
  drawCompare("rm", "c-rm", s.solo_rm, s.shared_rm, "RM", alone);
}

function drawCompare(key, canvas, soloValue, sharedValue, unit, alone) {
  setChart(key, canvas, {
    type: "bar",
    data: {
      labels: [alone === "driving alone" ? "Driving alone" : "E-hailing alone", `Shared ${em.vehicle}`],
      datasets: [{ data: [soloValue, sharedValue], backgroundColor: [COLORS.grey, COLORS.green], borderRadius: 6, maxBarThickness: 34 }],
    },
    options: {
      indexAxis: "y",
      layout: { padding: { left: 4 } },
      scales: { x: { beginAtZero: true, title: axisTitle(unit) }, y: { grid: { display: false }, ticks: { font: { size: 12 } } } },
      plugins: { tooltip: { callbacks: { label: (i) => ` ${num.format(i.raw)} ${unit}` } } },
    },
  });
}

// ---------- start ----------

async function init() {
  try {
    const res = await fetch("data/dashboard.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    const box = $("load-error");
    box.hidden = false;
    document.body.classList.remove("loading");
    box.textContent = `Could not load data/dashboard.json (${err.message}). Run "python src/export_web.py" from the repo root, `
      + "then serve the web/ folder (for example: python -m http.server -d web) instead of opening index.html as a file.";
    document.querySelectorAll(".page").forEach((p) => { p.hidden = true; });
    return;
  }
  L = createLogic(data);
  document.body.classList.remove("loading");
  if (typeof Chart === "undefined") {
    $("load-error").hidden = false;
    $("load-error").textContent = "Charts could not load (no internet connection to cdn.jsdelivr.net).";
    return;
  }
  setupChartDefaults();
  buildEvents();
  setupNav();
  setupOverview();
  setupForecast();
  setupCarpool();
  setupEmissions();
  $("p-body").addEventListener("change", onEditTable);
  $("d-body").addEventListener("change", onEditTable);
  $("p-body").addEventListener("click", onEditTable);
  $("d-body").addEventListener("click", onEditTable);

  renderOverview();
  renderForecast();
  renderEmissions();
  renderCarpool();
  setupStudent({ data, L, events, towns });
  showPage(location.hash.slice(1) || HOME[savedView()]);
}

init();
