// Real logins and bus-seat bookings, stored in Supabase.
// Tables and security rules: supabase/schema.sql.
// If SUPABASE_KEY is empty (or Supabase can't be reached) the site runs in
// demo mode and nothing here is used.

import { SUPABASE_URL, SUPABASE_KEY } from "./supabase-config.js";

const CLIENT_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";
const UTP_DOMAIN = "@utp.edu.my";

let client = null;
let session = null;
let profile = null;
let tripIds = new Map();      // "B|2026-12-15" -> trip id
let counts = new Map();       // trip id -> seats booked
let mine = [];                // my active bus bookings
let decisions = new Map();    // trip id -> PMMD's decision for that trip
let decisionsReady = false;   // false until schema.sql with trip_decisions has been run
let error = "";
const listeners = [];

const key = (route, date) => `${route}|${date}`;

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

function friendly(err) {
  const msg = err?.message ?? String(err);
  if (/database error saving new user/i.test(msg)) {
    return `Students must use a UTP email (${UTP_DOMAIN}). Operators: use the Operator tab to sign up with any email.`;
  }
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first: check your UTP inbox for the link.";
  if (/rate limit/i.test(msg)) return "Too many emails sent. Wait a while and try again.";
  if (/duplicate key|one_active_booking/i.test(msg)) return "You already have a seat on this trip.";
  if (/row-level security/i.test(msg)) return "That trip can't be booked any more.";
  return msg;
}

async function loadProfile() {
  profile = null;
  mine = [];
  if (!session) return;
  const { data: p } = await client.from("profiles").select("email, full_name, role").eq("id", session.user.id).maybeSingle();
  profile = p ?? { email: session.user.email, full_name: "", role: "student" };
  await refreshMine();
}

async function refreshMine() {
  if (!session) { mine = []; return; }
  const { data: rows, error: err } = await client
    .from("bookings")
    .select("id, destination, created_at, trips(route, departure_date, event_name)")
    .eq("student_id", session.user.id)
    .eq("status", "booked");
  if (err) { console.error(err); return; }
  mine = rows.map((r) => ({
    id: r.id, destination: r.destination, created: r.created_at,
    route: r.trips.route, date: r.trips.departure_date, event: r.trips.event_name,
  }));
}

async function loadDecisions() {
  const { data: rows, error: err } = await client
    .from("trip_decisions")
    .select("trip_id, action, buses, standby, note, decided_at");
  if (err) {
    decisionsReady = false;
    console.warn("trip_decisions not available (run supabase/schema.sql again):", err.message);
    return;
  }
  decisionsReady = true;
  decisions = new Map(rows.map((r) => [Number(r.trip_id), {
    action: r.action, buses: r.buses, standby: r.standby, note: r.note, decidedAt: r.decided_at,
  }]));
}

export const db = {
  /** True when Supabase is set up and reachable. */
  get enabled() { return Boolean(client); },
  get error() { return error; },
  get user() { return session?.user ?? null; },
  get profile() { return profile; },
  get isOperator() { return profile?.role === "operator"; },
  get myBookings() { return mine; },
  onChange(fn) { listeners.push(fn); },

  async init() {
    if (!SUPABASE_KEY) return false;
    try {
      const { createClient } = await import(CLIENT_URL);
      client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data: trips, error: err } = await client.from("trips").select("id, route, departure_date");
      if (err) throw err;
      tripIds = new Map(trips.map((t) => [key(t.route, t.departure_date), t.id]));
      ({ data: { session } } = await client.auth.getSession());
      await Promise.all([loadProfile(), db.refreshCounts(), loadDecisions()]);
      client.auth.onAuthStateChange((_event, s) => {
        const userChanged = (s?.user?.id ?? null) !== (session?.user?.id ?? null);
        session = s;
        // reload outside the auth callback, as supabase-js recommends
        if (userChanged) setTimeout(async () => { await loadProfile(); notify(); }, 0);
      });
      return true;
    } catch (e) {
      console.error("Supabase unavailable, running in demo mode:", e);
      error = friendly(e);
      client = null;
      return false;
    }
  },

  tripId(route, date) { return tripIds.get(key(route, date)) ?? null; },
  count(route, date) { return counts.get(db.tripId(route, date)) ?? 0; },
  hasBooking(route, date) { return mine.some((b) => b.route === route && b.date === date); },

  async refreshCounts() {
    if (!client) return;
    const { data: rows, error: err } = await client.rpc("trip_counts");
    if (err) { console.error(err); return; }
    counts = new Map(rows.map((r) => [Number(r.trip_id), Number(r.booked)]));
  },

  /** Students need a UTP email. Operator accounts can use any email; the
   * database gives them the operator role (see handle_new_user in schema.sql). */
  async signUp(email, password, fullName, asOperator = false) {
    email = email.trim().toLowerCase();
    if (!asOperator && !email.endsWith(UTP_DOMAIN)) return { error: `Please use your UTP email (${UTP_DOMAIN}).` };
    if (password.length < 8) return { error: "Use a password of at least 8 characters." };
    const { data: res, error: err } = await client.auth.signUp({
      email, password,
      options: {
        data: { full_name: fullName.trim(), role: asOperator ? "operator" : "student" },
        emailRedirectTo: location.origin + location.pathname,
      },
    });
    if (err) return { error: friendly(err) };
    if (!res.session) return { info: "Account created. Check your UTP inbox for the confirmation link, then sign in." };
    return { info: "Account created. You're signed in." };
  },

  async signIn(email, password) {
    const { error: err } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    return err ? { error: friendly(err) } : {};
  },

  async signOut() {
    await client.auth.signOut();
  },

  async book(route, date, destination) {
    const tripId = db.tripId(route, date);
    if (!tripId) return { error: "This trip isn't in the database yet." };
    const { error: err } = await client.from("bookings").insert({ trip_id: tripId, destination });
    if (err) return { error: friendly(err) };
    await Promise.all([refreshMine(), db.refreshCounts()]);
    notify();
    return {};
  },

  /** Every booking with its trip and student (operators only: the security
   * rules return just your own bookings to anyone else). Newest first. */
  async allBookings() {
    if (!client) return { rows: [] };
    const { data: rows, error: err } = await client
      .from("bookings")
      .select("id, status, destination, created_at, cancelled_at, trips(route, departure_date, event_name), profiles(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (err) return { rows: [], error: friendly(err) };
    return {
      rows: rows.map((r) => ({
        id: r.id, status: r.status, destination: r.destination, created: r.created_at, cancelled: r.cancelled_at,
        route: r.trips?.route ?? "?", date: r.trips?.departure_date ?? "", event: r.trips?.event_name ?? "",
        name: r.profiles?.full_name || "", email: r.profiles?.email ?? "",
      })),
    };
  },

  // ---------- PMMD decisions (trip_decisions table) ----------

  get decisionsReady() { return decisionsReady; },
  decision(route, date) { return decisions.get(db.tripId(route, date)) ?? null; },

  async refreshDecisions() {
    if (!client) return;
    await loadDecisions();
    notify();
  },

  /** Save one or more decisions: [{route, date, action, buses, standby, note}]. Operators only. */
  async decide(list) {
    const rows = [];
    for (const d of list) {
      const tripId = db.tripId(d.route, d.date);
      if (!tripId) return { error: `Route ${d.route} on ${d.date} isn't in the database yet.` };
      rows.push({
        trip_id: tripId, action: d.action, buses: d.action === "bus" ? d.buses : 0,
        standby: d.action === "bus" && d.standby, note: d.note ?? "", decided_at: new Date().toISOString(),
      });
    }
    const { error: err } = await client.from("trip_decisions").upsert(rows, { onConflict: "trip_id" });
    if (err) return { error: /row-level security/i.test(err.message) ? "Only operator accounts can make decisions." : friendly(err) };
    await loadDecisions();
    notify();
    return {};
  },

  async undecide(route, date) {
    const { error: err } = await client.from("trip_decisions").delete().eq("trip_id", db.tripId(route, date));
    if (err) return { error: friendly(err) };
    await loadDecisions();
    notify();
    return {};
  },

  /** The students with a seat on one trip (operators only). */
  async tripBookings(route, date) {
    const tripId = db.tripId(route, date);
    if (!client || !tripId) return { rows: [] };
    const { data: rows, error: err } = await client
      .from("bookings")
      .select("id, destination, profiles(full_name, email)")
      .eq("trip_id", tripId)
      .eq("status", "booked");
    if (err) return { rows: [], error: friendly(err) };
    return { rows: rows.map((r) => ({ id: r.id, destination: r.destination, name: r.profiles?.full_name || "", email: r.profiles?.email ?? "" })) };
  },

  async cancel(bookingId) {
    const { error: err } = await client.from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", bookingId);
    if (err) return { error: friendly(err) };
    await Promise.all([refreshMine(), db.refreshCounts()]);
    notify();
    return {};
  },
};
