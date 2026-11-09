# Spec 018 wave 5: the second slice

Approved by the human 2026-11-09 ("Design: Approve"; fetch only when the project sets `shared.ref`; trust bound is push access; cezar pins the latest Node 26.x). Rows 018-16, 018-18 and 018-19 run in parallel on disjoint seams; 018-17 starts after 018-16 fixes the part format; 018-20 after 018-17.

## 018-16 `squeal ci record`

Use /worker. Shape: slice.

Outcome: `squeal ci record [--out <dir>] -- <command>` runs the project's Vitest command unchanged, returns its exit code, and writes one part file per Vitest process with each test file's outcome, checks, duration, observed reads and each project's environment descriptor.

Read: `spec.md` D8, D9 (the consumer of your format), D1, D2; `research/ci-step.md` 1 to 3.

Starting seam: `src/runners/vitest/observe.ts` and `reporter.ts` (the daemon's recorder and reporter) and how `run.ts` attaches them; a fixture with two `--shard` runs as the first failing test. First edit offered as a lead: a runner-adapter entry point that attaches the recorder and a part writer to a command the user gives, with no daemon and no store. Define the part file format in `src/core/ci/parts.ts` with a version field and document it in your final message; 018-17 reads it.

Owns: `src/cli/ci.ts` (new, the `ci` command group), `src/cli/main.ts` (register `ci`), `src/core/ci/` (new), the Vitest adapter files the recorder attach needs, their tests.

Leave alone: `src/core/store/transfer*.ts`, `src/core/status/`, `src/core/keys/environment-descriptor.ts` (018-18); `src/runners/node-test/` (018-19). No coverage provider in this path. Other runners print "not supported" and run the command unchanged. No `pnpm run build`.

Done when: the two-shard fixture writes disjoint parts; exit codes pass through (pass, fail, crash); nothing is written outside `--out`; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.

## 018-18 import tolerance and re-key

Use /worker. Shape: slice.

Outcome: an export made with `CI=true` and a different observed union imports as current wherever the content is equal.

Read: `spec.md` D10, D11, D15; `research/ci-step.md` 3, `research/key-rules.md` 2 (option d) and its probes; `research/import-trial.md` count 2.

Starting seam: a failing test first: import the shape of the trial's case into a store whose observed union holds extra paths and whose environment differs only in `allowOnly`; the file must become current. First edit offered as a lead: `importResults` (`src/core/store/transfer.ts`) computes each file's local key from the local closure list, the export commit's blob ids (`git ls-tree -r <commit>`), and the local environment with D10's fields compared as equal, and stores the results at that key. D10's field rule lives in one function beside `describeDifferences` (`src/core/keys/environment-descriptor.ts`). Status adds "observed set differs" and the no-coverage note (D15).

Owns: `src/core/store/transfer*.ts`, `src/core/store/imports.ts`, `src/core/keys/environment-descriptor.ts`, `src/core/status/import*.ts`, `src/cli/import.ts`, their tests.

Leave alone: `src/cli/main.ts` and `src/cli/ci.ts` (018-16); `src/runners/` (018-16, 018-19); key inputs: no key of a local run may move. No `pnpm run build`.

Done when: D10 and D11 tests pass (each tolerated field; a browser-mode project still keyed; content differs means not current); `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.

## 018-19 node:test keyed without a path

Use /worker. Shape: slice.

Outcome: node:test's environment keys the project's Node by `process.version`, `process.versions`, a hash of `process.config`, `platform` and `arch`, not by `execPath`.

Read: `spec.md` D12; `research/key-rules.md` 1 and its probes.

Starting seam: `src/runners/node-test/adapter-environment.ts` (about lines 70 to 74) and `version.ts`. First failing test: one Node build at two paths gives equal environments; two builds of one version (differing `process.config`) differ. Raise `NODE_TEST_ADAPTER_VERSION`, not `KEY_FORMAT_VERSION`.

Owns: `src/runners/node-test/`, its tests, the node:test validity case if the key-format alarm needs one.

Leave alone: every other runner and the core key inputs: Vitest and pytest keys must not move (`test/keys/key-format.test.ts` shows it). No `pnpm run build`.

Done when: the two tests pass; the key-format alarm moves only node:test cases; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.

## 018-17 `squeal ci export --parts`

Use /worker. Shape: slice. Starts from the coordinator's branch with 018-16, 018-18 and 018-19 integrated (release 0.1.420 in review).

Outcome: `squeal ci export --parts <dir>... [--out <file>]`, run in a fresh checkout of the same SHA after the shards, writes the D2 export (passes and skips) whose keys equal what a daemon computes for that content, with each file's `keyParts`.

Read: `spec.md` D9, D2, D11 (with the 2026-11-09 `keyParts` line); `tasks/018-16/notes.md` (part format `squeal-ci-part/1`, `src/core/ci/parts.ts` `readPart`); `tasks/018-18/notes.md` (re-key rule, key parts, seams).

Starting seam: a failing test first: run `squeal ci record` on a two-shard fixture, export the parts, and compare with `squeal export` from a daemon that ran the same fixture (equal keys and results per file; `keyParts` present). First edit offered as a lead: a `src/core/ci/export.ts` that builds closures with the daemon's own closure and key code (static graph plus the parts' observed reads), not a copy of it.

Refuse with a named reason: parts whose environment descriptors differ for one project; a part made with `updateSnapshot` other than `none`; a part that did not complete; a test file in two parts; parts from different commits.

Owns: `src/core/ci/export.ts` (new), `src/cli/ci.ts` (add the `export` subcommand), their tests.

Leave alone: `src/core/store/transfer*.ts` except through their exports; the daemon's keying code except to export a function; key inputs. No `pnpm run build`.

Done when: the comparison test passes; each refusal has a test; `squeal status --wait 60000 <changed paths>` read once (report pending as pending); lint and typecheck clean.

## 018-18 R1 and 018-16 S1: repair after review FAIL (`reviews/wave-5.md`)

Use /worker. Shape: repair, on candidate `cand/0.1.420`.

Outcome: an import never makes a pass current where a local run could fail: a re-key keeps every input the exported run read, and `allowOnly` is tolerated only in the safe direction.

Read: `reviews/wave-5.md` B1, B2, S1 with their reproductions and "Worker-sized fix" lines; `spec.md` D10, D11; `tasks/018-18/notes.md`.

Rules:
- B1: re-key a file only when the destination closure (this worktree's list plus the shared observed entries) contains every path of the exported closure, observed files and directory listings included. If one is missing, keep the results at the exported key (D3). Never widen the shared observed set or move a local key.
- B2: tolerate an unequal `allowOnly` only when the export ran with `allowOnly: false` (the CI side, which rejects `.only`) and this worktree's value is `true`. Keep true-to-false, unknown and unrecognized values keyed. Compare known boolean hashes; store no config value. Apply the same one-direction rule to `watch` if the reproduction shows the same shape, and say so.
- S1: make `test/cli/ci-usage.test.ts`'s unsupported-runner test run in a real child process or an explicit resolution seam; keep its exit code, named note and unchanged-tree assertions.

Starting seam: the review's two probes as failing tests first.

Owns: `src/core/store/transfer-rekey.ts`, `transfer-import.ts`, `src/core/keys/environment-descriptor.ts` (the `importDifferences` rule), `test/store/transfer-rekey.test.ts`, the D10 tests, `test/cli/ci-usage.test.ts`.

Leave alone: `src/core/ci/`, `src/cli/ci.ts` (018-17 runs beside you); key inputs. No `pnpm run build`.

Done when: both probes fail before and pass after; S1's test passes alone and with `ci-record.test.ts`; lint and typecheck clean; `squeal status` read once (pending stated as pending).
