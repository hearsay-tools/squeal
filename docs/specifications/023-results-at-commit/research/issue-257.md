# Issue 257: spawned scripts in a red proof

Triaged 2026-11-21. Source: [#257](https://github.com/hearsay-tools/squeal/issues/257), an agent-reported `friction` issue.

## Fit and owner

Inferred: passes the vision decision filter. Actionable proof diagnostics reduce blocking and preserve provenance and uncertainty across harnesses. Spec 023 owns D2 (side keys), D5.1 (reuse), D5.2 (side inputs and explicit classification), D5.5/D5.6 (verdicts and exit codes), and Testing. This does not authorize implementation or change an existing hold.

## Reproduction verdict

Not reproduced, because the one-minute host load was 18.83, above 16 online CPUs. The exact intake commands were `cat /proc/loadavg` (18.83 22.67 25.72) and `getconf _NPROCESSORS_ONLN` (16). The human explicitly requires skipping live reproduction in this case. No researcher, probe, proof command or test was run. No probe files were created.

Read in the issue: the incident used Squeal 0.1.565; the reporter called 0.1.580 current. This checkout's `package.json` also says 0.1.580. The incident revision and original JSON are not recorded. These are reported results, not a replay:

```sh
squeal proof packages/cezar/src/runners/codex/runner-skill-trigger-codex-parity.test.ts packages/cezar/src/runners/opencode/runner-skill-trigger-opencode-parity.test.ts --base 72b8c5e9c4d5 --case source
```

Reported result: not comparable, proven 0/2. With explicit sources:

```sh
squeal proof packages/cezar/src/runners/codex/runner-skill-trigger-codex-parity.test.ts packages/cezar/src/runners/opencode/runner-skill-trigger-opencode-parity.test.ts --base 72b8c5e9c4d5 --case source --source packages/cezar/scripts/mock-codex-app-server.mjs --source packages/cezar/scripts/mock-opencode-serve.mjs
```

Reported result: 2 proven, 0 not red, 0 red for another reason, 0 not green, 0 not comparable. Reported cost: three attempts, about 30 minutes. Whether the first output already named a rerun command is unknown.

## Contract and duplicates

Read in spec 023 D5.2: when no named test changed, every changed file needs an explicit `--source` (product bytes from each side) or `--with` (test bytes copied from the test version). The refusal must name unsettled files and exact reruns. This rule explicitly includes files outside observed inputs, including child processes. Inferred: the issue's explanation that only imports count is not established by its output. Automatic classification from declared inputs or runtime reads would change the approved rule; clearer guidance may already be required by it. No current product behavior was verified here.

Checked `git show origin/main:docs/board.md` for #257, gh-257, spawned-script symptoms and both mock script names. No existing issue row or exact symptom row. `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels` and the open `triaged` list found no exact duplicate. Related open triaged #256 concerns an imported testkit being selected as test-side code; #144 concerns child-only function coverage in `squeal code`. Closed #247 / done 023-21 supplied the explicit-choice rule. These are related, not interchangeable defects.

## Human decision

Approve a bounded replay and diagnostics follow-up under D5.2, or defer pending the original JSON and exact checkout. Keep explicit classification unless the human separately reopens it. Done when a proof over spawned scripts either compares the explicitly selected product bytes with correct provenance, or names the unsettled script paths and exact `--source` / `--with` choices before an agent retries. Never infer an unobserved child input or count an unrun proof as proven.

## Landing checks

Documentation only; no tests run. Main CI 44836511140 is red: Node 22 and Node 26 shard 1 fail `test/policy/repository-inputs.test.ts` with `spawnSync git ENOBUFS`. Read in its logs: `git ls-files` exceeds the default output buffer. Peer coordinator 4abb5168 confirms the cause and reports coordinator fe95a218 owns the maxBuffer fix in candidate 0.1.582. This triage does not fix or claim a pass for that CI failure.
