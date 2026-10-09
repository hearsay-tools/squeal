# 004 wave 6: confirm the fixed loop, then ship

Decided by the human 2026-10-09 ("Confirm when calm"): once the host is quiet, a short confirmation dogfood of waves 5.5 and 5.6; spec 004 ships if it is clean. Dispatch only when the other coordinators' suites are not running and the load is below about 6 (24 CPUs).

## 004-53 confirmation dogfood: the revision loop stays closed in real use

Outcome: a `lessons.md` addendum, "Confirmation at 0.1.7x+", with a verdict and evidence per check. About 45 minutes; a check, not a third dogfood.

Read: `lessons.md` ("Re-dogfood at 0.1.68", defect 10 and its setup), spec 004 D2, D5, D6, `status.md`'s last six lines, `plugins/claude-code/README.md`.

Setup as in 004-46: this repository at `origin/main` (0.1.75 or later) in `/tmp/squeal-dogfood3-<yours>`, `npm ci`, `npm run build`; uncommitted config with `test/e2e/**` declared slow AND the original broad globs `test/fixtures/node-test/**` and `test/fixtures/vitest/**` restored (undoing `b70fcc2` there only). The shared store a pre-fix daemon wrote is the warm-store case 004-50 fixed; keep it. Sessions: `claude --plugin-dir <worktree>/plugins/claude-code --model opus` with `squeal@hearsay` disabled in that session's `.claude/settings.local.json`. Never Fable; never read credentials; never edit `~/.claude` or `~/.codex`.

Check, with timestamps and daemon notes: (1, defect 10) after a session's edits and the node:test runs that write `.tmp`, the revision number settles; record it every minute for 10 idle minutes. (2) a `claude -p` session ending with slow files pending: the drain. (3) an idle slow tier's width and the line naming its running files. (4, defects 11, 12, 15) the line after a session ends, after a daemon restart, after a revert, against the truth.

Owns: `docs/specifications/004-slow-suites/lessons.md` (the addendum only), throwaway scripts under `research/probes/dogfood3/` with a README. No product code: name defects with reproductions. No CPU burners; stop every daemon you start; never kill what you did not start; remove the worktree.

Done when: each check has a verdict with evidence; the worktree is removed.

Use /worker.

## 004-52 a predecessor's saved closure does not re-add dropped scratch

Outcome: `reviews/wave-5.6.md` S1 closed. Read the review and 004-50's commits (`git log --grep 004-50`). Start at the bootstrap drop in the keys layer that 004-50 added; a first lead is to filter a stored combined closure's paths through the same 004-47 rule before they become extras. Owns the keys bootstrap and its tests; leave `src/core/scheduler/` alone. Done when: a test with a complete predecessor store (hashes and saved closures) shows the dropped paths stay out of the watch set and no revision follows a full interval pass. Nonblocking; may run after 004-53.

Use /worker.
