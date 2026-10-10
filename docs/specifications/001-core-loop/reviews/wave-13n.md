# Wave 13n: second-round review of 001-203

## Verification output

Candidate: `976bf74fb6aee70c1f0bd9d22dbe7cb67dd81b9d`, package 0.1.92. Range: `ec906520..976bf74f`; implementation `a0fab3e9`, rebuild and unreleased format-1 re-pin `976bf74f`. Initial HEAD was `04d5f21c`, a descendant changing only `docs/board.md`; the reviewer checked out the exact candidate before installing or verifying. All candidate checks below preceded the findings-file edit on a clean tracked tree. The task branch was restored to its original board-only descendant before committing this file; no candidate product bytes changed. Linux, Node 24.21.0; selected checks also ran on Node 22.23.3.

`npm run build` was deliberately **not run**, as the task explicitly instructs. Rebuild reproducibility is **unverified**, not a finding against this wave. The committed bundles were inspected for the moved adapter version constants and format integer. The independent full Vitest run is the reviewer gate; Squeal is recorded separately.

```text
$ git rev-parse HEAD
976bf74fb6aee70c1f0bd9d22dbe7cb67dd81b9d
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install scripts lacked approval)

$ npm run lint
> squeal@0.1.92 lint
> biome check .
Checked 735 files in 219ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.92 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run  # independent reviewer gate, Node 24.21.0
Test Files  329 passed | 1 skipped (330)
     Tests  2383 passed | 10 skipped (2393)
Duration 298.87s
(exit 0; fixture worktree repair messages and one dead-run process sweep also printed)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run test/keys/key-format.test.ts test/keys/environment.test.ts test/harness/version.test.ts test/harness/step-down.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  68 passed (68)
Duration 16.09s
(exit 0)

$ node node_modules/vitest/vitest.mjs run --root <external-copy> --config <external-copy>/vitest.config.ts -t 'is bumped whenever'
baseline: exit 0, 1 passed, 20 skipped
completion-barrier mutation: exit 1, 1 failed, 20 skipped
recordsForFile mutation: exit 1, 1 failed, 20 skipped
exempt status-file comment: exit 0, 1 passed, 20 skipped
root package.json version-only mutation: exit 0, 1 passed, 20 skipped
bundled enhanced-resolve lock-entry version mutation: exit 1, 1 failed, 20 skipped
Vitest adapter version alone (2 -> 3): exit 0, 1 passed, 20 skipped
node:test adapter version alone (9 -> 10): exit 0, 1 passed, 20 skipped
# Each expected failure is the actual guard assertion:
AssertionError: the guarded sources changed: bump KEY_FORMAT_VERSION ...

$ node --import ./node_modules/tsx/dist/loader.mjs <external-copy>/adapter-probe.mts
# A separate process for baseline and each physical version-file edit;
# adapter versions read from real VitestAdapter and createNodeTestAdapter.
Vitest bump: globalHashChanged=false, vitestKeyChanged=true, nodeKeyChanged=false
node:test bump: globalHashChanged=false, vitestKeyChanged=false, nodeKeyChanged=true
(exit 0; runner environments hashed with identical other inputs)

$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.86/dist/cli/squeal.mjs run --all --wait
Checkpoint 7daf3049-ce6a-4ec3-bcec-615e571cacf1 started at revision 1: 330 test files
Checkpoint 7daf3049-ce6a-4ec3-bcec-615e571cacf1 completed
Revision: 1
Known failures: 0
Affected checks: 2713 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 1
Worktree: candidate HEAD 976bf74, clean at revision 1
Daemon: running
Inherited from other worktrees: none
(exit 0; Known failures was read explicitly)
```

## Verdict

**PASS `976bf74f`: 0 blockers, 1 non-blocking should-fix note, 0 nits.** Prior B1, S1 and S2 are closed. The required 001-203 controls hold. Every exemption is safe for result meaning at this candidate; the directory exemptions still require human review when their role changes. S3 below concerns the future boundary sentinel, not a current unguarded acceptance path.

## Blockers

None. No proven break of the reviewed row or cache guarantee was found.

## Prior findings closed

### B1. Proven closed: storage and acceptance code are guarded by default

`test/keys/key-sources.ts:18` traverses all of `src/` before its explicit exemptions. The actual candidate list has 239 guarded files. It includes `scheduler/stability.ts`, `records.ts`, `tiers.ts`, all their semantic dependencies, daemon wiring, watcher and reconciliation logic, policy defaults, slow-input/inheritance rules, failure fingerprints, store codecs and schema. Every semantic path named by wave 13m's inventory is now covered; the exemptions are audited below.

In an external copy of the exact candidate, the old barrier mutation (`if (touched.length === 0) return report;` to `>= 0`) fails the actual pinned guard. So does changing `recordsForFile` from `outcome: result.outcome` to `outcome: "pass"`. The mutations retain `KEY_FORMAT_VERSION = 1` and its pin. Their computed hashes are respectively `e497dbcd13cf779e39963e90bfa6212763ab7260753ef955118e81535121e781` and `9ee12ceb0da7ea49ff4de1a1898d7dd398d0e7e494af27c24f2c943bb6c4fa86`, unequal to the candidate's `f20381f6765e718efdc6123d293a7121fc3af0fa02122bfb58706ac2400fe700`. The predecessor release from B1 therefore cannot pass this release gate unchanged. The original product barrier need not be re-prosecuted: this repair changes the guard, not its implementation.

### S1. Proven closed: adapter-only version bumps remain isolated

Each adapter version is alone in `src/runners/{vitest,node-test}/version.ts`. Tests enforce the constant-only shape, and adapter code remains guarded. Source inspection confirms each adapter passes its own constant into its environment. Physical edits to either version file pass the actual global guard. A separate-process probe reads the versions through the real adapters, then hashes runner environments: only the edited runner's key moves. The 21-test key-format file additionally checks the two constant shapes, imports and environment isolation; the selected Node 22 suite passes all 68 checks.

### S2. Proven closed for the stated build/dependency boundary

All three build modules, `tsconfig.json`, the shell launcher and the plugin's Node module manifest are guarded. The root manifest is guarded apart from its release version and devDependencies. `bundledDependencies` follows root runtime dependencies through their lock dependencies, optional dependencies and peers, resolves package locations upward, excludes the build's runtime externals, and includes esbuild and its optional platform packages. The current runtime imports are Node builtins or the covered acorn, chokidar, enhanced-resolve and es-module-lexer closure; Vitest and Parcel load from the target project. No additional embedded runtime devDependency was found.

Physically changing enhanced-resolve's lock version fails the actual pin assertion. The candidate regressions also exercise transitive tapable integrity and esbuild changes and the harmless Biome control. A root release-version-only edit keeps the pin; plugin and lock root-version controls pass in the candidate tests. This review establishes the guard boundary, not behavior under a particular third-party upgrade.

## Exemption audit

The question is whether an edit can reuse a result with a changed meaning, not whether exempt code performs any write or requests validation. The checked imports contain nine named guarded-to-exempt edges. Trace of their current runtime callers finds no exempt outcome writer, key-input selector or post-run acceptance rule.

| Exemption | Candidate behavior and reason it is safe |
| --- | --- |
| `src/core/keys/key-format.ts` | Only the format integer and pin map. The integer itself enters every environment hash; the map is release-test metadata. No semantic helper resides here. The unreleased format-1 re-pin is explicitly authorized by 001-203. |
| `src/runners/vitest/version.ts` | Only its version constant and comments; directly changes Vitest environments. Shape enforced by a test. |
| `src/runners/node-test/version.ts` | Only its version constant and comments; directly changes node:test environments. Shape enforced by a test. |
| `src/cli` except `index.ts`, `main.ts`, `daemon.ts` | Commands read status/logs, request guarded daemon actions, or create/remove user configuration. Init's seeded inputs become the actual configuration that the guarded daemon keys. Remove erases the store; it never reinterprets retained rows. Run's force flag requests execution through the guarded scheduler. None constructs a result or changes acceptance of a retained record. The daemon entry and dispatch remain guarded. |
| `src/core/status` | Reads and formats snapshots, histories and logs; no result/known-state writes. Its heartbeat grace constant also reaches daemon discovery via delivery, but controls liveness and restart discovery, not acceptance of a stored result. |
| `src/core/delivery` | Writes consumer registration, views, version/turn/departure metadata; reads results and known states. `ensure.ts` uses liveness only for discovery, `lifecycle.ts` uses expiry/departure for shutdown, and `slow-tier.ts` uses `readTurn` to choose when to run. `state/slow.ts` uses slots for displayed turn information. All result construction, lookup and completion barriers remain guarded. These edges change timing or delivery, not a result's meaning. |
| `src/harness` except the three build modules | Hooks register, read/deliver, deny, wait and call guarded daemon startup/client operations. Their writes are consumer metadata. Step-down still compares release versions and delegates shutdown/start to guarded core. No key/result construction occurs in a hook. Build options, entry discovery and runtime copying remain guarded. |
| Root manifest `version` | Release identity and step-down remain release-based; excluded from environment hashing. Version-only mutation passes. |
| Root manifest `devDependencies` | Current entries are test/type/lint/build tools. esbuild's installed lock closure is separately fingerprinted. No other current entry is embedded as runtime product code. |
| Plugin manifest `version` | Release identity; Node execution fields including `type` remain hashed. |

Docs, skills and hook registration manifests are outside the guarded roots: they describe how to invoke hooks or communicate with the agent; runner/daemon execution and result storage live in the guarded modules. The CLI launcher is explicitly inside the roots. CRLF normalization and path+content hashing preserve the conservative change, add, delete and rename behavior.

## Should-fix notes

### S3. Plausible future gap: the import sentinel skips the guarded CLI/build exceptions

Location: `test/keys/key-sources.ts:187`. `GUARDED_WITHIN[path] === undefined` removes not only the command dispatcher, but also `src/cli/daemon.ts` and all three build modules from import scanning. Today their semantic helpers are guarded; there is no current cache failure and this does not reopen B1. A later extraction of daemon startup or build semantics into an exempt CLI/harness helper could be missed by the claimed boundary check.

A cheap external probe prepends `import "./status-wait-lines.js";` to the copied `src/cli/daemon.ts`. The reported seam list remains exactly nine edges although the target is exempt. The daemon source edit itself does change the source pin, so this probe is evidence of the sentinel omission, not a bypass of today's pin. A subsequent helper-only change after re-pinning is the plausible risk.

One-worker follow-up: scan these guarded exceptions too, allowlist the dispatcher's present command edges explicitly, and add a regression that a new daemon/build-to-exempt edge fails. Keep the existing timing/presentation seams documented. No need to move current presentation code into the global pin.

## Nits

None.

## What fits

- The implementation flips to default coverage rather than repairing only the three demonstrated scheduler omissions. New semantic sources under src are guarded automatically.
- Adapter values move without changing their meaning or public exports; release-based daemon identity and step-down are retained.
- Existing tests discriminate mutations at acceptance, storage, build, compiler options, dependency closure and version-only boundaries. External physical mutations independently verify the actual release assertion.
- D3 and D4 match the resulting guarded boundary and adapter exception. The format-1 correction is permitted because it is unreleased.
- No product source, board or spec was edited in this review. Only this findings file is committed.

## Inputs for the next wave

No blocker fix wave is required for 001-203. The coordinator can take B1, S1 and S2 as closed. If it accepts S3, give the worker `test/keys/key-sources.ts` and `key-format.test.ts` and require the new guarded-entry-to-exempt import control. Re-audit exemptions whenever a helper moves across this boundary. Future semantic changes must still bump the global version and append a pin once format 1 ships; adapter-only value changes remain per-runner. Rebuild verification remains the coordinator's gate, as requested.

The independent suite is green. Squeal's initial baseline separately reported two failures: `test/daemon/handover.test.ts:72` (expected spawned, received unavailable) and `test/integration/node-test.test.ts:274` (expected two retry runs, received one). Both recovered under the same inputs before the checkpoint completed, and Squeal labeled them flaky. They are verification observations outside the changed guard; no product source or timeout was changed to obtain a pass. Build reproducibility alone remains unverified because this review was told not to run the build.

External probes and temporary logs are removed after their relevant output is transcribed. Only this review is the deliverable.
