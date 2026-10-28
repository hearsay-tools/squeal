# Issue 116: named priority across daemon handover

Recommend treating #116 as a distinct request to extend C15's promotion lifetime across handover, subject to human approval. The loss reproduces in a current CLI/queue/store fixture. C15 explicitly permits it today. No implementation is authorized; existing holds stand.

Examined 2026-10-28: Squeal **0.1.370**, commit `2970f9b3581b2b58d8edec14034da528687fab32`, Node `v24.22.1`, Vitest `5.0.3`. Historical source: **0.1.313** at `51b37398230a2387d77908962957ae29ca0152ff`, **0.1.314** at `895e9d693365a9afdeda6bec95b19e553af28eb5`. Those historical binaries were not run.

## Questions and verdicts

The brief has no numbered questions. These five questions cover its requested evidence.

| Question | Answer and evidence tag | Version |
| --- | --- | --- |
| 1. Can a successor lose an open wait's priority? | **verified by experiment:** in a simulated replacement, B moves from first to second, its published promotion stops being visible, and the active wait sends no replacement request. | 0.1.370 |
| 2. Is this a breach of the existing contract? | **read in source code:** C15 explicitly excludes successor inheritance. C4/C9 preserve pending work, not the wait's rank. | 0.1.370; same lifetime exclusion in .313/.314 |
| 3. Does the historical implementation support the report? | **read in source code:** .313/.314 keep promotion in memory and send it once per wait. The original incident and its seven-minute delay are **not determined**, because no incident store/trace or historical live replay was supplied. | .313/.314 |
| 4. Is this already covered by #79, #110, #77 or 011-196? | **inferred:** no exact overlap; each addresses a different boundary, as detailed below. | Issue snapshots on 2026-10-28; board at examined commit |
| 5. What changes the decision for Squeal? | **inferred:** preserving an active wait would improve relevant feedback, but changes the documented lifetime and must retain deadlines, request order and scheduler constraints. Human approval is needed before design or implementation. | 0.1.370 |

## 1. Bounded experiment

**verified by experiment, 0.1.370.** The isolated fixture uses the real CLI wait loop, queue ordering, promotion publication/reading and temporary SQLite store. It simulates a successor by replacing the daemon record and creating a new queue with the same two pending files. It stubs sync and promotion transport. No daemon, socket or runner is started. No shared daemon is disrupted.

With equal queue classes and unknown durations, initial order is `[A, B]`. A wait naming B produces `[B, A]`. Before that wait ends, replacement produces `[A, B]`; visible promoted IDs fall from 1 to 0. The active wait emits one request, to the predecessor only, and returns timeout / exit 3. A new wait emits a request to the successor and restores `[B, A]`.

The second wait also times out: the fixture never runs either file. Thus timeout alone is not evidence that handover caused a missed deadline. The measured evidence is priority loss, lack of re-promotion and restored priority from a new wait. Arrival order here follows equal classes and durations; real C4 queues also consider failure, edit/catch-up class and duration.

Initial supplied load was 15.60 on 24 CPUs. Before execution, `node -e` using `os.loadavg()` and `os.cpus().length` recorded 20.57 on 24 CPUs at 10:14:30 UTC. The first probe recorded 20.85 and passed 1/1 in 4.83 s. An added output assertion then failed at load 22.60: the real reason was `queued; no run is open and nothing recorded holds it`, while the probe expected only `queued`. This was a probe assertion error, not a product regression. The retained `evidence.json` is from the first passing run; `result.txt` holds the later assertion failure. The expected string is corrected in the probe, but that correction was not rerun: at 10:18:14 UTC one-minute load was **33.29 above 24 CPUs**, so the required load rule stopped further live reproduction. This does not weaken the first run's queue-order and single-request assertions, which passed in both executions before the output assertion.

Exact run command (output redirected to the retained result file):

```sh
pnpm exec vitest run --config research/probes/issue-116/vitest.config.ts research/probes/issue-116/probe.test.ts > research/probes/issue-116/result.txt 2>&1
```

This probe is outside the repository's configured Squeal test coverage. No full suite, build or product regression run was requested. `pnpm exec biome check --write research/probes/issue-116/probe.test.ts research/probes/issue-116/vitest.config.ts` completed successfully (two files; imports organized). The final affected check, `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-116/probe.test.ts research/probes/issue-116/vitest.config.ts`, exited 3: “Squeal does not run” the probe and no closure holds its config; worktree known failures 0, 1,314 test files unknown. These unknown results are not a product-suite pass. Squeal reported the throwaway probe's functions as untested because its normal suite does not load this directory; that is not a claim that product tests passed or failed.

## 2. Why it happens and what the contract says

**read in source code, 0.1.370.** C15 Lifetime says: “Promotion lives in the daemon's memory, and a successor daemon does not inherit it.” `status-wait-paths.ts` keeps one `promoted` Boolean for the wait and sets it after the first decided read. Changing daemon identity does not reset it. Later promotion calls cover newly taken asks, not already queued files whose promotion a successor lost.

`Ledger` creates a fresh `RunQueue`. `Promotions` starts with an empty array. The published meta row is for status: `promotedIds` rejects a row written before the live daemon's start. `handover.ts` restores pending files and revision-based classes, without importing promotions. C4 requires queuing unfinished files at the successor's keys; C9 keeps cancelled unfinished work for that successor. Those are work-preservation rules, not rank-preservation rules.

**read in source code, 0.1.313/.314.** Both tagged specs contain the same lifetime exclusion. The .313 CLI's first decided read sets `promoted = true` and sends once; .314 retains that rule. Both versions' promotion module documents that a successor does not inherit the predecessor's row. The historical and current mechanism agree, but only the current fixture ran.

## 3. Related work

**inferred from fetched issues and the board at 0.1.370.** #116 is a specific handover-continuity request:

- **#79, open:** general fast-file promotion while the daemon continues. The board keeps it proposed and asks for newer evidence; tier size and scheduling boundaries are leads. A fresh wait in this probe does promote correctly.
- **#110, open:** a named slow file remains behind unrelated fast backlog after the current fast tier. It changes eligibility across lanes. This probe has only fast files and no lane constraint.
- **#77, closed:** repeated handover, blocked validation, store-busy reads and repeated notices. Rows 011-140/011-151 address liveness. Here every store read succeeds and the replacement is marked alive.
- **011-196, done in 0.1.304:** a scheduler record that requeues a file retains promotion until that record finishes. `RunQueue.settlingOnce` preserves state within one queue. It cannot transfer an in-memory promotion into another daemon's fresh queue. It predates the reported .313/.314 incident.

## Recommendation and open questions

**inferred, 0.1.370.** Keep #116 separate from liveness and slow-lane requests. Bring a bounded change to C15's successor exception to the human. The deciding tradeoff is continuity of an already active wait versus today's simple daemon-local lifetime. Preserving priority must not renew expired waits, lose ordering between concurrent waits, bypass claims/slow policy or claim that an unrun file passed. This report chooses no implementation or transfer protocol.

Not determined: real version-handover timing, the reported 8–59 selected files, their runner/queue classes, the seven-minute delay, and whether a status reason naming handover would change task behavior. A private daemon upgrade fixture and original traces could settle those points if separately needed. A fresh wait restores promotion in this fixture; it is not a guarantee of earlier completion under running-tier, claim, load or slow-lane constraints.

## Sources

- Fetched via `gh issue view N --repo hearsay-tools/squeal --json title,body,state,url` (116 also with `comments`): [#116](https://github.com/hearsay-tools/squeal/issues/116), [#79](https://github.com/hearsay-tools/squeal/issues/79), [#110](https://github.com/hearsay-tools/squeal/issues/110), [#77](https://github.com/hearsay-tools/squeal/issues/77). Issue text is reporter evidence, not independent reproduction.
- Local `spec.md` C4/C9/C15, `status.md` amendments 2026-10-17 and 2026-10-26, and `docs/board.md` rows gh-79, gh-110, gh-77, 011-196 at the examined commit. [Pinned C15 source](https://github.com/hearsay-tools/squeal/blob/2970f9b3581b2b58d8edec14034da528687fab32/docs/specifications/011-core/spec.md).
- Current source: `src/cli/status-wait-paths.ts:215`, `src/core/scheduler/ledger.ts:129`, `queue.ts:154`, `promotions.ts:143`, `handover.ts:42` and `bootstrap.ts:247` (scheduler paths under `src/core/scheduler/`). [Pinned wait loop](https://github.com/hearsay-tools/squeal/blob/2970f9b3581b2b58d8edec14034da528687fab32/src/cli/status-wait-paths.ts).
- Historical reads: `git show squeal--v0.1.313:<path>` and `git show squeal--v0.1.314:<path>` for `docs/specifications/011-core/spec.md`, `src/cli/status-wait-paths.ts`, `src/core/scheduler/promotions.ts`, and .314 `ledger.ts`. [Historical promotion source](https://github.com/hearsay-tools/squeal/blob/51b37398230a2387d77908962957ae29ca0152ff/src/core/scheduler/promotions.ts).
- Probe and raw evidence: repository-root `research/probes/issue-116/{README.md,probe.test.ts,vitest.config.ts,evidence.json,result.txt}`.
