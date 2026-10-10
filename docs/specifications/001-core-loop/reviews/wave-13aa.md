# Wave 13aa review (001-249)

FAIL `b93e6af47e4d9f9b359cffea85268920d95a8f8f`. Three proven blockers, one proven should-fix, no nits.

Range: `1c17aeb0..b93e6af47e4d9f9b359cffea85268920d95a8f8f`. Covers 001-236 in 0.1.108 and 001-234, 001-237 and 001-242 in 0.1.109. The review changes no product code. Blockers go to the human through the coordinator.

## Verification

The independent checks started on the clean candidate; no product, configuration or test file changed during verification. The review draft was kept outside the tree while the suite finished. `git rev-parse HEAD` returned the candidate above; `git status --short` was empty.

```text
npm ci
found 0 vulnerabilities
exit 0

npm run lint
> squeal@0.1.109 lint
> biome check .
Checked 773 files in 228ms. No fixes applied.
exit 0

npm run typecheck
> squeal@0.1.109 typecheck
> tsc --noEmit
exit 0
```

Independent full-suite result: **exit 0, zero failed**. Command:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
```

```text
 Test Files  353 passed | 1 skipped (354)
      Tests  2558 passed | 9 skipped (2567)
   Start at  00:16:31
   Duration  454.54s (tests 98%, import 1%)
exit 0
```

The run also printed two fixture gitdir-repair notices and a teardown notice that it killed one process from an earlier run. Neither failed the gate. The background Squeal baseline separately reported a departure-timing failure and its same-input recovery; that is not substituted for this independent result.

`npm run build` was deliberately excluded by the dispatch instruction. Bundle drift is **unverified** by this reviewer. The coordinator reports 2,557 passed, zero failed, and green CI; those are supplied evidence, not this independent run.

The review's throwaway probes ran against the candidate sources through `node --disable-warning=ExperimentalWarning --import ./node_modules/tsx/dist/loader.mjs`. SessionStart probes used real temporary `squeal.config.json` files, a real SQLite store, both harness handlers, and a stubbed daemon ensure. Their seeded key rows reproduce the stored state before a restarting daemon has committed its new listing. They do not claim a real daemon completed a listing. All probe directories were removed.

## Blockers

### B1. A node:test-only repository is told that Vitest is covered (**proven**)

Location: `src/harness/shared/primer.ts:40`, `:70`; `src/harness/shared/coverage.ts:50`.

001-234 requires the primer to list exactly the covered suites and never claim coverage it lacks. `Coverage` has no indication that Vitest is absent, and both the opening instruction and the coverage sentence always include it.

The daemon supports node:test-only repositories. `src/core/daemon/daemon.ts:326` creates no Vitest runner when `nodeTest` is nonempty and `vitestDetected(root)` is false. A temporary repository with `package.json` containing only `{"type":"module"}`, no Vitest/Vite config, and this policy therefore has only a node:test runner:

```json
{"nodeTest":[{"name":"scripts","argv":[],"env":{},"include":["scripts/*.test.mjs"]}]}
```

SessionStart under **both** Claude Code and Codex produced:

```text
vitestDetected: false
Squeal covers Vitest and node:test project "scripts" (scripts/*.test.mjs).
```

The opening also says not to run Vitest to learn whether edits broke something. The newly added exact-coverage list thus claims a runner the daemon deliberately omits. The existing matrix always writes `vitest.config.ts`, so it cannot discriminate this case.

Repair scope: one worker on `coverage.ts`, `primer.ts`, their shared exported type and harness tests. Represent whether Vitest is configured/detected using the daemon's selection rule, and render both instructions and coverage from the represented runners. Add a node:test-only SessionStart case under both harnesses, with neither a Vitest config nor a Vitest manifest dependency. Keep the existing Vitest-only and mixed cases.

### B2. Old node:test rows become invented Vitest projects (**proven**)

Location: `src/harness/shared/coverage.ts:41-46`.

The code assigns every stored nonempty project name absent from **today's** `nodeTest` configuration to Vitest. A row does not record its runner there, and its presence does not establish that today's daemon has listed it. On daemon restart, heartbeat and SessionStart can precede baseline's listing commit. Previous key rows remain visible until that commit (`src/core/scheduler/bootstrap.ts:103-181` and `ledger.ts:399-448`); a failed listing retains them.

Probe: keep `vitest.config.ts`, configure only the node:test project `scripts`, and seed the previous daemon's row `{project:"removed-node",path:"scripts/old.test.mjs"}`. No Vitest project has that name. Both SessionStart handlers returned:

```text
Squeal covers Vitest (vitest.config.ts, project "removed-node") and node:test project "scripts" (scripts/*.test.mjs).
```

This is a false suite identity, not just a missing slow count. The same mechanism exposes removed Vitest projects and counts retained slow-file rows as today's count. The `keys.length === 0` condition handles a never-listed store but does not make retained rows a current listing.

Repair scope: one worker on the coverage discovery boundary and its tests. Do not infer a current runner identity by subtracting current policy names from old key rows. Use runner-owned discovery with its provenance, or fall back to the detected config and explicitly qualify an unavailable/outdated listing. Slow counts must carry the same listing qualification. Add a real-policy SessionStart regression for a removed node:test project's retained row and for a changed slow-file listing. Do not wait for the full baseline in the hook.

### B3. A long Codex CLI path exceeds the primer cap and loses its closing sentence (**proven**)

Location: `src/harness/shared/primer.ts:55-60`, `:115`; `src/harness/codex/output.ts:29-34`.

001-234 requires the primer to stay within its length cap and keep the not-covered sentence whole when its coverage list is long. Folding projects is the only fallback. With no projects left, the function returns the fixed text even when that text exceeds 1,500 characters. The CLI command occurs twice in the slow variant.

Probe, using the real `codexCommand`:

```ts
const root = `/home/agent/${"x".repeat(250)}/.codex/plugins/cache/hearsay/squeal/0.1.109`;
const command = codexCommand({ PLUGIN_ROOT: root }, "/unused.mjs");
const coverage = { vitestConfig: null, vitestProjects: [], nodeTest: [], slow: { files: 3 } };
const tail = primer(command, coverage);
const text = `${"a".repeat(9000)}\n\n${tail}`;
```

The path has a valid 250-character component. Output:

```text
command length: 371
primer length: 1605
trailingPrimer(text) recognizes the tail: false
capContext(text, command) contains "Squeal does not cover": false
```

The fixed paragraph itself violates the cap. At the Codex cap boundary, `trailingPrimer` rejects that oversized paragraph and truncation drops the entire primer, including the sentence that names uncovered checks. No unusually long project name is needed.

Repair scope: one worker on the primer's fallback and Codex cap tests. After folding projects, compact the fixed wording or repeated command references as needed, preserving the coverage summary and the whole closing sentence. Add a long, valid `PLUGIN_ROOT` with slow files to both the primer-cap assertion and an over-8,000-character `capContext` case.

## Should-fix

### S1. The stat limit does not limit directory enumeration (**proven**, nonblocking)

Location: `src/core/watcher/root-recheck.ts:61-65`.

The 1,024 budget decreases only for a non-directory entry that is neither named nor excluded. Every skipped directory, named file or excluded file can still be read synchronously. A directory-only fixture with 1,500 child directories and one named file produced:

```text
readSync calls: 1502
statSync calls: 0
```

Thus the advertised stat limit holds, and zero content bytes are read, but it does not bound the callback's total directory work. A directory with many skipped entries can occupy the daemon's event loop beyond the intended small recheck. No missed-event or result-honesty break was established by this probe, so this does not block.

Repair scope: one watcher worker. Bound visited directory entries separately from stat calls, leaving the remainder to the existing reconcile pass. Test a directory full of skipped directories/excluded entries. Preserve the 1,024 stat and zero-content limits. Update the bound's wording if the policy changes.

## Nits

None.

## Answers to the brief and coordinator

1. **Can SessionStart claim missing coverage or omit a configured suite?** Yes to a missing-coverage claim: B1 and B2 are reproduced under both harnesses. Current `nodeTest` policy entries are always included, subject to counted folding, before any listing; they are not omitted by an empty store. Before first listing, named Vitest projects are absent. With a root config, the primer identifies that config instead, which meets the brief's "config or projects" wording. The cold-project probe returned `Squeal covers Vitest (vitest.config.ts).` for a config naming `unit` and `browser`. Without a root config, a cold listing cannot identify named projects and says only `Vitest`. That is a useful qualification to retain in the repair. `not counted yet` is honest for a never-listed slow tier; it does not cover an outdated retained listing (B2).

2. **Is `trailingPrimer()` safe when another paragraph starts with the same opening?** An earlier matching paragraph does not capture or remove the real trailing primer: `lastIndexOf` chooses the final opening, and a multi-paragraph tail is rejected. The collision probe kept the real final primer and capped the context to exactly 8,000 characters. A final single diagnostic paragraph beginning with that opening is a false positive and is retained if it is at most 1,500 characters. This preserves bounded diagnostic text and does not violate the actual registration contract, whose real primer is last. Do not describe the matcher as validating primer identity. B3 is the proven loss case: a real generated primer longer than the accepted tail budget.

3. **Are the stat budget and 2 s window sound, and is a failed stat trusted?** The root pass makes at most 1,024 candidate stat calls across the batch, reads no content, and never compares a same-size rewrite to a racy old signature. It reports a file when either mtime or ctime falls in the conservative window. The deterministic tests cover an erased sibling event, a same-tick write, exclusions, unrelated directories, the budget, and EACCES. A thrown stat error is reported as a change; an absent entry (`throwIfNoEntry:false`) is skipped and belongs to the stated removal/reconcile fallback. Directory open/read failures leave unexamined entries to that fallback. The 2 s window is partial recovery, not an unconditional maximum callback-delay guarantee. The worker's notes explicitly include an erased write hidden by a callback delay greater than 2 s in the fallback. D2 states the residual bound as 30 s **after the watcher goes quiet**, so sustained events can postpone it. S1 qualifies the work budget. No new false-current result from this recovery was proven.

4. **Does each row meet its done-when?** 001-234 has the required eight-cell harness/configuration matrix and long-list case, but B1-B3 break its exact-coverage/cap requirements. 001-236 has deterministic fake-parcel recovery, bounded candidate stats and the explicit D2 fallback; upstream issue text is recorded, and the board records that filing awaits human approval. The committed notes do not preserve output for the stipulated 50 parcel repetitions, so that repetition claim is **unverified** here. 001-237/242 name their causes and preserve their assertions. Their notes record 15 graph probe rounds under 24 busy loops and a reproduced old integration race, but do not preserve 20 consecutive passes of each final test under one busy loop per core. That repetition claim is **unverified**, not another blocker. The coordinator reports green CI; this review runs one independent full suite rather than manufacturing missing repetition evidence.

5. **Do the timing fixes keep what their tests prove?** Yes, by source inspection. The graph test still asserts a median re-resolve/cold ratio below one and edit/cold below 5%; it adds per-round parse/lookup work assertions rather than loosening timing bounds. Nine paired rounds reduce unpaired-load noise without promising immunity to any possible load. The integration test now waits for both the new failure and its one forced rerun before its unchanged exact two-file-run assertion. It does not increase the timeout or accept an extra run.

## What fits

- `startSession`, first-registration `deliver`, and first-registration `submitPrompt` all pass the new `(command, coverage)` interface in the correct order. Compaction uses the same coverage builder. Both harnesses share it.
- Every normal and slow variant retains the sentence about typecheck, build and other suites. Slow delivery wording still differs correctly between interactive Claude Code and Codex. The new matrix seeds listed files, so it proves formatting after discovery, not discovery freshness.
- `CONFIG_NAMES`/`CONFIG_EXTENSIONS` match the installed Vitest config lookup order. The coverage module does not execute the Vitest config in the hook.
- Root rechecks report hints; the existing change feed and reconciler decide whether bytes moved and create revisions. The added recovery does not bypass keying or trust recovered hints as results.
- `KEY_FORMAT_VERSION` is 4, leaving shipped versions 1-3 intact. Re-pinning unreleased 4 is consistent with the dispatch. Primer/coverage rendering remains outside key meaning; no extra bump is requested for these rendering fixes.

## Inputs for the next wave

The human decides the repair wave. B1 and B2 share `Coverage` and should be assigned to one worker or implemented sequentially. B3 can follow that interface without altering watcher or runner code. Extend the matrix to node:test-only, old-listing and long-command states rather than only adding more formatting snapshots. Keep discovery off the synchronous SessionStart wait path.

Keep the root recheck's two explicit budgets (candidate stats and content bytes) and the 2 s timestamp window distinct from its reconcile fallback. A future S1 worker should add an enumeration budget, not remove the conservative EACCES hint. Leave D2's quiet-relative bound explicit.

The review's build/drift check and the worker repetition evidence remain unverified as stated. No product fix, board edit or automatic integration is part of this review.
