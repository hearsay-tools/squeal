# Wave 15 (2026-10-15)

The human picked these rows on 2026-10-15. At most three workers run at once, so W4 (001-407) starts when the first of W1 to W3 lands, and after 005 has seen its brief: it edits the same header code as W2's slow-tier line. Leave `docs/board.md`, key pins and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output. A change to hooks or headers also runs `npx vitest run test/e2e/` under `flock /run/user/$(id -u)/squeal-full-run.lock` with `--maxWorkers=4`: the last wave broke there.

## W1: 001-414 and 001-416, the waiter's CPU and SubagentStop's unregister

Use /worker. Shape: research then slice. Read both board rows, spec 001's D9 and D10, and `tasks/001-415/notes.md`.

- **001-414:**
  - Find what each poll of `src/harness/shared/waiter.ts` and its callers reads. Measure the CPU per poll over a store of cezar's size: build a fixture of about 200 MB with about 20,000 checks. Don't touch cezar's store.
  - Bound a poll's work so it scales with what changed.
- **001-416:**
  - SubagentStop unregisters before it waits for pending checks, so a hook killed at its 2 s timeout has already unregistered.
  - Find out by experiment whether SubagentStart's `cwd` is the isolated worktree. Use a real `claude` in an isolated HOME (the `squeal-e2e` user, see `reference-squeal-e2e-user`); if that isn't possible, say so. Never the real HOME.

Done when tests pass for:
- An idle waiter over the fixture stays under 2% CPU; the numbers go in notes.
- A SubagentStop killed at its timeout has already unregistered.

The cwd probe's result goes in notes.

## W2: 001-412 and 001-413, "database is locked" and repeated notes

Use /worker. Shape: research then slice. Read both board rows and spec 001's D7, D8 and D12.

- **001-412:** find which write or open logged `daemon error: database is locked` with several daemons on one shared store, and what the daemon did next. 001-161, 001-207, 001-346 and 001-362 are earlier forms. Reproduce it on main with scratch stores and several daemons, or show it closed. Fix it if it is a short change; otherwise file what remains in notes.
- **001-413:**
  - Give node:test's incomplete-closure note a topic per project. 007-39's note topics keep only the latest per topic.
  - Status shows the latest restart note and counts the rest.
  - The slow-tier line names its artifacts as a count, with the list in `status --json` and `--notes`.
  - Seams: `src/runners/node-test/adapter-project.ts`, `src/core/state/slow-text.ts` and the status notes formatter.

Done when:
- 001-412 has a reproduction or evidence that it is closed.
- A test passes where three daemon starts leave one closure note per project.
- A test passes where the slow line stays under 200 characters with 25 artifacts.

## W3: 001-420, 001-421 and 001-355, a producer check and two test races

Use /worker. Shape: repair. Read the three board rows, and round 3 of `reviews/wave-14.md` for 001-420's reproducer.

- **001-420:** check a stored producer reference against the state it describes (origin, key, observed revision), and read unknown when they don't match. `src/core/state/producers.ts` and `shown-result.ts`.
- **001-421:** `test/runners/node-test/run.test.ts`, "does not start files left in the queue when the deadline passes". Name the cause and bound the test on what it means. Test-only unless the product is at fault.
- **001-355:** add a deterministic pause between the stopping daemon's socket unlink and its lock release (a test-only hook). Use it in `test/daemon/handover-gap.test.ts` and `test/e2e/stop-gap.test.ts`, keeping their lock assertions.

Done when:
- 001-420's reproducer passes as a regression.
- Both race tests and 001-421's case pass 30 runs in a row on `taskset -c 0-1` beside two busy loops.

## W4 (after a W1 to W3 slot frees, and after 005 has seen this): 001-407, the change header sends the news

Use /worker. Shape: slice. Read the board row (the human's decision), spec 001's D6 header paragraph, spec 005's D1, and whatever 005 adds to this section.

Outcome:
- A change delivery drops four things:
  - the changed paths;
  - the four-state split and the Inherited sentence, keeping only non-zero actionable counts such as `12 pending`;
  - the full-suite checkpoint sentence;
  - the slow-tier line, unless the slow tier's state changed.
- Session start, `status` and Stop keep the full block.
- Update every quoter in the same commit: 005's D1, both `plugins/*/skills/squeal/references` copies, the primer, and the pinning tests.

Seams: `formatDelta` and `headerLines` in `src/core/delivery/format.ts`.

Done when:
- Delivery tests pass for each dropped part and each kept one.
- `test/e2e/` passes under the flock.
