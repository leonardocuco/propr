# Team onboarding: ProPR local install (PAT mode)

Goal: each team member runs ProPR locally on their own machine, monitoring
their own GitHub repos (personal or org repos they already have access to),
with **zero GitHub-admin involvement**.

This fork adds a third GitHub auth mode, `pat`, alongside the upstream
ProPR Connect / custom App modes.

## What you need (one-time, ~10 minutes)

| Item | Purpose | Who creates it |
|---|---|---|
| Worker PAT (fine-grained, write) | push, PRs, labels, comments. Stays in ProPR. | You |
| Agent PAT (fine-grained, read-only) | the only credential agent containers receive | You |
| GitHub OAuth App (shared) | dashboard browser sign-in (identity only) | One per team |

No org admin is required for personal accounts. For org repos, the org must
allow fine-grained PATs; the OAuth App login requests identity only
(`user:email`), so restricted orgs will not trigger an admin approval flow.

## 1. Install

```bash
git clone https://github.com/leonardocuco/propr.git ~/Desktop/Projects/propr
cd ~/Desktop/Projects/propr
npm ci && npm run build --workspaces
PROPR_SKIP_REMOTE_IMAGE_CHECK=1 node packages/cli/dist/index.js setup --root ~/Desktop/Projects/propr
```

## 2. Wizard choices

- GitHub authentication → **Personal access tokens**. The wizard prints two
  pre-filled fine-grained PAT URLs (permissions and expiry already selected):
  pick the repositories, generate, paste. Classic `ghp_` tokens are rejected
  (they cannot be read-only).
- Browser sign-in → create the shared OAuth App from the printed pre-filled
  link (callback `http://localhost:4000/api/auth/github/callback`), paste the
  Client ID + Secret. One OAuth App per team: everyone shares the same
  credentials since the callback is identical on every machine.
- Intake → **polling** (imposed by PAT mode).
- Start the stack.

## 3. Verify

- Open http://localhost:5173 and "Sign in with GitHub" (identity-only
  authorization, no org request).
- `node packages/cli/dist/index.js repo add <owner>/<repo> -b main` then
  `repo list` to confirm.
- End-to-end: `plan create "Add a file TEST.md ..." -p <owner>/<repo> -b main`,
  wait for Review status, `plan finalize <draft-id>`, then add the `AI` label
  to the created issue. The agent runs and opens a PR authored by you.

## 4. Optional: Enablers-routed agent (Algolia team)

This fork's catalog includes the Algolia Enablers models
(`enablers/xlarge` 1M, `enablers/large` 256K, `d3`). They are only valid for
an agent whose Claude config routes through the Enablers edge router:

1. Create a Claude config dir with `settings.json` containing
   `env.ANTHROPIC_BASE_URL = https://inference-edgerouter.api.enablers.algolia.net`
   and `env.ANTHROPIC_AUTH_TOKEN` (Enablers JWT).
2. Add a second agent of type `claude` (alias `claude-enablers`) whose
   `configPath` points at that dir, via Settings → Coding Agents in the UI or
   `POST /api/config/agents` (required fields: id, type, alias, enabled,
   configPath, supportedModels; add `defaultModel`).
3. Keep the stock `claude` agent on the native `~/.claude` config; run
   `propr agent login claude` if you want native Anthropic credentials.

Do NOT check the Enablers models on the native agent: the ids only resolve
through the router.

## Conventions and gotchas

- One ProPR stack per machine per repo. Two stacks monitoring the same repo
  double-process issues.
- Adding a repository from the dashboard **replaces** the monitored list;
  prefer `repo add` (CLI) which appends.
- Org repos in the dashboard picker: the browser token is identity-only, so
  type `org/repo` manually in the Add Repository field.
- Automation (agent runs) need a non-empty `SYSTEM_TASK_SECRET`; the wizard
  generates one. If you ever empty it, agent-run report/action phases fail
  with "SYSTEM_TASK_SECRET is not configured on the worker".
- `NODE_ENV` must stay `production` in the stack `.env`.
