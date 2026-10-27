# 002-39: independent shipped-proof identities

2026-10-27. Repair of review `reviews/0.1.368.md` B2 against fixed-plugin D7–D9. Product inputs are commit `252369f29e0fcbf2d1161a1bf73d89647a16eeae`. Only the owned shipped-proof helper, three proof tests, one new regression and these notes change. No product, generated output, version, shared harness/plugins fixture, board or status file changes.

## Identity and proof changes

The helper reads adapter identity from `plugins/codex/.codex-plugin/plugin.json`, seed identity from `plugins/codex/seed/runtime.json`, and current release identity from `plugins/codex-runtime/runtime.json`. Synthetic next-runtime identity is the next patch after that current manifest. The real Codex cache path uses the adapter manifest version. It has no fixed `1.0.0` path.

`release()` now packs the actual built current runtime without rewriting its manifest or bytes. Passing the synthetic next version explicitly retains the existing test-only identity rewrite and regenerates its runtime manifest. WASM bytes remain unchanged. The synthetic manifest preserves the built runtime's Node floor.

The live proof starts offline with a seed-pinned session A. It then provisions the actual built current release and verifies a fresh real thread's pin, launcher version and complete retained tree against `plugins/codex-runtime`. A subsequent synthetic B update preserves both earlier sessions and selects B for a new thread. Removing A still produces the missing-pin CLI and real hook diagnostics. All 53 fixed-plugin files and modes, scratch config bytes, and ten trusted hook records stay unchanged across publication.

Installer failure and the migrated launcher before provisioning now assert the seed version. Successful provisioning asserts the actual current runtime. When current differs from seed, both tests require an artifact fetch and compare the complete retained runtime tree to the built release. A descriptor request alone cannot satisfy those assertions.

## Persistent later-release regression

`test/e2e/codex-later-runtime.test.ts` makes a temporary shared clone of HEAD and links the already-installed dependencies. It copies only the four owned proof helper/test files from the worktree so pre-commit proof edits are tested too. Product inputs remain from HEAD. It raises only scratch root/install versions and invokes the ordinary runtime builder:

```sh
pnpm exec tsx src/harness/codex/build.ts
```

The test compares the entire fixed-plugin tree before and after build and again after the three child proof tests. It requires a newer runtime with a different seed version and exactly three passing proof tests without skips. The temporary checkout is removed in `finally`. No generated output or version change enters the worker branch. The parent should commit its product/generated integration inputs before running this regression, since its scratch product source is HEAD.

The regression was run red before changing the existing proofs:

```sh
pnpm exec vitest run test/e2e/codex-later-runtime.test.ts --maxWorkers=1 --reporter=verbose
```

Exit 1, `Test Files 1 failed (1)`, `Tests 1 failed (1)`, 8.99 s. Its nested run failed all three original proofs in 6.02 s. They expected root version 0.1.369 but received frozen seed 0.1.368 for the first pin, offline installer fallback and migrated launcher. The scratch ordinary build left the fixed plugin unchanged. This reproduces the review's exact B2 failure class.

## Final verification

Real `codex-cli 0.164.0` was available. The availability guards did not skip any proof. E2E paths are excluded from Squeal, so they ran explicitly after the final helper edit:

```sh
pnpm exec vitest run \
  test/e2e/codex-fixed-plugin.test.ts \
  test/e2e/codex-installer.test.ts \
  test/e2e/codex-migration.test.ts \
  test/e2e/codex-later-runtime.test.ts \
  --maxWorkers=1 --reporter=verbose
```

Exit 0. `Test Files 4 passed (4)`; `Tests 4 passed (4)`; 26.18 s. The later-runtime test's nested run also exited 0: `Test Files 3 passed (3)`; `Tests 3 passed (3)`; 11.84 s. No skipped test. An earlier green run before the final type-only helper cleanup passed the same four tests in 26.12 s.

| Observation | Candidate proof | Ordinary later-runtime proof |
| --- | --- | --- |
| Adapter / seed / current / synthetic next | 1.0.0 / 0.1.368 / 0.1.368 / 0.1.369 | 1.0.0 / 0.1.368 / built 0.1.369 / synthetic 0.1.370 |
| Offline A pin and launcher | 0.1.368 | 0.1.368 |
| Fresh thread after actual current provisioning | 0.1.368 | 0.1.369 |
| Fresh thread after synthetic B provisioning | 0.1.369 | 0.1.370 |
| Fixed-plugin files; trusted hooks before/after | 53 unchanged; 10 / 10 | 53 unchanged; 10 / 10 |
| Installer provisioning failure / recovery exits | 1 / 0 | 1 / 0 |
| Installer and migration actual current artifact fetched | No: current already equals retained seed | Yes: both fetch and select built 0.1.369 |
| First-turn SessionStart / prompt / Interrupt | 93 / 60 / 61 ms | 94 / 65 / 61 ms |
| Cold turn; one-minute load | 317.44 ms; 2.34 | 317.21 ms; 2.72 |

These timings are individual observations, not a p95 claim. The first-turn SessionStart is below its asserted 2,000 ms budget.

The later installer logged the 0.1.369 descriptor twice, once failing offline and once succeeding, followed by the 0.1.369 artifact URL. The migrated released launcher logged:

```text
Codex: squeal@hearsay 1.0.0, was 0.1.367
Copied the launcher (format 7, now 8) to <scratch-home>/.local/bin/squeal
```

Before provisioning that launcher printed 0.1.368. After provisioning it printed 0.1.369; status selected 0.1.369; the retained tree matched the built runtime. Migration requested exactly the 0.1.369 descriptor and artifact. The live proof fetched both the built 0.1.369 artifact and synthetic 0.1.370 artifact, while A stayed pinned to 0.1.368.

Other actual checks:

| Command | Result |
| --- | --- |
| `pnpm run lint` | Exit 0. `Checked 2515 files in 820ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsc --noEmit`. |
| `git diff --check` | Exit 0, no output. |
| `git diff --exit-code -- src plugins package.json install.sh pnpm-lock.yaml` | Exit 0, no output. No product/generated/version change. |

Required final affected read:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/e2e/codex-shipped-fixture.ts \
  test/e2e/codex-fixed-plugin.test.ts \
  test/e2e/codex-installer.test.ts \
  test/e2e/codex-migration.test.ts \
  test/e2e/codex-later-runtime.test.ts
```

Exit 3 at revision 6 because all five paths are explicitly `Not run by Squeal`. The indirect selected check was current and passing: `the test files selected at revision 6: no known failures; 1 test file, each with a current result, after 1.0 s.` That selected file was `test/version-sensitive.test.ts`. Whole worktree: 0 known failures; 216 of 1303 test files unknown. No pending affected check. Those unknown files are not claimed as passing. The direct excluded-path results above are the actual proof.

## Limits, decisions and continuation

Real Codex runs in separate scratch HOME/CODEX_HOME directories. Its model provider is an OpenAI Responses endpoint at a refused loopback URL, without auth. Startup/prompt hooks and interruption are real. No successful inference, model consumption of the primer or model-issued CLI command is claimed. No credential is read or persisted.

Scratch Node fetch uses the existing local preload. It serves exact release descriptor/artifact URLs from local files and rejects unconfigured URLs. Packing, integrity checks, runtime publication and launcher execution are real. GitHub transport and descriptor release-commit identity are fixtures. Built 0.1.369 comes from the ordinary builder; synthetic 0.1.370 is explicitly an identity-rewritten fixture. Real Codex marketplace install/upgrade uses the local git server. No production config, hook trust or runtime data changes.

No product decision or product type change was required. Test-only exports replace ambiguous `VERSION`/`NEXT` with `ADAPTER_VERSION`, `SEED_VERSION`, `CURRENT_VERSION` and `NEXT_VERSION`. The test helper's default release target changes to actual current; synthetic next is explicit. These are test interfaces only.

No full suite, full-suite checkpoint, candidate CI, adapter rebuild, review acceptance, merge or release ran here. B1 belongs to sibling 002-38. The parent owns integration, generated output, deliberate adapter/version raises, exact candidate review and CI. Row 002-39 has no remaining implementation slice.
