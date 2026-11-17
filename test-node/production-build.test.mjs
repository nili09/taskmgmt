// The dev-only user path must not exist in a production build, whatever the environment says.
// Vitest runs inside the Workers runtime and cannot build, so this one runs in plain Node.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("production build contains no dev-user path", () => {
  execSync("npx vite build", { stdio: "pipe", env: { ...process.env, NODE_ENV: "production" } });
  const bundle = readFileSync("dist/worker/index.js", "utf8");
  assert.equal(bundle.includes("DEV_USER_EMAIL"), false, "DEV_USER_EMAIL found in the Worker bundle");
  assert.equal(bundle.includes("cf-access-jwt-assertion"), true, "Access verification missing from the Worker bundle");

  const config = readFileSync("dist/worker/wrangler.json", "utf8");
  assert.equal(config.includes("DEV_USER_EMAIL"), false, "DEV_USER_EMAIL found in the deploy config");
  assert.equal(config.includes("ALLOWED_EMAILS"), false, "ALLOWED_EMAILS found in the deploy config");
});
