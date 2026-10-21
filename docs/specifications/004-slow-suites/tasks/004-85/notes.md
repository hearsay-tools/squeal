# 004-85: status names the slow tier's wait, not Idle

Shape: slice, tests only. One new file, `test/status/slow-only-wait.test.ts`. No `src/` change was needed: 011-29 (0.1.234) already met the row's contract by deleting the work line, so the line "gives way" to the `Slow tier:` line.

## What the regressions pin

- **Every queued file slow, held for the load guard, then for the slot** (two cases each): `squeal status` and the pathless wait's text (`waitText`) print no `Idle` line, no `nothing is running` words, no `Outstanding:` line that names a held slow file, and the wait's words exactly once, on the line that starts `Slow tier: 2 test files; 2 pending, `. In `squeal status` there is no `Outstanding:` block at all, and the known-failures clause reads `not current: 2 of 3 test files (2 queued)`.
- **The wait's verdict line** starts `Returned on quiet: the 1 test file the edits since revision 1 re-keyed is not pending, ...; this wait does not hold for the rest of the worktree; 2 slow files are not current and Squeal runs them after the fast tests; `. It does not repeat the wait's reason.
- **The control**: a fast file queued with nothing running, beside the same held slow files, prints one `Outstanding:` group, `1 test file queued...: src/a.test.ts`, and no group for the slow files.

## Decisions the brief did not settle

- **The slot case seeds only the published activity** (`{ kind: "waiting", for: "slot" }`, `src/core/slow/state.ts`). Status reads that row and not the slot directory, so a second worktree that holds the slot changes no text here. 004-84's slot tests own the scheduler side.
- **Load per case.** The load case reads status at `BUSY` (30.2 on 24 CPUs), the slot case at `QUIET`, as the daemon would see the host for each reason. No line of the default text depends on it today.
- **The control has the held slow files beside the fast file**, not a fast file alone. One text then shows the fast file in `Outstanding:` and the slow files out of it. A fast file alone is already covered by `test/status/outstanding.test.ts`.
- **Only the edit-window quiet is tested.** The fallback quiet (`Returned on quiet: nothing pending ...`) cannot happen with a slow file pending: `isPending(header)` in `src/cli/status-wait.ts` counts it.
- **Assertions match on the slow tier's own words** (`waiting for host load to drop`, `waiting for the slow slot another worktree's slow tier holds`) and on line prefixes, not on whole lines that 011-29 or D8 own, so a wording change elsewhere does not break these tests for the wrong reason.

## Mutation check

In `src/core/status/outstanding.ts:106` I changed `if (slow.isSlow(file.testFile) && !held) continue;` to `if (false && slow.isSlow(file.testFile) && !held) continue;`. The held slow files then join a queued group. `npx vitest run test/status/slow-only-wait.test.ts` failed all 5 tests (`expected [ Array(1) ] to deeply equal []` for the four slow-only cases, `expected [ …(2) ] to have a length of 1 but got 2` for the control). I then restored the file with `git checkout`. The mutation was never committed.

## Seen, not asserted (for the coordinator)

- The `Affected checks` line names the held slow files by path: `among them 2 slow test files, test/e2e/a.test.ts and test/e2e/b.test.ts: \`squeal run --slow --wait 60000\` waits for their results` (004-83's wording). This line does not read as a stuck daemon, so it is not a finding.
- The control's fast group reads `queued; no run is open and nothing recorded holds it: src/a.test.ts; the store records no reason the daemon has not taken it`. That is correct for a fast file that nothing holds, also when the host load is high: the load guard holds slow files only.
