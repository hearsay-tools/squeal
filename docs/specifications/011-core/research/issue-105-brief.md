# Research brief 011-255: a write to a gitignored file queues slow browser tests (gh-105)

Use /researcher. Shape: research, bounded. Outcome: which gitignored files really feed test keys and which only cause runs, so a fix row can stop the waste and keep the real inputs.

## Why

Issue #105: a scratch write in an ignored folder counted as a change, and slow browser tests queued while `git status` was clean. Triage (`research/issue-105.md`) did not reproduce it under load. The human approved a bounded investigation on 2026-10-26: no fix before its findings.

## Read first

`research/issue-105.md`; issue #105; 011 C2, C3, C4 (tracked inputs, change detection, selection) and C6 (the revision header); the watcher and the ignored-path filter; how `inputs` in `squeal.config.json` declares ignored files.

## Questions

1. **Reproduce.** In a clone under `/tmp`, write to an ignored scratch path with no reader, then to a declared ignored input, then to a build output a browser project reads. For each: does the revision move, which keys change, and what queues.
2. **Why.** Where an ignored path with no keyed reader enters the revision and the selection, quoted from source.
3. **Which ignored files matter.** On this repository and cezarion, list the ignored paths that tests read (declared inputs, observed reads, build outputs) and the ones written often with no reader (`.ai/`, scratch, logs).
4. **The header.** What a revision header could name for a small and a large set of changed paths. No design beyond that.

## Rules

- Never open a live store or socket. Never signal a process you did not start. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- Experiments run in clones under `/tmp`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and `PLUGIN_DATA` under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA` first. Nice 10; a browser test may run once per question; give the one-minute load beside every timing. Make no CPU load on purpose.
- Stop everything you started and remove your clones at the end.
- Tag every finding as the issue-1 brief lists. Budget about one hour.

Own `research/issue-105-findings.md` and `research/probes/issue-105/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 4 each have an answer with tags, and the probe README says how to re-run each experiment. Commit.
