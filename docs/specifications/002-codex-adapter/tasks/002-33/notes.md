# 002-33: shipped fixed-plugin proof

2026-10-27. Worker against wave-6.md and spec 002 D7–D9. The committed adapter 1.0.0 and seed/current runtime 0.1.368 come from build commit `4c17e3f3409bc3614617331debb330389e0b4ed3`. The worker branched at `4c5d87037`. No product source, generated artifact, version, board or status file changed. No build, full suite, candidate review or release ran here.

## Results and their limits

| Requirement | Evidence |
| --- | --- |
| Direct install and first use offline | Real Codex 0.164.0 installs the exact tracked fixed plugin from a local marketplace into a scratch CODEX_HOME. Before `turn/start`, neither a pin nor retained seed exists. Its first real SessionStart retains all 36 seed files, including skill references, recorders/reporters and WASM assets, then pins 0.1.368. Retained file bytes match the seed; modes follow the runtime manifest's 0644/0755 normalization. No Node fetch occurs during bootstrap. |
| Startup budget | Real `hook/completed`: SessionStart completed in 107 ms, UserPromptSubmit 66 ms and Interrupt 61 ms at load 10.83. The cold turn, including explicit interruption after the expected offline connection failure, took 336.39 ms. SessionStart's 2,000 ms budget is asserted. These are individual observations, not a p95 claim. |
| Fixed-plugin approval persistence | The real shipped CLI publishes B via a locally injected transport. All 53 files inside the fixed plugin retain their byte hashes and modes, including seed, manifest and static skills. All ten hook records remain identical and trusted in the existing app-server and a fresh app-server. The scratch config remains byte-identical across publication. |
| A/B session identity | A is the shipped seed 0.1.368. B is a test-only 0.1.369 made from the committed current runtime, with textual runtime identity replaced and a new canonical manifest. Binary WASM files remain unchanged. The original real thread keeps its original pin through another turn; a new real thread pins B. Invoking the retained launcher with each real CODEX_SESSION_ID prints 0.1.368 and 0.1.369 respectively. B is not a real release. |
| Missing pinned runtime | Removing A's retained directory makes that thread's CLI exit 1 with `Start a new Codex session`. Another real turn produces `validation unavailable` from the approved hook. It does not switch to B. Plugin contents remain unchanged. |
| Current and seed behavior | Shipped-plugin scenarios separately exercise the bundled Claude Code CLI, Codex seed CLI, and retained current Codex CLI. Both Codex routes start the shipped daemon, run the project's real Vitest and deliver PASS -> FAIL on PostToolUse. The current route publishes the committed `plugins/codex-runtime` and executes its retained CLI, rather than the seed CLI. |
| Released format-7 migration | Exact released `squeal--v0.1.367` plugin bytes, tag object `258cf144228a5240ffb7fd682521f4d543a70038`, peeled commit `6709eb4d72d51d472a02602839c4d6d0c1f4c629`, are installed with real Codex from a loopback git marketplace. The actual format-7 terminal launcher runs the released CLI's `update`. Codex upgrades to the fixed plugin; the released CLI replaces the terminal launcher with format 8. That launcher then prints 0.1.368, and real `codex-runtime ensure/status/update` work. No restatement of the old copy algorithm or stub Codex command is used. |
| Real installer provisioning | The real `install.sh`, real Codex, seed CLI, runtime selector and terminal launcher run in a scratch home. Missing local release transport causes exit 1, retains a usable seed and prints no completion line. A rerun with the local release descriptor succeeds, exits 0 and installs the runtime launcher. The script input is the parent's exact correction at `3a14091da`, supplied through `SQUEAL_E2E_INSTALLER_COMMIT`; this worker does not edit install.sh. |

The offline turn uses an explicitly configured `gpt-6.1-sol` OpenAI Responses provider with a refused loopback URL, without auth. It runs real Codex startup and prompt hooks, observes the expected network error and interrupts the turn. It does **not** obtain or verify a successful model answer, model consumption of the primer, or an agent-issued CLI command. No model inference ran. No credential was read, copied or persisted. This closes the first-turn local bootstrap boundary; it does not replace the separate guarded model-session proof.

Node's fetch is replaced in scratch child processes by a test preload. It serves only exact descriptor/artifact URLs from local files and rejects every other URL. Thus release verification, staging, publication and the actual CLI are real, but GitHub transport and the B release identity are fixtures. Marketplace installation/upgrade uses real Codex and real git over loopback HTTP. No production trust/config file is written. Future update.json timestamps suppress ordinary fixtures' detached production update checks.

The installer asks for 0.1.368, which equals its seed. The real updater resolves that release descriptor and reports current without downloading an unnecessary artifact. The live A-to-B case downloads and validates the complete artifact. A configured local descriptor alone must not be described as an installer artifact download.

## Commands and actual output

All e2e paths below are excluded from Squeal and therefore run explicitly. No local full suite or full-suite checkpoint was requested.

```sh
SQUEAL_E2E_INSTALLER_COMMIT=3a14091da pnpm exec vitest run \
  test/e2e/shipped-plugin.test.ts test/e2e/codex-fixed-plugin.test.ts \
  test/e2e/codex-migration.test.ts test/e2e/codex-installer.test.ts \
  test/e2e/codex-upgrade.test.ts --maxWorkers=1 \
  --disableConsoleIntercept --reporter=verbose
```

Exit 0. `Test Files 4 passed | 1 skipped (5)`; `Tests 13 passed | 3 skipped (16)`; duration 22.84 s. Two skips are the Codex seed/current `bin/squeal` assertions: the fixed plugin exposes a retained launcher after first use, not a root bin/squeal. The unchanged legacy model-session test is skipped because this process is not the throwaway user `squeal-e2e`. Its test and separate legacy fixture remain intact.

```sh
pnpm exec vitest run test/e2e/transitions.test.ts test/e2e/lifecycle.test.ts --maxWorkers=1
```

Exit 0. `Test Files 2 passed (2)`; `Tests 10 passed (10)`; duration 60.53 s. Covers both harnesses using the shared fixture. An earlier transitions invocation started before the shared fixture correction was terminated; no passing result is claimed for it.

The live test was then strengthened to compare the entire retained seed inventory. Its first comparison rejected the source's group-write modes (0664/0775) against the store's intentional normalized modes (0644/0755). The comparison now uses the manifest's normalization. The B fixture also preserves binary WASM files rather than decoding them as text. A focused rerun of all three new proof tests verifies this final helper version; its result is recorded below.

```sh
SQUEAL_E2E_INSTALLER_COMMIT=3a14091da pnpm exec vitest run \
  test/e2e/codex-fixed-plugin.test.ts test/e2e/codex-migration.test.ts \
  test/e2e/codex-installer.test.ts --maxWorkers=1 \
  --disableConsoleIntercept --reporter=verbose
```

Final helper version: exit 0; `Test Files 3 passed (3)`; `Tests 3 passed (3)`; duration 10.93 s. Live evidence: cold turn 320.76 ms, load 4.44, SessionStart 94 ms, UserPromptSubmit 65 ms, Interrupt 66 ms; 53 unchanged plugin files, approvals 10 before/10 after, A CLI 0.1.368/B CLI 0.1.369, missing-pin CLI exit 1 and real hook diagnostic. Runtime publication requested exactly the B descriptor and artifact URLs through the injected transport. The installer requested the 0.1.368 descriptor twice, once failing and once succeeding. Released migration output included `Codex: squeal@hearsay 1.0.0, was 0.1.367` and `Copied the launcher (format 7, now 8)`.

`pnpm run lint`: exit 0, `Checked 2515 files in 925ms. No fixes applied.` `pnpm run typecheck`: exit 0, `$ tsc --noEmit`. Scoped Biome formatting and `git diff --check` also pass. Final post-edit results are recorded below.

Final post-edit `pnpm run lint`: exit 0, `Checked 2514 files in 740ms. No fixes applied.` Final `pnpm run typecheck`: exit 0, `$ tsc --noEmit`. The earlier interrupted transitions run left one owned fixture daemon; it was explicitly terminated during cleanup. No active completed proof fixture remains.

`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` over all nine changed e2e paths: exit 3 at revision 29. Every e2e path is explicitly reported `Not run by Squeal`; the selected `test/version-sensitive.test.ts` has a current passing result. Exact ending: `the test files selected at revision 29: no known failures; 1 test file, each with a current result, after 2.7 s.` Whole-worktree state then had 2 known baseline failures and 282 of 1303 files not current (2 queued, 280 unknown). Those excluded paths' direct results above are their proof, not this indirect one-file verdict.

Final required affected-path read after the helper changes: exit 3 at revision 37 for the same excluded-path reason. `the test files selected at revision 37: no known failures; 1 test file, each with a current result, after 1.3 s.` Whole worktree: 8 known baseline failures, 255 of 1303 test files unknown; none queued in that report. The eight failures are the two earlier parent corrections and six bundled-lint path assertions below. Their parent-side fixes are outside this worker branch. No pending or unknown result is claimed as passing.

## Parent-owned baseline corrections

- `test/node-floor.test.ts` expected four top-level launchers; the integrated runtime makes five. Parent fixed it in `27f5ee659` and reported recovery.
- `install.sh` still named 0.1.367 against root 0.1.368. Parent fixed it in `3a14091da` and reported recovery. The real installer proof deliberately reads that exact script commit without changing this branch's product files.
- Squeal later reported six baseline Codex failures in `test/lint/cli/bundled.test.ts`. It still executes `plugins/codex/dist/cli/squeal.mjs`, removed by the fixed-plugin layout. Parent was notified before any cross-file edit; parent owns the correction to `plugins/codex-runtime/dist/cli/squeal.mjs` and its verdict. This worker leaves it alone.

These baseline failures are not product defects discovered by the shipped boundary. The worker's branch is not a claim that the whole repository is green. Parent integration and candidate review remain required.

## Ownership, types and continuation

Owned changes: `test/e2e/plugins.ts`, `shipped-plugin.test.ts`, new focused `codex-*` tests/helpers, these notes, and appended lessons. Parent explicitly approved the narrow `test/e2e/harness.ts` correction in reply to request `36a2bdaa-3e67-4e9a-9277-b3e759f91a1e`. Its separate commit records that agreement. Other rows retain all product source, packaging, updater, installer, generated output, version claims, board and status files.

No product type changed. Test-only `copyPlugin` accepts the additional `codex-runtime` tree. New helpers export scratch environment/update suppression, real app-server RPC, real git marketplace serving, whole-tree snapshots and local release fixtures. Existing Plugin interfaces and hooks are unchanged.

Seams for the next worker: fixed hooks resolve `PLUGIN_DATA/runtime/sessions/<sha256(sessionId)>.json`; retained runtime/skills live in `PLUGIN_DATA/versions/<version>`. Ordinary fixture hooks need isolated PLUGIN_DATA plus a future update.json. The shared fixture's seed CLI and the dedicated current-runtime case intentionally use different concrete CLI paths. Codex adds scratch project trust on first thread creation, so take the no-write publication snapshot after that step. Host `/home/agent/.local/bin/codex` is a compatibility wrapper that finds the next Codex on PATH; an installer fixture with a reduced PATH must use the real Node-install Codex entry or `SQUEAL_E2E_CODEX_BIN`.

Commits: `ec5b687cc` (shared fixture, by parent agreement), `5935d7c3b` (isolated fixed-plugin fixture), `1dd5a6a6b` (shipped/live/installer/migration tests), `9fdecc815` (complete retained seed and binary-preserving fixture). The notes/lessons commit completes this row's deliverables. No unsettled product decision or product type change was needed. Parent still owns integration, the fresh pinned candidate review, exact release CI and any release. This worker cannot accept that review.

Parent integration: the three real-Codex tests skip explicitly when `codex --version` is unavailable. CI does not install Codex. Local installed-Codex proof remains mandatory for this release and ran before candidate review.

Parent post-integration check: the three guarded real-Codex tests ran (none skipped), 3/3 passed in 10.64s using current install.sh without an override. Lint/typecheck pass. Squeal affected read at revision 58 exits 3 for excluded e2e paths; its selected version-sensitive file is current/pass. Worktree known failures 0, 216 unknown lookup-only files; all 911 re-keyed files were current at revision 56. Child-process coverage warnings for adapter readStdin and the async entry callback are not measured in-thread; real child/live proof exercises those entry paths.
