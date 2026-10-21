# Research brief 013-05: the Vitest instance a close leaves alive

Use /researcher. Shape: research. Outcome: whether Squeal's own recreate and slow-lane drain leak a whole Vitest instance in a real daemon, which Vitest, Vite and Rolldown versions leak, and which fix Squeal can make itself. This is the input to code row 013-06 (the human chose this row on 2026-10-21).

## Why

011-53 (`../../011-core/research/daemon-memory.md` 3) found in a script that closing a Vitest 4.1.10 instance frees nothing. Rolldown 1.1.5 keeps a global handle on Vite 8.1.4's `onWarn` callback (`vite/dist/node/chunks/node.js` lines 32035 to 32107), and that callback holds the closed instance and its module graph. Three close-and-reopen cycles kept 3 instances alive, and private memory went from 741 to 1,759 MiB. Squeal closes and reopens its instance in `#recreate` (`src/runners/vitest/adapter.ts`: a config or install change, a pending touch of a file it read) and drops the slow instance when its lane drains (`src/core/daemon/slow-instance.ts`). Neither was measured in a daemon.

## Read first

`daemon-memory.md` 3 and its probes (`leak-check.mjs`, `retainers.py`, `snapshot.mjs`, `close-reopen.mjs`); 013 V1, V5 and V8; 004 D2 (the slow instance).

## Questions

1. **In a daemon.** Count the live `Vitest` instances from a heap snapshot after N recreates (for example a config touch) and after N slow-lane drains, on a small fixture and on a cezar clone. Give the memory per leaked instance.
2. **Versions.** Which combinations leak: Squeal's own dev Vitest and Vite; cezar's (Vitest 4.1.10, Vite 8.1.4, Rolldown 1.1.5); the latest Vite 8 and Rolldown; Vite 7, which has no Rolldown. Install each in a scratch project under `/tmp`.
3. **Fixes Squeal can make**, each with its cost and risk: break the retainer after a close (what to clear, and whether that is safe across versions); run the slow lane's instance in a child process; reuse an instance where a close is not needed; restart the daemon after a bound of leaked instances. Name the one 013-06 should build.
4. **The upstream report.** Which project owns the fix (Vite or Rolldown), a minimal reproduction, and the text of an issue. Do not file it: the human decides.

## Rules

As in `../../011-core/research/daemon-memory-brief.md`, Rules: the live host is read-only; a `git clone` under `/tmp`, never a worktree of a live repository; your own daemon with `HOME`, `XDG_*` and `TMPDIR` under `/tmp`; at most 4 test workers; the slow lane on only where question 1 needs it; live measurement only while the one-minute load is below 24, with the load beside every number; at the end, nothing of yours left. Tag every finding. Budget about two hours.

Own `vitest-close-leak.md` and `probes/vitest-close-leak/` only. Edit no board, spec, status, test or product file.

Done when every question has a tagged answer or "not determined, because", the recommendation names the fix for 013-06 with its numbers, and the issue text is in the findings file. Commit.
