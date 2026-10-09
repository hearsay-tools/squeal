# Throwaway hook-levers probes

Research only. **Do not install these handlers.** `hook.py` deliberately uses broad substring matching to expose harness semantics, including a pilot piped command. It is not the safe command matcher recommended in the findings. No product code changed.

## Setup and replay

All fixtures, settings, daemon stores, binaries and fetched source lived beneath `/tmp/squeal-hook-levers-4f3e9ac9`. Real HOME was retained for authentication; no credential was read, copied or logged. Parent `CLAUDE*` and `CEZ_*` environment variables were removed. `DISABLE_AUTOUPDATER=1`. The final clean repeats also remove inherited Codex session/thread identifiers. No settings were written to a real user directory or project.

Pinned inputs:

- `git archive 9848df0571da95cdfd0fe7b8303873deb0fa8414 plugins` extracted to the scratch root; Squeal 0.1.67. Claude `--plugin-dir` points to the copy; Codex session flags declare copied hooks with expanded paths and disable installed plugins. The hooks used trust bypass only in these test invocations.
- Claude 2.1.295 native executable copied into the scratch root, model `claude-sonnet-5-5`; Codex 0.160.1 native executable **and its sibling `codex-code-mode-host`** copied there, default configured model `gpt-6.1-sol`. Binary and plugin hashes: `logs/pins.json`.
- A full copy of the same repository commit under `repo/`, `npm ci --ignore-scripts`, supplies Vitest 5.0.3 via fixture `node_modules` symlinks. Each fixture is its own git repository with one passing test. Daemons and stores are independent from the product checkout. `substitute.py` changes its own test to fail and records executions outside its fixture's root.
- Subject shell permissions are deliberately different by harness: Claude normal approval mode with a small allow-list; Codex full-access/bypass mode as used by earlier research on this host. This measures rewrite support, not permission parity.

To replay in another disposable root, change `ROOT` in `probe.py`, adjust the explicit pinned paths in `clean.py`, prepare the copies above, and copy `probe.py` and `hook.py` into that root. Run only the chosen matrix once; it uses the entire 40-session budget. Drivers:

1. The initial three sessions: `probe.py claude rewrite 1`, `probe.py claude allow 1`, `probe.py codex allow 1`.
2. `batch.py claude` and `batch.py codex`: 16 and 12 more sessions, respectively, sequential within each harness. These may run concurrently with each other.
3. `ifbench.py`: 3 Claude sessions, 8 `pwd` commands and 1 matching command each. Plugin hook launches provide the common baseline.
4. `clean.py`: 6 Codex repeats with an explicit pinned-copy instruction; same prompt within that group.
5. `substitute.py`: non-model CLI probe; no subject sessions. `collect.py`: preserves relevant events, hook inputs, warmup output and cost meters; omits unrelated skill bodies and initialization metadata.

The shell-spawn microbenchmark ran `sh -c true`, the copied D9 fast gate ending in `true`, and `node -e 0`, 100 times each in `bench-sh` after its Squeal config was removed; durations use `time.perf_counter()`. It measures process cost, not internal `if` evaluation latency. Results: `logs/cost.json`.

The primary prompt is in `probe.py`: explicitly run exactly `npx vitest run`, no pipes/chains, then report what actually executed. Stop fixtures use `baseline.onStart: lookup-only` and `stop.requireFullSuite: true`, without warming a checkpoint. Other fixtures start a daemon and complete a checkpoint first. Claude settings are written after warmup, so registration records revision 1, with current reused results but the prior checkpoint at revision 0. Codex stays at revision 0. These differences are visible in the retained warmup logs.

## Limitations and exclusions

- `claude-rewrite-1` was a pilot with the earlier prompt permitting pipes; Claude chose `npx vitest run 2>&1 | tail -50`, which the intentionally broad handler replaced. Excluded from the standard rewrite count. Subsequent prompts explicitly disallow pipes/chains.
- `codex-allow-1` copied the CLI without its code-mode sibling and executed no shell calls. Excluded from behavior conclusions, included in spend and the 40-session ceiling. The sibling was copied before the next Codex session.
- Despite plugin-disable flags, the first Codex matrix still surfaced global skill paths. Its read Squeal 0.1.62 skill body is byte-identical to the pinned 0.1.67 body (hashes retained), but this does not establish full isolation. `codex-stop-8` also ran **one live 0.1.62 status CLI** against its own throwaway store: exclude it from pinned behavior counts. A scan of all command events found no other live Squeal CLI execution. `codex-stop-13` used pinned CLI commands but read the global, identical skill body. The clean repeats explicitly ban reading or executing the installed copy, disable the named skill via session config, and visibly read only the copied Squeal skill. The remaining global superpowers skill exposure is held constant, not a clean-room harness.
- Initial subjects inherited Codex session/thread IDs. In Claude hook status this added an irrelevant “no Codex consumer” note. Hooks identify their actual consumers from stdin; the clean repeats strip those variables. Do not read the note as a failed Claude registration.
- The banner explains reuse; it does not falsely claim the original command ran. The “0 test files” wording is the shipped CLI's own output, not a fabricated fixture response.
- Cold/unknown/no-install timeout recovery, interactive approval UI and editing-session adoption were not measured. Recommendations about matching and fallback are explicitly inferred from contracts and scope.

## Cost and sessions

Exactly **40** subject sessions: 18 Claude matrix/pilot, 3 Claude filter benchmarks, 19 Codex including the failed pilot and 6 clean repeats. Total subject wall time summed across overlapping sessions: **814.957 s**.

Claude's reported total: **$0.3454862** (list-price meters, rounded $0.345486 in summaries). Codex JSON reports usage, not billed dollars: **1,099,357 input tokens**, of which **862,720 cached**, **6,916 output tokens**, with **345 reasoning output tokens** reported separately. Codex dollar cost is **not determined**, because this configured provider did not expose a monetary meter; no price was invented. Per-session timing and usage are in `logs/sessions.json`; `events.jsonl` contains each session's command evidence and final answer, keyed by `session`; `hooks.jsonl` and `warmups.jsonl` retain hook inputs and initial evidence. The retained Claude result meters provide the unrounded costs.

## Verification

Checks ran on the isolated repository copy at the same product commit, to keep builds and installs out of this worker's unowned files. An initial test invocation against a bare `git archive` extraction was abandoned after failures showed that e2e fixtures require an actual git repository. The extraction was initialized and committed before the completed full run below. No product change was made to address test failures.

```text
$ npm run lint
> squeal@0.1.67 lint
> biome check .
Checked 667 files in 182ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.67 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.67 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.67 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

$ npx vitest run
Test Files  2 failed | 288 passed | 1 skipped (291)
     Tests  2 failed | 2188 passed | 13 skipped (2203)
    Errors  1 error
  Duration  217.82s (tests 95%, transform 4%, import 1%)

$ npx vitest run test/harness/step-down.test.ts test/runners/node-test/fixtures.test.ts
Test Files  2 passed (2)
     Tests  25 passed (25)
  Duration  12.39s (tests 80%, transform 17%, import 3%)
```

Lint, typecheck and build exited 0. `diff -qr` of each rebuilt plugin `dist` against the pinned pre-build copy produced no differences. Full Vitest exited 1: `step-down.test.ts:87` expected a step-down request but got none; `fixtures.test.ts:265` expected the generated node:test run's exit 0 but got 1; an unhandled EPIPE was attributed to step-down. Both files passed the focused repeat, exit 0. This suggests sensitivity to the full run/environment, but does not prove load as the cause or turn the full gate green. Full outputs are preserved in `logs/{lint,typecheck,build,vitest-git,vitest-focused}.log`.
