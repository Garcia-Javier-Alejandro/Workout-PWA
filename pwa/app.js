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
// In-memory copy of the program progression state (next workout + each main
// lift's TM / 5/3/1 week / cycle). Source of truth is IndexedDB.
let program = null;
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

function exerciseName(id) {
  return (window.EXERCISES && window.EXERCISES[id]) || id;
}

function workoutDef(type) {
  return window.WORKOUTS[type];
}

function mainLiftFor(type) {
  return window.MAIN_LIFTS[type];
}

function successorWorkout(type) {
  const seq = window.SEQUENCE;
  const i = seq.indexOf(type);
  return seq[(i + 1) % seq.length];
}

function roundToHalf(x) {
  return Math.round(x * 2) / 2;
}

// The three 5/3/1 working sets for a lift at a given week/TM.
function computeMainSets(week, tm) {
  const scheme = window.FIVE_THREE_ONE[week] || window.FIVE_THREE_ONE[1];
  return scheme.map((s) => ({
    pct: s.pct,
    reps: s.reps,
    weight: roundToHalf(tm * s.pct),
  }));
}

function defaultProgram() {
  const lifts = {};
  for (const type of window.SEQUENCE) {
    const m = mainLiftFor(type);
    lifts[m.id] = { tm: m.defaultTM, week: 1, cycle: 1 };
  }
  return { nextWorkout: window.SEQUENCE[0], lifts };
}

// Fill in any missing pieces of a stored program (e.g. after a config change),
// without touching progression the user has already accumulated.
function migrateProgram(p) {
  const d = defaultProgram();
  if (!p.lifts) p.lifts = {};
  for (const id in d.lifts) if (!p.lifts[id]) p.lifts[id] = d.lifts[id];
  if (!window.SEQUENCE.includes(p.nextWorkout)) p.nextWorkout = window.SEQUENCE[0];
  return p;
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

// Build the pending session for a given workout type. The main lift's series
// carry the prescribed 5/3/1 weight and target reps for the lift's current
// week; accessories seed weight/reps from the last time that exercise was done
// (double progression), falling back to the routine defaults. This only creates
// the session — it never advances any progression.
async function startNewSession(workoutType) {
  const completed = await window.DB.getAllCompletedSessions();
  const def = workoutDef(workoutType);
  const main = mainLiftFor(workoutType);
  const liftState = program.lifts[main.id];
  const mainSets = computeMainSets(liftState.week, liftState.tm);

  const sets = [];
  for (const ex of def.exercises) {
    if (ex.main) {
      mainSets.forEach((ms, i) => {
        sets.push({
          id: crypto.randomUUID(),
          exercise_id: ex.id,
          set_number: i + 1,
          reps: ms.reps,
          weight: ms.weight,
          touched: false,
          finished: false,
          // Prescription metadata for display; ignored on sync to D1.
          pct: ms.pct,
          targetReps: ms.reps,
        });
      });
    } else {
      const prev = lastSetFor(ex.id, completed);
      for (let n = 1; n <= ex.sets; n++) {
        sets.push({
          id: crypto.randomUUID(),
          exercise_id: ex.id,
          set_number: n,
          reps: prev ? prev.reps : ex.repRange[0],
          weight: prev ? prev.weight : DEFAULT_WEIGHT,
          touched: false,
          finished: false,
        });
      }
    }
  }

  active = {
    id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    completed_at: null,
    synced: false,
    workout: workoutType,
    // Snapshot of the main lift's state as prescribed for this session.
    mainLift: { id: main.id, week: liftState.week, cycle: liftState.cycle, tm: liftState.tm },
    sets,
  };
  currentPanel = "tracker";
  await persistActive();
  render();
}

// Defensive repair for a new-format active session: make sure every exercise of
// its workout has at least its base series, without touching series the user has
// already recorded or any extra series they added. A legacy session (no
// `workout`) is handled separately at init and never reaches here.
function ensureFullSession(session, completedSessions) {
  if (!session || !session.workout) return session;
  const def = workoutDef(session.workout);
  if (!def) return session;
  const snap = session.mainLift;
  const mainSets = snap ? computeMainSets(snap.week, snap.tm) : [];

  for (const ex of def.exercises) {
    const own = (session.sets || []).filter((s) => s.exercise_id === ex.id);
    const have = new Set(own.map((s) => s.set_number));
    const baseCount = ex.main ? mainSets.length : ex.sets;
    for (let n = 1; n <= baseCount; n++) {
      if (have.has(n)) continue;
      if (ex.main) {
        const ms = mainSets[n - 1];
        session.sets.push({
          id: crypto.randomUUID(),
          exercise_id: ex.id,
          set_number: n,
          reps: ms ? ms.reps : 5,
          weight: ms ? ms.weight : 0,
          touched: false,
          finished: false,
          pct: ms ? ms.pct : null,
          targetReps: ms ? ms.reps : null,
        });
      } else {
        const seed = own.length ? own[own.length - 1] : lastSetFor(ex.id, completedSessions);
        session.sets.push({
          id: crypto.randomUUID(),
          exercise_id: ex.id,
          set_number: n,
          reps: seed && typeof seed.reps === "number" ? seed.reps : ex.repRange[0],
          weight: seed && typeof seed.weight === "number" ? seed.weight : DEFAULT_WEIGHT,
          touched: false,
          finished: false,
        });
      }
    }
  }
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
  const exSets = active.sets
    .filter((s) => s.exercise_id === exerciseId)
    .sort((a, b) => a.set_number - b.set_number);
  const last = exSets[exSets.length - 1];
  // Extra series are always plain (no 5/3/1 prescription), seeded from the last
  // series of this exercise, or the routine defaults if somehow none exist.
  active.sets.push({
    id: crypto.randomUUID(),
    exercise_id: exerciseId,
    set_number: last ? last.set_number + 1 : 1,
    reps: last ? last.reps : 10,
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
  const completedType = active.workout;
  await window.DB.saveCompletedSession(finished);
  await window.DB.clearActiveSession();
  active = null;

  // Advance the 5/3/1 state of the completed workout's main lift. This is the
  // ONLY place the program advances, and it is driven purely by the user
  // completing a workout — never by the calendar. After the four-week cycle
  // (week 4 = deload) the Training Max increases and a new cycle begins.
  const main = mainLiftFor(completedType);
  const st = program.lifts[main.id];
  if (st.week >= 4) {
    st.week = 1;
    st.cycle += 1;
    st.tm = roundToHalf(st.tm + main.tmIncrement);
  } else {
    st.week += 1;
  }
  // Move the sequence cursor Push -> Pull -> Full Body -> Push ...
  program.nextWorkout = successorWorkout(completedType);
  await window.DB.setProgram(program);

  await loadPastSessions();
  // Open the next pending workout right away so it is ready without a manual
  // start; it stays pending indefinitely until the user actually performs it.
  await startNewSession(program.nextWorkout);
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

// Edit a main lift's Training Max. Persists it to the program (so future cycles
// use it) and re-prescribes the not-yet-finished working sets of the current
// session from the new TM. Does not touch series the user already locked in.
async function setTrainingMax(liftId, raw) {
  if (!program || !program.lifts[liftId]) return;
  let v = parseFloat(String(raw).replace(",", "."));
  if (isNaN(v) || v < 0) v = 0;
  v = roundToHalf(v);
  program.lifts[liftId].tm = v;
  await window.DB.setProgram(program);

  if (active && active.mainLift && active.mainLift.id === liftId) {
    active.mainLift.tm = v;
    const mainSets = computeMainSets(active.mainLift.week, v);
    active.sets
      .filter((s) => s.exercise_id === liftId)
      .sort((a, b) => a.set_number - b.set_number)
      .forEach((s, i) => {
        const ms = mainSets[i];
        if (ms && !s.finished) {
          s.weight = ms.weight;
          s.pct = ms.pct;
          s.targetReps = ms.reps;
          s.reps = ms.reps;
        }
      });
    await persistActive();
  }
  render();
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
      <p class="hint">Próximo entrenamiento: ${esc(workoutDef(program.nextWorkout).name)}</p>
      <button class="btn btn-primary btn-huge" data-action="new-session">EMPEZAR</button>
    </main>
  `;
}

function renderTracker() {
  const def = workoutDef(active.workout);
  const exercisesHtml = def.exercises.map(renderExerciseBlock).join("");

  appEl.innerHTML = `
    <header class="topbar">
      <h1>${esc(def.name)}</h1>
      <button class="link-btn" data-action="go-history">Historial</button>
    </header>
    <main class="screen${slideClass()}">
      <div class="workout-banner">${esc(def.name)}</div>
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

  let badge;
  let meta;
  if (ex.main) {
    const st = active.mainLift;
    badge = `<span class="ex-badge ex-badge-main">Principal · 5/3/1</span>`;
    meta = `
      <div class="ex-meta">
        <span>Semana ${st.week}/4 · Ciclo ${st.cycle}</span>
        <span class="tm-edit">TM
          <input class="tm-input" type="text" inputmode="decimal"
            data-tm-lift="${ex.id}" value="${formatWeight(st.tm)}" aria-label="Training Max en kg" />
          kg
        </span>
      </div>`;
  } else {
    badge = `<span class="ex-badge">Accesorio</span>`;
    meta = `<div class="ex-meta">objetivo: ${ex.sets} × ${ex.repRange[0]}–${ex.repRange[1]}</div>`;
  }

  return `
    <section class="card exercise-block">
      <div class="exercise-head">
        <h2 class="exercise-name">${esc(exerciseName(ex.id))}</h2>
        ${badge}
      </div>
      ${meta}
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
  // Main-lift series (with a 5/3/1 prescription) show the target %×reps; plain
  // series show the usual "Serie n/total".
  const label =
    s.pct != null
      ? `Serie ${s.set_number} · <span class="set-target">${Math.round(s.pct * 100)}%×${s.targetReps}</span>`
      : `Serie ${s.set_number}/${total}`;
  return `
    <div class="series-row${s.touched ? " touched" : ""}${s.finished ? " finished" : ""}" data-row-id="${s.id}">
      <span class="series-num">${label}</span>
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

// Group a completed session's sets by exercise id.
function groupByExercise(sess) {
  const byExercise = new Map();
  for (const s of sess.sets || []) {
    if (!byExercise.has(s.exercise_id)) byExercise.set(s.exercise_id, []);
    byExercise.get(s.exercise_id).push(s);
  }
  return byExercise;
}

// Exercise ids present in a session, ordered by the canonical list. Any id not
// in the list (unknown/future) is appended in first-seen order so nothing is
// dropped from history.
function orderedExerciseIds(byExercise) {
  const present = new Set(byExercise.keys());
  const ordered = window.EXERCISE_ORDER.filter((id) => present.has(id));
  for (const id of byExercise.keys()) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
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

  const byExercise = groupByExercise(sess);
  const blocks = orderedExerciseIds(byExercise)
    .map((exId) => {
      const sets = byExercise
        .get(exId)
        .slice()
        .sort((a, b) => a.set_number - b.set_number);
      const lines = sets
        .map(
          (s) =>
            `<div class="past-series"><span>Serie ${s.set_number}</span><span>${formatWeight(s.weight)} kg × ${s.reps}</span></div>`
        )
        .join("");
      return `<div class="past-ex"><div class="past-ex-name">${esc(exerciseName(exId))}</div>${lines}</div>`;
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
  // Group sets by exercise; order via the canonical list so both legacy and new
  // sessions read top-to-bottom in a sensible order and keep their real names.
  const byExercise = groupByExercise(sess);
  const blocks = orderedExerciseIds(byExercise)
    .map((exId) => {
      const sets = byExercise
        .get(exId)
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
          <div class="hist-ex-name">${esc(exerciseName(exId))}</div>
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
      // Order by the canonical exercise list (unknown ids sort last), then set.
      let ia = window.EXERCISE_ORDER.indexOf(a.exercise_id);
      let ib = window.EXERCISE_ORDER.indexOf(b.exercise_id);
      if (ia === -1) ia = Infinity;
      if (ib === -1) ib = Infinity;
      return ia - ib || a.set_number - b.set_number;
    });
    for (const s of sets) {
      rows.push([
        sess.id, sess.started_at, sess.completed_at, sess.completed_at.slice(0, 10),
        s.exercise_id, exerciseName(s.exercise_id), s.set_number, s.reps, s.weight,
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
      await startNewSession(program.nextWorkout);
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

// Manual weight entry and Training-Max entry commit on blur / Enter ("change").
appEl.addEventListener("change", async (e) => {
  const weight = e.target.closest('input[data-val="weight"]');
  if (weight) {
    await setWeightManual(weight.dataset.id, weight.value);
    return;
  }
  const tm = e.target.closest("input[data-tm-lift]");
  if (tm) await setTrainingMax(tm.dataset.tmLift, tm.value);
});

// Pressing Enter in a weight or TM input commits and blurs it.
appEl.addEventListener("keydown", (e) => {
  const input = e.target.closest('input[data-val="weight"], input[data-tm-lift]');
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
    if (e.touches.length !== 1 || e.target.closest(".mini-input, .tm-input")) {
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
  // Load (or initialize) the program progression state first: everything else
  // depends on knowing which workout is next and each main lift's 5/3/1 state.
  program = await window.DB.getProgram();
  if (!program) {
    program = defaultProgram();
    await window.DB.setProgram(program);
  } else {
    program = migrateProgram(program);
  }

  await loadPastSessions();
  active = await window.DB.getActiveSession();

  // A session left over from the OLD dumbbell routine has no `workout` field.
  // It is only an in-progress (never-completed) session, so discarding it loses
  // no history; the new program simply presents its first pending workout.
  if (active && !active.workout) {
    await window.DB.clearActiveSession();
    active = null;
  }

  if (active) {
    // Repair a new-format session so every exercise has its base series.
    const completed = await window.DB.getAllCompletedSessions();
    const before = JSON.stringify(active.sets);
    ensureFullSession(active, completed);
    if (JSON.stringify(active.sets) !== before) await persistActive();
  } else {
    // No pending session: open the next workout so it is ready without a
    // manual start.
    await startNewSession(program.nextWorkout);
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
