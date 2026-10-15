# 006-66: worker notes

Worker, 2026-10-15. Brief: `tasks/wave-13.md`, "006-66 Claude cells allow the service starts models type". Evidence read: pilot 2's Sonnet a9 cell (`20261015T104301Z-9edb7b`, `grade.json` `timeline.refused`, `events.jsonl` `permission_denials`), read only. No cell, baseline or build ran.

## Result

| Form | Before | After | Why it was refused |
|---|---|---|---|
| `nohup node scripts/rates-service.mjs >/dev/null 2>&1 &` | refused | **refused** | `&` background operator safety check |
| `node scripts/rates-service.mjs &` | refused | **refused** | same, though `Bash(node:*)` matches it |
| `(nohup node scripts/rates-service.mjs >/dev/null 2>&1 &) ; sleep 2; squeal retry test/rates.test.ts --reason environment` | refused | **refused** | "This command can't be checked before it runs" |
| `cat ~/.ledgerline-rates.port; echo; git status --short` | refused | allowed | `cat` outside the working directory: "Claude Code may only concatenate files from the allowed working directories" |
| (control) `node scripts/rates-service.mjs` with the Bash tool's `run_in_background: true` | allowed | allowed (list unchanged for it) | none |

The change: one rule, `Read(~/.ledgerline-rates.port)`, in `CLAUDE_ALLOWED_TOOLS`. `echo` passes as read-only, so no `Bash(echo:*)`. The brief's lead `Bash(nohup node scripts/rates-service.mjs:*)` was probed and does nothing, so it is not added. **Three of the four forms stay refused**: within narrow allowances, they cannot be allowed on Claude Code 2.1.300 (below). That is the decision returned to the coordinator.

## Why no rule admits `&` (Claude Code 2.1.300, read from its bundle)

In the Bash permission check (`yBe` in the minified bundle): once rules have allowed a command, if it contains `&` and its parse has an `&` node outside a `&&`/`||` binary expression, the result becomes `ask` with a `safetyCheck` reason (`circuitBreaker: "backgroundOperator"`, `classifierApprovable: false`). The only exception is the allow reason "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)". The breaker's table marks `backgroundOperator` `bypassImmune: false, classifierRouted: true`. So the ways past it are:
- `--permission-mode bypassPermissions` (every command);
- auto mode, whose server classifier may approve `background_operator` (every command goes to a classifier);
- the sandbox with `autoAllowBashIfSandboxed` (every sandboxed command, plus the sandbox's own network and file limits).

None is narrow. A PreToolUse hook that answers `permissionDecision: "allow"` for the exact strings was probed too: it lets the subshell form through (its refusal is the "can't be checked" parse, not the breaker), but the two bare `&` forms are still refused. A hook adds a new mechanism to the cell (a `--settings` hook and a script) and matches exact strings only; Sonnet's real call ended in `; squeal status --wait 60000`, which an exact match misses. Not added.

## Probes

All as `squeal-e2e`, through `docs/specifications/005-agent-adoption/research/probes/dogfood/as-e2e.mjs` (005-17's contract: `sudo -n --preserve-env=ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL -u squeal-e2e -H env HOME=… PATH=… sh -c 'cd "$1"; …'`, cwd `/`). Each case root is `/home/squeal-e2e/runs/p66-<before|after>-<form>-<id>/`, with scratch `home`, `tmp`, `codex`, `claude`, `xdg`. Credentials passed by name only.

Setup: `squeal-e2e`'s Claude Code was 2.1.296; 2.1.300 (the host's, the cells') was installed into its own prefix: `npm install -g --prefix /home/squeal-e2e/.npm-global @anthropic-ai/claude-code@2.1.300` run as `squeal-e2e` (it now reports `2.1.300 (Claude Code)`; the 005-17 real-CLI suite pins the host's version, so this matches its intent).

Each probe ran `/home/squeal-e2e/.npm-global/bin/claude` with the argv `sessionCommand({ harness: "claude", model: "claude-haiku-5-5", effort: "medium", pluginDir: null, prompt })` builds: before from `HEAD`'s `evals/lib/session.mjs` (d4284c12), after from the edited one. It ran in a scratch git repo (`work/`) holding a stub `scripts/rates-service.mjs` (listens on 127.0.0.1, writes `~/.ledgerline-rates.port`, exits after 20 s) and `test/rates.test.ts`, with a stub `squeal` on `PATH` that echoes its arguments. The prompt was: "Run exactly this shell command with the Bash tool, once, character for character, in the foreground (do not set run_in_background): <form>. Then reply DONE. Do not run anything else." Outcome read from the stream-json: the `tool_use` command (always the form verbatim) and the `result`'s `permission_denials`, plus the tool result text.

| Case root suffix | List | Form | Outcome | Tool result |
|---|---|---|---|---|
| `before-3-00caef7f` | HEAD | cat port; echo; git status | refused | `cat in '…/home/.ledgerline-rates.port' was blocked. For security, Claude Code may only concatenate files from the allowed working directories` |
| `before-0-8ebeb3c7` | HEAD | nohup … & | refused | `This command uses the \`&\` background operator, …` |
| `before-1-4051b460` | HEAD | node … & | refused | same |
| `before-2-b5feeaf7` | HEAD | (nohup … &) ; sleep 2; squeal retry … | refused | `This command can't be checked before it runs` |
| `before-4-cc6e4766` | HEAD | `node scripts/rates-service.mjs`, `run_in_background: true` | allowed | `Command running in background with ID: …` |
| `before-0-…` + `Bash(nohup node scripts/rates-service.mjs:*)` | HEAD + rule | nohup … & | refused | `&` breaker |
| `before-0-…` + `Bash(nohup node scripts/rates-service.mjs >/dev/null 2>&1 &)` (exact) | HEAD + rule | nohup … & | refused | `&` breaker |
| `before-1-…` + `Bash(node scripts/rates-service.mjs &)` (exact) | HEAD + rule | node … & | refused | `&` breaker |
| `before-3-85f95dc0` + `Read(~/.ledgerline-rates.port)` | HEAD + rule | cat port; echo; git status | allowed | `cat: …/.ledgerline-rates.port: No such file or directory` (it ran; no service was up) |
| `before-{0,1,2}-…` + PreToolUse allow hook (file in the case root) | HEAD + hook | the three `&` forms | refused, refused, **allowed** | breaker, breaker, `squeal stub: retry test/rates.test.ts --reason environment` |
| `after-0-7fdb1a9e` | edited | nohup … & | refused | `&` breaker |
| `after-1-2f45ac7e` | edited | node … & | refused | `&` breaker |
| `after-2-5a10d8e4` | edited | (nohup … &) ; … | refused | `can't be checked before it runs` |
| `after-3-d1d0322d` | edited | cat port; echo; git status | allowed | `cat: …: No such file or directory` |

(A first hook attempt with an inline `node -e` command had broken quoting and proves nothing; it is not in the table.)

## Tests

- `test/evals/service-start.test.ts`: "Claude's allow-list is pinned", the whole list with `toEqual`. It replaces `runner.test.ts`'s two `toContain` checks.
- `test/evals/atomic-scenarios.test.ts`, "keeps its conditions fingerprint": the list is part of the run conditions (D6, 70fadb64), so the new rule changes every Claude cell's fingerprint, the baseline's too. The test now pins the last runs' `586284d42fcc` on the list without the rule, and the next runs' `94149a6c1c14` on the list with it. **The baseline's next Claude run starts a new trend line** for a rule only a9 needs; a per-scenario list would avoid that, but it needs run-cell to pass the scenario to `sessionCommand`, outside this row.

## For the coordinator

- The done-when "each form refused before and allowed after" holds for the `cat` form only. The `&` forms need a decision: (a) leave them refused and grade a refused `&` service start as the harness's (grader, not this row); (b) a broad mode for a9's Claude cells only (`bypassPermissions`, which matches the Codex cells' full access); (c) a PreToolUse hook, which covers the subshell form only.
- Claude Code's own background path, `node scripts/rates-service.mjs` with `run_in_background: true`, is allowed today, so a model that uses it is not refused.
