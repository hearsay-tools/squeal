# Wave 1 of spec 015: complexity

Three rows in parallel on wave 0's interface, then 015-08 on top of 015-06 and 015-07. They share one candidate with wave 0 and one review (015-09). Briefed by coordinator 52e58f23 on 2026-10-24. Every row starts from wave 0's commit and reads `tasks/015-04/notes.md` first: its seam map, the types to import, and its 17 decisions.

All rows: `spec.md` and `status.md`. Not yours: the board, spec text, bundles (`plugins/*/dist`), the version, the main store's schema. No `npm run build`. Final message: the decisions the spec did not settle, any type change, and the output of lint, typecheck and `squeal run --all --wait`.

## W1: 015-05, the counter

Use /worker. Shape: slice. Outcome: `countFile(text, language): Promise<FileCount>` in `src/core/code/count/index.ts` returns every function of a file with D2's identity, range, body hash, CC and decision points by kind, by D3's rules.

- **Seams.** Copy `tree-sitter-tsx.wasm` unchanged from the `tree-sitter-typescript` npm package into `src/core/code/count/`, with a README, as 007 did for Python (`src/runners/pytest/graph/README.md`). In `src/harness/build.ts`, copy it into every plugin's `dist/`. One `web-tree-sitter` runtime and one Python grammar per plugin: reuse the shipped ones. The counting rules follow `research/complexity-and-crap.md` 1 and 4, and the anonymous-function naming follows D2.
- **Owns.** `src/core/code/count/**`, the grammar's block in `build.ts`, `test/code/count/**`, `test/fixtures/code/**`.
- **Done when.** The constructs fixture equals ESLint's classic counts and radon's. All of `src/` at a pinned commit equals stored ESLint counts, which you generate under `/tmp`. Duplicate names get occurrences, and anonymous functions are named by call site. Report the times per file.

## W2: 015-06, the daemon's pass and the states

Use /worker. Shape: slice. Outcome: on each revision the daemon counts the included files the revision changed and records states and transitions in the code store, by D1, D2, D4 and D5.

- **Seams.** `src/core/code/pass/**`, new. It starts from one call where the daemon handles a new revision; find it from `src/core/daemon-loop/` and `src/core/revision/`. The pass does:
  - the included set (D1, test files and the size limit included);
  - the blob lookup;
  - slices of 200 files;
  - the first count;
  - moves by body hash;
  - removed functions;
  - the recount on a policy change, with one summary record.

  Import `countFile` from W1's path. Until it exists, inject a fake counter in tests.
- **Owns.** `src/core/code/pass/**`, `src/core/code/store/schema.ts` and its repos if V1 must change (only this row edits them; D6's "too big, told once" record goes here, notes 16), that daemon call site, `test/code/pass/**`. 011 wave 26 W3 (worker a415f243) edits `src/core/daemon/{composite-runner,runner-set,node-test-runners,pytest-runners}.ts` and the scheduler's `queue.ts` and `tiers.ts`: stay out of them.
- **Done when.**
  - Identity and state tests cover every row of D5's table.
  - Two worktrees at one blob count it once.
  - With the policy off, nothing is counted and no `code.sqlite` exists.
  - A 300-file pull keeps the hooks within their bound.

## W3: 015-07, delivery, status and `squeal code`

Use /worker. Shape: slice. Outcome: the agent sees D6 (without its first-edit rule) and D7, read from the code store.

- **Seams.**
  - Delivery, in `src/core/delivery/` (`delta.ts`, `format.ts`, `registered.ts`): the registration line, the FAIL and PASS lines after the test failures, the 5-line limit, the summary line, and the too-big line, using W2's record.
  - Status: the line and the `code` JSON in `src/core/status/format-status.ts` and `snapshot.ts`.
  - The command: `src/cli/code.ts`, new, registered in `src/cli/main.ts`.
  - D7: Stop's check in `src/harness/shared/stop.ts`.
  - Docs: the keys and the command in `plugins/*/skills/squeal/references/{policy,commands}.md`. Add sections of your own; 011 wave 26 W1 (worker fa8e6ec2) edits the `baseline` lines there.
- **Owns.** Those files and `test/code/delivery/**`.
- **Done when.**
  - With the policy off, every delivery and status is byte-identical.
  - Delivery tests cover goals 3, 4 and 7, from seeded code store rows.
  - The `squeal code --json` shape is tested.
  - One integration test each passes through the Claude Code and the Codex hook.

## W4: 015-08, the first edit to a standing failure

Use /worker. Shape: slice. Starts from `int/015` with 015-04 to 015-07 integrated. Outcome: goal 5. The first edit in a session to a function that was over the threshold before it and is still over after it delivers one line about that function, once per session. It is dropped if it proves complex.

- **Read.** D6, its last rule; `tasks/015-06/notes.md`, "For the next rows"; `tasks/015-07/notes.md`, "For 015-08".
- **Seams.** The pass already returns `PassReport.edited`: the checks whose identity stayed and whose body hash changed (015-06). Store it where the hooks can read it. The lead is a revision column, for example `edited_at`, on the states row: V1 is unreleased, so edit V1 itself, and set the column in the pass's last transaction. In `tellCode`'s plan (`src/core/delivery/code-*.ts`), a `fail` state whose view entry is told by `count` and whose `edited_at` is after the view's `toldAt` or seed is told in full once, and the entry is written as `full`. The line must not read as a new failure: it says the function was already over before the edit.
- **Owns.** `src/core/code/pass/**`; the column in `src/core/code/store/{schema,states,types}.ts`; `src/core/delivery/code-*.ts`; `test/code/**`; `tasks/015-08/`. Nothing else.
- **Done when.**
  - The first edit that leaves the function over tells it once, in full.
  - A second edit in the same session is quiet.
  - Another session gets its own one line.
  - A move with the same body tells nothing.
  - `PASS -> FAIL` and `FAIL -> PASS` are told as before.
  - Lint, typecheck and `squeal run --all --wait` pass; paste their output.

## 015-09: review of candidate 0.1.283

Spawned by coordinator 52e58f23 on 2026-10-24 (reviewer 5cbd5f63, codex gpt-6.1-sol high), pinned to `cand/0.1.283` at de9deb5bc. The brief as given:

### Review 015-09: candidate 0.1.283 (spec 015 waves 0 and 1)

Use /reviewer. Candidate `cand/0.1.283` at de9deb5bcde5861eb8e284c7a45406a69657fa73. Range: `origin/main` (ab48c6833)..de9deb5bc, the 015-04 to 015-08 commits plus one build commit (bundles, version 0.1.283). Write `docs/specifications/015-coverage-complexity/reviews/0.1.283.md` and commit it on your branch.

Read `docs/specifications/015-coverage-complexity/spec.md` (D1 to D7; D8 to D10 are wave 2 and out of scope), `status.md`, the notes under `tasks/015-04/` to `tasks/015-08/`, and `tasks/wave-0.md`, `tasks/wave-1.md`.

Check against the spec's goals 1 to 8, with proof where you can:
1. **Policy off.** Nothing changes: no `code.sqlite`, the main store's `user_version` stays 1, and deliveries, status and exit codes are byte-identical.
2. **Hook bounds.** A busy or corrupt code store never stalls or fails a hook, status or Stop (011 C8, C13). A pull of many files keeps hooks within their bound.
3. **Counting.** The counter matches ESLint classic and radon (the pinned fixtures). Identity, occurrences, names by call site, and moves by body hash.
4. **States and transitions.** D5's table, with no first-seen-fail at a first count. A code-only change never keeps the agent going at Stop and never denies a tool call (D7).
5. **Delivery.** The registration count line, the 5-line limit, the summary lines (`first`, `threshold`, `include`, `counter`), the too-big line, `STILL FAIL` once per session (015-08), and the `squeal code` shape and exit codes.
6. **Bundles.** All four plugins ship `dist/code/tree-sitter-tsx.wasm`. The shared web-tree-sitter runtime is started once (015-05 notes 8). There are no duplicate grammars.

Known and accepted, for you to weigh, not to re-find:
- The code-only title counts a `STILL FAIL` line as "1 complexity change" (`src/core/delivery/format.ts`).
- No caller runs `CodeStore.prune` yet (015-06 notes).
- Pi and OpenCode get the code part only through `openContext`.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Label every finding proven, plausible or unverified; only a proven break blocks. Verdict PASS or FAIL.

## Repair of review 0.1.283 (round 1 FAIL): rows 015-16 and 015-17

Two workers in parallel on disjoint files, both from the candidate `cand/0.1.283` at de9deb5bc. Briefed by coordinator 52e58f23 on 2026-10-24 (R1 worker fd003b1e, R2 worker 15f7d48e, claude opus xhigh). Each got this section plus the review file, with its reproductions, "Worker-sized fix" paragraphs and "Inputs for the repair" section. Test first: each blocker gets a failing regression before its fix. Not theirs: the bundles (`plugins/*/dist`; the bundle-drift tests fail again after a source change, expected), the version, the board, spec text. No `npm run build`.

### R1: 015-16, B1, B3 and B4

Use /worker. Shape: repair.
- **B1.** Any code-store failure inside a code operation, corruption included, costs only the code part. Test status, registration, delivery and Stop stay as they would be without code. The seam is `withCode` in `src/core/delivery/code-source.ts`; touch its callers (`src/core/status/code-status.ts`, `src/core/delivery/code-deliver.ts`, `src/harness/shared/stop-code.ts`) only if needed. Add no integrity scan in a hook.
- **B3.** A zero-width parse error, as at a missing closing brace, belongs to the function whose end it touches. That function is `unknown`, with no transition; an adjacent healthy function stays judged. The seam is `overlaps` in `src/core/code/pass/judge.ts`; change only that rule there.
- **B4.** `squeal code` names every file whose stored count has `errors`, from `FileCount.errors`, with the number of affected functions as detail. The seam is `src/cli/code-report.ts`.
- **Owns.** Those files, `test/code/delivery/**` and a new `test/code/pass/judge-errors.test.ts`.
- **Done when.**
  - B1: a regression with a physically corrupt data page and a healthy main store keeps status available, registration delivered, and delivery and Stop unaffected.
  - B3: real-parser tests cover a missing brace and other end-of-file tokens, and show that an existing fail is not recovered by such an edit.
  - B4: text and JSON tests cover a file with no function and an error outside a healthy function.

### R2: 015-17, B2 and B5

Use /worker. Shape: repair.
- **B2.** A move carries the old check's transitions to the new identity, in the same transaction as its state and view entries, keeping their original revision and time. It records no new transition. The seam is `move` in `src/core/code/store/states.ts`.
- **B5.** The body provenance of the last judged state survives a skipped or failed count. Old bodies come from the blob the retained state was judged on, never from a pending `files` row. The seams are `oldBodies` and the retry path in `src/core/code/pass/{pass.ts,blobs.ts}`.
- **Owns.** `src/core/code/store/{states,types,schema}.ts`, `src/core/code/pass/{pass,blobs,types}.ts`, `test/code/pass/**` (except R1's new file) and store tests. Not theirs: `judge.ts` (R1), `code-source.ts` and `code-report.ts` (R1).
- **Done when.**
  - B2: a crossing moved before delivery and one moved after it keep `wentOverSince`, the Stop reason with `complexity.blocking`, status's session count and `squeal code --changed`.
  - B5: two edits that overtake a count give one `STILL FAIL` line, then a quiet second delivery.
  - The existing pass, slice and move tests still pass.

S1 (a transient counter error leaves a file pending) is not in this repair; it is planned row 015-18.
