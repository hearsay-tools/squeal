# Wave 13 of spec 011

Three rows the human approved on 2026-10-22 (digest `triage/2026-10-22-digest.md`), now free since 011-32, 011-34 and 005-75 shipped in 0.1.261. Their seams are disjoint, so they run in parallel from main with 0.1.261. 005-77 is a spec 005 row; its brief is here so that the wave has one file.

## W1: 011-66 and 011-106, a tier the daemon cannot finish is re-queued, never stored

Use /worker. Shape: slice, one commit per row, 011-66 first.

Outcome: a tier that crashes while its daemon stops, or whose daemon's own runtime is gone, leaves its files queued and stores no FAIL or UNKNOWN for them.

Read board rows 011-66 and 011-106, `research/issue-50.md` (Recommendation), `research/issue-72.md` with `research/probes/issue-72/probe.sh`, the digest's group A, and spec 011 C4, C5, C9 and C11.

Seam: the crash path in `src/core/scheduler/tiers.ts` (`end: "crashed"` and `ledger.markUnknown` near line 744), the install re-queue in `src/core/scheduler/install.ts`, and the daemon's tier start and `#shutdown("reinstalled")` in `src/core/daemon/daemon.ts`. A lead: write 011-106's three probe-shaped tests first.

Owns: those files, `src/core/scheduler/ledger.ts`, their tests, notes under `tasks/011-66/` and `tasks/011-106/`. Not yours: `src/core/delivery/` (W2), `src/harness/` and `src/cli/start.ts` (W3), `src/core/scheduler/yields.ts` and the 011-99 test files, the board, spec text, bundles, version.

Done when: both rows' done-when hold; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass, their output in your summary. Answer gh-72's open question in the notes: why the restart re-ran the two false FAILs.

## W2: 011-109, a regression notice groups checks with one error and location

Use /worker. Shape: slice.

Outcome: 91 failing checks with one first error and location read as one block with their count and one `squeal failures` command, in every harness's notice and deny reason.

Read board row 011-109, `002-codex-adapter/research/issue-71.md`, the digest's group D, spec 011 C5, and the evals parsers under `evals/lib/` that read `formatDelta`'s text.

Seam: `formatDelta` in `src/core/delivery/format.ts:244`. A lead: a test with 91 checks that share one error first.

Owns: `src/core/delivery/format.ts`, its tests, the evals parsers that read its blocks and their tests, notes under `tasks/011-109/`. Not yours: `src/harness/shared/deny.ts` (the deny-once contract is unchanged), W1's and W3's files, the board, spec text, bundles, version.

Done when: the row's done-when holds, the parsers round-trip the grouped block through the real `formatDelta`, in plain text and hook JSON; lint, typecheck and `squeal run --all --wait` pass, their output in your summary.

## W3: 005-77, a daemon the CLI spawns from the plugin cache runs from a kept copy

Use /worker. Shape: slice.

Outcome: `squeal start` run from a plugin cache path spawns a daemon whose command line names the kept copy of its version, as a SessionStart daemon does under Codex since 005-73.

Read board rows 005-77 and 005-73, `005-agent-adoption/tasks/005-73-notes.md` ("Open after this row"), and spec 005 D3.

Seam: `keepVersion` in `src/harness/shared/version-copies.ts:86`, called today only from `src/harness/codex/kept.ts:38`, and the spawn in `src/cli/start.ts:50`. A lead: a test that runs `start` from a cache path first.

Owns: `src/harness/shared/version-copies.ts`, `src/cli/start.ts`'s spawn, `src/core/daemon/ensure.ts`'s `daemonCliEntry` if the copy is chosen there, their tests, notes under `005-agent-adoption/tasks/005-77/`. Not yours: the launcher, W1's and W2's files, the board, spec text, bundles, version. No `npm run build`.

Done when: the row's done-when holds; a SessionStart spawn is unchanged; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

W3 also takes 011-110 as its last commit (steered 2026-10-22 after main CI 39755680012): `finishHandoff` in `src/cli/start.ts:123` spawns with no lock wait when it joined a live claim with the lock free; with the lock wait only when it claimed. W3 may edit `start.ts`'s `finishHandoff`, `test/daemon/start-handoff.test.ts` and `test/daemon/handover-tier.test.ts` for it.
