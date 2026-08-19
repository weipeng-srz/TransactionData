import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerEntry = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
// Wrangler appends its own v3/d1 segments. This root therefore resolves to the
// same .wrangler/state/v3/d1 store used by the Cloudflare Vite plugin.
const persistenceDirectory = process.env.TRENDSIGHT_D1_PERSIST_PATH?.trim() || ".wrangler/state";

const result = spawnSync(process.execPath, [
  wranglerEntry,
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  persistenceDirectory,
  "--config",
  "wrangler.local.jsonc",
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CI: "1",
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
