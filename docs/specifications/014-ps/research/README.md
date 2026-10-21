# Research for spec 014

The human's need (2026-10-21): one command that shows what occupies the host, so they can check that it makes sense and catch what should not be up. The decisions so far are in `../status.md`.

## The snapshot that started it

2026-10-21, one `ps` read by the coordinator; an observation, not a measurement. Load 36.8 on 24 CPUs; 48 GB memory, 15 GB available. 20 processes ran `squeal.mjs daemon`: 18 for cezar worktrees and 2 for squeal worktrees; 14 from the Codex plugin cache and 6 from Claude Code's; 18 on 0.1.235 and 2 on 0.1.234 (both from Claude Code's cache). RSS per daemon 154 to 2,234 MiB, 19.6 GiB together; in the three sampled, PSS was 65 to 93% of RSS, nearly all anonymous. `ps` put their lifetime CPU at 308% of one CPU together. 50 processes ran at nice 10.

## Rules for every brief

- Use /researcher. Read-only on the product. Own only your findings file and `probes/<topic>/`. Edit no board, spec, status, test or product file.
- The live host is evidence, read-only: `ps`, `/proc/<pid>/*`, `ls` and `stat` of `$XDG_RUNTIME_DIR`, `/tmp/squeal-*` and the stores. Never connect to a live daemon's socket, never open a live store for writing, never stop, signal or renice a process. Other projects' sessions run there.
- An experiment that needs a daemon runs your own: a scratch repository under `/tmp` with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` set there, with the installed 0.1.235 bundle or this checkout's source; at most five test files; no `npm run build` in your worktree. Stop it before you finish and show nothing of it is left.
- Record the one-minute load beside every timing. No full suite.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`.
- Budget about ninety minutes; then write what you have. Done when every numbered question has a tagged answer, the recommendation names its numbers and the limits are stated; commit.

## Briefs

- [daemon-discovery-brief](daemon-discovery-brief.md) (014-01): finding every live daemon of the user and what each can say about its work. Findings go to `daemon-discovery.md`.
- [process-measurement-brief](process-measurement-brief.md) (014-02): CPU and memory per process, tying each test process to its daemon, lane and file, the host totals. Findings go to `process-measurement.md`.
- [should-not-be-up-brief](should-not-be-up-brief.md) (014-03): the states to flag, each with a rule and the command that ends it, and how comparable tools lay out such a list. Findings go to `should-not-be-up.md`.
