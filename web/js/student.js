// Student view: plan a trip home, find or offer a carpool, and keep track of bookings.
//
// Bus numbers come from the SIMULATED trips in dashboard.json (simulation run 1).
// The carpool drivers and riders are made up here with a fixed random seed per
// day, so everyone sees the same SIMULATED students. Bookings are only saved in
// this browser (localStorage): it is a demo, nothing is sent anywhere.

import { round } from "./logic.js";
import {
  $, num, MONTHS, DAYS, COLORS, fmtDate, option, segmented, areaGradient,
  countUp, replay, setChart, axisTitle,
} from "./ui.js";

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
  const badge = $("trips-badge");
  badge.hidden = myTrips.length === 0;
  badge.textContent = myTrips.length;
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

  const { left, snap } = snapshotNow(trip);
  const key = `bus|${trip.id}`;
  const booked = snap[1] + (hasTrip(key) ? 1 : 0);
  const expected = Math.max(1, Math.round(snap[2]));
  const rec = L.recommend(snap[2]);
  const vehicle = rec.action === "van" ? "van" : "bus";
  const capacity = rec.action === "bus" ? rec.buses * data.config.BUS_CAPACITY
    : rec.action === "van" ? data.config.VAN_CAPACITY : 0;

  const km = L.stopKm(route, st.town);
  const fare = L.co2Saved(1, km, vehicle).shared_rm;
  const sharedKgEach = L.co2Saved(expected, km, vehicle).shared_kg / expected;
  const alone = L.co2Saved(1, directKm(st.town), "bus", "car");
  return {
    available: rec.action !== "cancel", trip, route, left, booked, expected, rec, capacity, key, vehicle,
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

const ICONS = {
  bus: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v2M16 18v2"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/></svg>',
  carpool: '<svg viewBox="0 0 24 24"><path d="M5 11 6.8 6.2A2 2 0 0 1 8.7 5h6.6a2 2 0 0 1 1.9 1.2L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/></svg>',
  alone: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></svg>',
};

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
  $("sp-time").value = st.time;
  $("sp-time").addEventListener("change", (e) => { st.time = e.target.value || "09:00"; renderPlan(); });

  $("sp-dates").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    st.date = chip.dataset.date;
    renderPlan();
  });
  $("sp-dates").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const dates = eventDates(st.eventKey);
    const i = dates.indexOf(st.date) + (e.key === "ArrowRight" ? 1 : -1);
    if (i < 0 || i >= dates.length) return;
    st.date = dates[i];
    renderPlan();
    $("sp-dates").querySelector(`[data-date="${st.date}"]`)?.focus();
  });

  for (const id of ["opt-bus", "opt-carpool", "opt-alone"]) {
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

function renderPlan() {
  const ev = events.get(st.eventKey);
  $("sp-kicker").textContent = `${ev.event} · starts ${dayName(ev.firstDay)} ${fmtDate(ev.firstDay, true)}`;
  $("sp-title").textContent = `Going home to ${st.town}?`;
  $("sp-town").value = st.town;

  const route = routeOf(st.town);
  $("sp-dates").innerHTML = eventDates(st.eventKey).map((d) => {
    const trip = route && tripFor(st.eventKey, route, d);
    const rec = trip ? L.recommend(snapshotNow(trip).snap[2]) : null;
    const label = !rec ? "No bus" : rec.action === "cancel" ? "May be cancelled" : rec.action === "van" ? "Van" : "Bus";
    const on = d === st.date;
    return `<button type="button" class="chip" role="radio" data-date="${d}" aria-checked="${on}" tabindex="${on ? 0 : -1}">
      <strong>${dayName(d)} ${fmtDate(d)}</strong>
      <small><i class="${rec ? rec.action : ""}"></i>${label}</small>
    </button>`;
  }).join("");

  const bus = busOption();
  const car = carpoolOption();
  const alone = L.co2Saved(1, directKm(st.town), "bus", "car");
  const grab = L.co2Saved(1, directKm(st.town), "bus", "ehailing");

  // best value = the cheapest option you can actually take
  const offers = [bus.available && ["bus", bus.fare], car.available && ["carpool", car.fare]].filter(Boolean);
  const best = offers.sort((a, b) => a[1] - b[1])[0]?.[0];

  renderBusCard(bus, best === "bus");
  renderCarpoolCard(car, best === "carpool");
  $("opt-alone").innerHTML = `
    <div class="option-head">
      <div class="option-icon alone">${ICONS.alone}</div>
      <div><h3>Going alone</h3><p>For comparison</p></div>
    </div>
    <div class="price"><strong>${rm(alone.solo_rm)}</strong><span>driving your own car</span></div>
    <ul class="facts">
      <li>E-hailing instead <strong>${rm(grab.solo_rm)}</strong></li>
      <li>CO₂ from your car <strong>${kg(alone.solo_kg)}</strong></li>
      <li>Road distance <strong>about ${num.format(directKm(st.town) * data.emissions.ROAD_FACTOR)} km</strong></li>
    </ul>
    <div class="spacer"></div>
    <p class="muted small">Petrol at the BUDI95 price plus tolls. E-hailing uses Grab's base, per-km and per-minute fares.</p>`;

  document.querySelectorAll(".option").forEach((o, i) => { o.style.setProperty("--i", i); replay(o, "pop"); });
  renderDemand(bus);
}

function renderBusCard(bus, isBest) {
  const el = $("opt-bus");
  el.classList.toggle("best", isBest);
  const head = `
    <div class="option-head">
      <div class="option-icon bus">${ICONS.bus}</div>
      <div><h3>University ${bus.vehicle === "van" ? "van" : "bus"}</h3><p>${bus.route ? `Route ${bus.route} · ${data.config.ROUTES[bus.route].name}` : "Route A, B or C"}</p></div>
    </div>${isBest ? '<span class="ribbon">Best value</span>' : ""}`;

  if (!bus.trip) {
    el.innerHTML = `${head}<div class="status none">${esc(bus.why)}</div><div class="spacer"></div>
      <button class="btn secondary" data-act="go-carpool">Look for a carpool</button>`;
    return;
  }
  if (!bus.available) {
    el.innerHTML = `${head}
      <div class="status warn">Likely to be cancelled: only about ${bus.expected} student${bus.expected === 1 ? "" : "s"} expected
        (under ${data.config.MIN_PASSENGERS}). Students on this trip will be offered carpools.</div>
      <ul class="facts"><li>Booked so far <strong>${bus.booked}</strong></li></ul>
      <div class="spacer"></div>
      <button class="btn secondary" data-act="go-carpool">Find a carpool instead</button>`;
    return;
  }
  const r = bus.rec;
  const plan = r.action === "van" ? "1 van planned"
    : `${r.buses} bus${r.buses > 1 ? "es" : ""} planned${r.standby ? " + 1 on standby" : ""}`;
  const pct = Math.min(100, (100 * bus.booked) / bus.capacity);
  const booked = hasTrip(bus.key);
  el.innerHTML = `${head}
    <div class="price"><strong>${rm(bus.fare)}</strong><span>per seat</span></div>
    <div class="status ${r.action === "van" ? "van" : "ok"}">On track · ${plan}</div>
    <div class="seatbar">
      <span>${bus.booked} of ${bus.capacity} seats booked so far</span>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>
    <ul class="facts">
      <li>You save vs driving <strong class="good">${rm(bus.savedRm)}</strong></li>
      <li>CO₂ saved <strong class="good">${kg(bus.savedKg)}</strong></li>
    </ul>
    <div class="spacer"></div>
    <button class="btn" data-act="book-bus" ${booked ? "disabled" : ""}>${booked ? "Seat booked ✓" : "Book a seat"}</button>`;
}

function renderCarpoolCard(car, isBest) {
  const el = $("opt-carpool");
  el.classList.toggle("best", isBest);
  const head = `
    <div class="option-head">
      <div class="option-icon carpool">${ICONS.carpool}</div>
      <div><h3>Carpool</h3><p>With a student driver</p></div>
    </div>${isBest ? '<span class="ribbon">Best value</span>' : ""}`;
  if (!car.available) {
    el.innerHTML = `${head}
      <div class="status none">No driver leaving within ${data.config.MAX_TIME_DIFF_HOURS} h of ${st.time} is going your way yet.</div>
      <div class="spacer"></div>
      <button class="btn secondary" data-act="go-carpool">Change time or offer a ride</button>`;
    return;
  }
  const b = car.best;
  const key = `ride|${st.date}|${b.driver.id}`;
  const requested = hasTrip(key);
  el.innerHTML = `${head}
    <div class="price"><strong>${rm(car.fare)}</strong><span>your share of petrol and tolls</span></div>
    <div class="status van">${car.count} driver${car.count > 1 ? "s" : ""} going your way</div>
    <ul class="facts">
      <li>Best match <strong>Driver ${b.driver.id} · leaves ${clock(b.driver.minute)}</strong></li>
      <li>Driver heading to <strong>${b.driver.town}${b.detour_km > 0 ? ` (+${b.detour_km} km detour)` : ""}</strong></li>
      <li>You save vs driving <strong class="good">${rm(car.savedRm)}</strong></li>
      <li>CO₂ saved <strong class="good">${kg(car.savedKg)}</strong></li>
    </ul>
    <div class="spacer"></div>
    <button class="btn green" data-act="request-best" ${requested ? "disabled" : ""}>${requested ? "Seat requested ✓" : "Request this seat"}</button>`;
}

function renderDemand(bus) {
  const card = $("sp-demand-card");
  card.hidden = !bus.trip;
  if (!bus.trip) return;
  const days = data.config.SNAPSHOT_DAYS;
  const snaps = bus.trip.snaps;
  const nowIdx = snaps.findIndex((s) => s[0] === snapshotNow(bus.trip).snap[0]);
  const n = days.length + 1;
  const mine = hasTrip(bus.key) ? 1 : 0;
  $("sp-demand-title").textContent = `How full is the ${dayName(bus.trip.date)} ${fmtDate(bus.trip.date)} Route ${bus.route} ${bus.vehicle}?`;
  $("sp-demand-sub").textContent = bus.left > days[0]
    ? `Bookings have only just opened. About ${bus.expected} students are expected to travel.`
    : `${bus.left} days to go: ${bus.booked} booked so far, about ${bus.expected} expected to travel. Forecast from the trained model (simulated data).`;

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
          label: "Seats on the planned vehicles", data: Array.from({ length: n }, () => bus.capacity || null),
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

// ---------- Carpool ----------

let smap;
let smapLayer;

function setupCarpoolPage() {
  segmented($("sc-role"), [["rider", "I need a ride"], ["driver", "I can offer a ride"]], st.role, (v) => {
    st.role = v;
    renderCarpoolPage();
  });
  $("sc-date").addEventListener("change", (e) => { st.date = e.target.value; renderCarpoolPage(); });
  $("sc-town").addEventListener("change", (e) => { st.town = e.target.value; renderCarpoolPage(); });
  $("sc-time").addEventListener("change", (e) => { st.time = e.target.value || "09:00"; renderCarpoolPage(); });
  $("sc-seats").addEventListener("change", (e) => { st.seats = Number(e.target.value); renderCarpoolPage(); });
  $("sc-results").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (btn) act(btn.dataset.act, btn);
  });
  $("sc-rules").textContent = `Matches follow the same rules as the operator view: leave within ${data.config.MAX_TIME_DIFF_HOURS} hours `
    + `of each other and add at most ${data.config.MAX_DETOUR_KM} km to the driver's trip. The other students here are simulated.`;
}

function renderCarpoolPage() {
  const sel = $("sc-date");
  sel.innerHTML = "";
  for (const d of eventDates(st.eventKey)) sel.append(option(d, `${dayName(d)} ${fmtDate(d, true)}`, d === st.date));
  $("sc-town").value = st.town;
  $("sc-time").value = st.time;
  $("sc-seats").value = String(st.seats);
  $("sc-seats-field").hidden = st.role !== "driver";
  [...$("sc-role").children].forEach((b, i) => b.classList.toggle("active", (i === 0) === (st.role === "rider")));

  const list = $("sc-results");
  let lines = [];
  if (st.role === "rider") {
    const found = driversForMe();
    $("sc-results-title").textContent = "Drivers going your way";
    $("sc-results-sub").textContent = found.length
      ? `${found.length} student driver${found.length > 1 ? "s" : ""} on ${dayName(st.date)} ${fmtDate(st.date)}, best match first`
      : "";
    list.innerHTML = found.length ? found.slice(0, 9).map((f, i) => {
      const cost = riderCost(f.detour_km);
      const key = `ride|${st.date}|${f.driver.id}`;
      const done = hasTrip(key);
      return `<div class="match fresh" style="--i:${i}">
        <header>
          <div class="avatar-sm" style="background:${f.driver.color}">${f.driver.id}</div>
          <div><strong>Driver ${f.driver.id} → ${f.driver.town}</strong><span>Leaves ${clock(f.driver.minute)} · ${f.driver.seats} seat${f.driver.seats > 1 ? "s" : ""} free</span></div>
          ${i === 0 ? '<span class="tag van top">Best match</span>' : ""}
        </header>
        <ul class="facts">
          <li>Time difference <strong>${f.time_diff_hours === 0 ? "same time" : `${round(f.time_diff_hours * 60)} min`}</strong></li>
          <li>Detour for the driver <strong>${f.detour_km} km</strong></li>
          <li>Your share <strong>${rm(cost.shared_rm)}</strong></li>
          <li>CO₂ saved <strong class="good">${kg(cost.kg_co2)}</strong></li>
        </ul>
        <button class="btn green" data-act="request" data-driver="${f.driver.id}" ${done ? "disabled" : ""}>${done ? "Requested ✓" : "Request seat"}</button>
      </div>`;
    }).join("") : emptyState("No drivers match yet",
      `Nobody is driving towards ${st.town} within ${data.config.MAX_TIME_DIFF_HOURS} hours of ${st.time} on this day. Try another time or day.`);
    lines = found.slice(0, 9).map((f) => ({ town: f.driver.town, color: f.driver.color, label: `Driver ${f.driver.id}` }));
  } else {
    const riders = ridersForMe();
    const detour = riders.reduce((s, r) => s + r.detour_km, 0);
    const total = riders.length ? L.co2Saved(riders.length, directKm(st.town), "carpool", "car", detour) : null;
    const key = `offer|${st.date}|${st.town}|${st.time}`;
    const done = hasTrip(key);
    $("sc-results-title").textContent = "Students you could take";
    $("sc-results-sub").textContent = riders.length
      ? `${riders.length} of your ${st.seats} seat${st.seats > 1 ? "s" : ""} filled · riders would pay you ${rm(total.shared_rm)} in total for petrol and tolls`
      : "";
    list.innerHTML = riders.length ? riders.map((r, i) => `
      <div class="match fresh" style="--i:${i}">
        <header>
          <div class="avatar-sm" style="background:${r.rider.color}">${r.rider.id}</div>
          <div><strong>Student ${r.rider.id} → ${r.rider.town}</strong><span>Wants to leave ${clock(r.rider.minute)}</span></div>
        </header>
        <ul class="facts">
          <li>Time difference <strong>${r.time_diff_hours === 0 ? "same time" : `${round(r.time_diff_hours * 60)} min`}</strong></li>
          <li>Your detour <strong>${r.detour_km} km</strong></li>
        </ul>
      </div>`).join("") + `
      <div class="match offer-card">
        <ul class="facts">
          <li>Riders <strong>${riders.length}</strong></li>
          <li>They pay you <strong>${rm(total.shared_rm)}</strong></li>
          <li>CO₂ saved together <strong class="good">${kg(total.kg_co2)}</strong></li>
        </ul>
        <button class="btn" data-act="offer" ${done ? "disabled" : ""}>${done ? "Ride posted ✓" : "Post my ride"}</button>
      </div>`
      : emptyState("No riders match yet",
        `No student needs a ride towards ${st.town} within ${data.config.MAX_TIME_DIFF_HOURS} hours of ${st.time}. Try another time.`);
    lines = riders.map((r) => ({ town: r.rider.town, color: r.rider.color, label: `Student ${r.rider.id}` }));
  }
  renderStudentMap(lines);
}

function emptyState(title, text) {
  return `<div class="empty"><strong>${title}</strong><span>${esc(text)}</span></div>`;
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
  const seen = new Set();
  for (const l of lines) {
    const p = towns[l.town];
    pts.push(p);
    // rider: UTP -> me -> driver's town; driver: UTP -> rider -> me
    const path = st.role === "rider" ? [utp, mine, p] : [utp, p, mine];
    Lf.polyline(path, { color: l.color, weight: 2.5, opacity: 0.75, className: "route-line" }).addTo(smapLayer);
    if (!seen.has(l.town)) {
      seen.add(l.town);
      Lf.circleMarker(p, { radius: 7, color: "#fff", weight: 2, fillColor: l.color, fillOpacity: 1 })
        .bindTooltip(`<div class="map-pin"><strong>${l.town}</strong><br>${lines.filter((x) => x.town === l.town).map((x) => x.label).join(", ")}</div>`)
        .addTo(smapLayer);
    }
  }
  Lf.circleMarker(mine, { radius: 10, color: "#fff", weight: 3, fillColor: COLORS.accent, fillOpacity: 1 })
    .bindTooltip(`<div class="map-pin"><strong>You → ${st.town}</strong></div>`).addTo(smapLayer);
  Lf.circleMarker(utp, { radius: 9, color: "#fff", weight: 3, fillColor: COLORS.primary, fillOpacity: 1 })
    .bindTooltip('<div class="map-pin"><strong>UTP</strong></div>').addTo(smapLayer);
  smap.fitBounds(pts, { padding: [30, 30], maxZoom: 9 });
  $("sc-map-sub").textContent = `UTP → ${st.town}`;
}

// ---------- actions ----------

function act(what, btn) {
  if (what === "go-carpool") { location.hash = "student-carpool"; return; }

  if (what === "book-bus") {
    const bus = busOption();
    addTrip({
      key: bus.key, kind: bus.vehicle, date: st.date, time: st.time, town: st.town,
      title: `University ${bus.vehicle} to ${st.town}`, detail: `Route ${bus.route} · seat booked`,
      paid: bus.fare, rm: bus.savedRm, kg: bus.savedKg,
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
      title: `Carpool to ${st.town}`, detail: `With driver ${f.driver.id} (going to ${f.driver.town}) · requested`,
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
      title: `Driving to ${st.town} with ${riders.length} rider${riders.length > 1 ? "s" : ""}`,
      detail: `Riders: ${riders.map((r) => r.rider.id).join(", ")}`,
      // as the driver you get the riders' share back
      paid: alone.solo_rm - total.shared_rm, rm: total.shared_rm, kg: total.kg_co2,
    });
    toast(`Ride posted: ${riders.length} student${riders.length > 1 ? "s" : ""} can travel with you`);
    renderCarpoolPage();
  }
}

// ---------- My trips ----------

function renderMyTrips() {
  const sorted = [...myTrips].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const totalRm = sorted.reduce((s, t) => s + Math.max(0, t.rm), 0);
  const totalKg = sorted.reduce((s, t) => s + Math.max(0, t.kg), 0);
  countUp($("mt-count"), sorted.length);
  $("mt-count-sub").textContent = sorted.length ? `next: ${dayName(sorted[0].date)} ${fmtDate(sorted[0].date)}` : "nothing booked yet";
  countUp($("mt-rm"), totalRm, rm);
  countUp($("mt-kg"), totalKg, kg);
  $("mt-kg-sub").textContent = "compared with driving alone";

  $("mt-list").innerHTML = sorted.length ? sorted.map((t, i) => {
    const [, m, d] = t.date.split("-").map(Number);
    return `<div class="trip" style="animation-delay:${i * 50}ms">
      <div class="when"><strong>${d}</strong><span>${MONTHS[m - 1]}</span></div>
      <div>
        <h3>${esc(t.title)}</h3>
        <p>${dayName(t.date)} · ${t.kind === "offer" ? "you leave" : "leaves"} ${t.time} · ${esc(t.detail)}</p>
      </div>
      <div class="saved"><strong>${t.kind === "offer" ? `+${rm(t.rm)}` : rm(t.paid)}</strong>${t.kind === "offer" ? "back from riders" : `saves ${rm(t.rm)}`}</div>
      <button class="icon-btn" data-remove="${t.id}" title="Cancel" aria-label="Cancel ${esc(t.title)}">×</button>
    </div>`;
  }).join("") : `<div class="empty"><strong>No trips yet</strong><span>Plan your trip home to book a bus seat or a carpool.</span>
      <button class="btn" data-go="student">Plan my trip</button></div>`;
}

function setupMyTrips() {
  $("mt-list").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      myTrips = myTrips.filter((t) => t.id !== rm.dataset.remove);
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
}

export function renderStudent(page) {
  if (!data) return;
  if (page === "student") renderPlan();
  if (page === "student-carpool") renderCarpoolPage();
  if (page === "student-trips") renderMyTrips();
}
