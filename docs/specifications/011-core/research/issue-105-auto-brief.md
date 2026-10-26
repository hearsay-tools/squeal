# Research brief 011-261: can Squeal tell a runtime-state file from a real test input by itself (gh-105)

Use /researcher. Shape: research, bounded. Outcome: whether an automatic rule can stop keying an ignored runtime-state file that tests read, such as cezarion's `.ai/qa/test-env.json`, and still keep every real ignored input; if none can, say so.

## Why

Issue #105. Row 011-255 (`research/issue-105-findings.md`) found the cause: since 0.1.313 (016 D4) Squeal keys a git-ignored file a test was seen to read. Cezarion's test environment rewrites `.ai/qa/test-env.json` (a pid, a port, a start time) at each boot and idle stop, from `globalSetup` and a detached watcher, which the recorder does not see. Each rewrite re-keys 32 slow browser specs: 58 revisions in 22 h. The human chose on 2026-10-26 to research an automatic rule before any fix, over a "not an input" setting in `squeal.config.json`.

## Read first

`research/issue-105-findings.md` (all of it, with its open question 3); `016-extensions/spec.md` D4 and `016-extensions/research/ignored-paths.md`; 011 C2, C3 and C12 ("Not seen"); `src/core/scheduler/observed.ts` (`scratchOf`, the written-directory bound); `src/core/scheduler/keying.ts` (`track`, `#release`); the recorder that fills `observed.written`.

## Questions

1. **Candidate rules.** For each, how it works and what Squeal must see to apply it: (a) a write seen while Squeal's own run of a reader is in progress, before the reader reads the file, is the run's own output; (b) a write from Vitest's main process (`globalSetup`) or a non-Node child, if a hook there can see it; (c) a file that changes at each run of its readers with no other change; (d) any other signal you find. Say which ones cover the incident: an agent ran one spec by hand, outside Squeal.
2. **What each rule drops.** Apply each to the observed ignored paths in copies of cezarion's and Squeal's stores (findings, section 3) and to an E1-style clone. A rule passes only if it drops the descriptor and keeps the build output `e2e/c` reads, `packages/cezar/web/dist/index.html`, the installed lockfiles and a declared ignored input.
3. **Cost.** Per passing rule: the seams, the cost per run, and whether stored results stay valid (no re-key of every check; `docs/process.md` and row 011-35).
4. **Recommendation.** The best passing rule against the not-an-input setting, with the failure case each one leaves.

## Rules

- Never open a live store or socket: read copies of the store files only. Never signal a process you did not start. Never run a script under `evals/bin/`, `tasks/*/probe/` or `research/probes/`, except your own under `research/probes/issue-105-auto/`.
- Experiments run in clones under `/tmp`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and `PLUGIN_DATA` under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA` first. Nice 10. A browser test may run once per question. Give the one-minute load beside every timing. Make no CPU load on purpose.
- Stop everything you started and remove your clones at the end.
- Tag every finding as `research/issue-1-brief.md` lists. Budget about two hours.

Own `research/issue-105-auto-findings.md` and `research/probes/issue-105-auto/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 4 each have an answer with tags, and the probe README says how to re-run each experiment. Commit.
