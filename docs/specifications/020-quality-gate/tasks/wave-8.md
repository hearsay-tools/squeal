# Spec 020 wave 8: the quality cleanup

Approved by the human on 2026-11-11 ("Cleanup: Run now"). Source: `quality/2026-11.md`. No behavior changes: every existing test passes unchanged, apart from moved imports; no key, report or text changes; `KEY_FORMAT_VERSION` and `QUALITY_POLICY_VERSION` stay.

Order: 020-22a and 020-22b now, in parallel. Then 020-23 and 020-24 (test helpers), one worker. 020-21 waits for spec 021 wave 1, which owns `src/core/daemon/daemon.ts`. Slice 8 waits for spec 021 too (`src/core/store/open.ts`).

Every row:
- Read `docs/styleguide.md` and the named parts of `quality/2026-11.md`.
- One commit per slice, subject naming the slice.
- Do not run `pnpm run build` or a full suite. Before you finish, run `pnpm run lint`, `pnpm run typecheck`, `test/keys/key-format.test.ts`, and read `squeal status --wait 60000 <changed paths>`. Bundle drift is expected.
- Spec 021 (coordinator 52f4f62a) owns `src/cli/{hold,stopped-mark,start,store-writes,ps,ps-index,runner-host,main}.ts`, `src/core/scheduler/{runner-work,batch}.ts`, `src/core/daemon/{daemon,lifecycle}.ts`, `src/core/store/{busy,connection,open,prune,lock-holders}.ts`, `src/core/delivery/{held-connection,code-source,prepared}.ts` and `src/core/runner-host/`. Do not edit them.

## 020-22a the gate's own files

Use /worker. Shape: finish.

Outcome: `src/core/code/gate/collect.ts`, `prepare.ts` and `report.ts` are each under 300 lines, and the gate's duplicate rules have one owner.

Do: row `proposed-collect-split`; slices 3, 4, 5, 6, 7, 12, 13, 14, 15, 19.

Owns: `src/core/code/gate/{collect,plan,prepare,report,rule,evaluate,scope,prerun,records}.ts` and new files beside them; `src/cli/code-gate*.ts`, `src/cli/code.ts` (one comment); their tests. In `keep.ts`, only slice 3's `refKey` replacement.

## 020-22b shared seams around the gate

Use /worker. Shape: finish.

Outcome: the gate reuses the daemon's and `ci`'s helpers instead of copies.

Do: slices 1, 2, 9, 10, 11, 16, 17, 18.

Owns: `src/core/scheduler/ledger.ts`, `src/core/code/gate/{stored,keep,keep-expected,parts,parts-environment}.ts`, `src/core/ci/{export,parts}.ts`, `src/cli/ci-export.ts`, `src/runners/vitest/{observe,ci-runs}.ts`, `src/core/daemon/full-check.ts`, `src/cli/code-coverage.ts`, `src/cli/code-crap-reason.ts`, `src/core/delivery/code-coverage.ts`, `src/core/code/coverage/{mapper,drops}.ts`, `src/core/code/crap/loaders.ts`, `src/core/types/code-delivery.ts`, and their tests. Leave `refKey` in `keep.ts` to 020-22a.

## 020-23+24 test helpers

Starts after 020-22a and 020-22b are integrated; the coordinator writes the baseline here.

Use /worker. Shape: finish.

Do: rows `proposed-gate-cli-test-kit` and `proposed-gate-core-test-fixtures`.

Owns: `test/cli/code-gate*`, `test/code/gate/*`, and new kit files beside them. Test files only.

Done when: every test in those folders passes with the same names and count; `code-gate-parts-cases.test.ts` is under 300 lines.

## 020-21 one Vitest adapter rule, and the cleanup edits in spec 021's files

Starts now that spec 021 wave 1 (0.1.436) is on main. Baseline: the wave 8 integration branch `w8/int`, which holds 020-22a and 020-22b on 0.1.436.

Use /worker. Shape: finish. No behavior change.

Do:
- row `proposed-runs-vitest` in `quality/2026-11.md`: one owner for "Vitest runs here when no other runner is configured, or Vitest is detected", and one set of its daemon options;
- the left-overs of 020-22b: drop the dead `listed` spread in `src/core/scheduler/runner-work.ts`; use `OBSERVED_META_KEYS` (`src/core/keys/observed-rows.ts`) in `src/core/daemon/lifecycle.ts`; import `BUSY_BOUND_MS` in `src/cli/store-writes.ts` from `src/core/store/sliced-write.ts`;
- slice 8: export one read-only store open with the schema check from `src/core/store/open.ts`, used by `src/core/code/gate/stored.ts` and `src/cli/code-gate-durations.ts`.

Owns: the files those name, `src/core/daemon/daemon.ts` and the other places the quality row lists, and their tests. Leave `test/cli/code-gate*` and `test/code/gate/*` test helpers to 020-23+24.

Done when: lint, typecheck and `test/keys/key-format.test.ts` pass with keys unchanged; the tests of each changed file pass; no behavior change.
