// Main application logic for the Workout PWA.
//
// Core principle: the user fully controls the session lifecycle. Nothing here
// starts, continues, ends, creates, or discards a session automatically. There
// is no time-based or heuristic logic of any kind. The app is a recorder.
//
// Interaction model: when a session is active, all 15 series are shown on one
// page and can be edited in any order with +/- steppers. There is no "next"
// action. All 15 series are saved to D1 when the user presses COMPLETAR SESIÓN.

const WEIGHT_STEP = 0.5;

// In-memory copy of the active session; the source of truth is IndexedDB.
let active = null;
// Current screen: "tracker" or "history".
let screen = "tracker";

const appEl = document.getElementById("app");

// ---------- helpers ----------

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function exerciseById(id) {
  return window.ROUTINE.find((e) => e.id === id);
}

function formatWeight(w) {
  if (w === null || w === undefined) return "0";
  return Number.isInteger(w) ? String(w) : w.toFixed(1);
}

function formatDate(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function touchedCount() {
  return active ? active.sets.filter((s) => s.touched).length : 0;
}

// Last weight used for an exercise, from the global history the app has seen:
// locally kept completed sessions (most recent first). Used to seed the initial
// weight for each series when a new session starts, so the value is available
// offline based on what the app already knows.
function lastWeightFor(exerciseId, completedSessions) {
  const sorted = completedSessions
    .slice()
    .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
  for (const sess of sorted) {
    const matches = (sess.sets || []).filter((s) => s.exercise_id === exerciseId);
    if (matches.length) return matches[matches.length - 1].weight;
  }
  return null;
}

async function persistActive() {
  if (active) await window.DB.setActiveSession(active);
}

// ---------- session lifecycle (user-driven only) ----------

async function startNewSession() {
  const completed = await window.DB.getAllCompletedSessions();
  const sets = [];
  for (const ex of window.ROUTINE) {
    const lw = lastWeightFor(ex.id, completed);
    for (let n = 1; n <= ex.sets; n++) {
      sets.push({
        id: crypto.randomUUID(),
        exercise_id: ex.id,
        set_number: n,
        reps: ex.initialReps,
        weight: lw === null ? 0 : lw,
        touched: false,
      });
    }
  }
  active = {
    id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    completed_at: null,
    synced: false,
    sets,
  };
  await persistActive();
  render();
}

// The only mechanism that closes a session. Saves all 15 series to D1.
async function completeSession() {
  if (!active) return;
  active.completed_at = new Date().toISOString();
  active.synced = false;
  const finished = active;
  await window.DB.saveCompletedSession(finished);
  await window.DB.clearActiveSession();
  active = null;
  render();
  // Attempt to sync; if offline/failed it stays queued and is retried later.
  syncPending();
}

// ---------- counter mutations ----------

function findSet(id) {
  return active && active.sets.find((s) => s.id === id);
}

async function changeReps(id, delta) {
  const set = findSet(id);
  if (!set) return;
  set.reps = Math.max(0, set.reps + delta);
  set.touched = true;
  await persistActive();
  updateSetDom(set);
}

async function changeWeight(id, delta) {
  const set = findSet(id);
  if (!set) return;
  set.weight = Math.max(0, Math.round((set.weight + delta) * 2) / 2);
  set.touched = true;
  await persistActive();
  updateSetDom(set);
}

// Targeted DOM update so +/- taps don't rebuild the whole list (keeps scroll
// position and feels instant).
function updateSetDom(set) {
  const repsEl = appEl.querySelector(`[data-val="reps"][data-id="${set.id}"]`);
  const weightEl = appEl.querySelector(`[data-val="weight"][data-id="${set.id}"]`);
  if (repsEl) repsEl.textContent = set.reps;
  if (weightEl) weightEl.textContent = formatWeight(set.weight);
  const row = appEl.querySelector(`[data-row-id="${set.id}"]`);
  if (row) row.classList.add("touched");
  const prog = appEl.querySelector("#progress-count");
  if (prog) prog.textContent = `${touchedCount()}/${window.TOTAL_SETS}`;
}

// ---------- rendering ----------

function render() {
  if (screen === "history") {
    renderHistory();
    return;
  }
  if (!active) {
    renderNoSession();
  } else {
    renderTracker();
  }
}

function renderNoSession() {
  appEl.innerHTML = `
    <header class="topbar">
      <h1>Entrenamiento</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen center">
      <p class="hint">No hay una sesión activa.</p>
      <button class="btn btn-primary btn-huge" data-action="new-session">NUEVA SESIÓN</button>
    </main>
  `;
}

function renderTracker() {
  const total = window.TOTAL_SETS;
  const exercisesHtml = window.ROUTINE.map(renderExerciseBlock).join("");

  appEl.innerHTML = `
    <header class="topbar">
      <h1>Entrenamiento</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen">
      <div class="progress">Registradas: <strong><span id="progress-count">${touchedCount()}/${total}</span></strong> series</div>
      ${exercisesHtml}
      <button class="btn btn-complete" data-action="complete">COMPLETAR SESIÓN</button>
    </main>
  `;
}

function renderExerciseBlock(ex) {
  const sets = active.sets.filter((s) => s.exercise_id === ex.id);
  const rows = sets.map((s) => renderSeriesRow(ex, s)).join("");
  return `
    <section class="card exercise-block">
      <h2 class="exercise-name">${esc(ex.name)}</h2>
      ${rows}
    </section>`;
}

function renderSeriesRow(ex, s) {
  return `
    <div class="series-row${s.touched ? " touched" : ""}" data-row-id="${s.id}">
      <span class="series-num">Serie ${s.set_number}/${ex.sets}</span>
      <div class="mini">
        <span class="mini-label">Peso (kg)</span>
        <div class="mini-stepper">
          <button class="btn btn-mini" data-action="weight" data-id="${s.id}" data-delta="-0.5">−</button>
          <span class="mini-val" data-val="weight" data-id="${s.id}">${formatWeight(s.weight)}</span>
          <button class="btn btn-mini" data-action="weight" data-id="${s.id}" data-delta="0.5">+</button>
        </div>
      </div>
      <div class="mini">
        <span class="mini-label">Reps</span>
        <div class="mini-stepper">
          <button class="btn btn-mini" data-action="reps" data-id="${s.id}" data-delta="-1">−</button>
          <span class="mini-val" data-val="reps" data-id="${s.id}">${s.reps}</span>
          <button class="btn btn-mini" data-action="reps" data-id="${s.id}" data-delta="1">+</button>
        </div>
      </div>
    </div>`;
}

async function renderHistory() {
  appEl.innerHTML = `
    <header class="topbar">
      <button class="link-btn" data-action="go-tracker">← Volver</button>
      <h1>Historial</h1>
      <span></span>
    </header>
    <main class="screen">
      <div class="history-status" id="history-status">Cargando…</div>
      <div id="history-list"></div>
    </main>
  `;

  let sessions = [];
  let source = "";
  try {
    sessions = await window.API.getSessions();
    source = "D1";
  } catch (_) {
    // Offline or Worker unreachable: fall back to what we have locally.
    sessions = await window.DB.getAllCompletedSessions();
    sessions.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
    source = "local";
  }

  const statusEl = document.getElementById("history-status");
  const listEl = document.getElementById("history-list");
  if (!statusEl || !listEl) return; // screen changed while awaiting

  if (!sessions.length) {
    statusEl.textContent = "";
    listEl.innerHTML = `<p class="hint">Todavía no hay sesiones completadas.</p>`;
    return;
  }

  statusEl.textContent =
    source === "local" ? "Sin conexión: mostrando datos locales." : "";
  listEl.innerHTML = sessions.map(renderHistorySession).join("");
}

function renderHistorySession(sess) {
  // Group sets by exercise, preserving routine order.
  const byExercise = new Map();
  for (const s of sess.sets || []) {
    if (!byExercise.has(s.exercise_id)) byExercise.set(s.exercise_id, []);
    byExercise.get(s.exercise_id).push(s);
  }
  const blocks = window.ROUTINE.filter((ex) => byExercise.has(ex.id))
    .map((ex) => {
      const sets = byExercise
        .get(ex.id)
        .slice()
        .sort((a, b) => a.set_number - b.set_number);
      const weights = [...new Set(sets.map((s) => formatWeight(s.weight)))];
      // Show one weight if constant across the exercise, otherwise per-set.
      const weightText =
        weights.length === 1
          ? `${weights[0]} kg`
          : sets.map((s) => `${formatWeight(s.weight)} kg`).join(" / ");
      const repsText = sets.map((s) => s.reps).join(" / ");
      return `
        <div class="hist-exercise">
          <div class="hist-ex-name">${esc(ex.name)}</div>
          <div class="hist-ex-data">${weightText} — ${repsText}</div>
        </div>`;
    })
    .join("");

  return `
    <section class="card hist-session">
      <div class="hist-date">${formatDate(sess.completed_at)}</div>
      ${blocks}
    </section>`;
}

// ---------- sync ----------

let syncing = false;

async function syncPending() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await window.DB.getUnsyncedSessions();
    for (const sess of pending) {
      try {
        await window.API.postSession(sess);
        await window.DB.markSynced(sess.id);
      } catch (_) {
        // Leave queued; will retry on next opportunity.
      }
    }
  } finally {
    syncing = false;
    if (screen === "history") renderHistory();
  }
}

// ---------- event handling (delegated) ----------

appEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case "new-session":
      await startNewSession();
      break;
    case "reps":
      await changeReps(btn.dataset.id, Number(btn.dataset.delta));
      break;
    case "weight":
      await changeWeight(btn.dataset.id, Number(btn.dataset.delta));
      break;
    case "complete":
      if (confirm("¿Completar y cerrar esta sesión? Se guardarán las 15 series.")) {
        await completeSession();
      }
      break;
    case "go-history":
      screen = "history";
      render();
      break;
    case "go-tracker":
      screen = "tracker";
      render();
      break;
  }
});

// ---------- init ----------

window.addEventListener("online", syncPending);

(async function init() {
  active = await window.DB.getActiveSession();
  render();
  // Retry any sessions that completed while offline.
  syncPending();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
