# Throwaway OpenCode plugin probes

These are **throwaway research probes**, not product code or supported installation scripts. Findings: [../../opencode-plugins.md](../../opencode-plugins.md). Run only as the disposable OS user `squeal-e2e`. They intentionally throw once before an edit, append instructions, create scratch files and, in `hang` mode, leave a hook unresolved until the driver aborts it.

## Isolation and setup actually used

1. Verified `sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=/usr/bin:/bin sh -c 'cd / && id'`. The user already existed (uid 1002). `/opt/squeal-e2e/node24/bin/node` was already provisioned; no access to `/home/agent` was granted.
2. Installed with `sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=/opt/squeal-e2e/node24/bin:/usr/bin:/bin sh -c 'cd / && npm install --global --prefix /home/squeal-e2e/.npm-global opencode-ai@1.18.35'`. npm reported three packages and an unapproved postinstall; nevertheless the installed executable's isolated `opencode --version` returned `1.18.35`. The running plugin recorded Bun `1.3.14` and the executable path.
3. Sent files by tar, then initialized a scratch git repo, with no commit required:

   ```sh
   tar -C docs/specifications/008-opencode-adapter/research/probes/opencode-plugins -cf - . |
     sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=/usr/bin:/bin sh -c \
       'cd / && mkdir -p /home/squeal-e2e/008-plugins && cd /home/squeal-e2e/008-plugins && tar xf - && git init -q'
   ```

4. `opencode.json` names the requested provider/model and the literal `{env:CLIPROXY_API_KEY}` placeholder. The key was passed by **name only**, with sudo preservation and GNU env's split-string expansion before clearing the environment. The following contains no credential value and must not be run with shell tracing:

   ```sh
   sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H \
     env -i -S 'CLIPROXY_API_KEY=${CLIPROXY_API_KEY}' \
     HOME=/home/squeal-e2e \
     PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin \
     OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 \
     sh -c 'cd / && cd /home/squeal-e2e/008-plugins && node drive.mjs base && node summarize.mjs serve-evidence.json'
   ```

   `-S` expansion was first tested with a nonsecret dummy variable. No real-user OpenCode config or auth store was read. No credential values were printed, copied to files or included in probes. The environment placeholder is the only credential configuration.

5. Source was fetched read-only from `https://api.github.com/repos/sst/opencode/tarball/v1.18.35`; `git ls-remote` resolved the tag to `53d1eabb61e21162157817bf677da0a4ad3332e3`. The extracted source at `/tmp/anomalyco-opencode-53d1eab` was never executed.

## Scenarios

Use the same isolated command envelope above for every invocation. `drive.mjs` starts `serve` at `127.0.0.1:4198`, drives `/session`, `/session/:id/message`, deletion and (for hang) abort, and terminates its own server in `finally`, escalating after five seconds. Do not run concurrent copies on this port/root.

| Mode | Stimulus | Recorded result |
| --- | --- | --- |
| `runtime` | Session creation, no model | SQLite import rejected; Unix echo and detached spawn succeeded. |
| `base` | Bash printf, create `serve-hello.txt`, retry denied edit | After text and primer reached final answer; one deny, one successful retry. |
| `noReply` | After first tool, call SDK prompt with `noReply:true`, synthetic text | Distinct user message; final `DELTA_SEEN NOREPLY_SEEN PRIMER_SEEN`. |
| `large` | After-output appends 32,768 `x` plus tail instruction | Final `Done. PRIMER_SEEN DELTA_SEEN LARGE_TAIL_SEEN`. |
| `idle` | On first idle only, inject news with ordinary SDK prompt | One extra completed answer; next idle silent. |
| `hang` | Before hook awaits forever; driver waits three seconds, requests health and abort | Health responsive, abort returns true; tool never executes, idle/error emitted. |

The sequential driver batch used `for mode in noReply large idle hang runtime; do node drive.mjs "$mode" && node summarize.mjs "$mode-evidence.json" && cp serve-result.json "$mode-result.json"; done`.

`run` was separately invoked with `timeout -k 5 120 opencode run --format json 'Use bash to run printf probe. Then create hello.txt containing hello with the file editing tool. Reissue once if denied. Reply briefly.'`. Its final text was `Ran the printf probe and created hello.txt containing hello. DELTA_SEEN PRIMER_SEEN` (the filename was formatted with backticks). The base `serve` final text was `Created serve-hello.txt containing hello. PRIMER_SEEN DELTA_SEEN`. Both had one user prompt and multiple tool/model steps. `run-evidence.json` and `serve-evidence.json` preserve hooks, IDs, errors and next-request timing; those final text excerpts were read from the JSON outputs before the scratch output files were reused.

An additional `run` used `mode.txt=idle` and prompt `Reply OK briefly.`. Its record is `idle-run-evidence.json`: idle, wake start, synthetic chat-message, then disposal 33 ms after wake start; no second model-parameter hook. The SDK promise's resolution (`wake.done`) alone is **not** proof of a successful model response. `idle-result.json` from the `serve` scenario includes actual messages proving that mode's second response.

The first HTTP driver version could wait 90 seconds on a startup health request; the retained driver bounds health requests to one second. An extra manually created HTTP session occurred during that diagnosis and is visible in `serve-evidence.json`. The model-free initial attempt was interrupted before session creation, but its plugin runtime results appear at the start of `run-evidence.json`. Neither preliminary attempt is counted as a completed model scenario.

## Evidence and limits

- `*-evidence.json`: hook/event inventories plus selected timestamped records. `summarize.mjs` removes noisy bus events while retaining their distinct names. Config/provider/environment objects are never logged. `session.diff` bodies are suppressed to prevent snapshots of the growing log from feeding back into it.
- `noReply-result.json`, `large-result.json`, `idle-result.json`, `hang-result.json`: HTTP results/messages. Their synthetic user parts are real persisted parts, not a separate developer-authority channel.
- Socket timings are a local Bun echo server, 50 connections per plugin initialization. Node timings are 30 `node -e 'void 0'` subprocesses. Neither measures the shared Squeal handler. The detached marker proves spawning/execution, not a complete daemon lifecycle policy; the sibling topic owns that question.
- `runtime-result.json` / `detached-result.json` are scratch checks, not claims that every detached child outlives OpenCode: an earlier marker can already exist. The findings deliberately make only the supported spawn/execution claim.
- No compaction, permission-ask, custom command, child-task or TUI experiment here. No maximum payload or loaded-store timing claim. `slow` is an available optional mode, not one of the recorded scenarios.
- `tool`, `auth`, `provider` are declared extension objects; every callable hook in `Hooks` is either instrumented or its absence described in the findings. Default auth/provider behavior was not replaced.

After each driver run its own server is stopped. The probe's detached children exit after three seconds; no Squeal daemon is started in this scratch repo. Do not kill other `squeal-e2e` processes: that account is shared with the sibling researcher. The real worktree was never exposed to this user.

## Verification

The repo initially lacked dependencies: lint/typecheck exited 127 (`biome`/`tsc` missing). `npm ci --ignore-scripts` installed 58 packages, then lint, typecheck and build passed. Build left no tracked bundle changes. The Squeal full checkpoint exited 3 as abandoned, with six unknown test files; the repository explicitly requires direct Vitest in that case. Its output is retained in `verification-vitest.txt`; the final handoff reports the completed result, not the abandoned checkpoint as a pass.

Completed verification (exit 0 unless noted):

```text
$ npm run lint
Checked 1094 files in 380ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs run --all --wait 600000
Checkpoint bced18eb-5de2-42b6-8919-fd0079fa1500 has no verdict: it was abandoned before every test file had a result
(exit 3; six test files unknown)
$ npx vitest run
Test Files  516 passed | 1 skipped (517)
     Tests  4348 passed | 10 skipped (4358)
  Duration  194.57s (tests 96%, import 2%, transform 1%)
$ git diff --check
(no output)
```

Final HTTP health check at port 4198 failed to connect, confirming the probe server was stopped.
