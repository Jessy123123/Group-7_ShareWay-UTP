// PMMD's decision for each trip: cancel, one van, or N buses (+ standby).
//
// With Supabase (and the trip_decisions table from supabase/schema.sql) the
// decisions are shared: every student sees them. Otherwise (demo mode) they
// are kept in this browser, so the student view in the same browser still
// reacts to them.
//
// A decision looks like { action: "cancel" | "van" | "bus", buses, standby, note, decidedAt }.

import { db } from "./db.js";

const STORE = "shareway.decisions.v1";
const listeners = [];
const key = (route, date) => `${route}|${date}`;

function local() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; }
}

function saveLocal(all) {
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* private mode: kept until reload */ }
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

/** True when decisions are saved to Supabase and shared with every student. */
export const sharedDecisions = () => db.enabled && db.decisionsReady;

export function getDecision(route, date) {
  return sharedDecisions() ? db.decision(route, date) : local()[key(route, date)] ?? null;
}

/** Save decisions: [{route, date, action, buses, standby, note}]. */
export async function setDecisions(list) {
  if (sharedDecisions()) {
    const res = await db.decide(list);
    if (!res.error) notify();
    return res;
  }
  const all = local();
  const now = new Date().toISOString();
  for (const d of list) {
    all[key(d.route, d.date)] = {
      action: d.action, buses: d.action === "bus" ? d.buses : 0, standby: d.action === "bus" && Boolean(d.standby),
      note: d.note ?? "", decidedAt: now,
    };
  }
  saveLocal(all);
  notify();
  return {};
}

export async function clearDecision(route, date) {
  if (sharedDecisions()) {
    const res = await db.undecide(route, date);
    if (!res.error) notify();
    return res;
  }
  const all = local();
  delete all[key(route, date)];
  saveLocal(all);
  notify();
  return {};
}

export function onDecisions(fn) {
  listeners.push(fn);
}

// another tab (e.g. the student view) changed the demo decisions
window.addEventListener("storage", (e) => { if (e.key === STORE) notify(); });
