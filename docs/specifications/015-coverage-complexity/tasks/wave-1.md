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

## W4: 015-08, the first edit to a standing failure (after W2 and W3 are integrated)

Briefed when W2 and W3 land on the candidate: D6's last rule, on W2's body-hash change and W3's view marks. It is dropped if it proves complex.
