// Main application logic for the Workout PWA.
//
// Core principle: the user fully controls the session lifecycle. Nothing here
// starts, continues, ends, creates, or discards a session automatically. There
// is no time-based or heuristic logic of any kind. The app is a recorder.
//
// Interaction model: when a session is active, all 15 series are shown on one
// page and can be edited in any order with +/- steppers. There is no "next"
// action. All 15 series are saved to D1 when the user presses COMPLETAR SESIÓN.
//
// Navigation: the tracker is the rightmost of a horizontal strip of panels.
// Swiping right walks back through up to 3 past workouts (read-only); one more
// step reaches the full Historial. Swiping left returns toward the present.

const WEIGHT_STEP = 0.5;
// Default starting weight for a series when there is no prior history to seed
// from. All series start at this value; the user adjusts it per series.
const DEFAULT_WEIGHT = 10;
// How many recent workouts are reachable by swiping right from the tracker.
const MAX_PAST_PANELS = 3;

// In-memory copy of the active session; the source of truth is IndexedDB.
let active = null;
// Which panel is on screen: "tracker" | "history" | "past-0" | "past-1" | ...
// (past-0 is the most recent completed workout).
let currentPanel = "tracker";
// Recent completed workouts (most recent first), cached for the swipe panels.
let pastSessions = [];
// Direction of the last panel navigation, for the slide-in animation:
// -1 = moved toward the past (right swipe), +1 = toward the present.
let lastNavDir = 0;

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

// Last set (weight + reps) recorded for an exercise across the completed history
// the app already knows locally (most recent first). Used to seed a new session
// so both weight and reps carry over from the previous workout, offline.
function lastSetFor(exerciseId, completedSessions) {
  const sorted = completedSessions
    .slice()
    .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
  for (const sess of sorted) {
    const matches = (sess.sets || []).filter((s) => s.exercise_id === exerciseId);
    if (matches.length) {
      const last = matches[matches.length - 1];
      return { weight: last.weight, reps: last.reps };
    }
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
    const prev = lastSetFor(ex.id, completed);
    for (let n = 1; n <= ex.sets; n++) {
      sets.push({
        id: crypto.randomUUID(),
        exercise_id: ex.id,
        set_number: n,
        // Seed both weight and reps from the last workout for this exercise,
        // falling back to the routine defaults when there is no history.
        reps: prev ? prev.reps : ex.initialReps,
        weight: prev ? prev.weight : DEFAULT_WEIGHT,
        touched: false,
        finished: false,
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
  currentPanel = "tracker";
  await persistActive();
  render();
}

// Ensure an active session has at least the routine's base series per exercise
// in the new one-page format, while preserving any extra series the user added.
// This migrates sessions created by an older app version (which stored only the
// completed sets plus a cursor) and repairs any session missing series, so an
// in-progress session is never lost or left with no rows to edit. Idempotent
// for already-well-formed sessions.
function ensureFullSession(session, completedSessions) {
  if (!session) return session;
  const byKey = new Map();
  for (const s of session.sets || []) {
    byKey.set(`${s.exercise_id}#${s.set_number}`, s);
  }
  const sets = [];
  for (const ex of window.ROUTINE) {
    const own = (session.sets || []).filter((s) => s.exercise_id === ex.id);
    // Cover the base series (1..ex.sets) plus any higher set_numbers the user
    // added, without filling gaps in the extra range.
    const maxN = Math.max(ex.sets, ...own.map((s) => s.set_number), 0);
    for (let n = 1; n <= maxN; n++) {
      const existing = byKey.get(`${ex.id}#${n}`);
      if (existing) {
        sets.push({
          id: existing.id || crypto.randomUUID(),
          exercise_id: ex.id,
          set_number: n,
          reps: typeof existing.reps === "number" ? existing.reps : ex.initialReps,
          weight: typeof existing.weight === "number" ? existing.weight : DEFAULT_WEIGHT,
          // A set already recorded by the old model was intentional -> touched.
          touched: existing.touched !== undefined ? existing.touched : true,
          finished: existing.finished === true,
        });
      } else if (n <= ex.sets) {
        // A missing base series: seed weight/reps from the session's own
        // recorded sets for this exercise, else from global completed history,
        // else the defaults.
        const ownSeed = own.length ? own[own.length - 1] : null;
        const histSeed = ownSeed ? null : lastSetFor(ex.id, completedSessions);
        const seed = ownSeed || histSeed;
        sets.push({
          id: crypto.randomUUID(),
          exercise_id: ex.id,
          set_number: n,
          reps: seed && typeof seed.reps === "number" ? seed.reps : ex.initialReps,
          weight: seed && typeof seed.weight === "number" ? seed.weight : DEFAULT_WEIGHT,
          touched: false,
          finished: false,
        });
      }
      // n > ex.sets with no existing set: skip (do not fabricate extra series).
    }
  }
  session.sets = sets;
  // Drop obsolete fields from the old model if present.
  delete session.cursor;
  delete session.current;
  return session;
}

// Append another series to an exercise. It gets the next set_number and seeds
// its weight and reps from that exercise's last series in the session. Works
// with history: it is just another set row.
async function addSeries(exerciseId) {
  if (!active) return;
  const ex = exerciseById(exerciseId);
  if (!ex) return;
  const exSets = active.sets
    .filter((s) => s.exercise_id === exerciseId)
    .sort((a, b) => a.set_number - b.set_number);
  const last = exSets[exSets.length - 1];
  active.sets.push({
    id: crypto.randomUUID(),
    exercise_id: exerciseId,
    set_number: last ? last.set_number + 1 : 1,
    reps: last ? last.reps : ex.initialReps,
    weight: last ? last.weight : DEFAULT_WEIGHT,
    touched: false,
    finished: false,
  });
  const y = window.scrollY;
  await persistActive();
  render();
  window.scrollTo(0, y); // keep the user's place after the re-render
}

// Remove a series. The remaining series of that exercise are renumbered to stay
// contiguous (1..n). Confirms first only if the series has entered data, so an
// accidental tap doesn't discard values. Nothing is synced yet, so this only
// affects the in-progress session. A finished series can still be removed.
async function removeSeries(id) {
  if (!active) return;
  const set = findSet(id);
  if (!set) return;
  if ((set.touched || set.finished) && !confirm("¿Eliminar esta serie?")) return;
  const exId = set.exercise_id;
  active.sets = active.sets.filter((s) => s.id !== id);
  active.sets
    .filter((s) => s.exercise_id === exId)
    .sort((a, b) => a.set_number - b.set_number)
    .forEach((s, i) => {
      s.set_number = i + 1;
    });
  const y = window.scrollY;
  await persistActive();
  render();
  window.scrollTo(0, y);
}

// Toggle a series' "finished" state. A finished series is tinted green and its
// steppers/input are disabled (locked), so its recorded value can't be changed
// by accident; it can still be removed with the trashcan, or un-finished by
// pressing the check again.
async function finishSeries(id) {
  const set = findSet(id);
  if (!set) return;
  set.finished = !set.finished;
  if (set.finished) set.touched = true;
  await persistActive();
  // Re-render just this row so scroll position is preserved.
  const total = active.sets.filter((s) => s.exercise_id === set.exercise_id).length;
  const row = appEl.querySelector(`[data-row-id="${id}"]`);
  if (row) {
    const tmp = document.createElement("template");
    tmp.innerHTML = renderSeriesRow(set, total).trim();
    row.replaceWith(tmp.content.firstChild);
  }
}

// The only mechanism that closes a session. Saves all its series to D1, then
// immediately starts a fresh session (per user preference) so the next workout
// is ready without an extra tap.
async function completeSession() {
  if (!active) return;
  active.completed_at = new Date().toISOString();
  active.synced = false;
  const finished = active;
  await window.DB.saveCompletedSession(finished);
  await window.DB.clearActiveSession();
  active = null;
  await loadPastSessions();
  // Begin the next session right away (seeds weights from the just-saved one).
  await startNewSession();
  // Attempt to sync the completed session; if offline it stays queued and is
  // retried later. Then reconcile the swipe panels with D1.
  await syncPending();
  refreshPastFromServer();
}

// ---------- counter mutations ----------

function findSet(id) {
  return active && active.sets.find((s) => s.id === id);
}

async function changeReps(id, delta) {
  const set = findSet(id);
  if (!set || set.finished) return;
  set.reps = Math.max(0, set.reps + delta);
  set.touched = true;
  await persistActive();
  updateSetDom(set);
}

async function changeWeight(id, delta) {
  const set = findSet(id);
  if (!set || set.finished) return;
  set.weight = Math.max(0, Math.round((set.weight + delta) * 2) / 2);
  set.touched = true;
  await persistActive();
  updateSetDom(set);
}

// Manual weight entry: parse a single-decimal float (accepts "," or "."),
// clamp to >= 0, and store it. Marks the series as adjusted.
async function setWeightManual(id, raw) {
  const set = findSet(id);
  if (!set || set.finished) return;
  let v = parseFloat(String(raw).replace(",", "."));
  if (isNaN(v) || v < 0) v = 0;
  v = Math.round(v * 10) / 10; // single decimal place
  set.weight = v;
  set.touched = true;
  await persistActive();
  updateSetDom(set); // normalize the displayed value
}

function setDomValue(el, value) {
  if (!el) return;
  if (el.tagName === "INPUT") el.value = value;
  else el.textContent = value;
}

// Targeted DOM update so +/- taps don't rebuild the whole list (keeps scroll
// position and feels instant).
function updateSetDom(set) {
  setDomValue(appEl.querySelector(`[data-val="reps"][data-id="${set.id}"]`), set.reps);
  setDomValue(
    appEl.querySelector(`[data-val="weight"][data-id="${set.id}"]`),
    formatWeight(set.weight)
  );
  const row = appEl.querySelector(`[data-row-id="${set.id}"]`);
  if (row) row.classList.add("touched");
}

// ---------- panel navigation (swipe / links) ----------

// Fill the swipe panels from the local store first (instant and offline-safe),
// then let refreshPastFromServer() reconcile with D1 when online.
async function loadPastSessions() {
  const local = await window.DB.getAllCompletedSessions();
  local.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
  pastSessions = local.slice(0, MAX_PAST_PANELS);
}

// D1 is the source of truth for history, so the past-workout panels should show
// what Historial shows. Best-effort: on failure (offline) we keep the local copy.
async function refreshPastFromServer() {
  try {
    const remote = await window.API.getSessions(); // already most-recent-first
    pastSessions = (remote || []).slice(0, MAX_PAST_PANELS);
    if (currentPanel.startsWith("past-")) render();
  } catch (_) {
    // Offline or Worker unreachable: keep the local sessions already loaded.
  }
}

// Panels laid out left -> right. The tracker (present) is on the right; each
// step left is an older workout, and the leftmost is the full Historial.
function panelIds() {
  const ids = ["history"];
  for (let i = pastSessions.length - 1; i >= 0; i--) ids.push("past-" + i);
  ids.push("tracker");
  return ids;
}

// step -1 = move one panel toward the past (right swipe); +1 = toward present.
function navigatePanels(step) {
  const ids = panelIds();
  let i = ids.indexOf(currentPanel);
  if (i === -1) i = ids.length - 1; // fall back to the tracker
  const ni = Math.min(ids.length - 1, Math.max(0, i + step));
  if (ni === i) return;
  currentPanel = ids[ni];
  lastNavDir = step;
  render();
}

function slideClass() {
  if (lastNavDir < 0) return " slide-from-left";
  if (lastNavDir > 0) return " slide-from-right";
  return "";
}

// ---------- rendering ----------

function render() {
  if (currentPanel === "history") {
    renderHistory();
  } else if (currentPanel.startsWith("past-")) {
    renderPast(Number(currentPanel.slice(5)));
  } else if (!active) {
    renderNoSession();
  } else {
    renderTracker();
  }
  lastNavDir = 0;
}

function renderNoSession() {
  appEl.innerHTML = `
    <header class="topbar">
      <h1>Entrenamiento</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen center${slideClass()}">
      <p class="hint">No hay una sesión activa.</p>
      <button class="btn btn-primary btn-huge" data-action="new-session">NUEVA SESIÓN</button>
    </main>
  `;
}

function renderTracker() {
  const exercisesHtml = window.ROUTINE.map(renderExerciseBlock).join("");

  appEl.innerHTML = `
    <header class="topbar">
      <h1>Entrenamiento</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen${slideClass()}">
      ${exercisesHtml}
      <button class="btn btn-complete" data-action="complete">COMPLETAR SESIÓN</button>
    </main>
  `;
}

function renderExerciseBlock(ex) {
  const sets = active.sets
    .filter((s) => s.exercise_id === ex.id)
    .sort((a, b) => a.set_number - b.set_number);
  const total = sets.length;
  const rows = sets.map((s) => renderSeriesRow(s, total)).join("");
  return `
    <section class="card exercise-block">
      <h2 class="exercise-name">${esc(ex.name)}</h2>
      <div class="series-head-row">
        <span></span>
        <span class="col-head">Peso</span>
        <span class="col-head">Reps</span>
        <span></span>
        <span></span>
      </div>
      ${rows}
      <button class="btn btn-add" data-action="add-series" data-exercise-id="${ex.id}">+ Agregar serie</button>
    </section>`;
}

function renderSeriesRow(s, total) {
  const dis = s.finished ? " disabled" : "";
  return `
    <div class="series-row${s.touched ? " touched" : ""}${s.finished ? " finished" : ""}" data-row-id="${s.id}">
      <span class="series-num">Serie ${s.set_number}/${total}</span>
      <div class="mini-stepper">
        <button class="btn btn-mini" data-action="weight" data-id="${s.id}" data-delta="-0.5"${dis}>−</button>
        <input class="mini-input" type="text" inputmode="decimal" data-val="weight" data-id="${s.id}" value="${formatWeight(s.weight)}" aria-label="Peso en kg"${dis} />
        <button class="btn btn-mini" data-action="weight" data-id="${s.id}" data-delta="0.5"${dis}>+</button>
      </div>
      <div class="mini-stepper">
        <button class="btn btn-mini" data-action="reps" data-id="${s.id}" data-delta="-1"${dis}>−</button>
        <span class="mini-val" data-val="reps" data-id="${s.id}">${s.reps}</span>
        <button class="btn btn-mini" data-action="reps" data-id="${s.id}" data-delta="1"${dis}>+</button>
      </div>
      <button class="icon-btn-finish${s.finished ? " active" : ""}" data-action="finish-series" data-id="${s.id}" aria-label="Finalizar serie" title="Finalizar serie">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
      <button class="icon-btn-trash" data-action="remove-series" data-id="${s.id}" aria-label="Eliminar serie" title="Eliminar serie">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          <path d="M10 11v6M14 11v6"></path>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
        </svg>
      </button>
    </div>`;
}

// Read-only view of a past workout, reachable by swiping right from the tracker.
function renderPast(idx) {
  const sess = pastSessions[idx];
  if (!sess) {
    currentPanel = "tracker";
    render();
    return;
  }
  const label = idx === 0 ? "Último entrenamiento" : `Hace ${idx + 1} entrenamientos`;

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
      const lines = sets
        .map(
          (s) =>
            `<div class="past-series"><span>Serie ${s.set_number}</span><span>${formatWeight(s.weight)} kg × ${s.reps}</span></div>`
        )
        .join("");
      return `<div class="past-ex"><div class="past-ex-name">${esc(ex.name)}</div>${lines}</div>`;
    })
    .join("");

  appEl.innerHTML = `
    <header class="topbar">
      <button class="link-btn" data-action="go-tracker">← Actual</button>
      <h1>${esc(label)}</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen${slideClass()}">
      <p class="hint past-hint">${formatDate(sess.completed_at)} · solo lectura — deslizá para navegar.</p>
      <section class="card">${blocks}</section>
    </main>
  `;
}

async function renderHistory() {
  appEl.innerHTML = `
    <header class="topbar">
      <button class="link-btn" data-action="go-tracker">← Volver</button>
      <h1>Historial</h1>
      <button class="link-btn" data-action="export-csv">Exportar CSV</button>
    </header>
    <main class="screen${slideClass()}">
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

// ---------- export ----------

function csvCell(v) {
  const str = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Download the full history as a CSV with one row per series (long format),
// ready for spreadsheets or pandas. Reads D1 when reachable, else local data.
async function exportCsv() {
  let sessions;
  try {
    sessions = await window.API.getSessions();
  } catch (_) {
    sessions = await window.DB.getAllCompletedSessions();
  }
  sessions = [...sessions].sort((a, b) => (a.completed_at < b.completed_at ? -1 : 1));

  const header = [
    "session_id", "started_at", "completed_at", "date",
    "exercise_id", "exercise_name", "set_number", "reps", "weight_kg",
  ];
  const rows = [header];
  for (const sess of sessions) {
    const sets = [...(sess.sets || [])].sort((a, b) => {
      const ia = window.ROUTINE.findIndex((e) => e.id === a.exercise_id);
      const ib = window.ROUTINE.findIndex((e) => e.id === b.exercise_id);
      return ia - ib || a.set_number - b.set_number;
    });
    for (const s of sets) {
      const ex = exerciseById(s.exercise_id);
      rows.push([
        sess.id, sess.started_at, sess.completed_at, sess.completed_at.slice(0, 10),
        s.exercise_id, ex ? ex.name : s.exercise_id, s.set_number, s.reps, s.weight,
      ]);
    }
  }

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `workout-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    if (currentPanel === "history") renderHistory();
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
    case "add-series":
      await addSeries(btn.dataset.exerciseId);
      break;
    case "remove-series":
      await removeSeries(btn.dataset.id);
      break;
    case "finish-series":
      await finishSeries(btn.dataset.id);
      break;
    case "complete":
      if (confirm("¿Completar esta sesión? Se guardarán todas las series y se iniciará una nueva.")) {
        await completeSession();
      }
      break;
    case "go-history":
      lastNavDir = -1;
      currentPanel = "history";
      render();
      break;
    case "export-csv":
      await exportCsv();
      break;
    case "go-tracker":
      lastNavDir = 1;
      currentPanel = "tracker";
      render();
      break;
  }
});

// Manual weight entry commits on blur / Enter (the "change" event).
appEl.addEventListener("change", async (e) => {
  const input = e.target.closest('input[data-val="weight"]');
  if (input) await setWeightManual(input.dataset.id, input.value);
});

// Pressing Enter in a weight input commits and blurs it.
appEl.addEventListener("keydown", (e) => {
  const input = e.target.closest('input[data-val="weight"]');
  if (input && e.key === "Enter") {
    e.preventDefault();
    input.blur();
  }
});

// ---------- swipe navigation ----------

let touchStartX = null;
let touchStartY = null;

appEl.addEventListener(
  "touchstart",
  (e) => {
    // Ignore multi-touch and gestures that begin on the editable weight field,
    // so text selection / caret placement still works there.
    if (e.touches.length !== 1 || e.target.closest(".mini-input")) {
      touchStartX = null;
      return;
    }
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  },
  { passive: true }
);

appEl.addEventListener(
  "touchend",
  (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    // Require a clearly horizontal swipe to avoid hijacking vertical scrolls.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Swipe right (dx > 0) -> older workout; swipe left -> toward the present.
    navigatePanels(dx > 0 ? -1 : 1);
  },
  { passive: true }
);

// ---------- init ----------

window.addEventListener("online", syncPending);

(async function init() {
  await loadPastSessions();
  active = await window.DB.getActiveSession();
  // Migrate/repair an active session so it always has all 15 series (handles
  // sessions created by an older app version).
  if (active) {
    const completed = await window.DB.getAllCompletedSessions();
    const before = JSON.stringify(active.sets);
    ensureFullSession(active, completed);
    if (JSON.stringify(active.sets) !== before) await persistActive();
  }
  render();
  // Reconcile the swipe panels with D1 (they were filled from local above).
  refreshPastFromServer();
  // Retry any sessions that completed while offline.
  syncPending();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
