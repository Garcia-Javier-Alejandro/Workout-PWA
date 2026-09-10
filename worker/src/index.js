/**
 * Cloudflare Worker: API in front of Cloudflare D1 for the Workout PWA.
 *
 * Responsibilities:
 *  - POST /sessions : receive one completed session with all its sets in a
 *    single call and persist it idempotently (INSERT OR IGNORE).
 *  - GET  /sessions : return the historical sessions with their sets.
 *
 * Authentication is a shared secret sent in the `X-App-Key` header, read from
 * the `APP_KEY` Worker Secret. This only deters casual traffic; there are no
 * user accounts.
 *
 * No dependencies are used: routing is a couple of string checks, which is
 * simpler and lighter than pulling in a router library for two endpoints.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Shared-secret check for every non-preflight request.
    if (!env.APP_KEY || request.headers.get("X-App-Key") !== env.APP_KEY) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/sessions" && request.method === "POST") {
        return await createSession(request, env);
      }
      if (path === "/sessions" && request.method === "GET") {
        return await listSessions(env);
      }
      if (path === "/health") {
        return json({ ok: true });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json({ error: "server_error", detail: String(err) }, 500);
    }
  },
};

/**
 * Persist a completed session and its sets idempotently.
 * Retrying with the same UUIDs is safe: INSERT OR IGNORE means duplicates are
 * silently skipped, so the response is always OK for a valid payload.
 */
async function createSession(request, env) {
  const body = await request.json();
  const session = body && body.session;
  const sets = (body && body.sets) || [];

  if (!session || !session.id || !session.started_at || !session.completed_at) {
    return json({ error: "invalid_session" }, 400);
  }
  if (!Array.isArray(sets)) {
    return json({ error: "invalid_sets" }, 400);
  }

  const statements = [
    env.DB.prepare(
      "INSERT OR IGNORE INTO sessions (id, started_at, completed_at) VALUES (?, ?, ?)"
    ).bind(session.id, session.started_at, session.completed_at),
  ];

  for (const s of sets) {
    if (
      !s.id ||
      !s.session_id ||
      !s.exercise_id ||
      typeof s.set_number !== "number" ||
      typeof s.reps !== "number" ||
      typeof s.weight !== "number"
    ) {
      return json({ error: "invalid_set", set: s }, 400);
    }
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO sets (id, session_id, exercise_id, set_number, reps, weight) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(s.id, s.session_id, s.exercise_id, s.set_number, s.reps, s.weight)
    );
  }

  await env.DB.batch(statements);
  return json({ ok: true, session_id: session.id, sets: sets.length });
}

/**
 * Return all sessions with their sets, most recent first. Shaped so the PWA can
 * render the history directly and so future analysis has structured data.
 */
async function listSessions(env) {
  const sessionsRes = await env.DB.prepare(
    "SELECT id, started_at, completed_at FROM sessions ORDER BY completed_at DESC"
  ).all();
  const sessions = sessionsRes.results || [];

  if (sessions.length === 0) {
    return json({ sessions: [] });
  }

  const setsRes = await env.DB.prepare(
    "SELECT id, session_id, exercise_id, set_number, reps, weight FROM sets ORDER BY set_number ASC"
  ).all();
  const setsBySession = new Map();
  for (const s of setsRes.results || []) {
    if (!setsBySession.has(s.session_id)) setsBySession.set(s.session_id, []);
    setsBySession.get(s.session_id).push(s);
  }

  const shaped = sessions.map((sess) => ({
    ...sess,
    sets: setsBySession.get(sess.id) || [],
  }));

  return json({ sessions: shaped });
}
