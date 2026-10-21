# Host-load wave 2: the accepted designs 011-82 and 011-83

The human, 2026-10-21: 011-82 and 011-83 accepted as recommended, after asking how edits stay fast. The answer is the rule for every row here: an edit's own tier never waits, never takes a permit, and is never held by a quiet wait. The spec text is in 011 C4 step 5, C4's checkpoint paragraph, C6, C10 and 013 V7 (`status.md`, 2026-10-21). Wave 1 (`host-load-wave-1.md`) runs beside this one: W3 (011-91 to 011-93) changes `scheduler.ts`, `ledger.ts`, `slow-tier.ts`, `lifecycle.ts` and `daemon.ts`; W1 and W2 change `src/core/keys/` and `src/runners/vitest/project.ts`.

Every worker: tests first, red before green. Your full-suite verdict is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your summary. Run `npm ci` first. No build, no bundles, no version raise, no spec text, no board. Done when your rows' tests are red before and green after, and `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W4: 011-94, the quiet wait after a cancel

Use /worker. Shape: slice. Read `tasks/011-82/design.md` sections 1.1, 2.3 and 7 (row A), C4 step 5 and C6 as amended.

Seam: `selectTier` in `src/core/scheduler/tiers.ts`. First edit, a lead: the new `src/core/scheduler/quiet.ts` (`BacklogQuiet`, `BACKLOG_QUIET_MS`) and a unit test that `selectTier` with a waiting lane and only backlog files queued starts nothing; then that an edit's file queued is taken. The backlog cancel is `cancelsBacklog` in `backlog.ts` and `yields.ts` (the design's defect note).

Owns: row A's files in section 7. In `scheduler.ts` only the pump's wake and `run --all`'s call: W3 edits other methods of that file, so keep your hunks small. Not yours: `src/runners/`, `src/core/capacity/`, `src/core/daemon/`, `ledger.ts`, `slow-tier.ts`.

## W5: 011-95, the related walk loads only listed files

Use /worker. Shape: slice. Read `tasks/011-82/design.md` sections 1.5, 2.6 and 7 (row B), 013 V7 as amended.

Seam: `relatedSpecifications` in `src/runners/vitest/related.ts`. First edit, a lead: the fixture whose `squeal.config.json` excludes `e2e/**` while Vitest includes `e2e/x.test.ts`, and row B's test 1, red on main.

Owns: `src/runners/vitest/related.ts`, `affected.ts`, their tests. Not yours: `project.ts` and `environment.ts` (wave 1), `moved.ts`, `sources.ts`, `touched.ts`, `src/core/`.

## W6: 011-96, 011-97, 011-98, the CPU cap (not dispatched yet)

Starts after 011-93 and 011-94 land (`slow-tier.ts`, `tiers.ts`), and 011-98 after 014-21 lands, whose `src/core/ps/` tree arithmetic (`cutime`, `cstime`) 011-98's `cores.ts` reuses. Read `tasks/011-83/design.md` sections 1, 2, 3.3 and 7, C10 as amended. Rows in order, one commit each, as section 7 names their seams, owned files and red-first tests. Check 011-97's risk first: Vitest's sequential group for an isolated project at `maxWorkers` 1 against `tierPart`.
