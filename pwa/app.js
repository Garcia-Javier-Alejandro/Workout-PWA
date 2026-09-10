// Main application logic for the Workout PWA.
//
// Core principle: the user fully controls the session lifecycle. Nothing here
// starts, continues, ends, creates, or discards a session automatically. There
// is no time-based or heuristic logic of any kind. The app is a recorder.

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

function exerciseByIndex(i) {
  return window.ROUTINE[i];
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

// Last weight used for an exercise, from the global history the app has seen:
// 1) sets already recorded in the active session,
// 2) locally kept completed sessions (most recent first).
// This keeps the value available offline based on what the app already knows.
async function lastWeightFor(exerciseId) {
  if (active && active.sets.length) {
    const own = active.sets.filter((s) => s.exercise_id === exerciseId);
    if (own.length) return own[own.length - 1].weight;
  }
  const completed = await window.DB.getAllCompletedSessions();
  completed.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
  for (const sess of completed) {
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
  const firstExercise = exerciseByIndex(0);
  active = {
    id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    completed_at: null,
    synced: false,
    sets: [],
    cursor: { exerciseIndex: 0, setNumber: 1 },
    current: { reps: firstExercise.initialReps, weight: null },
  };
  const lw = await lastWeightFor(firstExercise.id);
  active.current.weight = lw === null ? 0 : lw;
  await persistActive();
  render();
}

// Record current set and advance to the next one (or the next exercise).
// Advancing never completes the session, even on the 15th set.
async function nextSet() {
  if (!active || isAllDone()) return;
  const ex = exerciseByIndex(active.cursor.exerciseIndex);
  active.sets.push({
    id: crypto.randomUUID(),
    exercise_id: ex.id,
    set_number: active.cursor.setNumber,
    reps: active.current.reps,
    weight: active.current.weight === null ? 0 : active.current.weight,
  });

  // Advance the cursor.
  if (active.cursor.setNumber < ex.sets) {
    active.cursor.setNumber += 1;
  } else if (active.cursor.exerciseIndex < window.ROUTINE.length - 1) {
    active.cursor.exerciseIndex += 1;
    active.cursor.setNumber = 1;
  } else {
    // Last set of the last exercise recorded: all 15 done, session stays open.
    active.cursor = null;
  }

  // Initialize the counters for the new current set (if any).
  if (active.cursor) {
    const nextEx = exerciseByIndex(active.cursor.exerciseIndex);
    const lw = await lastWeightFor(nextEx.id);
    active.current = {
      reps: nextEx.initialReps,
      weight: lw === null ? 0 : lw,
    };
  }

  await persistActive();
  render();
}

function isAllDone() {
  return active && active.cursor === null;
}

// The only mechanism that closes a session.
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

async function changeReps(delta) {
  if (!active || isAllDone()) return;
  active.current.reps = Math.max(0, active.current.reps + delta);
  await persistActive();
  render();
}

async function changeWeight(delta) {
  if (!active || isAllDone()) return;
  const w = active.current.weight === null ? 0 : active.current.weight;
  active.current.weight = Math.max(0, Math.round((w + delta) * 2) / 2);
  await persistActive();
  render();
}

// ---------- editing already-recorded sets (active session only) ----------

let editingSetId = null;
let editDraft = null;

function openEdit(setId) {
  const set = active.sets.find((s) => s.id === setId);
  if (!set) return;
  editingSetId = setId;
  editDraft = { reps: set.reps, weight: set.weight };
  render();
}

function closeEdit() {
  editingSetId = null;
  editDraft = null;
  render();
}

function editChangeReps(delta) {
  editDraft.reps = Math.max(0, editDraft.reps + delta);
  render();
}

function editChangeWeight(delta) {
  editDraft.weight = Math.max(0, Math.round((editDraft.weight + delta) * 2) / 2);
  render();
}

async function saveEdit() {
  const set = active.sets.find((s) => s.id === editingSetId);
  if (set) {
    set.reps = editDraft.reps;
    set.weight = editDraft.weight;
    await persistActive();
  }
  closeEdit();
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
  const done = active.sets.length;
  const total = window.TOTAL_SETS;

  let currentBlock;
  let nextInfo;

  if (isAllDone()) {
    currentBlock = `
      <section class="card current all-done">
        <p class="all-done-title">Todas las series completadas 🎉</p>
        <p class="hint">La sesión sigue abierta. Presioná <strong>COMPLETAR SESIÓN</strong> cuando quieras cerrarla.</p>
      </section>`;
    nextInfo = "";
  } else {
    const ex = exerciseByIndex(active.cursor.exerciseIndex);
    currentBlock = `
      <section class="card current">
        <p class="exercise-name">${esc(ex.name)}</p>
        <p class="set-label">Serie ${active.cursor.setNumber}/${ex.sets}</p>

        <div class="control">
          <span class="control-label">Peso (kg)</span>
          <div class="stepper">
            <button class="btn btn-round" data-action="weight" data-delta="-0.5">−</button>
            <span class="value">${formatWeight(active.current.weight)}</span>
            <button class="btn btn-round" data-action="weight" data-delta="0.5">+</button>
          </div>
        </div>

        <div class="control">
          <span class="control-label">Repeticiones</span>
          <div class="stepper">
            <button class="btn btn-round" data-action="reps" data-delta="-1">−</button>
            <span class="value">${active.current.reps}</span>
            <button class="btn btn-round" data-action="reps" data-delta="1">+</button>
          </div>
        </div>

        <button class="btn btn-primary btn-next" data-action="next">SIGUIENTE →</button>
      </section>`;
    nextInfo = renderNextInfo();
  }

  appEl.innerHTML = `
    <header class="topbar">
      <h1>Entrenamiento</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen">
      <div class="progress">Progreso: <strong>${done}/${total}</strong> series</div>
      ${currentBlock}
      ${nextInfo}
      ${renderRecordedSets()}
      <button class="btn btn-complete" data-action="complete">COMPLETAR SESIÓN</button>
    </main>
    ${editingSetId ? renderEditModal() : ""}
  `;
}

function renderNextInfo() {
  const c = active.cursor;
  const ex = exerciseByIndex(c.exerciseIndex);
  let text;
  if (c.setNumber < ex.sets) {
    text = `${ex.name} — Serie ${c.setNumber + 1}/${ex.sets}`;
  } else if (c.exerciseIndex < window.ROUTINE.length - 1) {
    const nextEx = exerciseByIndex(c.exerciseIndex + 1);
    text = `${nextEx.name} — Serie 1/${nextEx.sets}`;
  } else {
    text = "Última serie";
  }
  return `<div class="next-info">Después: <span>${esc(text)}</span></div>`;
}

function renderRecordedSets() {
  if (!active.sets.length) return "";
  const rows = active.sets
    .map((s) => {
      const ex = exerciseById(s.exercise_id);
      return `
        <li class="recorded-row">
          <span class="recorded-text">
            <strong>${esc(ex.name)}</strong> · Serie ${s.set_number}
            · ${formatWeight(s.weight)} kg · ${s.reps} reps
          </span>
          <button class="icon-btn" data-action="edit" data-id="${s.id}" aria-label="Editar serie">✎</button>
        </li>`;
    })
    .join("");
  return `
    <section class="card recorded">
      <h2>Series registradas</h2>
      <ul class="recorded-list">${rows}</ul>
    </section>`;
}

function renderEditModal() {
  const set = active.sets.find((s) => s.id === editingSetId);
  const ex = exerciseById(set.exercise_id);
  return `
    <div class="modal-backdrop" data-action="close-edit-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Editar serie</h2>
        <p class="modal-sub">${esc(ex.name)} · Serie ${set.set_number}</p>

        <div class="control">
          <span class="control-label">Peso (kg)</span>
          <div class="stepper">
            <button class="btn btn-round" data-action="edit-weight" data-delta="-0.5">−</button>
            <span class="value">${formatWeight(editDraft.weight)}</span>
            <button class="btn btn-round" data-action="edit-weight" data-delta="0.5">+</button>
          </div>
        </div>

        <div class="control">
          <span class="control-label">Repeticiones</span>
          <div class="stepper">
            <button class="btn btn-round" data-action="edit-reps" data-delta="-1">−</button>
            <span class="value">${editDraft.reps}</span>
            <button class="btn btn-round" data-action="edit-reps" data-delta="1">+</button>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="cancel-edit">Cancelar</button>
          <button class="btn btn-primary" data-action="save-edit">Guardar</button>
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

// ---------- event handling (delegated) ----------

appEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case "new-session":
      await startNewSession();
      break;
    case "next":
      await nextSet();
      break;
    case "reps":
      await changeReps(Number(btn.dataset.delta));
      break;
    case "weight":
      await changeWeight(Number(btn.dataset.delta));
      break;
    case "complete":
      if (confirm("¿Completar y cerrar esta sesión?")) await completeSession();
      break;
    case "edit":
      openEdit(btn.dataset.id);
      break;
    case "edit-reps":
      editChangeReps(Number(btn.dataset.delta));
      break;
    case "edit-weight":
      editChangeWeight(Number(btn.dataset.delta));
      break;
    case "save-edit":
      await saveEdit();
      break;
    case "cancel-edit":
      closeEdit();
      break;
    case "close-edit-backdrop":
      if (e.target === btn) closeEdit();
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
