# Wave 10: the `manual` moment (row 019-47)

## W1: a group at `manual` runs only when asked

Use /worker. Shape: slice. Board row 019-47.

**Outcome:** `{ "name": "parity", "runner": "vitest", "tests": ["**/*-parity.test.ts"], "at": "manual" }` (and a lint group at `manual`) is accepted; its checks never start from an edit, a pause, Stop or a commit, and run on `squeal run <group>`, `run --all` and a named `status --wait <path>`.

**Read:** spec D1 (moments, as amended 2026-11-05), D3 last paragraph, D4, D5, D6; `status.md` last decision line; `research/load-split.md` section 4a.

**Starting seam:** `src/core/daemon/check-groups.ts:22` `CHECK_MOMENTS`: add `"manual"` last, and the type in `src/core/types/check-groups.ts`. Then let the compiler list the exhaustive tables (`group-text.ts`, `next-step.ts` `GROUP_RUNS`, `status-wait-groups.ts` `LEFT_FOR`, `primer.ts` `AT`, `coverage.ts` `MOMENTS`). A lead for the rest: `scheduler/slow-trigger.ts` `momentHolds` returns false for `manual`; the `at === "commit"` held tests in `slow-tier.ts` (`holdsFollowers`, `#publishUntriggered`), `scheduler.ts` `#drainable` and `core/commit/compute.ts` `held` become one "held until asked or committed" predicate, while `scheduler/commit-moment.ts` `commitGroups` stays `commit` only; lint: `lint/pass/moment.ts` (`MOMENTS`, `heldBy`) holds it, released only by `src/cli/run-lint-group.ts`.

**Stop:** `src/harness/shared/stop-required.ts` is the one owner of Stop holds; a `manual` group is never required there, at the 2 s entry or the waiting entry. `state/required.ts` likewise.

**Owns:** the files above, `src/core/daemon/policy-checks*.ts`, their tests, and `references/policy.md` in every plugin that has one (`plugins/claude-code`, `codex-runtime`, `codex/seed`, `pi`). Leave alone: spec, status, board, bundles, version.

**Done when:** tests show, for a Vitest group, a node:test group and a lint group at `manual`: the loader accepts it and rejects `after: ["<manual group>"]` from an earlier moment; an edit, a pause, Stop (both entries) and a commit start none of its checks and Stop does not hold for them; `squeal run <group>` and `run --all` run them; status and primer name "waits for `squeal run <group>`"; nothing reads as current. Lint, typecheck and `squeal status --wait 60000 <changed paths>` clean. No build in your tree.
