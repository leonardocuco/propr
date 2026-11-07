import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readOAuthAppSetup } from "./oauthAppSetup.js";

test("readOAuthAppSetup keeps defaults when the stack has no .env yet", () => {
  const setup = readOAuthAppSetup(join(tmpdir(), "propr-oauth-missing-"));
  assert.equal(setup.apiPort, "4000");
  assert.equal(setup.frontendUrl, "http://localhost:5173");
  assert.equal(setup.callbackUrl, "http://localhost:4000/api/auth/github/callback");
  assert.ok(setup.creationUrl.includes("callback_url=http%3A%2F%2Flocalhost%3A4000%2Fapi%2Fauth%2Fgithub%2Fcallback"));
  // Nothing pinned: the wizard may write the default FRONTEND_URL.
  assert.deepEqual(Object.keys(setup.envVars("id", "secret")).sort(), [
    "FRONTEND_URL",
    "GH_OAUTH_CALLBACK_URL",
    "GH_OAUTH_CLIENT_ID",
    "GH_OAUTH_CLIENT_SECRET",
  ]);
});

test("readOAuthAppSetup strips quotes from DASHBOARD_API_PORT for the callback URL", () => {
  const root = mkdtempSync(join(tmpdir(), "propr-oauth-port-"));
  try {
    // A quoted value must not leak its quotes into the pre-filled callback
    // (GitHub rejects http://localhost:"4010"/...).
    writeFileSync(join(root, ".env"), 'DASHBOARD_API_PORT="4010"\n');
    const setup = readOAuthAppSetup(root);
    assert.equal(setup.apiPort, "4010");
    assert.equal(setup.callbackUrl, "http://localhost:4010/api/auth/github/callback");
    assert.ok(setup.creationUrl.includes("callback_url=http%3A%2F%2Flocalhost%3A4010"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readOAuthAppSetup falls back to the default port when the value is not numeric", () => {
  const root = mkdtempSync(join(tmpdir(), "propr-oauth-badport-"));
  try {
    writeFileSync(join(root, ".env"), "DASHBOARD_API_PORT=oops\n");
    const setup = readOAuthAppSetup(root);
    assert.equal(setup.apiPort, "4000");
    assert.equal(setup.callbackUrl, "http://localhost:4000/api/auth/github/callback");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readOAuthAppSetup honours a pinned FRONTEND_URL and never clobbers it", () => {
  const root = mkdtempSync(join(tmpdir(), "propr-oauth-frontend-"));
  try {
    writeFileSync(join(root, ".env"), "FRONTEND_URL=https://propr.example.com\n");
    const setup = readOAuthAppSetup(root);
    assert.equal(setup.frontendUrl, "https://propr.example.com");
    assert.ok(setup.creationUrl.includes(encodeURIComponent("https://propr.example.com")));
    // .env.example says an uncommented FRONTEND_URL always overrides the
    // derived origin — the wizard must not rewrite it on re-run.
    assert.equal(setup.envVars("id", "secret").FRONTEND_URL, undefined);
    assert.deepEqual(Object.keys(setup.envVars("id", "secret")).sort(), [
      "GH_OAUTH_CALLBACK_URL",
      "GH_OAUTH_CLIENT_ID",
      "GH_OAUTH_CLIENT_SECRET",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readOAuthAppSetup ignores commented FRONTEND_URL lines", () => {
  const root = mkdtempSync(join(tmpdir(), "propr-oauth-comment-"));
  try {
    writeFileSync(join(root, ".env"), "# FRONTEND_URL=https://stale.example.com\n");
    const setup = readOAuthAppSetup(root);
    assert.equal(setup.frontendUrl, "http://localhost:5173");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
