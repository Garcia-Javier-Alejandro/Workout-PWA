// Build step: generate pwa/config.js from environment variables.
//
// Used by Cloudflare Pages (Git integration): set API_BASE and APP_KEY as
// project environment variables and this writes them into the client bundle at
// build time, so the shared secret never has to live in the repo.
//
// No dependencies: plain Node fs.

const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE;
const APP_KEY = process.env.APP_KEY;

if (!API_BASE || !APP_KEY) {
  console.error(
    "gen-config: missing env vars. Set API_BASE and APP_KEY (Pages project settings)."
  );
  process.exit(1);
}

const out = `// Generated at build time by scripts/gen-config.js. Do not edit.
window.APP_CONFIG = {
  API_BASE: ${JSON.stringify(API_BASE.replace(/\/+$/, ""))},
  APP_KEY: ${JSON.stringify(APP_KEY)},
};
`;

const target = path.join(__dirname, "..", "pwa", "config.js");
fs.writeFileSync(target, out);
console.log(`gen-config: wrote ${target}`);
