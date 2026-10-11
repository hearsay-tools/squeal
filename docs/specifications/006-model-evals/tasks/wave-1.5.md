# 006 wave 1.5: repair of `reviews/wave-1.md`

Two workers on disjoint files. Read `../reviews/wave-1.md` first; each finding names its probe, which becomes a test. Shape: repair. No subject sessions are needed: test with synthetic transcripts, fake harness binaries and made-up tokens. Never print a matched secret value.

**The contract between the two rows**, written by the runner (006-05) and read by the grader (006-06):

- `out/truth.json`: `{"vitest": C, "nodeTest": C & {"files": <count>}}`, where `C` is `{"exit": <number|null>, "signal": <string|null>, "timedOut": <bool>, "spawnError": <string|null>}`. The Vitest JSON report stays in `out/truth.vitest.json`. `truth.txt` is no longer written.
- `out/status-end.json`: the pinned CLI's `squeal status --json` output, verbatim. `status-end.txt` stays, for reading by eye.

Edge cases, settled during the wave (2026-10-11):
- A `nodeTest` with `files: 0` has every other field null or false. The fixture always ships a node:test file, so this means the suite is gone: truth unavailable.
- A command that could not start has `exit: null` and `spawnError` set: truth unavailable.
- `status-end.json` is written only when the plugin is on. Under a variant that removes the plugin, Squeal's state is not applicable and the claim is graded against ground truth alone. With the plugin on, a missing or unparsable file means Squeal's state is unavailable.

A cell without these files (the 005-07 import) has no truth for the grader. The import's committed grades stand as they are.

Both rows may add export lines to `evals/lib/index.mjs` and `index.d.mts`. On a conflict, the coordinator keeps both sides. Each row puts its tests in new files under `test/evals/`, and changes only the tests that cover its own files.

## 006-05 runner: cleanup, completion records, variants, fresh runs

Use /worker.

- **B1:** cleanup wraps the whole cell lifecycle, including setup exceptions. Retained evidence (`out/`, `work/`, harness copies, logs, diff, store copy) is scanned. A file holding a recognized secret is removed or sanitized, and the cell fails if a secret survives.
- **S3:** the provider block copies only allow-listed fields. Any inline credential (a header, a token) is rejected or added to the redaction set.
- **S2:** spawn errors are handled. Timeout escalates TERM, then KILL, to the process group with a deadline, and the daemon is stopped on every exit path. Test with fake harness binaries.
- **B3, the runner's half:** write `out/truth.json` per the contract, including timeouts and signals. Also write `out/status-end.json`, the runner's half of B4.
- **B5:** check fixture consistency within each arm, and build each arm's conditions from its own fixture identity.
- **S1:** a fresh run identity, an explicit `--resume`, and unique result names, so two runs of one commit both survive (006-04 needs this).

**Owns:** `evals/bin/run-cell.mjs`, `evals/bin/run-baseline.mjs`, `evals/lib/{scratch,session,daemon,prepare,variant,results}.mjs`, and the README.

**Done when:** every B1, B3 (runner), B5, S1, S2 and S3 probe is a passing test, and the repository gate is green.

## 006-06 grader: execution, completion and Squeal's state

Use /worker.

- **B2:** keep conditional structure and action order through the parser, the timeline and the grader. Each action is executed, refused or indeterminate, and an indeterminate one never counts as established. Parse heredocs a shell executes; ignore heredoc text passed to `cat`. Edits and runs within one call keep their order. Unsuccessful edit tools are not edits.
- **B3, the grader's half:** read `out/truth.json`. Grade pass only when both commands completed (a numeric exit, no signal, no timeout, no spawn error) and the Vitest report is valid and non-empty. Anything else is "truth unavailable", never a pass.
- **B4:** read `out/status-end.json` and use the full current-state contract (`src/core/status/`). Stale, unknown, pending, unlisted or unrefined state is never Squeal's "pass". Unsupported or missing status fails closed.

**Owns:** `evals/bin/grade.mjs` and `evals/lib/{shell,commands,grade,behaviours,transcript,claim}.mjs`.

**Done when:** every B2, B3 (grader) and B4 probe from the review is a passing test, including `false && …`, a heredoc fed to `bash`, an edit then a run in one call, a null exit, an empty report, and stale or unknown status. The repository gate is green.
