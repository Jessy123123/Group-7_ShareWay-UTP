// Live bookings: replays one SIMULATED trip day by day, as the full system would run.
//
// Students book through ShareWay, so the operator never types anything in. Each day
// the new bookings arrive on their own, the model forecasts the final number again,
// and the vehicle plan is updated. Bookings between the snapshot days in
// dashboard.json are interpolated, and the forecast comes from the in-browser model
// (L.predictRange), the same one the What-if page uses.
import { round, dayOfWeek } from "./logic.js";
import {
  $, num, MONTHS, DAYS, COLORS, charts, fmtDate, addDays, option, segmented, areaGradient, hexAlpha,
  countUp, replay, setChart, axisTitle,
} from "./ui.js";
import { db } from "./db.js";

const RUN = 0; // same simulation run as the student view, so student bookings line up
const STUDENT_STORE = "shareway.trips.v1";
const SPEED_MS = { 1: 1400, 2: 700, 4: 320 };

let data;
let L;
let events;
const lv = { eventKey: null, route: "B", tripId: null, day: null, speed: 1, timer: null, history: [] };

// ---------- trip data ----------

function eventTrips(key) {
  return events.get(key).trips.filter((t) => t.run === RUN);
}

function currentTrip() {
  return eventTrips(lv.eventKey).find((t) => t.id === lv.tripId);
}

const firstDay = () => Math.max(...data.config.SNAPSHOT_DAYS);
const lastDay = () => Math.min(...data.config.SNAPSHOT_DAYS);
const dayList = () => Array.from({ length: firstDay() + 1 }, (_, i) => firstDay() - i); // 28 … 0

/** 1 if the viewer booked this trip in the student view: saved to their
 * Supabase account when signed in, otherwise in this browser only. */
function ownBooking(trip) {
  if (db.enabled) return db.hasBooking(trip.route, trip.date) ? 1 : 0;
  try {
    const mine = JSON.parse(localStorage.getItem(STUDENT_STORE)) ?? [];
    return mine.some((t) => t.key === `bus|${trip.id}`) ? 1 : 0;
  } catch { return 0; }
}

/** Bookings so far `d` days before departure: snapshot values, straight line between them. */
function bookingsAt(trip, d) {
  const snaps = [...trip.snaps].sort((a, b) => b[0] - a[0]); // 28, 21, … 1
  const day = Math.max(lastDay(), Math.min(firstDay(), d));
  let value = snaps[snaps.length - 1][1];
  for (let i = 0; i < snaps.length - 1; i++) {
    const [d0, b0] = snaps[i];
    const [d1, b1] = snaps[i + 1];
    if (day <= d0 && day >= d1) { value = b0 + ((b1 - b0) * (d0 - day)) / (d0 - d1); break; }
  }
  return Math.round(value) + ownBooking(trip);
}

function seatsFor(rec) {
  if (rec.action === "van") return data.config.VAN_CAPACITY;
  return (rec.buses + (rec.standby ? 1 : 0)) * data.config.BUS_CAPACITY;
}

function planText(rec) {
  if (rec.action === "cancel") return "Cancel";
  if (rec.action === "van") return "1 van";
  return `${rec.buses} bus${rec.buses > 1 ? "es" : ""}${rec.standby ? " + standby" : ""}`;
}

/** What the system knows `d` days before departure. */
function stateAt(trip, d) {
  const bookings = bookingsAt(trip, d);
  const { low, mid, high } = L.predictRange(trip.route, d, bookings, trip.date, trip.holiday);
  const rec = L.recommend(high); // plan for the high end (safety margin)
  return { d, bookings, low, mid, high, rec, seats: seatsFor(rec) };
}

// ---------- controls ----------

export function setupLive(ctx) {
  ({ data, L, events } = ctx);
  const today = new Date().toISOString().slice(0, 10);
  const list = [...events.values()].filter((e) => eventTrips(e.key).length);
  lv.eventKey = (list.find((e) => e.firstDay >= today) ?? list[list.length - 1]).key;

  const fEvent = $("lv-event");
  for (const e of list) {
    const [y, m] = e.firstDay.split("-").map(Number);
    fEvent.append(option(e.key, `${e.event} · ${MONTHS[m - 1]} ${y}`, e.key === lv.eventKey));
  }
  fEvent.addEventListener("change", () => { lv.eventKey = fEvent.value; pickRoute(); });

  segmented($("lv-route"), Object.keys(data.config.ROUTES).map((c) => [c, `${c} · ${data.config.ROUTES[c].name}`]),
    lv.route, (v) => { lv.route = v; pickRoute(); });
  $("lv-trip").addEventListener("change", (e) => { lv.tripId = Number(e.target.value); restart(); });

  segmented($("lv-speed"), [["1", "1×"], ["2", "2×"], ["4", "4×"]], "1", (v) => {
    lv.speed = Number(v);
    if (lv.timer) { pause(); play(); }
  });
  $("lv-play").addEventListener("click", () => (lv.timer ? pause() : play()));
  $("lv-step").addEventListener("click", () => { pause(); step(); });
  $("lv-restart").addEventListener("click", () => { pause(); restart(); });

  pickRoute();
}

function pickRoute() {
  const trips = eventTrips(lv.eventKey).filter((t) => t.route === lv.route).sort((a, b) => a.date.localeCompare(b.date));
  if (!trips.some((t) => t.id === lv.tripId)) {
    lv.tripId = trips.reduce((a, b) => (b.final > a.final ? b : a), trips[0]).id; // busiest day
  }
  const fTrip = $("lv-trip");
  fTrip.innerHTML = "";
  for (const t of trips) fTrip.append(option(t.id, `${DAYS[t.dow]} ${fmtDate(t.date, true)}`, t.id === lv.tripId));
  restart();
}

// ---------- playback ----------

function play() {
  if (lv.day === 0) restart();
  lv.timer = setInterval(step, SPEED_MS[lv.speed]);
  step();
  playButton();
}

function pause() {
  clearInterval(lv.timer);
  lv.timer = null;
  playButton();
}

/** Stop when the operator leaves the page. */
export function leaveLive() {
  if (lv.timer) pause();
}

function playButton() {
  const btn = $("lv-play");
  btn.textContent = lv.timer ? "Pause" : lv.day === 0 ? "Replay" : lv.history.length > 1 ? "Resume" : "Start";
  btn.setAttribute("aria-pressed", Boolean(lv.timer));
  $("lv-step").disabled = lv.day === 0;
  $("lv-live").classList.toggle("on", Boolean(lv.timer));
}

function restart() {
  pause();
  const trip = currentTrip();
  lv.day = firstDay();
  lv.history = [stateAt(trip, lv.day)];
  $("lv-feed").innerHTML = "";
  drawChart(trip);
  addFeed(trip, lv.history[0], null);
  renderState(trip);
  playButton();
}

function step() {
  if (lv.day === 0) { pause(); return; }
  const trip = currentTrip();
  const prev = lv.history[lv.history.length - 1];
  lv.day -= 1;
  if (lv.day === 0) {
    addDeparture(trip, prev);
    pause();
  } else {
    const now = stateAt(trip, lv.day);
    lv.history.push(now);
    addFeed(trip, now, prev);
  }
  renderState(trip);
  updateChart(trip);
  playButton();
}

// ---------- rendering ----------

function renderState(trip) {
  const s = lv.history[lv.history.length - 1];
  const date = addDays(trip.date, -lv.day);
  const done = lv.day === 0;

  $("lv-today").textContent = done ? "Departure day" : `${lv.day} day${lv.day === 1 ? "" : "s"} to go`;
  $("lv-today-sub").textContent = `${DAYS[dayOfWeek(date)]} ${fmtDate(date, true)} · Route ${trip.route}, ${fmtDate(trip.date)}`;
  countUp($("lv-book"), s.bookings, (v) => num.format(Math.round(v)), 500);
  const mine = ownBooking(trip);
  const prev = lv.history[lv.history.length - 2];
  const today = prev ? `+${s.bookings - prev.bookings} today` : "bookings just opened";
  $("lv-book-sub").textContent = done
    ? `${trip.final} turned up (simulated)`
    : `${today}${mine ? " · includes your booking" : ""}`;
  countUp($("lv-pred"), round(s.mid), (v) => num.format(Math.round(v)), 500);
  $("lv-pred-sub").textContent = `likely ${round(s.low)} to ${round(s.high)}`;

  const plan = $("lv-plan");
  const text = planText(s.rec);
  if (plan.textContent !== text) {
    plan.textContent = text;
    replay(plan, "pop");
  }
  $("lv-plan-sub").textContent = s.rec.action === "cancel" ? "offer carpools instead" : `${s.seats} seats ready`;
}

function feedItem(html, cls = "") {
  const li = document.createElement("li");
  li.className = `feed-item ${cls}`;
  li.innerHTML = html;
  $("lv-feed").prepend(li);
}

function addFeed(trip, now, prev) {
  const when = `<span class="feed-day">${now.d}d</span>`;
  if (!prev) {
    feedItem(`${when}<div><strong>Bookings open.</strong> ${now.bookings} students have booked so far.
      First forecast: <strong>${round(now.mid)}</strong> passengers (likely ${round(now.low)}–${round(now.high)}),
      plan <strong>${planText(now.rec)}</strong>.</div>`);
    return;
  }
  const added = now.bookings - prev.bookings;
  const moved = round(now.mid) - round(prev.mid);
  const arrow = moved === 0 ? "unchanged" : `${moved > 0 ? "▲" : "▼"} ${Math.abs(moved)}`;
  feedItem(`${when}<div><strong>${added > 0 ? `+${added}` : "No new"} booking${added === 1 ? "" : "s"}</strong>
    · total ${now.bookings}<br><span class="muted">Forecast ${round(now.mid)} (${arrow}), likely
    ${round(now.low)}–${round(now.high)}</span></div>`);
  if (planText(now.rec) !== planText(prev.rec)) {
    feedItem(`${when}<div><strong>Plan updated:</strong> ${planText(prev.rec)} → <strong>${planText(now.rec)}</strong>
      <br><span class="muted">${now.seats} seats for a high-end forecast of ${Math.ceil(now.high)}</span></div>`, "change");
  }
}

function addDeparture(trip, last) {
  const short = trip.final - last.seats;
  const verdict = last.rec.action === "cancel"
    ? (trip.final < data.config.MIN_PASSENGERS ? "Cancelling was right." : `${trip.final} students needed seats: the trip should have run.`)
    : short > 0 ? `${short} student${short === 1 ? "" : "s"} short of a seat.` : `Everyone had a seat (${-short} spare).`;
  feedItem(`<span class="feed-day">Go</span><div><strong>Departure.</strong> ${trip.final} students turned up
    (simulated, after no-shows). Final plan: ${planText(last.rec)}, ${last.seats} seats. ${verdict}</div>`,
  short > 0 ? "warn" : "done");
}

function chartLabels() {
  return dayList().map((d) => (d === 0 ? "Depart" : `${d}d`));
}

function series() {
  const n = dayList().length;
  const at = (pick) => {
    const out = Array(n).fill(null);
    for (const s of lv.history) out[firstDay() - s.d] = pick(s);
    return out;
  };
  const actual = Array(n).fill(null);
  if (lv.day === 0) actual[n - 1] = currentTrip().final;
  return [at((s) => s.bookings), at((s) => round(s.low, 1)), at((s) => round(s.high, 1)),
    at((s) => round(s.mid, 1)), at((s) => s.seats), actual];
}

function drawChart(trip) {
  const [bookings, low, high, mid, seats, actual] = series();
  // fixed y axis for the whole replay, so the lines don't jump as they grow
  const all = dayList().filter((d) => d > 0).map((d) => stateAt(trip, d));
  const max = Math.max(trip.final, ...all.map((s) => Math.max(s.high, s.seats, s.bookings)));
  setChart("live", "c-live", {
    type: "line",
    data: {
      labels: chartLabels(),
      datasets: [
        {
          label: "Bookings so far", data: bookings, borderColor: COLORS.accent, backgroundColor: areaGradient(COLORS.accent),
          fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.2,
        },
        { label: "Likely range (low)", data: low, borderWidth: 0, pointRadius: 0, fill: false },
        {
          label: "Likely range (high)", data: high, borderWidth: 0, pointRadius: 0, fill: "-1",
          backgroundColor: hexAlpha(COLORS.primary, 0.12),
        },
        { label: "Forecast final", data: mid, borderColor: COLORS.primary, borderWidth: 2, pointRadius: 0, tension: 0.2 },
        {
          label: "Seats planned", data: seats, borderColor: COLORS.green, borderWidth: 2, pointRadius: 0,
          stepped: true, borderDash: [6, 4],
        },
        {
          label: "Actual final (simulated)", data: actual, borderColor: COLORS.text, backgroundColor: COLORS.text,
          pointRadius: 7, pointStyle: "rectRot", showLine: false,
        },
      ],
    },
    options: {
      animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, title: axisTitle("Days before departure"), ticks: { maxTicksLimit: 15 } },
        y: { beginAtZero: true, suggestedMax: Math.ceil(max * 1.08), title: axisTitle("Passengers / seats") },
      },
      plugins: { tooltip: { filter: (item) => item.raw !== null } },
    },
  });
}

function updateChart() {
  const chart = charts.live;
  if (!chart) return;
  series().forEach((d, i) => { chart.data.datasets[i].data = d; });
  chart.update();
}
