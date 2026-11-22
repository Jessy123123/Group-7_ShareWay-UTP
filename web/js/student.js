// Student view: plan a trip home, find or offer a carpool, and keep track of bookings.
//
// Bus numbers come from the SIMULATED trips in dashboard.json (simulation run 1).
// The carpool drivers and riders are made up here with a fixed random seed per
// day, so everyone sees the same SIMULATED students. Bookings are only saved in
// this browser (localStorage): it is a demo, nothing is sent anywhere.

import { round } from "./logic.js";
import {
  $, num, MONTHS, DAYS, COLORS, charts, fmtDate, option, areaGradient,
  countUp, replay, setChart, axisTitle,
} from "./ui.js";
import { db } from "./db.js";
import { openAuth } from "./auth.js";

let data;
let L;
let events;
let towns;

const RUN = 0; // simulation run shown to students
const STORE = "shareway.trips.v1";
const st = { eventKey: null, town: "Kuala Lumpur", date: null, time: "09:00", role: "rider", seats: 3 };
let myTrips = [];

// ---------- small helpers ----------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const dayName = (iso) => DAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
const rm = (v) => `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kg = (v) => `${v.toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
const toMin = (time) => { const [h, m] = (time || "09:00").split(":").map(Number); return h * 60 + m; };
const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMs = (date, time) => Date.parse(`${date}T00:00:00Z`) + toMin(time) * 60000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function routeOf(town) {
  for (const [code, r] of Object.entries(data.config.ROUTES)) if (town in r.stops) return code;
  return null;
}

function directKm(town) {
  return L.distanceKm(data.config.UTP, towns[town]);
}

function eventDates(key) {
  return [...new Set(events.get(key).trips.filter((t) => t.run === RUN).map((t) => t.date))].sort();
}

function tripFor(key, route, date) {
  return events.get(key).trips.find((t) => t.run === RUN && t.route === route && t.date === date);
}

/** Bookings as they stand today: the latest snapshot that has already happened. */
function snapshotNow(trip) {
  const left = dayDiff(trip.date, todayIso());
  let pick = data.config.SNAPSHOT_DAYS[0];
  for (const d of data.config.SNAPSHOT_DAYS) if (d >= left) pick = d;
  return { left, snap: trip.snaps.find((s) => s[0] === pick) };
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2800);
}

// ---------- saved trips (this browser only) ----------

function loadTrips() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? []; } catch { return []; }
}

function saveTrips() {
  try { localStorage.setItem(STORE, JSON.stringify(myTrips)); } catch { /* private mode: kept until reload */ }
  updateBadge();
}

function updateBadge() {
  const n = allTrips().length;
  const badge = $("trips-badge");
  badge.hidden = n === 0;
  badge.textContent = n;
}

function addTrip(trip) {
  myTrips.push({ id: `${Date.now()}`, ...trip });
  saveTrips();
}

const hasTrip = (key) => myTrips.some((t) => t.key === key);

// ---------- SIMULATED carpool students ----------

const POOL_TOWNS = [
  ["Kuala Lumpur", 30], ["Ipoh", 12], ["Penang", 10], ["Teluk Intan", 9], ["Johor Bahru", 8],
  ["Seremban", 7], ["Melaka", 7], ["Alor Setar", 6], ["Kota Bharu", 6], ["Kuala Terengganu", 5],
];
const AVATAR_COLORS = ["#5b3fd9", "#4e7bf4", "#3fbf7f", "#e9a23b", "#e5566b", "#2bb3c0", "#8e5bd9"];
const poolCache = new Map();

function seeded(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted(rand, items) {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items[items.length - 1][0];
}

/** The same made-up drivers and riders every time for a given day. */
function pool(date) {
  if (poolCache.has(date)) return poolCache.get(date);
  const rand = seeded(`shareway-${date}`);
  const person = (prefix, i) => ({
    id: `${prefix}${String(i + 1).padStart(2, "0")}`,
    town: weighted(rand, POOL_TOWNS),
    minute: 7 * 60 + 30 * Math.floor(rand() * 23), // 07:00 to 18:00
    color: AVATAR_COLORS[Math.floor(rand() * AVATAR_COLORS.length)],
  });
  const drivers = Array.from({ length: 14 }, (_, i) => ({ ...person("D", i), seats: 1 + Math.floor(rand() * 4) }));
  const riders = Array.from({ length: 18 }, (_, i) => person("S", i));
  const result = { drivers, riders };
  poolCache.set(date, result);
  return result;
}

const asDriver = (d, date) => ({
  driver_id: d.id, departure_time: toMs(date, clock(d.minute)), dest_lat: towns[d.town][0], dest_lon: towns[d.town][1],
  spare_seats: d.seats, willing: true,
});
const asRider = (p, date) => ({
  passenger_id: p.id, departure_time: toMs(date, clock(p.minute)), dest_lat: towns[p.town][0], dest_lon: towns[p.town][1],
});

/** Every driver who could take me, best first (carpool.py rules, one driver at a time). */
function driversForMe() {
  const me = asRider({ id: "YOU", town: st.town, minute: toMin(st.time) }, st.date);
  const found = [];
  for (const d of pool(st.date).drivers) {
    const m = L.match([me], [asDriver(d, st.date)]);
    if (m.length) found.push({ driver: d, ...m[0] });
  }
  return found.sort((a, b) => a.time_diff_hours - b.time_diff_hours || a.detour_km - b.detour_km);
}

/** Riders I could take as a driver, using match() with me as the only driver. */
function ridersForMe() {
  const me = asDriver({ id: "YOU", town: st.town, minute: toMin(st.time), seats: st.seats }, st.date);
  const riders = pool(st.date).riders;
  return L.match(riders.map((p) => asRider(p, st.date)), [me])
    .map((m) => ({ rider: riders.find((r) => r.id === m.passenger_id), ...m }));
}

function riderCost(detour) {
  return L.co2Saved(1, directKm(st.town), "carpool", "car", detour);
}

// ---------- options for one trip ----------

function busOption() {
  const route = routeOf(st.town);
  if (!route) return { available: false, why: `No university bus goes to ${st.town}: it isn't on Route A, B or C.` };
  const trip = tripFor(st.eventKey, route, st.date);
  if (!trip) return { available: false, route, why: `There's no Route ${route} bus on ${dayName(st.date)} ${fmtDate(st.date)}. Try another day.` };

  const key = `bus|${trip.id}`;
  // signed in: the seat is saved in Supabase; demo mode: in this browser
  const mineBooked = db.enabled ? db.hasBooking(route, st.date) : hasTrip(key);
  const n = busNumbers(route, st.town, trip);
  return {
    ...n, available: n.rec.action !== "cancel", trip, route, key, mineBooked,
    booked: n.snap[1] + (mineBooked ? 1 : 0),
    live: db.enabled ? db.count(route, st.date) : null,
  };
}

/** Any simulated trip (run 1) for a route and date, whatever the break. */
function findTrip(route, date) {
  for (const ev of events.values()) {
    const t = ev.trips.find((x) => x.run === RUN && x.route === route && x.date === date);
    if (t) return t;
  }
  return null;
}

/** Fare, plan and savings for one student on a bus trip. */
function busNumbers(route, town, trip) {
  const { left, snap } = snapshotNow(trip);
  const expected = Math.max(1, Math.round(snap[2]));
  const rec = L.recommend(snap[4]);   // vehicles are planned for the high end of the forecast range
  const vehicle = rec.action === "van" ? "van" : "bus";
  const capacity = rec.action === "bus" ? rec.buses * data.config.BUS_CAPACITY
    : rec.action === "van" ? data.config.VAN_CAPACITY : 0;

  const km = L.stopKm(route, town);
  const fare = L.co2Saved(1, km, vehicle).shared_rm;
  const sharedKgEach = L.co2Saved(expected, km, vehicle).shared_kg / expected;
  const alone = L.co2Saved(1, directKm(town), "bus", "car");
  return {
    left, snap, expected, rec, capacity, vehicle,
    fare, savedRm: alone.solo_rm - fare, savedKg: alone.solo_kg - sharedKgEach,
  };
}

function carpoolOption() {
  const all = driversForMe();
  if (!all.length) return { available: false, count: 0 };
  const best = all[0];
  const cost = riderCost(best.detour_km);
  return { available: true, count: all.length, best, fare: cost.shared_rm, savedRm: cost.rm_saved, savedKg: cost.kg_co2 };
}

// ---------- Plan my trip ----------

function setupPlan() {
  const today = todayIso();
  const upcoming = [...events.values()].filter((e) => eventDates(e.key).at(-1) >= today);
  const list = upcoming.length ? upcoming : [...events.values()].slice(-1);
  st.eventKey = list[0].key;

  const fEvent = $("sp-event");
  for (const e of list) {
    const [y, m] = e.firstDay.split("-").map(Number);
    fEvent.append(option(e.key, `${e.event} · ${MONTHS[m - 1]} ${y}`, e.key === st.eventKey));
  }
  for (const id of ["sp-town", "sc-town"]) {
    for (const t of Object.keys(towns)) $(id).append(option(t, t, t === st.town));
  }
  pickDefaultDate();

  fEvent.addEventListener("change", () => { st.eventKey = fEvent.value; pickDefaultDate(); renderPlan(); });
  $("sp-town").addEventListener("change", (e) => { st.town = e.target.value; renderPlan(); });
  $("sp-date").addEventListener("change", (e) => { st.date = e.target.value; renderPlan(); });
  $("sp-time").addEventListener("change", (e) => { st.time = e.target.value || "09:00"; renderPlan(); });

  for (const id of ["opt-bus", "opt-carpool"]) {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (btn) act(btn.dataset.act, btn);
    });
  }
}

function pickDefaultDate() {
  const dates = eventDates(st.eventKey);
  st.date = dates.find((d) => d >= todayIso()) ?? dates[0];
}

/** Short bus status for a day, shown in the day picker. */
function dayStatus(route, date) {
  const trip = route && tripFor(st.eventKey, route, date);
  if (!trip) return "no bus";
  const rec = L.recommend(snapshotNow(trip).snap[4]);   // planned for the high end
  return rec.action === "cancel" ? "bus may be cancelled" : rec.action === "van" ? "van" : "bus";
}

function renderPlan() {
  $("sp-town").value = st.town;
  $("sp-time").value = st.time;
  const route = routeOf(st.town);
  const sel = $("sp-date");
  sel.innerHTML = "";
  for (const d of eventDates(st.eventKey)) {
    sel.append(option(d, `${dayName(d)} ${fmtDate(d)} · ${dayStatus(route, d)}`, d === st.date));
  }

  const bus = busOption();
  const car = carpoolOption();
  const alone = L.co2Saved(1, directKm(st.town), "bus", "car");
  const grab = L.co2Saved(1, directKm(st.town), "bus", "ehailing");

  // KPI tiles
  // The university bus/van is recommended when it runs; otherwise a carpool.
  const offers = [bus.available && ["University bus", bus.savedKg], car.available && ["Carpool", car.savedKg]].filter(Boolean);
  const best = offers[0];
  $("sk-best").textContent = best ? (best[0] === "Carpool" ? "Carpool" : bus.vehicle === "van" ? "Van" : "Bus") : "Alone";
  $("sk-best-sub").textContent = best
    ? (best[0] === "Carpool" ? `with driver ${car.best.driver.id}, your share ${rm(car.fare)}` : `${planText(bus.rec)} on Route ${bus.route}`)
    : "No shared option yet for this trip";

  if (bus.trip) {
    $("sk-seats").textContent = bus.capacity ? `${bus.booked}/${bus.capacity}` : `${bus.booked}`;
    $("sk-seats-sub").textContent = bus.available ? planText(bus.rec) : "Likely to be cancelled";
  } else {
    $("sk-seats").textContent = "–";
    $("sk-seats-sub").textContent = bus.route ? "No bus on this day" : "Not on a bus route";
  }
  countUp($("sk-drivers"), car.count);
  $("sk-drivers-sub").textContent = car.available ? `best leaves ${clock(car.best.driver.minute)}` : `within ${data.config.MAX_TIME_DIFF_HOURS} h of ${st.time}`;
  const co2 = Math.max(0, ...offers.map((o) => o[1]));
  countUp($("sk-co2"), co2, kg);
  $("sk-co2-sub").textContent = "compared with driving alone";

  renderBusCard(bus, best?.[0] === "University bus");
  renderCarpoolCard(car, best?.[0] === "Carpool");
  renderDemand(bus);
  renderCost(bus, car, alone, grab);
}

function planText(rec) {
  if (rec.action === "van") return "1 van planned";
  return `${rec.buses} bus${rec.buses > 1 ? "es" : ""} planned${rec.standby ? " + standby" : ""}`;
}

function kvTable(rows) {
  return `<div class="table-wrap"><table class="table kv"><tbody>${rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table></div>`;
}

function cardHead(title, tag) {
  return `<div class="card-head"><h2>${title}</h2><span class="tags">${tag ?? ""}</span></div>`;
}

function renderBusCard(bus, isBest) {
  const el = $("opt-bus");
  const title = `University ${bus.vehicle === "van" ? "van" : "bus"}`;
  const routeText = bus.route ? `Route ${bus.route} · ${data.config.ROUTES[bus.route].name}` : "Not on a route";
  if (!bus.trip) {
    el.innerHTML = cardHead(title, '<span class="tag muted-tag">Not available</span>')
      + `<div class="empty"><strong>No bus for this trip</strong><span>${esc(bus.why)}</span></div>`
      + '<div class="card-actions"><button class="btn-ghost" data-act="go-carpool">Look for a carpool</button></div>';
    return;
  }
  if (!bus.available) {
    el.innerHTML = cardHead(title, '<span class="tag cancel">Likely cancelled</span>')
      + kvTable([
        ["Route", routeText],
        ["Booked so far", bus.booked],
        ["Expected to travel", `about ${bus.expected}`],
      ])
      + `<p class="muted small card-note">Trips with fewer than ${data.config.MIN_PASSENGERS} students are cancelled and the students are offered carpools.</p>`
      + '<div class="card-actions"><button class="btn-ghost" data-act="go-carpool">Find a carpool instead</button></div>';
    return;
  }
  const booked = bus.mineBooked;
  const pct = Math.min(100, (100 * bus.booked) / bus.capacity);
  const button = db.enabled && !db.user
    ? '<button class="btn" data-act="sign-in">Sign in to book</button>'
    : `<button class="btn" data-act="book-bus" ${booked ? "disabled" : ""}>${booked ? "Seat booked ✓" : "Book a seat"}</button>`;
  el.innerHTML = cardHead(title, `${isBest ? '<span class="tag van">Recommended</span> ' : ""}<span class="tag ${bus.rec.action}">${planText(bus.rec)}</span>`)
    + kvTable([
      ["Route", routeText],
      ["Seats booked so far", `<span class="bar"><i style="width:${pct}%"></i></span>${bus.booked} of ${bus.capacity}`],
      ["Expected to travel", `about ${bus.expected}`],
      ...(bus.live !== null ? [["Booked on ShareWay (live)", `${bus.live} student${bus.live === 1 ? "" : "s"}`]] : []),
      ["CO₂ saved vs driving alone", `<span class="good">${kg(bus.savedKg)}</span>`],
    ])
    + `<div class="card-actions">${button}</div>`;
}

function renderCarpoolCard(car, isBest) {
  const el = $("opt-carpool");
  if (!car.available) {
    el.innerHTML = cardHead("Carpool", '<span class="tag muted-tag">No match yet</span>')
      + `<div class="empty"><strong>No driver going your way yet</strong><span>Nobody leaves within ${data.config.MAX_TIME_DIFF_HOURS} hours of ${st.time} towards ${esc(st.town)}.</span></div>`
      + '<div class="card-actions"><button class="btn-ghost" data-act="go-carpool">Change time or offer a ride</button></div>';
    return;
  }
  const b = car.best;
  const requested = hasTrip(`ride|${st.date}|${b.driver.id}`);
  el.innerHTML = cardHead("Carpool", `${isBest ? '<span class="tag van">Recommended</span> ' : ""}<span class="tag bus">${car.count} driver${car.count > 1 ? "s" : ""} found</span>`)
    + kvTable([
      ["Best match", `Driver ${b.driver.id}`],
      ["Leaves at", `${clock(b.driver.minute)} (${b.time_diff_hours === 0 ? "same time as you" : `${round(b.time_diff_hours * 60)} min apart`})`],
      ["Driver going to", `${b.driver.town}${b.detour_km > 0 ? ` · +${b.detour_km} km detour` : ""}`],
      ["Your share of petrol and tolls", rm(car.fare)],
      ["You save vs driving", `<span class="good">${rm(car.savedRm)}</span>`],
      ["CO₂ saved", `<span class="good">${kg(car.savedKg)}</span>`],
    ])
    + `<div class="card-actions"><button class="btn-ghost" data-act="go-carpool">See all drivers</button>
       <button class="btn" data-act="request-best" ${requested ? "disabled" : ""}>${requested ? "Seat requested ✓" : "Request seat"}</button></div>`;
}

function renderDemand(bus) {
  const card = $("sp-demand-card");
  let empty = card.querySelector(".empty");
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "empty";
    card.querySelector(".chart-box").after(empty);
  }
  card.querySelector(".chart-box").hidden = !bus.trip;
  card.querySelector(".legend").hidden = !bus.trip;
  empty.hidden = Boolean(bus.trip);
  if (!bus.trip) {
    $("sp-demand-title").textContent = "How full is the bus?";
    $("sp-demand-sub").textContent = "";
    empty.innerHTML = `<strong>No university bus for this trip</strong><span>${esc(bus.why)}</span>`;
    if (charts.sdemand) { charts.sdemand.destroy(); delete charts.sdemand; }
    return;
  }
  const days = data.config.SNAPSHOT_DAYS;
  const snaps = bus.trip.snaps;
  const nowIdx = snaps.findIndex((s) => s[0] === snapshotNow(bus.trip).snap[0]);
  const n = days.length + 1;
  const mine = bus.mineBooked ? 1 : 0;
  $("sp-demand-title").textContent = `How full is the ${dayName(bus.trip.date)} ${fmtDate(bus.trip.date)} ${bus.vehicle}?`;
  $("sp-demand-sub").textContent = bus.left > days[0] ? "Bookings have just opened" : `${bus.left} days to go`;

  setChart("sdemand", "c-sdemand", {
    type: "line",
    data: {
      labels: [...days.map((d) => `${d}d`), "Depart"],
      datasets: [
        {
          label: "Booked so far", data: snaps.map((s, i) => (i <= nowIdx ? s[1] + (i === nowIdx ? mine : 0) : null)).concat(null),
          borderColor: COLORS.accent, backgroundColor: areaGradient(COLORS.accent, 0.28), fill: true, borderWidth: 2.5,
          pointRadius: 3, pointBackgroundColor: COLORS.accent, tension: 0.25,
        },
        {
          label: "Expected by departure", data: Array.from({ length: n }, (_, i) => (i >= nowIdx ? bus.expected : null)),
          borderColor: COLORS.green, borderDash: [6, 5], borderWidth: 2.5, pointRadius: 0, tension: 0,
        },
        {
          label: "Seats planned", data: Array.from({ length: n }, () => bus.capacity || null),
          borderColor: COLORS.text, borderDash: [3, 4], borderWidth: 1.5, pointRadius: 0, tension: 0,
        },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, title: axisTitle("Days before departure") },
        y: { beginAtZero: true, title: axisTitle("Students") },
      },
      plugins: { tooltip: { filter: (i) => i.raw !== null } },
    },
  });
}

function renderCost(bus, car, alone, grab) {
  const rows = [];
  if (car.available) rows.push(["Carpool", car.fare, true]);
  rows.push(["Driving alone", alone.solo_rm, false], ["E-hailing", grab.solo_rm, false]);
  $("sp-cost-sub").textContent = `UTP → ${st.town}, about ${num.format(directKm(st.town) * data.emissions.ROAD_FACTOR)} km by road`;
  setChart("scost", "c-scost", {
    type: "bar",
    data: {
      labels: rows.map((r) => r[0]),
      datasets: [{
        data: rows.map((r) => r[1]), backgroundColor: rows.map((r) => (r[2] ? COLORS.accent : COLORS.grey)),
        borderRadius: 6, maxBarThickness: 26,
      }],
    },
    options: {
      indexAxis: "y",
      scales: { x: { beginAtZero: true, title: axisTitle("RM per student") }, y: { grid: { display: false }, ticks: { font: { size: 12 } } } },
      plugins: { tooltip: { callbacks: { label: (i) => ` ${rm(i.raw)}` } } },
    },
  });
}

// ---------- Carpool ----------

let smap;
let smapLayer;

function setupCarpoolPage() {
  $("sc-role").addEventListener("change", (e) => { st.role = e.target.value; renderCarpoolPage(); });
  $("sc-date").addEventListener("change", (e) => { st.date = e.target.value; renderCarpoolPage(); });
  $("sc-town").addEventListener("change", (e) => { st.town = e.target.value; renderCarpoolPage(); });
  $("sc-time").addEventListener("change", (e) => { st.time = e.target.value || "09:00"; renderCarpoolPage(); });
  $("sc-seats").addEventListener("change", (e) => { st.seats = Number(e.target.value); renderCarpoolPage(); });
  for (const id of ["sc-body", "sc-actions"]) {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (btn) act(btn.dataset.act, btn);
    });
  }
  $("sc-rules").textContent = `Within ${data.config.MAX_TIME_DIFF_HOURS} h, detour up to ${data.config.MAX_DETOUR_KM} km`;
}

function setKpi(i, label, value, sub) {
  $(`ck${i}-label`).textContent = label;
  $(`ck${i}`).textContent = value;
  $(`ck${i}-sub`).textContent = sub;
}

const timeDiff = (h) => (h === 0 ? "same time" : `${round(h * 60)} min`);

function renderCarpoolPage() {
  const sel = $("sc-date");
  sel.innerHTML = "";
  for (const d of eventDates(st.eventKey)) sel.append(option(d, `${dayName(d)} ${fmtDate(d, true)}`, d === st.date));
  $("sc-role").value = st.role;
  $("sc-town").value = st.town;
  $("sc-time").value = st.time;
  $("sc-seats").value = String(st.seats);
  $("sc-seats-field").hidden = st.role !== "driver";

  const body = $("sc-body");
  replay(body, "fresh");
  let lines;
  if (st.role === "rider") {
    const found = driversForMe();
    const best = found[0];
    const cost = best && riderCost(best.detour_km);
    setKpi(1, "Drivers found", found.length, `on ${dayName(st.date)} ${fmtDate(st.date)}`);
    setKpi(2, "Best time difference", best ? timeDiff(best.time_diff_hours) : "–", best ? `driver leaves ${clock(best.driver.minute)}` : "no match yet");
    setKpi(3, "Your share", best ? rm(cost.shared_rm) : "–", "petrol and tolls, best match");
    setKpi(4, "CO₂ saved", best ? kg(cost.kg_co2) : "–", "compared with driving alone");

    $("sc-results-title").textContent = "Drivers going your way";
    $("sc-legend-other").textContent = "Drivers";
    $("sc-head").innerHTML = '<tr><th>Driver</th><th>Going to</th><th>Leaves</th><th class="num">Your share</th><th></th></tr>';
    body.innerHTML = found.length ? found.slice(0, 10).map((f) => {
      const done = hasTrip(`ride|${st.date}|${f.driver.id}`);
      return `<tr>
        <td><strong>${f.driver.id}</strong><br><span class="muted small">${f.driver.seats} seat${f.driver.seats > 1 ? "s" : ""} free</span></td>
        <td>${f.driver.town}<br><span class="muted small">${f.detour_km > 0 ? `+${f.detour_km} km detour` : "no detour"}</span></td>
        <td>${clock(f.driver.minute)}<br><span class="muted small">${timeDiff(f.time_diff_hours)}${f.time_diff_hours ? " apart" : ""}</span></td>
        <td class="num">${rm(riderCost(f.detour_km).shared_rm)}</td>
        <td class="num"><button class="btn-ghost" data-act="request" data-driver="${f.driver.id}" ${done ? "disabled" : ""}>${done ? "Requested" : "Request"}</button></td>
      </tr>`;
    }).join("") : emptyRow(5, "No drivers match yet", `Nobody drives towards ${st.town} within ${data.config.MAX_TIME_DIFF_HOURS} hours of ${st.time}. Try another time or day.`);
    $("sc-actions").innerHTML = "";
    lines = found.slice(0, 10).map((f) => ({ town: f.driver.town, label: `Driver ${f.driver.id}` }));
  } else {
    const riders = ridersForMe();
    const detour = riders.reduce((s, r) => s + r.detour_km, 0);
    const total = riders.length ? L.co2Saved(riders.length, directKm(st.town), "carpool", "car", detour) : null;
    setKpi(1, "Riders matched", riders.length, `on ${dayName(st.date)} ${fmtDate(st.date)}`);
    setKpi(2, "Seats left", st.seats - riders.length, `of ${st.seats} offered`);
    setKpi(3, "Riders pay you", total ? rm(total.shared_rm) : "–", "for petrol and tolls");
    setKpi(4, "CO₂ saved together", total ? kg(total.kg_co2) : "–", "compared with everyone driving");

    $("sc-results-title").textContent = "Students you could take";
    $("sc-legend-other").textContent = "Riders";
    $("sc-head").innerHTML = '<tr><th>Student</th><th>Going to</th><th>Wants to leave</th></tr>';
    body.innerHTML = riders.length ? riders.map((r) => `<tr>
        <td><strong>${r.rider.id}</strong></td>
        <td>${r.rider.town}<br><span class="muted small">${r.detour_km > 0 ? `+${r.detour_km} km detour for you` : "no detour"}</span></td>
        <td>${clock(r.rider.minute)}<br><span class="muted small">${timeDiff(r.time_diff_hours)}${r.time_diff_hours ? " apart" : ""}</span></td>
      </tr>`).join("") : emptyRow(3, "No riders match yet", `No student needs a ride towards ${st.town} within ${data.config.MAX_TIME_DIFF_HOURS} hours of ${st.time}.`);
    const done = hasTrip(`offer|${st.date}|${st.town}|${st.time}`);
    $("sc-actions").innerHTML = riders.length
      ? `<button class="btn" data-act="offer" ${done ? "disabled" : ""}>${done ? "Ride posted ✓" : "Post my ride"}</button>` : "";
    lines = riders.map((r) => ({ town: r.rider.town, label: `Student ${r.rider.id}` }));
  }
  renderStudentMap(lines);
}

function emptyRow(cols, title, text) {
  return `<tr><td colspan="${cols}"><div class="empty"><strong>${title}</strong><span>${esc(text)}</span></div></td></tr>`;
}

function renderStudentMap(lines) {
  const Lf = window.L;
  if (!Lf || $("page-student-carpool").hidden) return;
  if (!smap) {
    smap = Lf.map("s-map", { scrollWheelZoom: false });
    Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(smap);
    smapLayer = Lf.layerGroup().addTo(smap);
  }
  smap.invalidateSize();
  smapLayer.clearLayers();
  const utp = data.config.UTP;
  const mine = towns[st.town];
  const pts = [utp, mine];
  const byTown = {};
  for (const l of lines) (byTown[l.town] ??= []).push(l.label);
  for (const [town, labels] of Object.entries(byTown)) {
    const p = towns[town];
    pts.push(p);
    // rider: UTP -> me -> driver's town; driver: UTP -> rider -> me
    const path = st.role === "rider" ? [utp, mine, p] : [utp, p, mine];
    Lf.polyline(path, { color: COLORS.primary, weight: 2.5, opacity: 0.8, className: "route-line" }).addTo(smapLayer);
    Lf.circleMarker(p, { radius: 6 + labels.length, color: "#fff", weight: 2, fillColor: COLORS.green, fillOpacity: 1 })
      .bindTooltip(`<div class="map-pin"><strong>${town}</strong><br>${labels.join(", ")}</div>`)
      .addTo(smapLayer);
  }
  Lf.circleMarker(mine, { radius: 9, color: "#fff", weight: 3, fillColor: COLORS.accent, fillOpacity: 1 })
    .bindTooltip(`<div class="map-pin"><strong>You → ${st.town}</strong></div>`).addTo(smapLayer);
  Lf.circleMarker(utp, { radius: 9, color: "#fff", weight: 3, fillColor: COLORS.primary, fillOpacity: 1 })
    .bindTooltip('<div class="map-pin"><strong>UTP</strong></div>').addTo(smapLayer);
  smap.fitBounds(pts, { padding: [30, 30], maxZoom: 9 });
  $("sc-map-sub").textContent = `UTP → ${st.town}`;
}

// ---------- actions ----------

async function act(what, btn) {
  if (what === "go-carpool") { location.hash = "student-carpool"; return; }
  if (what === "sign-in") { openAuth("student"); return; }

  if (what === "book-bus" && db.enabled) {
    const bus = busOption();
    if (!db.user) { openAuth("student"); return; }
    btn.disabled = true;
    const res = await db.book(bus.route, st.date, st.town);
    toast(res.error ?? `Seat booked on the ${dayName(st.date)} ${fmtDate(st.date)} ${bus.vehicle} to ${st.town}`);
    renderPlan();
    return;
  }

  if (what === "book-bus") {
    const bus = busOption();
    addTrip({
      key: bus.key, kind: bus.vehicle, date: st.date, time: st.time, town: st.town,
      title: `University ${bus.vehicle} to ${st.town}`, detail: `Route ${bus.route}`, status: "Seat booked",
      paid: null, rm: null, kg: bus.savedKg,   // no fare for the university bus/van
    });
    toast(`Seat booked on the ${dayName(st.date)} ${fmtDate(st.date)} ${bus.vehicle} to ${st.town}`);
    renderPlan();
    return;
  }

  if (what === "request-best" || what === "request") {
    const found = driversForMe();
    const f = what === "request" ? found.find((x) => x.driver.id === btn.dataset.driver) : found[0];
    if (!f) return;
    const cost = riderCost(f.detour_km);
    addTrip({
      key: `ride|${st.date}|${f.driver.id}`, kind: "carpool", date: st.date, time: clock(f.driver.minute), town: st.town,
      title: `Carpool to ${st.town}`, detail: `Driver ${f.driver.id}`, status: "Requested",
      paid: cost.shared_rm, rm: cost.rm_saved, kg: cost.kg_co2,
    });
    toast(`Seat requested with driver ${f.driver.id}, leaving ${clock(f.driver.minute)}`);
    if (what === "request-best") renderPlan(); else renderCarpoolPage();
    return;
  }

  if (what === "offer") {
    const riders = ridersForMe();
    if (!riders.length) return;
    const detour = riders.reduce((s, r) => s + r.detour_km, 0);
    const total = L.co2Saved(riders.length, directKm(st.town), "carpool", "car", detour);
    const alone = L.co2Saved(1, directKm(st.town), "bus", "car");
    addTrip({
      key: `offer|${st.date}|${st.town}|${st.time}`, kind: "offer", date: st.date, time: st.time, town: st.town,
      title: `Driving to ${st.town}`, detail: `${riders.length} rider${riders.length > 1 ? "s" : ""}: ${riders.map((r) => r.rider.id).join(", ")}`,
      status: "Ride posted",
      // as the driver you pay for the trip and get the riders' share back
      paid: alone.solo_rm - total.shared_rm, rm: total.shared_rm, kg: total.kg_co2,
    });
    toast(`Ride posted: ${riders.length} student${riders.length > 1 ? "s" : ""} can travel with you`);
    renderCarpoolPage();
  }
}

// ---------- My trips ----------

const STATUS_TAG = { "Seat booked": "bus", Requested: "standby", "Ride posted": "van" };

/** Bus seats saved in Supabase, shaped like the local trips. */
function liveTrips() {
  return db.myBookings.map((b) => {
    const trip = findTrip(b.route, b.date);
    const n = trip ? busNumbers(b.route, b.destination, trip) : { vehicle: "bus", fare: 0, savedRm: 0, savedKg: 0 };
    return {
      id: `db-${b.id}`, dbId: b.id, kind: n.vehicle, date: b.date, time: "–", town: b.destination,
      title: `University ${n.vehicle} to ${b.destination}`, detail: `Route ${b.route} · saved to your account`,
      status: "Seat booked", paid: null, rm: null, kg: n.savedKg,   // no fare for the university bus/van
    };
  });
}

/** Everything in My trips. With Supabase, bus seats come from the database
 * and only carpools (still a demo) come from this browser. */
function allTrips() {
  if (!db.enabled) return myTrips;
  return [...myTrips.filter((t) => t.kind === "carpool" || t.kind === "offer"), ...liveTrips()];
}

function renderMyTrips() {
  $("mt-note").textContent = !db.enabled ? "Saved in this browser only (demo, no real booking)"
    : "Bus seats are saved to your account · carpools are still a demo in this browser";
  const sorted = [...allTrips()].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  countUp($("mt-count"), sorted.length);
  $("mt-count-sub").textContent = sorted.length ? `next: ${dayName(sorted[0].date)} ${fmtDate(sorted[0].date)}` : "nothing booked yet";
  countUp($("mt-rm"), sorted.reduce((s, t) => s + Math.max(0, t.rm ?? 0), 0), rm);
  countUp($("mt-kg"), sorted.reduce((s, t) => s + Math.max(0, t.kg), 0), kg);

  const body = $("mt-body");
  replay(body, "fresh");
  body.innerHTML = sorted.length ? sorted.map((t) => {
    const status = t.status ?? (t.kind === "carpool" ? "Requested" : t.kind === "offer" ? "Ride posted" : "Seat booked");
    return `<tr>
      <td>${dayName(t.date)} ${fmtDate(t.date, true)}</td>
      <td><strong>${esc(t.title)}</strong> <span class="muted small">${esc(t.detail)}</span></td>
      <td>${t.time}</td>
      <td><span class="tag ${STATUS_TAG[status] ?? "bus"}">${status}</span></td>
      <td class="num">${t.paid == null ? '<span class="muted" title="No fare for the university bus/van">–</span>' : rm(Math.max(0, t.paid))}</td>
      <td class="num good">${t.rm == null ? '<span class="muted">–</span>' : rm(Math.max(0, t.rm))}</td>
      <td class="num good">${kg(Math.max(0, t.kg))}</td>
      <td class="num"><button class="icon-btn" data-remove="${t.id}" title="Cancel" aria-label="Cancel ${esc(t.title)}">×</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8"><div class="empty"><strong>No trips yet</strong>
      <span>Plan your trip home to book a bus seat or a carpool.</span>
      <button class="btn" data-go="student">Plan my trip</button></div></td></tr>`;
}

function setupMyTrips() {
  $("mt-body").addEventListener("click", async (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove && remove.dataset.remove.startsWith("db-")) {
      remove.disabled = true;
      const res = await db.cancel(Number(remove.dataset.remove.slice(3)));
      toast(res.error ?? "Booking cancelled");
      return;
    }
    if (remove) {
      myTrips = myTrips.filter((t) => t.id !== remove.dataset.remove);
      saveTrips();
      renderMyTrips();
      toast("Booking cancelled");
      return;
    }
    const go = e.target.closest("[data-go]");
    if (go) location.hash = go.dataset.go;
  });
}

// ---------- entry points (called from app.js) ----------

export function setupStudent(ctx) {
  ({ data, L, events, towns } = ctx);
  myTrips = loadTrips();
  saveTrips();
  setupPlan();
  setupCarpoolPage();
  setupMyTrips();
  db.onChange(refreshStudent);
}

/** What the student is looking at right now, as plain text for the AI assistant. */
export function studentFacts() {
  if (!data || !st.eventKey || !st.date) return "No trip picked yet.";
  const ev = events.get(st.eventKey);
  const bus = busOption();
  const car = carpoolOption();
  const alone = L.co2Saved(1, directKm(st.town), "bus", "car");
  const grab = L.co2Saved(1, directKm(st.town), "bus", "ehailing");
  const lines = [
    `Break: ${ev.event}, first day ${ev.firstDay}. The student is going home to ${st.town}, leaving on ${dayName(st.date)} ${st.date} around ${st.time}.`,
  ];
  if (!bus.trip) lines.push(`University bus: not available. ${bus.why}`);
  else if (!bus.available) {
    lines.push(`University ${bus.vehicle} on Route ${bus.route}: likely to be CANCELLED, only about ${bus.expected} students expected `
      + `(trips under ${data.config.MIN_PASSENGERS} are cancelled and students are offered carpools). ${bus.booked} booked so far.`);
  } else {
    lines.push(`University ${bus.vehicle} on Route ${bus.route} (${data.config.ROUTES[bus.route].name}): ${planText(bus.rec)}, `
      + `${bus.booked} of ${bus.capacity} seats booked so far, about ${bus.expected} students expected to travel, ${bus.left} days before departure. `
      + `No fare is shown for the university bus/van. CO2 saved vs driving alone: ${bus.savedKg.toFixed(1)} kg.`
      + (bus.mineBooked ? " The student HAS BOOKED a seat on it." : " The student has not booked it yet."));
  }
  if (car.available) {
    const b = car.best;
    lines.push(`Carpool: ${car.count} student driver(s) going their way. Best match: driver ${b.driver.id}, leaves ${clock(b.driver.minute)} `
      + `(${b.time_diff_hours === 0 ? "same time" : `${Math.round(b.time_diff_hours * 60)} min apart`}), driving to ${b.driver.town}, `
      + `${b.detour_km} km detour. Student's share of petrol and tolls RM ${car.fare.toFixed(2)}, saves RM ${car.savedRm.toFixed(2)} and `
      + `${car.savedKg.toFixed(1)} kg CO2 vs driving alone.`);
  } else {
    lines.push(`Carpool: no student driver leaves within ${data.config.MAX_TIME_DIFF_HOURS} hours of ${st.time} towards ${st.town}.`);
  }
  lines.push(`Going alone: driving own car about RM ${alone.solo_rm.toFixed(2)} and ${alone.solo_kg.toFixed(1)} kg CO2; e-hailing about RM ${grab.solo_rm.toFixed(2)}.`);
  const route = routeOf(st.town);
  lines.push(`Other departure days for this break: ${eventDates(st.eventKey).map((d) => `${dayName(d)} ${d} (${dayStatus(route, d)})`).join("; ")}.`);
  const trips = allTrips();
  lines.push(trips.length
    ? `Student's booked trips: ${trips.map((t) => `${t.title} on ${t.date} (${t.status ?? "booked"})`).join("; ")}.`
    : "The student has no booked trips yet.");
  lines.push(`Carpool rules: driver and passenger leave within ${data.config.MAX_TIME_DIFF_HOURS} hours, detour at most `
    + `${data.config.MAX_DETOUR_KM} km, best match first. Bus seats are booked on the Plan trip page; carpools on the Carpool page; `
    + "My trips lists bookings and money/CO2 saved. Bus plans use the high end of the demand forecast range so fewer trips run out of seats.");
  return lines.join("\n");
}

/** Redraw the open student page (after Supabase connects or someone signs in/out). */
export function refreshStudent() {
  updateBadge();
  const page = location.hash.slice(1);
  if (page.startsWith("student")) renderStudent(page);
}

export function renderStudent(page) {
  if (!data) return;
  if (page === "student") renderPlan();
  if (page === "student-carpool") renderCarpoolPage();
  if (page === "student-trips") renderMyTrips();
}
