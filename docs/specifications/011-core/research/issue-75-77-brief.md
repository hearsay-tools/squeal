# Research brief 011-133: what starts the old-version daemons in a handover that does not converge

Use /researcher. Shape: research.

Outcome: findings that name what starts the old-version daemons in the gh-75 and gh-77 reports, or show that nothing does on 0.1.273, with the repair as one proposed row.

## Read first

- `docs/triage/2026-10-23-digest.md` group A: the facts, the source and spec readings, the lead and the overlaps.
- `research/issue-75.md`, `research/issue-77.md`, `research/probes/issue-75/` (its README and `probe.mjs`).
- Spec 011 C8 and C9, and `status.md` lines for 011-30 to 011-34, 011-110, 011-111 and 011-113.
- Issues [#75](https://github.com/hearsay-tools/squeal/issues/75) and [#77](https://github.com/hearsay-tools/squeal/issues/77), with `gh issue view <n> --comments`.

## Questions

1. **What the store kept.** Find the Squeal store of the cezarion checkout on this host. Copy its database files to `/tmp` with `cp` and open only the copy. For 2026-10-22, 10:00 to 15:30Z, list each daemon record, exit note and `daemon-handoff` claim: version, executable path, start time, pid, end. Say what the notes' cap pruned.
2. **A probe with what the reports had.** Extend `probes/issue-75/probe.mjs` on the 0.1.271, 0.1.272 and 0.1.273 release bundles: three versions in one worktree (an old daemon, newer hooks, a `start` and a spawn from a third version), kept-copy runtimes, one real test tier and a writer that holds the store. Record each daemon incarnation, its executable and its spawner, each claim and each exit note.
3. **The verdicts.** Does 0.1.273 still loop? Does a named wait's first read still return busy? Does a Stop wake come from a liveness change or from unchanged state? Is 011-126's event-loop hold on a busy store (fixed in 0.1.273) a cause?
4. **The repair**, as one proposed row: its spec sentences, its files and its regression tests.

## Rules

- `git clone` this repository under `/tmp` for bundles and scratch, never `git worktree add`. Run every probe daemon with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`, at most 4 test workers. No build in your worktree. Never run a script under `evals/bin/`.
- The live host is read-only evidence. Never connect to a live daemon's socket, open a live store, or signal a process you did not start.
- Step 2 runs only while the one-minute load is below 16 on this host's 24 CPUs. Record the load beside each run.
- From cezarion's store, quote only versions, times, pids, executable paths and record kinds; no test names but the file the issues name.
- At the end, stop what you started, remove your clones and copies, and show that nothing of them is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Budget about three hours.

Own `research/issue-75-77.md` and `research/probes/issue-75/` only. Edit no board, spec, status, config, test or product file.

Done when every numbered question has a tagged answer, or "not determined, because". Commit.
