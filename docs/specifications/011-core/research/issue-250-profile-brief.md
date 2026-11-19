# Brief: row 011-408, where a two-file named status spends 10 s of CPU (#250)

Use /researcher. Approved by the human on 2026-11-19 (card of coordinator 4abb5168: "Yes, diagnose now"). Research only; no product change.

**Question.** Issue #250: on 0.1.567, at load 43 to 46 on 24 CPUs, `squeal status --json <2 listed test files>` with no wait took 13 s wall and 10.5 s user CPU, and `--wait 60000` ended after 74 s. Where does that CPU go, and did 0.1.567 make it worse than 0.1.566?

**Read first.** `research/issue-250.md` (triage, source only: the final read builds a whole-worktree snapshot, `src/core/status/snapshot.ts`; synchronous terminal work is outside the deadline; 011-403's stored-walk fallback is bypassed for listed test paths). Spec 011 C6 (011-42 amendment), C15. Rows 011-398, 011-403.

**Method.**
1. Pick the largest Squeal store on this host by `test_file_keys` and state rows (the squawk/cezar clone is the reporter's shape). Copy it into your scratch folder; never open the original for writing, start no daemon on it, never touch the real HOME (set `HOME` and `XDG_*` to scratch).
2. Take the CLI bundles of both releases from git: `git show squeal--v0.1.566:plugins/claude-code/dist/cli/squeal.mjs` and the same for `squeal--v0.1.567` (and current main for comparison).
3. Run the issue's no-wait named status for two listed test files on the copy, at least 5 times per version, with `/usr/bin/time -v` and `node --cpu-prof`. Then name the phases: store open, sync attempt, named selection, verdict, whole snapshot, rendering, with wall and CPU each. Count the rows each phase reads.
4. Say whether a missing daemon changes the path compared with a late one; reproduce the late-daemon case only if it needs no daemon on the real store.
5. Make no CPU load on purpose; report the host's load per run. Do not use the lab VM (in use).

**Done when.** `research/issue-250-profile.md` gives CPU and wall per phase per version with tagged evidence, says whether 0.1.567 regressed, and names the smallest fix with its expected saving. Probes under `research/probes/issue-250/`. Timebox about 90 minutes. Write `~`, never a home path.
