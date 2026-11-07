/**
 * Shared state for the guided browser-sign-in OAuth App step of the PAT
 * setup branch. Both wizards (Ink TUI and sequential readline) render this
 * step; keeping the URL derivation and the .env reads here means they can
 * never drift in behaviour.
 *
 * The helper is intentionally read-only over the stack's .env: it derives the
 * callback port and honours a custom FRONTEND_URL instead of clobbering it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_API_PORT = "4000";
const DEFAULT_FRONTEND_URL = "http://localhost:5173";

/**
 * Reads the value assigned to `key` in .env content (uncommented lines only),
 * stripping surrounding quotes and whitespace. Returns `undefined` when the
 * key is absent or empty.
 */
function readEnvValue(envText: string, key: string): string | undefined {
  const match = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return undefined;
  // A quoted value must not leak its quotes into URLs (e.g.
  // DASHBOARD_API_PORT="4010" would otherwise produce an invalid callback).
  return match[1].trim().replace(/^["']+|["']+$/g, "").trim() || undefined;
}

export interface OAuthAppSetup {
  /** Numeric dashboard API port the GitHub OAuth callback points at. */
  apiPort: string;
  /** Effective dashboard origin (a pinned FRONTEND_URL or the localhost default). */
  frontendUrl: string;
  /** OAuth callback registered with GitHub. */
  callbackUrl: string;
  /** GitHub OAuth App creation link with the form pre-filled. */
  creationUrl: string;
  /**
   * Env vars for a supplied client id/secret. FRONTEND_URL is omitted when the
   * .env already pins it — .env.example says an uncommented FRONTEND_URL always
   * overrides the derived origin, so rewriting it here would clobber a custom
   * value on re-run.
   */
  envVars(clientId: string, clientSecret: string): Record<string, string>;
}

/** Derive the OAuth App setup state from the stack's .env (if it exists yet). */
export function readOAuthAppSetup(rootDir?: string): OAuthAppSetup {
  let envText = "";
  try {
    envText = readFileSync(join(rootDir ?? "", ".env"), "utf-8");
  } catch {
    // Fresh install: .env may not exist yet; keep the defaults.
  }
  const configuredPort = readEnvValue(envText, "DASHBOARD_API_PORT") ?? DEFAULT_API_PORT;
  const apiPort = /^\d+$/.test(configuredPort) ? configuredPort : DEFAULT_API_PORT;
  const frontendUrl = readEnvValue(envText, "FRONTEND_URL") ?? DEFAULT_FRONTEND_URL;
  const callbackUrl = `http://localhost:${apiPort}/api/auth/github/callback`;
  const creationUrl = "https://github.com/settings/applications/new"
    + `?name=${encodeURIComponent("ProPR (local)")}`
    + `&url=${encodeURIComponent(frontendUrl)}`
    + `&callback_url=${encodeURIComponent(callbackUrl)}`;
  return {
    apiPort,
    frontendUrl,
    callbackUrl,
    creationUrl,
    envVars: (clientId, clientSecret) => ({
      GH_OAUTH_CLIENT_ID: clientId,
      GH_OAUTH_CLIENT_SECRET: clientSecret,
      GH_OAUTH_CALLBACK_URL: callbackUrl,
      ...(frontendUrl === DEFAULT_FRONTEND_URL ? { FRONTEND_URL: frontendUrl } : {}),
    }),
  };
}
