// Login pop-up. When Supabase is connected, the Student view needs a signed-in
// account and the Operator view needs an account with role = 'operator'.
// In demo mode (no Supabase key) nothing is gated.

import { $ } from "./ui.js";
import { db } from "./db.js";

const TEXT = {
  student: {
    side: "Book your seat home, find a carpool and see what you save.",
    points: [["ti-bus", "University bus and van seats"], ["ti-car", "Carpools with other students"], ["ti-leaf", "CO₂ you save on every trip"]],
  },
  operator: {
    side: "Forecast demand and plan buses and vans for every break.",
    points: [["ti-chart-line", "Demand forecast with a safety margin"], ["ti-bus", "Vehicle plan per trip"], ["ti-ticket", "Live seat bookings"]],
  },
};

const ICON = {
  "ti-bus": '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4z"/><path d="M4 11h16M8 16v2M16 16v2"/><circle cx="8" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/>',
  "ti-car": '<path d="M5 11 6.8 6.2A2 2 0 0 1 8.7 5h6.6a2 2 0 0 1 1.9 1.2L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/>',
  "ti-leaf": '<path d="M11 20A7 7 0 0 1 4 13c0-6 7-9 16-9 0 9-3 16-9 16Z"/><path d="M4 21c3-5 6-8 10-10"/>',
  "ti-chart-line": '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
  "ti-ticket": '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"/>',
};

const state = { view: "student", mode: "sign-in", onSwitchView: () => {} };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Does this view need someone (else) to sign in first? */
export function needsAuth(view) {
  if (!db.enabled) return false;
  if (!db.user) return true;
  return view === "operator" && !db.isOperator;
}

/** Show the pop-up if the view needs a login, hide it otherwise. */
export function checkGate(view) {
  if (view !== state.view) state.mode = "sign-in";
  state.view = view;
  if (needsAuth(view)) open(); else close();
}

export function openAuth(view = state.view, mode = "sign-in") {
  state.view = view;
  state.mode = mode;
  open();
}

function open() {
  const el = $("auth");
  render();
  if (el.hidden) {
    el.hidden = false;
    document.body.classList.add("auth-open");
    setTimeout(() => el.querySelector("input")?.focus(), 50);
  }
}

function close() {
  const el = $("auth");
  if (el.hidden) return;
  el.hidden = true;
  document.body.classList.remove("auth-open");
}

function render() {
  const { view, mode } = state;
  const t = TEXT[view];
  const wrongRole = db.user && view === "operator" && !db.isOperator;
  const side = `
    <aside class="auth-side">
      <div class="auth-logo"><img src="assets/utp-emblem.png" alt=""></div>
      <h2>ShareWay UTP</h2>
      <p>${t.side}</p>
      <ul>${t.points.map(([ic, txt]) => `<li><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[ic]}</svg>${txt}</li>`).join("")}</ul>
      <span class="auth-foot">TEB2023 · Group 7</span>
    </aside>`;

  const roleSwitch = `
    <div class="auth-role" role="group" aria-label="I am">
      <button type="button" data-auth-view="student" class="${view === "student" ? "active" : ""}" aria-pressed="${view === "student"}">Student</button>
      <button type="button" data-auth-view="operator" class="${view === "operator" ? "active" : ""}" aria-pressed="${view === "operator"}">Operator</button>
    </div>`;

  let body;
  if (wrongRole) {
    body = `
      <h3 id="auth-title">Operator access only</h3>
      <p class="auth-sub">You're signed in as <strong>${esc(db.user.email)}</strong>, which is a student account.
        Sign in with an operator account, or carry on in the student view.</p>
      <div class="auth-actions">
        <button class="btn" type="button" data-auth="to-student">Go to student view</button>
        <button class="btn-ghost" type="button" data-auth="sign-out">Sign in as someone else</button>
      </div>`;
  } else {
    const signUp = mode === "sign-up";
    body = `
      <h3 id="auth-title">${signUp ? "Create your account" : view === "operator" ? "Operator sign in" : "Welcome back"}</h3>
      <p class="auth-sub">${view === "operator"
        ? (signUp ? "Use the email the admin approved for you." : "Sign in with your operator email to continue.")
        : (signUp ? "Use your UTP email. It only takes a minute." : "Sign in with your UTP email to continue.")}</p>
      <div class="auth-tabs" role="tablist">
        <button type="button" role="tab" data-auth-mode="sign-in" class="${!signUp ? "active" : ""}" aria-selected="${!signUp}">Sign in</button>
        <button type="button" role="tab" data-auth-mode="sign-up" class="${signUp ? "active" : ""}" aria-selected="${signUp}">Create account</button>
      </div>
      <form class="auth-form" novalidate>
        ${signUp ? '<label class="field"><span>Full name</span><input id="auth-name" autocomplete="name" required></label>' : ""}
        <label class="field"><span>${view === "operator" ? "Email" : "UTP email"}</span><input id="auth-email" type="email" autocomplete="email" placeholder="${view === "operator" ? "you@example.com" : "name@utp.edu.my"}" required></label>
        <label class="field pass-field"><span>Password</span>
          <input id="auth-pass" type="password" autocomplete="${signUp ? "new-password" : "current-password"}" minlength="8" required>
          <button type="button" class="pass-toggle" data-auth="toggle-pass" aria-label="Show password">Show</button>
        </label>
        ${signUp ? '<p class="auth-hint">At least 8 characters.</p>' : ""}
        <button class="btn auth-submit" type="submit">${signUp ? "Create account" : "Sign in"}</button>
        <p class="auth-msg" id="auth-msg" role="status"></p>
      </form>
      <p class="auth-note">${view === "operator"
        ? "Operators can use any email (Gmail is fine), but the admin has to approve it first. Students sign in from the Student tab."
        : "Only @utp.edu.my addresses can sign up. Your name and email are used for bookings only."}</p>`;
  }

  $("auth").innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      ${side}
      <div class="auth-main">${roleSwitch}${body}</div>
    </div>`;
}

async function submit(form) {
  const msg = $("auth-msg");
  const email = $("auth-email").value.trim();
  const pass = $("auth-pass").value;
  const nameInput = $("auth-name");
  const name = nameInput?.value.trim() ?? "";
  msg.className = "auth-msg error";
  if (nameInput && !name) { msg.textContent = "Enter your full name."; nameInput.focus(); return; }
  if (!email) { msg.textContent = "Enter your UTP email."; $("auth-email").focus(); return; }
  const asOperator = state.view === "operator";
  if (!asOperator && !email.toLowerCase().endsWith("@utp.edu.my")) { msg.textContent = "Use your full UTP email, e.g. name@utp.edu.my."; $("auth-email").focus(); return; }
  if (!email.includes("@")) { msg.textContent = "Enter a full email address."; $("auth-email").focus(); return; }
  if (!pass) { msg.textContent = "Enter your password."; $("auth-pass").focus(); return; }

  const button = form.querySelector(".auth-submit");
  button.disabled = true;
  msg.className = "auth-msg";
  msg.textContent = "Please wait…";
  const res = nameInput ? await db.signUp(email, pass, name, asOperator) : await db.signIn(email, pass);
  button.disabled = false;
  if (!document.body.contains(msg)) return;   // signed in: the pop-up closed or was redrawn
  msg.className = `auth-msg ${res.error ? "error" : "info"}`;
  msg.textContent = res.error ?? res.info ?? "";
}

export function setupAuth({ onSwitchView }) {
  state.onSwitchView = onSwitchView;
  const el = $("auth");
  el.addEventListener("submit", (e) => { e.preventDefault(); submit(e.target); });
  el.addEventListener("input", (e) => {
    if (e.target.matches("input") && $("auth-msg")) $("auth-msg").textContent = "";
  });
  el.addEventListener("click", async (e) => {
    const viewBtn = e.target.closest("[data-auth-view]");
    if (viewBtn && viewBtn.dataset.authView !== state.view) { state.onSwitchView(viewBtn.dataset.authView); return; }
    const modeBtn = e.target.closest("[data-auth-mode]");
    if (modeBtn) { state.mode = modeBtn.dataset.authMode; render(); el.querySelector("input")?.focus(); return; }
    const act = e.target.closest("[data-auth]")?.dataset.auth;
    if (act === "toggle-pass") {
      const input = $("auth-pass");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      e.target.textContent = show ? "Hide" : "Show";
      e.target.setAttribute("aria-label", show ? "Hide password" : "Show password");
    }
    if (act === "to-student") state.onSwitchView("student");
    if (act === "sign-out") { await db.signOut(); }
  });
}
