# 002-36: runtime identity and seed CLI retention

2026-10-27. Spec 002 D7 to D9 and `../wave-5-integration.md`. Source only. No committed build, version raise, release or full-suite request.

## Changes and seams

- `src/core/daemon/codex-runtime-version.ts`: additive `codexRuntimeVersion(plugins, marketplace): string | null` reads the runtime a new session can select. It uses `runtimeReadiness`, chooses usable current or a newer usable seed, and writes nothing. A fixed adapter's version never enters the runtime comparison. `src/core/daemon/version.ts` keeps `codexNewest` and its existing adapter/cache discovery behavior.
- `src/core/ps/flags.ts`: `olderOf` uses the runtime reader for Codex. Setup's `src/cli/setup/harnesses.ts` keeps `codexNewest`; it needed no edit. Claude Code keeps `claudeLoaded`.
- `src/harness/shared/version-copies.ts`: `keptCacheCli` also recognizes `<Codex cache>/<adapter>/seed/dist/cli/squeal.mjs`. It retains the seed through `src/harness/shared/seed-cli.ts` before returning the persistent concrete CLI path. Absolute `PLUGIN_DATA` takes precedence for this seed path; otherwise CODEX_HOME and HOME follow the existing locator.
- `retainSeedCli(root, data, version): string` checks the executing runtime version and calls the existing atomic `publishRuntime` with no `select`. The complete manifest inventory is retained, including skills, recorder/reporters and launcher. Current and session pins are unchanged. Pruning still protects current, pins, recent copies and process argv.
- `src/cli/start.ts`: a seed retention error exits 1 before daemon ensure/spawn. Its diagnostic says to restore data-directory write access or reinstall the plugin, then retry `squeal start`.

No existing type changed. The two functions above are additive exports. `keptCacheCli` keeps its string return type; seed failures now throw for `start` to report. Legacy cache retention and CLI paths outside Codex's cache keep their behavior. `SQUEAL_CLI` remains the explicit daemon override.

The seed import chain is `version-copies -> seed-cli -> adapter/store -> adapter/publish/manifest/layout`. Adapter modules import only their siblings and Node builtins. There is no reverse edge to shared/version-copies. Only ps flags import the runtime identity helper; generic version.ts imports no adapter module. The frozen adapter boundary check and real scratch CLI startup pass.

## Regression evidence

All verdicts below came through `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 <named-test-path>...`. No direct Vitest run or full-suite checkpoint was requested.

- Red at revision 1: `test/harness/shared/seed-cli-retention.test.ts` returned the cache seed path instead of the retained path. Green at revision 2 after complete publication.
- Red at revision 3: `test/ps/flags-codex-runtime.test.ts` reported `version 0.1.5; codex installs 1.0.0`. Runtime reader tests also failed before the new function existed. Both files green at revision 4.
- Red at revision 5: explicit PLUGIN_DATA was ignored; both start failure cases lacked a retry action. Green at revision 8 after the locator and diagnostic changes.
- `test/harness/codex/version-copies-start.test.ts` runs the real scratch-bundled CLI. The seed starts a daemon with argv naming `data/versions/0.1.900/dist/cli/squeal.mjs daemon <root>`. Removing the entire adapter cache leaves the same pid, which reaches ready. The retained runtime manifest, observe recorder and skill remain present. Its existing legacy startup test also passes.
- The complete-copy regression compares every required runtime entry and runtime.json, executes the retained CLI after cache removal, checks current/pin bytes, and ages copies so pruning must keep a pinned old runtime while removing an unpinned old runtime.
- Runtime identity checks cover seed-only, selected current, seed newer than current, unusable current/seed, an unselected newer retained version, legacy numeric ordering and Claude Code setup. Diagnostics stay read-only. The ps test keeps the existing live-old-session information state.
- Broad catch-up found a real regression in the initial identity placement: version.ts statically imported adapter/store, so five source-worker tests loaded RuntimeError's TypeScript parameter properties in Node's strip-only mode. `155619616` moves the reader to its own helper, outside those workers' import graph. At revision 14, `test/daemon/desk-guard.test.ts`, `focus.test.ts`, `nudge.test.ts`, `promote.test.ts` and `sync-readers.test.ts` all recovered FAIL to PASS. Their seven-file wait, including identity and ps, exited 0 with every named file current. No source-worker failure is deferred.

At revision 9 the following 13 files all had current results and no known failures: `test/harness/version.test.ts`, `test/harness/runtime-identity.test.ts`, `test/harness/shared/version-copies.test.ts`, `test/harness/shared/seed-cli-retention.test.ts`, `test/harness/codex/version-copies-start.test.ts`, `test/daemon/start-seed-retention.test.ts`, `test/harness/codex/adapter/frozen.test.ts`, `test/ps/flags-daemons.test.ts`, `test/ps/flags-codex-runtime.test.ts`, `test/cli/setup/codex-runtime.test.ts`, `test/cli/update-codex-runtime.test.ts`, `test/cli/update-pi.test.ts`, `test/cli/update-opencode.test.ts`.

After the boundary correction, the final focused gate at revision 14 included these 13 files and all five source-worker files. Output: `Named test files at revision 14: no known failures; 18 test files, each with a current result, after 12.2 s.` Exit 0. The whole worktree then had three current generated-drift failures, 781 queued and 217 baseline-unknown files; broader results were still pending.

`pnpm run lint`: initial format/import failures in the new code were fixed with scoped Biome formatting. Final output after the worker boundary fix: `Checked 2496 files in 1065ms. No fixes applied.` Exit 0.

`pnpm run typecheck`: `$ tsc --noEmit`, exit 0.

`node --disable-warning=ExperimentalWarning --import ./test/store/child/register-ts.mjs --input-type=module -e 'await import("./src/core/daemon/version.ts"); await import("./src/core/daemon/handlers.ts"); console.log("generic version and transitive desk handlers load in strip-only mode")'`: exit 0, printed `generic version and transitive desk handlers load in strip-only mode`.

`git diff --check HEAD~2 HEAD`: exit 0, no output.

## Limits and handoff

The broad affected-path command selected 808 test files and exited 3: `Named test files have no verdict: the deadline passed after 60.5 s: 772 test files still pending at revision 9`. Its current subset was 33 passing files and three files with expected generated drift. Across the whole worktree, Squeal reported 773 queued and 217 baseline-unknown files, with the catch-up lane waiting for its 120-second quiet interval. These are not passing claims. The named 13-file regression gate above is current. On 2026-10-27 the parent instructed this worker to settle with this precise limit rather than wait indefinitely; it owns final combined affected checks.

A second 60.5-second affected-path wait also exited 3, at revision 11: 772 selected files still pending. The whole worktree then had 200 files in the running tier, 573 queued and 217 baseline-unknown. Seven known failures remained, all generated drift. Catch-up had started; its unreported results are not claimed as passes.

After the source-worker correction, the final affected-path wait included all six changed source paths, including the new identity helper. It exited 3 after 60.6 s at revision 16: 780 selected files pending, 28 current passing files. Worktree totals were three current generated-drift failures, 200 files in the running tier, 581 queued and 217 baseline-unknown. The five source-worker files remained current passes. The broad gate is incomplete and belongs to the parent's combined verification; no broad pass is claimed.

The known failures are generated drift from before this row: format-7 committed launchers versus format-8 source and four harness bundle-drift checks. At revision 9, seven failures were current and the root bundle drift was pending. The parent owns all generated artifacts. Packaging 002-31 is live; this row does not edit adapter/*, runtime-update/*, launcher source, packaging or generated files.

No new product choice was needed. The parent confirmed keeping adapter discovery separate and publishing the seed without selection. The seed startup test uses scratch bundles from the current sources, not committed release bundles. The coordinator still owns combined packaging/installer proof and the candidate review.

Packaging integrated on the parent at `7993b6286` after this worktree branched. It renamed `CODEX_PLUGIN` to `CODEX_RUNTIME`, `CODEX_PLUGIN_DIST` to `CODEX_RUNTIME_DIST`, and `buildCodexPlugin` to `buildCodexRuntime` returning `{ runtime, metafile }`. This row adds no direct imports of those old symbols. Its real startup case reuses `cache-fixture.ts`; the parent confirmed that packaging already rewrote that helper to build a legacy runtime without copying the fixed seed. Do not rebase or edit that sibling helper here. The parent will check this seed case against the combined helper after integration.

Product commits: `895e18bd9` (first retained seed slice), `327675685` (runtime diagnostics, startup failure and regression coverage), `155619616` (required source-worker import boundary correction). Integrate the whole range, including the correction. The notes commits carry evidence and integration limits.
