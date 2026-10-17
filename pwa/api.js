// Thin client for the Cloudflare Worker API.
// The shared secret is sent in the X-App-Key header on every request.
//
// Requests go first to /api on the app's own domain (a Pages Function that
// proxies to the Worker), so the phone never needs to resolve workers.dev,
// which some DNS filters block. If the proxy fails, the direct Worker URL from
// config.js is tried as a fallback.

// A response only counts if it is JSON: without the proxy deployed, Pages may
// answer /api/* with the HTML app shell and a 200.
function isJson(res) {
  return (res.headers.get("Content-Type") || "").includes("application/json");
}

const API = {
  bases() {
    return ["/api", window.APP_CONFIG.API_BASE];
  },

  async request(path, init) {
    let lastErr;
    for (const base of this.bases()) {
      try {
        const res = await fetch(`${base}${path}`, init);
        if (res.ok && isJson(res)) return res.json();
        lastErr = new Error(`${init.method} ${base}${path} failed: ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  },

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
    return this.request("/sessions", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
  },

  // Fetch full history from D1 via the Worker.
  async getSessions() {
    const data = await this.request("/sessions", {
      method: "GET",
      headers: this.headers(),
    });
    return data.sessions || [];
  },

  // Record one body-weight entry. Idempotent server-side like sessions.
  async postBodyWeight(entry) {
    return this.request("/bodyweight", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id: entry.id,
        recorded_at: entry.recorded_at,
        weight: entry.weight,
      }),
    });
  },

  // All body-weight entries from D1, most recent first.
  async getBodyWeights() {
    const data = await this.request("/bodyweight", {
      method: "GET",
      headers: this.headers(),
    });
    return data.entries || [];
  },
};

window.API = API;
