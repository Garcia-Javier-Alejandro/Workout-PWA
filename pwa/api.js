// Thin client for the Cloudflare Worker API.
// The shared secret is sent in the X-App-Key header on every request.

const API = {
  headers() {
    return {
      "Content-Type": "application/json",
      "X-App-Key": window.APP_CONFIG.APP_KEY,
    };
  },

  // POST a completed session with all its sets in a single call.
  // Idempotent server-side thanks to client UUIDs + INSERT OR IGNORE, so
  // retrying after a failure is always safe.
  async postSession(session) {
    const payload = {
      session: {
        id: session.id,
        started_at: session.started_at,
        completed_at: session.completed_at,
      },
      sets: session.sets.map((s) => ({
        id: s.id,
        session_id: session.id,
        exercise_id: s.exercise_id,
        set_number: s.set_number,
        reps: s.reps,
        weight: s.weight,
      })),
    };
    const res = await fetch(`${window.APP_CONFIG.API_BASE}/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`POST /sessions failed: ${res.status}`);
    return res.json();
  },

  // Fetch full history from D1 via the Worker.
  async getSessions() {
    const res = await fetch(`${window.APP_CONFIG.API_BASE}/sessions`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET /sessions failed: ${res.status}`);
    const data = await res.json();
    return data.sessions || [];
  },
};

window.API = API;
