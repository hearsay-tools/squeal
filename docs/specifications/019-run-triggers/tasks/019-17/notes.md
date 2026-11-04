# 019-17 notes: the proof and the dogfood

Worker dc7216e0, 2026-11-04, 02:00Z to 03:45Z. The results are in `../../lessons.md`, "Round 1 (019-17)". These notes are the residue: how the round ran, where the raw data is, and what to know before running such a round again.

## Part A, the end-to-end test

| File | What it holds |
| --- | --- |
| `test/e2e/run-triggers.test.ts` | The three groups, per plugin: an edit runs unit only (watched 3 s more, so a lane that should wait had time to start); Stop starts e2e and waits; the commit line once, then its update once; a hold on an e2e failure, told, then silent; `squeal run e2e --wait` with a failure (exit 1) and a pass (exit 0); two holds at a 20 s bound with a 60 s e2e run, then a silent Stop; e2e runs after unit and one at a time. |
| `test/e2e/run-triggers-control.test.ts` | The same repository with no `checks`, one session on the plugin of 0.1.393's candidate `24a8a63b6` (`git archive`) and one on this worktree's: equal texts, Stop decisions and runs. One accepted difference, named in the test. |
| `test/e2e/run-triggers-fixture.ts` | The fixture: `unit` and `e2e` Vitest projects, `src/delay.ts` (how long `flow.test.ts` sleeps), oxlint on `src/**`. |
| `test/e2e/run-triggers-support.ts` | Hooks the harness does not drive (the waiting Stop entry, the user prompt), both Stop entries at once, the runs with their times, the settle on `edit` groups, oxlint linked in, a plugin from a commit, and Codex's runtime installed in its data folder. |
| `test/e2e/run-triggers-moments.ts` | The commit lines over several boundaries, the session's first Stop, the lane order check. |

Things that cost time, for whoever extends these tests:

- **The first SessionStart in a repository with no store is silent** (task 001-88): the primer comes with the first registration, a prompt or a boundary. Claude Code's prompt registers only in an attended session (`CLAUDE_CODE_SESSION_ATTENDED=1`), Codex's always.
- **No consumer in a turn reads as a pause**, so a group at `stop` runs at the start unless a prompt registered the session in a turn before the unit baseline ends (`promptOnceStored`).
- **`lanePending` counts every configured group**, `edit` groups too; a settle that subtracts it returns while unit still runs. Settle on the `edit` groups' lines instead.
- **The Codex plugin runs its seed runtime (0.1.368) unless a runtime is selected** in `<plugin>.data/runtime/current.json`. Every Codex e2e test that drives the plugin copy runs the seed. `pluginAt` installs this worktree's `plugins/codex-runtime` and selects it.
- **The first Stop of a session is a race** between the two entries (`stopWaitRuns`, task 001-297). `firstStop` lets the waiting entry record itself first.
- **A new failure's confirmation run** (001-171) decides whether a boundary says "Squeal saw your edit; all N test files it re-keyed are current". The control waits for `testFileCounts.pending === 0`, else the two versions differ by timing alone.
- Part A runs: three in a row at 02:51Z, 02:55Z and 02:59Z, 222 to 224 s each, load 5.6 to 8.9 (`/tmp/dogfood-019-17/part-a/run-{1,2,3}.txt` while the host keeps `/tmp`).

## Part B, isolation and setup

| Item | Value |
| --- | --- |
| OS user | `squeal-e2e` (uid 1002). Every clone, install, daemon, CLI run and model session ran as that user through `bin/as-e2e.mjs` (017-13's, unchanged but its header), cwd `/`. Credentials by name only: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` for Claude Code; `CLIPROXY_API_KEY`, `CODEX_CA_CERTIFICATE` for Codex. |
| Case root | `/home/squeal-e2e/runs/d1917`: `home`, `tmp`, `claude` (`CLAUDE_CONFIG_DIR`), `codex` (`CODEX_HOME`, with the host's provider block and model catalog, no credential), `xdg`, `corepack`, `pnpm-store`, `bin`, `pin`, and the clones `cezarion` and `fixture`. |
| Scratch | `/tmp/dogfood-019-17`: `bin/` (a copy of `bin/` the e2e user can read), `prompts/`, `bundles/`, `fixture-src/`, `bases.json`, `logs/` (below), `part-a/`. |
| Squeal | `git archive 4163f5de8` (main at 0.1.398, unreleased) of both plugins, the Codex runtime and both marketplace manifests, each marketplace renamed `hearsay` (`bin/setup.sh pin install`). Claude Code: `claude plugin install squeal@hearsay`, user scope. Codex: `codex plugin add squeal@hearsay` (adapter 1.0.3), the 0.1.398 runtime copied to `codex/plugins/data/squeal-hearsay/versions/0.1.398` and selected, the hooks trusted with `squeal init --harness codex --trust --yes` (both Stop handlers trusted). `squeal --version` printed 0.1.398. |
| Harnesses | Claude Code 2.1.300, `claude -p --model sonnet --output-format stream-json --verbose --include-hook-events --permission-mode bypassPermissions`. Codex CLI 0.160.1, `codex exec --json -s danger-full-access -m gpt-6-astra -c model_reasoning_effort="medium"`. Node 24.21.0 (`/opt/squeal-e2e/node24`). |
| cezarion | A bundle of `/home/agent/projects/cezar` at `10e7a5782` (read only), `corepack pnpm install --frozen-lockfile` (pnpm 12.11.2). Branches: `cez-today` (its own `squeal.config.json`), `cez-groups` (the same plus `checks`: e2e at stop after unit with `maxParallel: 1`, every other Vitest project at edit, lint at commit) (`bin/configs.mjs`). |
| fixture | The Part A fixture with a 15 s e2e file (`bin/make-fixture.mjs`), `npm install` of Vitest 5.0.3 and oxlint 1.90.0. Branches `fix-h1` and `fix-h2`: the three groups with `stop.maxHolds` 1 and 2. |

## Scripts (`bin/`)

| Script | What it does |
| --- | --- |
| `as-e2e.mjs` | Runs one command as `squeal-e2e` in the case root. |
| `setup.sh` | Steps `dirs`, `pin`, `bundles`, `clone`, `deps`, `install`, `configs`. |
| `make-fixture.mjs` | The Part A fixture as a git repository, from `test/e2e/run-triggers-fixture.ts`. |
| `configs.mjs` | The configuration branches, printed as `bases.json`. |
| `session.mjs <id>` | One session: reset to the variant's commit (`fresh`: daemon stopped and store removed), `squeal start`, settle (fixture: `squeal run --all --wait`; cezarion: `squeal status --wait packages/cezar/src/core/effort.test.ts`), load gate, memory, the harness with each stream line stamped, memory at the result, status, the store's rows, the diff, the Codex rollout, `timeline.txt`. `interrupt: "sdk"` sends the SDK's interrupt 5 s into the first Bash call; `"sigint"` sends SIGINT. |
| `timeline.mjs` | A session's timeline from its stream (and the Codex rollout's hook texts). |
| `mem.mjs <clone> [--heap\|--gc]` | The daemon's RSS, RssAnon and peak from `/proc`; with `--heap` its V8 heap through the inspector (SIGUSR1 as the e2e user, port 9229, pid checked, inspector closed again); `--gc` forces two GCs first. |
| `memloop.sh` | `mem.mjs` every 5 s until a stop file exists. |
| `store.mjs` | As the e2e user, read only: runs, revisions and the commit, Stop and turn meta rows since a time. |
| `cycles.mjs` | 20 e2e lane cycles in the fixture with the heap after forced GCs (open question 7, row 019-19). |
| `partial.sh` | The partial-staging probe (open question 4), no model. |

Per session, in `/tmp/dogfood-019-17/logs/sessions/<id>/` while the host keeps `/tmp`: `stream.jsonl`, `timeline.txt`, `meta.json` (load, memory, times), `mem.jsonl`, `store.json`, `status-before.txt`, `status-after.txt`, `settle-before.txt`, `diff.patch`, `stderr.txt`, and for Codex `codex-rollout.jsonl`. Also `logs/cez-mem.jsonl` (the cezarion daemon every 5 s from its start), `logs/cycles.jsonl`, `logs/e2e-smoke-probe.txt`.

## What went wrong, and how it was handled

- **cezarion's browser e2e cannot run as `squeal-e2e`**: its global setup fails in 29 s with "installed Chrome failed to launch with resolved settings" (`logs/e2e-smoke-probe.txt`). The Chrome sandbox does not start for that user; `resolve-browser-launch.mjs` adds `--no-sandbox` only in a container. Changing that needs the host, outside this row. Its e2e group stayed at `stop` as briefed; the fixture's 15 s e2e file stands in for a real Stop wait.
- **f2b and f2c reused f2a's results by key.** The same edit makes the same bytes, so the e2e failure arrived 0.1 s after the edit and the fix's pass before Stop. Correct, and kept as a record; from f2d each fixture session starts with a new store (`fresh`).
- **f2a's end memory read nothing**: the daemon exits seconds after its last session. From f2c the end reading is taken at the session's result event.
- **cezarion's whole unit baseline is slow here**: 1,220 test files, 4 at a time, with coverage on (its own configuration), about 300 files in 12 minutes, and 780 test files read `effort.ts`. The sessions settle only the namesake test; edits run ahead of the backlog.
- **`pkill -f` matched my own shell** and ended the command, as 017-13 warned. Kill by pid.

## For the next worker

- A session that should exercise Stop's wait must keep the agent from checking first: with the group named in status, agents ran `squeal run e2e --wait` themselves (f2a, f4). The `f2s` prompt asks it not to run tests.
- Results are shared by key across sessions in one clone. Use a new store, or tasks that write new bytes, when the wait or the first run is the thing measured.
- The heap reading opens the daemon's inspector for a moment; only one reader at a time can use port 9229.
