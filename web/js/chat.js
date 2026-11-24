// AI assistant for students and operators, running on Ollama (a local LLM).
//
// The model only sees the numbers the dashboard is showing right now (passed in
// as "facts" by app.js / student.js), so it explains the app's own data instead
// of making things up. Ollama must be running on the computer that opens the
// site: `ollama serve`, with a model pulled, e.g. `ollama pull llama3.2:3b`.
// For a deployed site, allow its address with OLLAMA_ORIGINS (see README).

import { $ } from "./ui.js";

const OLLAMA_URL = "http://localhost:11434";
const PREFERRED_MODELS = ["llama3.2:3b", "llama3.2", "qwen2.5:1.5b"];

const PROMPTS = {
  student: `You are the ShareWay UTP assistant for students of Universiti Teknologi PETRONAS.
You help a student get home for a semester break or public holiday: the university bus or van,
a carpool with another student, or going alone. You also explain how booking and carpool matching work.
Rules:
- Use ONLY the facts below. Never invent numbers, drivers, dates or prices. Copy numbers exactly as written.
- The app shows no fare for the university bus and van. Never give a price for them and never call them free; just don't talk about their cost.
- If the answer is not in the facts, say you don't know and point to the right page (Plan trip, Carpool, My trips).
- Keep answers short (under 120 words), friendly and in simple English. Use bullet points for lists.
- All trip data is simulated for a class project; mention this only if asked whether it is real.`,
  operator: `You are the ShareWay UTP assistant for transport operators (planners) at Universiti Teknologi PETRONAS.
You help them read the demand forecast, the likely range, the vehicle plan, and the model's accuracy.
Rules:
- Use ONLY the facts below. Never invent numbers. Copy numbers exactly as written; don't add them up or reinterpret them.
- "Trips" and "buses" are different: one trip can need several buses.
- Explain clearly why a plan was chosen (forecast, high end of the range, vehicle rules).
- If the answer is not in the facts, say so and point to the right page (Overview, Live bookings, What-if forecast, Trip decisions, CO2, Booking history).
- Keep answers short (under 150 words) and practical. Use bullet points for lists.
- The data is simulated for a class project; say so if asked whether it is real.`,
};

const SUGGESTIONS = {
  student: ["What's the best way home for me?", "Is my bus likely to be cancelled?", "How does carpool matching work?", "How much CO₂ do I save?"],
  operator: ["Summarise this break's plan", "Which trips need a standby bus?", "How accurate is the forecast?", "Why plan for the high end of the range?"],
};

const state = {
  view: "student",
  model: null,
  online: false,
  busy: false,
  controller: null,
  history: { student: [], operator: [] },
  getFacts: () => "",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Tiny markdown: **bold**, bullet lists and line breaks. */
function format(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").split("\n");
  let html = "";
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*•+]\s+(.*)/.exec(line) || /^\d+[.)]\s+(.*)/.exec(line);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${bullet[1]}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line) html += `<p>${line}</p>`;
    }
  }
  return html + (inList ? "</ul>" : "");
}

async function findModel() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(res.status);
    const names = (await res.json()).models.map((m) => m.name);
    state.model = PREFERRED_MODELS.find((m) => names.includes(m))
      ?? names.find((n) => !/embed/i.test(n)) ?? null;
    state.online = Boolean(state.model);
  } catch {
    state.online = false;
    state.model = null;
  }
  renderStatus();
}

function renderStatus() {
  const el = $("chat-status");
  el.className = `chat-status ${state.online ? "on" : "off"}`;
  el.innerHTML = state.online
    ? `<i></i>Ollama · ${esc(state.model)}`
    : "<i></i>Offline: Ollama isn't running";
}

function renderLog() {
  const log = $("chat-log");
  const msgs = state.history[state.view];
  const intro = state.view === "student"
    ? "Hi! I can help you plan your trip home: the university bus, a carpool, or going alone. Ask me anything about the trip you've picked."
    : "Hi! I can explain the forecast, the likely range and the vehicle plan for the break you're looking at.";
  let html = `<div class="msg bot">${format(intro)}</div>`;
  if (!state.online) {
    html += `<div class="msg bot warn">${format("The assistant runs on **Ollama** on this computer. Start it with `ollama serve`, make sure a model is installed (`ollama pull llama3.2:3b`), then press ↺ to reconnect.")}</div>`;
  }
  html += msgs.map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${m.role === "user" ? esc(m.content) : format(m.content)}</div>`).join("");
  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
  $("chat-suggest").innerHTML = msgs.length ? "" : SUGGESTIONS[state.view]
    .map((q) => `<button type="button" class="chip-q">${esc(q)}</button>`).join("");
  $("chat-input").placeholder = state.view === "student" ? "Ask about your trip home…" : "Ask about the forecast or plan…";
}

async function send(text) {
  text = text.trim();
  if (!text || state.busy) return;
  if (!state.online) { await findModel(); if (!state.online) { renderLog(); return; } }
  const view = state.view;
  const history = state.history[view];
  history.push({ role: "user", content: text });
  const reply = { role: "assistant", content: "" };
  history.push(reply);
  renderLog();

  const log = $("chat-log");
  const bubble = log.lastElementChild;
  bubble.classList.add("typing");
  bubble.innerHTML = "<span></span><span></span><span></span>";

  const today = new Date().toISOString().slice(0, 10);
  const messages = [
    { role: "system", content: `${PROMPTS[view]}\n\nToday is ${today}.\n\nFACTS (what the dashboard shows right now):\n${state.getFacts(view)}` },
    ...history.slice(-9, -1).map(({ role, content }) => ({ role, content })),
  ];

  setBusy(true);
  state.controller = new AbortController();
  try {
    // No Content-Type header: keeps it a "simple" request, so the browser
    // doesn't need a CORS preflight. Ollama reads the JSON body anyway.
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      body: JSON.stringify({ model: state.model, messages, stream: true, options: { temperature: 0.2, num_ctx: 4096 } }),
      signal: state.controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama replied ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) {
          reply.content += chunk.message.content;
          bubble.classList.remove("typing");
          bubble.innerHTML = format(reply.content);
          log.scrollTop = log.scrollHeight;
        }
      }
    }
    if (!reply.content) reply.content = "Sorry, I didn't get an answer. Please try again.";
  } catch (err) {
    if (err.name === "AbortError") {
      reply.content += reply.content ? " …(stopped)" : "(stopped)";
    } else {
      reply.content = `I couldn't reach Ollama (${err.message}). Is it running? Try \`ollama serve\`, then press ↺.`;
      state.online = false;
      renderStatus();
    }
  } finally {
    setBusy(false);
    state.controller = null;
    if (state.view === view) renderLog();
  }
}

function setBusy(busy) {
  state.busy = busy;
  const btn = $("chat-send");
  btn.textContent = busy ? "Stop" : "Send";
  btn.classList.toggle("stop", busy);
}

function toggle(open) {
  const panel = $("chat");
  const isOpen = open ?? panel.hidden;
  panel.hidden = !isOpen;
  $("chat-fab").setAttribute("aria-expanded", String(isOpen));
  $("chat-fab").classList.toggle("open", isOpen);
  if (isOpen) {
    renderLog();
    if (!state.online) findModel().then(renderLog);
    setTimeout(() => $("chat-input").focus(), 50);
  }
}

let docked = false;

/** Show the chat full-size inside a page (the "Ask AI" pages), or put it back
 * as the floating panel when `container` is null. Same conversation either way. */
export function dockChat(container) {
  const panel = $("chat");
  const fab = $("chat-fab");
  if (container) {
    if (panel.parentElement !== container) container.append(panel);
    panel.classList.add("docked");
    panel.hidden = false;
    docked = true;
    fab.hidden = true;
    $("chat-close").hidden = true;
    renderLog();
    if (!state.online) findModel().then(renderLog);
  } else if (docked) {
    document.body.insertBefore(panel, $("auth"));
    panel.classList.remove("docked");
    panel.hidden = true;
    docked = false;
    fab.hidden = false;
    fab.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    $("chat-close").hidden = false;
  }
}

/** Called by app.js when the view changes (Student / Operator). */
export function setChatView(view) {
  if (view === state.view) return;
  if (state.busy) state.controller?.abort();
  state.view = view;
  $("chat-title").textContent = view === "student" ? "Student assistant" : "Operator assistant";
  if (!$("chat").hidden) renderLog();
}

export function setupChat({ getFacts, view }) {
  state.getFacts = getFacts;
  state.view = view;
  $("chat-title").textContent = view === "student" ? "Student assistant" : "Operator assistant";
  $("chat-fab").addEventListener("click", () => toggle());
  $("chat-close").addEventListener("click", () => toggle(false));
  $("chat-clear").addEventListener("click", () => {
    if (state.busy) state.controller?.abort();
    state.history[state.view] = [];
    findModel().then(renderLog);
  });
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.busy) { state.controller?.abort(); return; }
    const input = $("chat-input");
    const text = input.value;
    input.value = "";
    input.style.height = "";
    send(text);
  });
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chat-form").requestSubmit(); }
  });
  $("chat-input").addEventListener("input", (e) => {
    e.target.style.height = "";
    e.target.style.height = `${Math.min(110, e.target.scrollHeight)}px`;
  });
  $("chat-suggest").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip-q");
    if (chip) send(chip.textContent);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !docked && !$("chat").hidden) toggle(false); });
  findModel();
}
