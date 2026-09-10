// Copy this file to `config.js` and fill in your own values.
// `config.js` is gitignored so the live shared secret is not committed.
// The APP_KEY intentionally lives in the client bundle at runtime; its only
// purpose is to deter casual traffic, not to provide strong security.
window.APP_CONFIG = {
  // Base URL of the deployed Cloudflare Worker, no trailing slash.
  API_BASE: "https://workout-pwa-api.example.workers.dev",
  // Shared secret sent in the X-App-Key header. Must match the Worker's APP_KEY.
  APP_KEY: "change-me",
};
