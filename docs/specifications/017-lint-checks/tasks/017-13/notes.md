# 017-13: dogfood notes

Worker 4a90e840, 2026-11-01, 20:44Z to about 22:00Z. The results are in `../../lessons.md`, "Round 1 (017-13)". These notes are the residue: how the round ran, where the raw data is, and what to know before running such a round again.

## Isolation and setup

| Item | Value |
| --- | --- |
| OS user | `squeal-e2e` (uid 1002). Every clone, install, daemon, CLI run and model session ran as that user through `bin/as-e2e.mjs` (015-10 Part C's helper, unchanged but for its header): `sudo -n [--preserve-env=ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN] -u squeal-e2e -H env HOME=… PATH=… sh -c 'cd "$1"; exec "$@"'`, cwd `/`. Credentials by name only. `E2E_VAR_<NAME>` passes one more variable, which is how saas got `ESLINT_FLAGS`. |
| Case root | `/home/squeal-e2e/runs/d1713`, with its own `home`, `tmp`, `claude` (`CLAUDE_CONFIG_DIR`), `xdg`, `corepack`, `pnpm-store`, `bin`, `snap/<session>` (file snapshots) and `compare/` (CLI comparisons). |
| Scratch | `/tmp/dogfood-017-13/w-4a90e840`: `bundles/`, `src/svelte` (the GitHub clone the bundle came from), `bin/` (a copy of `bin/` the e2e user can read), `bases.json`, `logs/` (see below). |
| Squeal | 0.1.390: `git archive squeal--v0.1.390 plugins/claude-code .claude-plugin`, the marketplace renamed `hearsay`, installed at user scope (`bin/setup.sh pin install`). `squeal --version` printed 0.1.390. |
| Harness | Claude Code 2.1.300, `claude -p --model sonnet --output-format stream-json --verbose --include-hook-events --permission-mode bypassPermissions`. |
| Node | `/opt/squeal-e2e/node24` (24.21.0) for everything. |
| saas | Bundle of `refs/remotes/origin/release/next` at `b36f7150` from `~/projects/saas-bp-management-dashboard` (read only). `corepack pnpm install --frozen-lockfile` (pnpm 10.26.2). Its postinstall rebuilds `packages/internal/cli` and rewrites the tracked `tsconfig.tsbuildinfo`; restore it with `git checkout` after each install. Base commits on the local branch `dogfood`: `04a3069b` lint on; `9fb61e4f` `.npmrc` with `public-hoist-pattern[]=*eslint*` and `*prettier*`. Changing the hoist pattern needs `CI=true` for pnpm to rebuild `node_modules` without a TTY. A commit runs the repository's husky and lint-staged hooks; `--no-verify` skips them. |
| Svelte | `git clone https://github.com/sveltejs/svelte`, branch `dogfood-base` at `356c8766a`, bundled. pnpm 10.33.4, ESLint 10.0.0, typescript-eslint 8, TypeScript 5.5.4. Base commits: `08cbe64dd` lint on; `5672f971` the TODO rule `@typescript-eslint/no-unused-vars` as a warning in `packages/svelte/src/compiler/**/*.js` (`bin/svelte-warn.cjs`). |

## Order of events

1. 20:47Z, saas first start: `eslint.config.js does not load: Cannot find module '@eslint/js'` (L1). `node_modules/.bin/eslint` works, `node node_modules/eslint/bin/eslint.js` fails: pnpm's shim sets `NODE_PATH`.
2. 20:50Z, `pnpm add -D -w @eslint/js@9.39.2` while the daemon ran: no recovery in 2 min 35 s (L2). `logs/firstpass/saas-noload/recovery-check.txt`.
3. A second undeclared module (`jsonc-eslint-parser`) failed the same way, so the `@eslint/js` commit was dropped and the hoist pattern used instead.
4. 20:52Z, Svelte first pass. 20:55Z, saas first pass with the root config (`logs/firstpass/{svelte,saas}`).
5. The root config turns no rule on for TypeScript (its `FlatCompat` blocks set `rules: {}`); `nx lint` uses each project's config (read in `@nx/eslint`'s `lint.impl.js`: `findFlatConfigFile(projectRoot)`, then `overrideConfigFile`). `v10_config_lookup_from_file` (the old name `unstable_config_lookup_from_file` is inactive in 9.39) gave the per-project rules. A restart with the flag re-keyed every file by itself (the computed configs changed).
6. 21:00Z, saas first pass with the flag, after moving `lint.sqlite` aside to `/home/squeal-e2e/runs/d1713/aside/saas-root-config/` (`logs/firstpass/saas-flag`). `bin/compare.mjs` found the 12 false findings; `bin/repro-cwd.mjs` reproduced them from `.git/squeal` (`logs/repro-cwd.txt`) (L3).
7. 21:04Z, the Svelte config change, measured as a pass of its own (`logs/firstpass/svelte-config`).
8. 21:07Z to 21:45Z, the sessions: v1 and s1 alone, then `bin/run-repo.sh` for each repository in parallel.

## Scripts (`bin/`; they ran from `/tmp/dogfood-017-13/w-4a90e840/bin` or this folder)

| Script | What it does |
| --- | --- |
| `as-e2e.mjs` | Runs one command as `squeal-e2e` in the case root. |
| `setup.sh` | Steps `dirs`, `pin`, `bundles`, `clone`, `deps`, `install`, `lint-on`. |
| `firstpass.mjs <repo> [<name> <cmd>…]` | Starts `sampler.mjs`, then `squeal start` (or `<cmd>`), and polls `squeal status --json` until lint has nothing pending. Its "done" test was too early for a trigger that edits a file (the 2.8 s Svelte config result); read the poll file, not `doneS`, for those. |
| `sampler.mjs` | Every 250 ms: the daemon's threads from `/proc/<pid>/task/*/stat` (name, CPU, start) and its VmRSS and VmHWM. The lint worker is the `WorkerThread` that starts when the first lint is due; a second one with 0.05 s of CPU is another of the daemon's workers. |
| `session.mjs <id>` | One session: reset to the base, `squeal start`, wait until lint keyed the latest revision with nothing pending or stale, load gate, `sampler.mjs` and `snap.mjs`, `claude -p`, then the same wait with a `squeal start` at each read (the daemon exits 3 s after the session), then the diff, `squeal lint`, the store's transitions, revisions and states, and the transcript. A lock per clone. |
| `snap.mjs` | As `squeal-e2e`, watches every tracked folder and keeps every version of a written file by its git blob hash. |
| `store.mjs` | Reads `lint.sqlite` and `store.sqlite` read only: `meta`, `counts`, `cursor`, `list <outcome>`, `transitions`, `states`, `revisions`. |
| `compare.mjs` | One CLI run over the repository against every state and finding Squeal holds. |
| `verify.mjs` | With the daemon stopped: for each transition, writes the session's changed files as they were at its revision and at the file's previous one, runs the CLI on the file, and compares outcome, added and removed; then puts the final bytes back and runs the CLI on each changed file. |
| `run-repo.sh` | Sessions of one repository, each followed by `squeal stop` and `verify.mjs`. |
| `svelte-warn.cjs` | The Svelte base's config edit: the TODO rule as a warning in the compiler. |
| `closure-reg.mjs`, `closure-hook.mjs` | `node --import closure-reg.mjs -e "await import('eslint-plugin-svelte'); await import('svelte/compiler')"` prints each project file the imports load: 233 in Svelte (L9). |
| `report.py`, `summary.py`, `threads.py` | A session's timeline with per-edit worker CPU; the lint lines with the edit before each and the agent's next action; a pass's CPU per thread and RSS. Run them with `python3 -I -B`. |

Outputs per session are in `/tmp/dogfood-017-13/w-4a90e840/logs/sessions/<id>/` while the host keeps `/tmp`: `stream.jsonl`, `transcript.jsonl`, `meta.json`, `samples.jsonl`, `transitions.jsonl`, `revisions.jsonl`, `states.jsonl`, `lint-*.txt|json`, `diff.patch`, `snap-log.jsonl`, `verify.json`. The runner output is `logs/run-<id>.out` and `logs/verify-<id>.out`.

## What went wrong, and how it was handled

- **The settle wait read old state.** A status read right after an edit can show the state before it; the first config-change measurement stopped at 2.8 s. The wait now also requires lint's cursor at the latest revision, or five clean reads in a row when a revision changes no linted file.
- **The daemon exited after each session** with lint work pending (v1, s1). I started it again by hand for those two; from the next sessions the runner does it. In s1 the restart's re-key means the 19.5 s of worker CPU after the session includes a full re-lint, not only the idle one.
- **`pkill -f` matched my own shell twice** and ended the command. Kill by a pid read from `ps` instead.
- **Two files written to `/tmp` as `squeal-e2e`** (`/tmp/x.json`, `/tmp/x.err`) by an early probe command were removed at once; later probes write to the case `TMPDIR`.

## For the next worker

- After a reset or checkout, start a daemon and wait for lint's cursor, not only for `pending: 0`.
- One session per clone at a time (`session.mjs`'s lock).
- `claude -p` turns are short: the agents' turns ended 2 to 5 s after their last edit. To see what an agent does with a lint line, give the task a step after the edit; a `git diff` request did not do it (s5's agent put the diff in its final message).
- Svelte as of 0.1.390 needs L4 fixed before its edits are judged; saas needs the `.npmrc` hoist and `ESLINT_FLAGS=v10_config_lookup_from_file` until L1 and L7 are fixed, and its import findings are wrong until L3 is.
- At 21:46:38Z, after the last session, `squeal stop` in both clones found no daemon running, and `ps -u squeal-e2e` listed no process. The case root, with both clones and their `node_modules`, stays as evidence: 5.3 GB.
