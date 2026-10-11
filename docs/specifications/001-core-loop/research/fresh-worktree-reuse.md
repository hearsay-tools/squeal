# Fresh worktree at main's commit: does it reuse main's results? (001-218)

Researcher, 2026-10-11, wave 13ac. Brief: `tasks/wave-13.md`, "001-218 confirm a fresh worktree at main's commit reuses main's results". Probes: `probes/fresh-worktree-reuse/` (throwaway).

Setup. The cezar repository at `/home/agent/projects/cezar`, local `main` at `c07b0bfc`, which is also the main checkout's HEAD. The main checkout's store result set: revision 33, 13806 passing results, full-suite checkpoint completed. Three scratch worktrees, detached at `c07b0bfc` under this task's temp directory, each set up with `npm ci` the way Cezarion's `worktreeSetup` does (`npm 11.19.0`, Node `v24.21.0`, Vitest `4.1.10`). Squeal ran from pinned copies of the hub bundles 0.1.110, 0.1.99 and 0.1.94. No human worktree, store row or daemon was written; the main checkout was only read (`squeal status`, `squeal why`, read-only SQLite). All three scratch worktrees were removed afterwards. Load average: 1.6 at the start, about 30 to 43 during the baselines, 68 at the end from other waves.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | On 0.1.110, does a fresh worktree at main's commit inherit the main checkout's current results? | No. 0 of 651 test files: `Inherited from other worktrees: none`. | verified by experiment |
| 2 | Which key input differs? | Two inputs. (a) Key format: main's results were written by 0.1.99 (`KEY_FORMAT_VERSION` 2); 0.1.110 keys under 4. This is expected, once per format bump. (b) **The launching harness's environment**: Vitest folds std-env's `isAgent` and `isCI` into the resolved config, which is in every project's environment hash. A Claude-launched daemon and a Codex-launched one never share a key. | verified by experiment |
| 3 | With version and launch env equal, does a fresh worktree reuse another worktree's results? | Yes. 0.1.99 with the agent variables unset: 644 of 651 keys equal main's, **13712 results inherited from the main checkout**. 0.1.110 to 0.1.110: S3 inherited **15003 results** (641 of 651 files) within seconds of starting. | verified by experiment |
| 4 | What still misses at equal version and env? | 10 of 651 files: 4 that observe `.git`, 2 whose observed set holds `node -e` arguments, 3 held inherited failures (by design, task 001-170), and 1 whose source run had not finished. | verified by experiment, read in source code |
| 5 | Was defect 3 (0 of 651 matched, session 1a9234b5) the Squeal version alone? | No. 1a9234b5 is a Claude Code session; the main checkout's daemons were Codex-launched. Input (b) alone yields 0 of 651, with or without the 0.1.86 version in the hash. | inferred |

## Findings

**Q1 and Q2a: 0.1.110 matches nothing in the main checkout.** S1, a fresh worktree whose daemon the released plugin's own hook started (0.1.110), keyed 651 files and shared no key with any worktree in the store. That includes the live 0.1.110 worktree at `0fa4e345`. The main checkout's results date from 2026-10-10 18:13 to 21:03 UTC. The 22 Codex sessions rooted at the main checkout from 20:13 local time on loaded `squeal/0.1.99`, a grep of `~/.codex/sessions/2026/10/10/*.jsonl` for the plugin path. The bundles say `KEY_FORMAT_VERSION = 1` (0.1.94), `2` (0.1.99), `3` (0.1.107) and `4` (0.1.110). So 0.1.110 cannot match main's rows, and no worktree at `c07b0bfc` has re-run under format 4. The main checkout's contract check `attention.test.ts` has carried 21 different keys since 2026-10-06, one per release before 001-199 (`squeal why`).

**Q2b: the environment hash follows the launching harness.** S2 at the same commit, re-keyed with 0.1.94 and then 0.1.99 from this Claude session, still matched 0 of 651. Copying in the main checkout's untracked and ignored files (`squeal.config.json`, `.claude/`, `.opencode/`, `notes.md`, `packages/cezar/dist/`, `packages/cezar/web/`, `packages/cezar/README.md`) changed none of S2's keys. The installed-dependency fingerprint is the same in all three checkouts (`ef6adaab9a39`, hidden lockfile byte-identical and trusted; `deps-probe.ts`). The environment probe (`env-probe.ts`, which calls 0.1.110's own `createVitestAdapter(...).environment()`) gives identical inputs for S1 and S2 under one env. Unsetting `CLAUDECODE`, `CLAUDE_CODE` and `AI_AGENT` changes every project's `resolvedConfig` hash and its package-set hash. `CI=1` changes every `resolvedConfig` as well (`evidence/`):

- no agent: `"isAgent": true` becomes `false`;
- `CI=1`: `allowOnly` true becomes false, `browser.headless` false becomes true, `browser.ui` true becomes false, `browser.screenshotFailures` false becomes true, `watch: false` is added.

The decisive run: S2 re-keyed by 0.1.99 started with those three variables unset matched **644 of 651** of main's keys. The contract check's key is `ea80f8c9f70f`, the same as main's, and status reads `Inherited from other worktrees: 13712 current results / 13712 from /home/agent/projects/cezar at c07b0bf`. So the main checkout's Codex-launched daemon saw no agent. Why Codex's hook env carries none of std-env's markers (`CODEX_SANDBOX`, `CODEX_THREAD_ID`) is not determined; no Codex-launched daemon was running to inspect.

Where it comes from, Vitest 4.1.10 (`node_modules/vitest/dist/chunks/`). The serialized config carries `isAgent` (`cli-api.BK8pd4xc.js:9271`), used by workers only to turn colours off (`init.k9zZ9sLh.js:219`). A project with no reporters gets `[isAgent ? "agent" : "default", {}]` (`coverage.DM_a_rWm.js:455`). `allowOnly: !isCI` is in `defaults.9aQKnqFk.js:46`. `browser.headless ??= isCI` and `browser.ui` are in `coverage.DM_a_rWm.js:490-495`. Squeal hashes `project.serializedConfig` whole (`src/runners/vitest/environment.ts`, `canonicalConfig`). Its `namedByConfig` (`src/runners/vitest/packages.ts:155-159`) also reads the built-in reporter names `agent` and `default` as package names, which is why the package set moved too. Spec D3 keys environment variables only through `env.allowlist`; this path keys two of them by the back door. (Read in source code.) In `isAgent`'s case, nothing that decides PASS or FAIL depends on it. `allowOnly` does: under `CI` a `.only` fails.

**Q3: reuse works when version and env agree.** Two fresh 0.1.110 worktrees at the same commit agreed on 647 of 651 keys before either ran a test. S1 then inherited 3315 results from S2 while both baselines ran. S3, created after S1's baseline (650 of 651 files done), reported `Inherited from other worktrees: 15003 current results`: 11688 from S1 and 3315 from S2. In the store, linked cezar worktrees also share keys with each other: `e820bb25` is held by 3 worktrees, `c9d3f554` by 3. The main checkout shares no key with any of them.

**Q4: the residue, per file.**

- `.git`, 4 files (`server/application-update`, `automations-api`, `preview-socket`, `task-webhook-api`). cezar's `packages/cezar/src/workspace/projects.ts:250` stats `<root>/.git`, and the observed sets (spec D3, task 001-132) hold `.git` for these 4. In a linked worktree `.git` is a file, `gitdir: <common>/worktrees/<name>`, different in every worktree. In the main checkout it is a directory, which `observedInputs` leaves out (`src/runners/observe/inputs.ts`). So these keys never match across worktrees. (Verified by experiment: `closure-diff.mjs` shows `.git` as the only differing closure path.)
- `node -e` arguments, 2 files (`ci-wait/process`, `ci-wait/supervisor`; 337 entries across 4 files). The recorder records `process.argv[1]` as a child's entry point (`src/runners/observe/recorder.cjs:209-210`). For `node -e <code> <json>` that is the first argument: cezar's test passes `JSON.stringify({file, args})`, so entries like `{"file":"/home/agent/.nvm/.../node","args":["/home/agent/projects/cezar/.ai/cezar/worktrees/0514bb3c-.../gh.mjs",...]}` become "paths". They carry each worktree's absolute path, so every run in a new worktree grows the shared set and re-keys these files everywhere (`observed-stats.mjs`). Read in source code, with the store as evidence.
- `artifacts/cli.test.ts` observes 85 `absent-runs/<uuid>-artifacts` paths, one per run. Its set grows on every run, so its key moves after each run. It was inherited in S3 only because nothing had run it since S1 keyed it. It also observes `.ai/cezar`, which only the main checkout has.
- 3 files whose S1 result under the same key was a FAIL (two 5 s timeouts at load about 30, one assertion) were re-run, not inherited: spec 001, "An inherited fail stands only once the receiving worktree confirms it" (task 001-170). By design.

## Recommendation for Squeal

One fix row, from Q2b. A daemon's keys must not depend on which harness started it. Keep std-env's detection out of the environment hash. Two options, and the tradeoff decides:

1. **Normalize the daemon's environment.** The daemon removes the agent markers std-env reads (`CLAUDECODE`, `CLAUDE_CODE`, `CODEX_SANDBOX`, `CODEX_THREAD_ID`, `AI_AGENT`, `OPENCODE`, `CURSOR_AGENT`, and the rest of std-env 4.2.0's list) before creating Vitest, so runs and keys are the same from every harness. It also changes what tests see. A cezar test that reads `CODEX_THREAD_ID` would behave differently, which D3 already accepts for unlisted variables.
2. **Leave it out of the key only.** `canonicalConfig` drops `isAgent`, which is display-only in Vitest 4.1.10, and `namedByConfig` skips Vitest's built-in reporter names. Tests still see the harness, and keys agree. CI-derived fields stay keyed, since `allowOnly` changes outcomes.

Option 2 is narrower and keeps D3's "unlisted env is not keyed" boundary intact. It needs a version guard, so that a future Vitest field derived from the environment is noticed. Either option is a key change, so it ships with a `VITEST_ADAPTER_VERSION` bump. Proposed row:

> **001-2xx keys do not depend on the launching harness.** Shape: repair. A daemon started from a Claude Code session and one started from Codex, at one commit with one install, compute the same keys (red before: 0 of 651 on cezar; `research/fresh-worktree-reuse.md`). Own `src/runners/vitest/environment.ts`, `src/runners/vitest/packages.ts`, `src/runners/vitest/version.ts`, `test/vitest/`. Done when a test creates the adapter twice, with and without `CLAUDECODE`/`AI_AGENT`/`CODEX_THREAD_ID`, and gets equal environments; `CI=1` still re-keys; the adapter version is bumped; lint, typecheck and the full suite are green.

Smaller, for the coordinator to weigh. The coordinator decides whether these become rows; they are not drafted here:

- The recorder's `argv[1]` under `node -e` or `-p`. Record it only when the child ran a script, by checking `process.execArgv` for `-e`/`--eval`/`-p`/`--print`. Today it fills shared observed sets with argv strings and absolute paths of other worktrees, and re-keys those files everywhere after each run.
- `.git` as an observed input. Its content names the worktree, as the root path does, and the root path is never keyed. Keying `.git` by kind (file, directory, absent) instead of bytes would let 4 cezar files inherit.
- Per-run unique absent paths (`absent-runs/<uuid>-...`) grow a set without bound. This is cezar's test, but Squeal could cap or collapse absent observations.

The main checkout itself will match a fresh 0.1.110 worktree only after its own daemon re-keys under format 4 from the same kind of harness. Nothing in the store needs a migration.

## Open questions

- Why Codex's hook env has no std-env agent marker. A Codex version that sets `CODEX_THREAD_ID` for hooks would flip every Codex-started key. Not determined: no Codex-launched daemon was live to read `/proc/<pid>/environ`.
- Whether option 1 or 2 is wanted. That is a design decision for the coordinator; the spec D3 text above favours 2.
- Whether the 3 timeouts S1 recorded at load about 30 are flaky under load. Out of scope here (001-182 territory).

## Sources

- Store: `/home/agent/projects/cezar/.git/squeal/store.sqlite`, read with `node:sqlite` read-only (`probes/fresh-worktree-reuse/store-query.mjs`). Tables `worktrees`, `test_file_keys`, `results`, `runs`, `checkpoints`, `revisions`, `meta` (`observed.server`).
- Squeal bundles: `~/.claude/plugins/cache/hearsay/squeal/{0.1.94,0.1.99,0.1.107,0.1.110}/dist/cli/squeal.mjs` (`KEY_FORMAT_VERSION`), pinned copies used to run the daemons.
- Squeal source at `8e5e5462` (key code unchanged since the 0.1.110 build `cb947c25`): `src/core/keys/environment.ts`, `src/runners/vitest/environment.ts`, `src/runners/vitest/packages.ts:149-162`, `src/runners/observe/inputs.ts`, `src/runners/observe/recorder.cjs:208-211`, spec 001 D3 and task 001-170 text.
- Vitest 4.1.10 and std-env 4.2.0 under the scratch worktree's `node_modules` (from `package-lock.json` at cezar `c07b0bfc`): `vitest/dist/chunks/coverage.DM_a_rWm.js:300,455,490-495`, `defaults.9aQKnqFk.js:46-48`, `cli-api.BK8pd4xc.js:9271`, `init.k9zZ9sLh.js:219`, `std-env/dist/index.mjs` (agent table).
- cezar at `c07b0bfc`: `packages/cezar/src/workspace/projects.ts:250`, `packages/cezar/src/ci-wait/process.test.ts:17`, `vitest.config.ts`.
- Session logs, read for the plugin path only: `~/.codex/sessions/2026/10/10/*.jsonl` with `"cwd":"/home/agent/projects/cezar"`; `~/.claude/projects/-home-agent-projects-wiktor/1a9234b5-*.jsonl` (exists, so 1a9234b5 was Claude Code).
