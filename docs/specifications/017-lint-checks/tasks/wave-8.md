# Wave 8: why lint stays pending during a gate (row 017-34, gh-238)

The human, 2026-11-27 (session bca5dbc3): "Start the approved rows". Approved 2026-11-19 ("Diagnose + show the wait"). Coordinator b468025e. Start condition met: 0.1.570 (the CPU-wait text, row 017-33) shipped 2026-11-19.

## Row 017-34 (researcher; shape: research)

**Question.** In the daemon logs of loaded worktrees on 0.1.570 and later: does lint still wait behind the CPU limit once test slots no longer cap it, and what started each full lint re-check?

**Read.** [#238](https://github.com/hearsay-tools/squeal/issues/238); `research/issue-238.md`; `research/lint-memory.md`; board row 017-33; spec 017 and spec 011 C9 (CPU admission). Daemon logs live under each repository's `.git/squeal/logs/` (this repository and its worktrees under `.ai/squawk/worktrees/`, and other projects on this host that run Squeal). Use the refusal lines and lint keying records; read the source that writes them to know what each line proves.

**Rules.** Logs and source only. No artificial load, no new daemons, no test runs, no scripts that touch the real HOME. Count over every log you can read, name the window and versions, and tag each finding `verified by experiment`, `read in source code` or `inferred`.

**Output.** `docs/specifications/017-lint-checks/research/lint-gate-stall.md`: counts of lint waits with free test slots (before and after 0.1.570), their lengths, the causes of full re-checks, and, if lint still stalls, one proposed fix row (scope and done-when). Throwaway probes under `research/probes/017-34/`. Commit on your branch; edit nothing else.

Use /researcher.
