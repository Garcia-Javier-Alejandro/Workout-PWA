# Workout PWA

A deliberately simple Progressive Web App to record a dumbbell workout routine,
built for use from Firefox on Android during training.

The app is a **recorder**, not a coach: the user fully controls the session
lifecycle. Nothing starts, ends, or discards a session automatically, and there
are no timers of any kind.

## Usage

- **NUEVA SESIÓN** creates a session with all 15 series (5 exercises × 3)
  visible on a single page. Each series' weight is seeded from the last weight
  used for that exercise; reps from the routine's initial value.
- Adjust weight (0.5 kg steps) and reps for any series, in any order, with the
  `+` / `−` steppers. There is no "next" action.
- **COMPLETAR SESIÓN** is the only thing that closes a session: it saves all 15
  series to D1 and moves the session to history. The active session survives
  closing the browser, reboots, and any amount of time.
- **Exportar CSV** (in Historial) downloads the full history as a CSV with one
  row per series: `session_id, started_at, completed_at, date, exercise_id,
  exercise_name, set_number, reps, weight_kg`. Uses D1 when reachable, else the
  local copy.

## Architecture

```
Firefox Android
      ↓
    PWA            (Cloudflare Pages — vanilla HTML/CSS/JS)
      ↓
Cloudflare Worker  (API, shared-secret auth in X-App-Key header)
      ↓
Cloudflare D1      (source of truth for completed-session history)
```

- The **active session** and the **sync queue** of completed-but-not-synced
  sessions live in **IndexedDB**, so a full session can be recorded offline and
  survives closing Firefox, rebooting the phone, and any amount of time passing.
- Synchronization to D1 happens **only** when the user presses
  `COMPLETAR SESIÓN`, in a single POST containing the session and all its sets.
- Session and set ids are **client-generated UUID v4** and are PRIMARY KEYs in
  D1. Inserts use `INSERT OR IGNORE`, so retries with the same ids never
  duplicate data.

## Project structure

```
Workout-PWA/
  pwa/       # frontend: HTML/CSS/JS, manifest, service worker
  worker/    # Cloudflare Worker + wrangler config
  db/        # D1 SQL migrations (schema.sql)
  README.md
```

## Prerequisites

- Node.js 18+ and [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
  (`npm install -g wrangler`).
- A Cloudflare account (`wrangler login`).

## 1. Create the D1 database

```bash
cd worker
wrangler d1 create workout-pwa
```

Copy the printed `database_id` into `worker/wrangler.toml` (the
`database_id = "REPLACE_WITH_D1_DATABASE_ID"` line).

## 2. Apply the migrations (schema)

```bash
# From the worker/ directory. Remote applies to the deployed D1 database.
wrangler d1 execute workout-pwa --remote --file=../db/schema.sql

# (Optional) local dev copy:
wrangler d1 execute workout-pwa --local --file=../db/schema.sql
```

## 3. Configure the shared secret

Choose any string as the app key and store it as a Worker Secret:

```bash
wrangler secret put APP_KEY
# paste your secret when prompted
```

The PWA must send the same value in the `X-App-Key` header (see step 6).

## 4. Deploy the Worker

```bash
cd worker
wrangler deploy
```

Note the deployed URL, e.g. `https://workout-pwa-api.<subdomain>.workers.dev`.

## 5. Deploy the PWA to Cloudflare Pages

The PWA is static. `pwa/config.js` (Worker URL + shared secret) is **gitignored**,
so for Git-connected deploys it is generated at build time from environment
variables by `scripts/gen-config.js`.

**Option A — Git integration (auto-deploy on push):**

Cloudflare → Workers & Pages → Create → Pages → **Connect to Git** → select this
repo, then set:

- **Build command:** `node scripts/gen-config.js`
- **Build output directory:** `pwa`
- **Environment variables:**
  - `API_BASE` = `https://workout-pwa-api.<subdomain>.workers.dev`
  - `APP_KEY` = the same secret you set in step 3

Every push to `main` then rebuilds and deploys automatically.

**Option B — Direct upload via CLI:**

```bash
cp pwa/config.example.js pwa/config.js   # then edit it (see step 6)
wrangler pages deploy pwa --project-name workout-pwa --branch main
```

## 6. Point the PWA at the Worker

`pwa/config.js` holds the Worker URL and the shared secret and is **gitignored**
so the secret is not committed. Create it from the template:

```bash
cp pwa/config.example.js pwa/config.js
```

Then edit `pwa/config.js`:

```js
window.APP_CONFIG = {
  API_BASE: "https://workout-pwa-api.<subdomain>.workers.dev",
  APP_KEY: "the-same-secret-you-set-in-step-3",
};
```

Commit and redeploy the Pages project. The `APP_KEY` intentionally ships in the
client bundle; it only deters casual traffic, not a determined attacker.

## Running locally

The frontend is fully static. From the `pwa/` directory:

```bash
npx http-server . -p 8080
# or: python -m http.server 8080
```

Open `http://localhost:8080`. A secure context (localhost or https) is required
for `crypto.randomUUID()` and the service worker.

For the Worker locally: `cd worker && wrangler dev`.

## Data model

```
Session: id (uuid), started_at, completed_at
Set:     id (uuid), session_id, exercise_id, set_number, reps, weight
```

Every set is stored individually, enabling later performance analysis (weight
and rep evolution, volume per exercise/session, training frequency, etc.). No
analysis is implemented yet — only the data is captured.

## API

All requests require the `X-App-Key` header.

- `POST /sessions` — body `{ session: {id, started_at, completed_at}, sets: [...] }`.
  Idempotent (`INSERT OR IGNORE`). Returns `{ ok, session_id, sets }`.
- `GET /sessions` — returns `{ sessions: [ { id, started_at, completed_at, sets: [...] } ] }`,
  most recent first.
- `GET /health` — liveness check.
