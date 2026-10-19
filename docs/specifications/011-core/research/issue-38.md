# Issue 38: do stale selected files have a focused refresh path under a lookup-only baseline?

Researcher, 2026-10-19, 20-minute time box, documentation only. Issue: hearsay-tools/squeal#38 (`gh issue view 38`). Read: `docs/vision.md`, 011 C4, C5, C6, C9, C15 and `status.md` at `85f94301`.

Versions: this worktree's HEAD `85f94301`, **0.1.222** (`package.json`), run from its committed bundle `plugins/claude-code/dist/cli/squeal.mjs` without a build. That is the incident's version. The installed `squeal --version` also prints 0.1.222. Vitest 4.1.10 is symlinked read-only from `/home/agent/projects/cezar/node_modules`. The retry path for a file with no result came from 011-16 (`f8f7c726`, `68e8a1a5`), whose `package.json` reads 0.1.216.

Host load: the one-minute load was 4.42 on 24 CPUs at the start (`/proc/loadavg`, `nproc`), 5.00 and 5.97 at each probe's start, and 6.05 at the end. That is below the CPU count throughout, so the live probe ran. The probe ran in its own `/tmp/issue38.XXXX` with HOME and XDG_* inside it, and its own daemon, which `squeal stop` ended. No shared daemon or other worktree was touched.

## Verdict

**Reproduced: under `baseline.onStart: "lookup-only"`, a stale file selected by a source path or by its exact path gets a named wait that exits 3 at once with nothing queued, and the line names no command (verified by experiment, 0.1.222).** The wording matches the issue's line for line: `Stale (1): tests/a.test.ts: last pass` / `Named test files have no verdict: 1 test file without a current result at revision 2 (1 stale). Worktree: known failures 0; checks 0 running, 0 queued`.

A focused path already exists for an **exact test path**. Since 0.1.216, `squeal retry <test file> --reason load|environment` queues one run of a stale file at its normal priority. A named wait then returned it current (verified by experiment). Nothing points at it: not the no-verdict line, not `status`, not `retry`'s help, and not the skill. A **source path** has no focused path. `retry src/lib.js` is refused with `is not a test file Squeal has keyed in this worktree`, so the only command left is `run --all`. That command runs every file without a current result, so it is narrower than the full suite but not limited to the selection (verified by experiment). `status` stayed read-only in every step (read in source code: C6, `status-command.ts` reads the store).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the issue's state reproduce? | Yes, when the edit lands while no daemon runs and a lookup-only daemon then starts: `4 stale ... 0 queued`. A whitespace-only `squeal.config.json` edit made while the daemon ran left the input-declared file current (B below). | verified by experiment |
| 2 | Why is nothing queued? | The start's baseline checkpoint covers the misses, and with `lookup-only` it is `finish("abandoned")` without enqueueing them (`src/core/scheduler/bootstrap.ts:178-186`). This follows C4: "the baseline is a lookup ... followed by a run of the misses, or lookup only, per policy". | read in source code; verified by experiment |
| 3 | Does `retry` refresh a stale file named by its exact path? | Yes. `Run queued: tests/a.test.ts has no result at its inputs (stale: its last result is at other inputs). It runs once now ...`. A second ask queues nothing. Then `status --wait 60000 src/lib.js` gives `each with a current result`, exit 0. | verified by experiment; read in source code (`src/cli/retry.ts:172-200`, 011-16 repair `68e8a1a5`) |
| 4 | Does `retry` accept a source path? | No: `Not retried: src/lib.js is not a test file Squeal has keyed in this worktree.`, exit 1. It does not expand to the selection. | verified by experiment |
| 5 | Is `run --all` the only refresh for a source selection? | Yes. It printed `3 test files, 1 already current, 2 run now`, so it ran every stale file, the selected one and the unselected one, but not the current file. C4 says it "queues every test file whose key has no result". | verified by experiment; read in official docs (spec C4) |
| 6 | Does any output name a refresh command for stale files with nothing queued? | No. The named line's `settled` case prints `none(why)` with no command (`src/cli/status-wait-lines.ts:200-205`). The `Idle:` line counts only `unknownTestFiles` (`src/core/status/work-line.ts:33-34`), so with `4 stale, 0 queued` no `Idle:` line appeared. `squeal --help` still describes `retry` as for failures only (`src/cli/main.ts:83-88`). The plugin skill under `plugins/claude-code/skills/squeal/` has no `retry` match. | verified by experiment; read in source code |
| 7 | Does `run` have a selection flag? | No. `squeal run --help` lists `--all`, `--fast` and `--slow` only, as the issue says. | verified by experiment |
| 8 | Does the cezarion incident's own cause match? | Not determined, because cezarion#1281's checkout and its daemon's start time were not available. A config edit made while no daemon ran, or a daemon restart after one, gives this state (inferred from A). A live whitespace edit did not (B). | inferred |

## Exact commands and output

`probes/issue-38/probe.sh <squeal.mjs> <vitest node_modules>` (throwaway). It runs `init`, then sets `baseline.onStart: "lookup-only"` and declares `inputs: {"tests/cfg.test.ts": ["squeal.config.json"]}`. Then it runs `start` and `run --all --wait` (3 run now, 6 passed). Header and footer lines are cut from the output below.

**B: daemon running, `echo "" >> squeal.config.json`.** The note reads `revision 1: squeal.config.json changed; policy reloaded`. `status --wait 20000 squeal.config.json` returns `Selected: tests/cfg.test.ts` / `Named test files at revision 1: no known failures; 1 test file, each with a current result`, exit 0. `retry tests/cfg.test.ts` returns `has no known failure`, exit 1, which is right for a current pass. Whether the edit re-keyed and ran it, or left its key alone, was not determined (`Returned on quiet: ... re-keyed is pending (0 test files)`).

**A: `squeal stop`, then edit `src/lib.js` and append to `squeal.config.json`, then `squeal start` (lookup-only).**

```
$ squeal status
Revision: 2 · 075bcb36 + 2, dirty
Affected checks: 2 passed (1 test, 1 test file loaded), 0 running, 0 queued, 4 stale (2 tests, 2 test files loaded)
(exit 0)
$ squeal status --wait 20000 src/lib.js
Selected: tests/a.test.ts
Stale (1): tests/a.test.ts: last pass
Named test files have no verdict: 1 test file without a current result at revision 2 (1 stale). Worktree: known failures 0; checks 0 running, 0 queued
(exit 3)
$ squeal status --wait 20000 tests/a.test.ts
[the same three lines]
(exit 3)
$ squeal retry src/lib.js --reason load
Not retried: src/lib.js is not a test file Squeal has keyed in this worktree.
(exit 1)
$ squeal retry tests/a.test.ts --reason load
Run queued: tests/a.test.ts has no result at its inputs (stale: its last result is at other inputs). It runs once now at its normal priority, whatever the reason; that is its one run at these inputs, and it spends no retry of this session. squeal status --wait 60000 tests/a.test.ts waits for its result and moves it ahead in the queue.
(exit 0)
$ squeal retry tests/a.test.ts --reason environment
tests/a.test.ts has a run queued or running at its inputs already, so nothing more is queued. squeal status --wait 60000 tests/a.test.ts waits for its result and moves it ahead in the queue.
(exit 0)
$ squeal status --wait 60000 src/lib.js
Affected checks: 4 passed (2 tests, 2 test files loaded), 0 running, 0 queued, 2 stale (1 test, 1 test file loaded)
Selected: tests/a.test.ts
Named test files at revision 2: no known failures; 1 test file, each with a current result, after 0.5 s. Worktree: known failures 0; checks 0 running, 0 queued
(exit 0)
$ squeal run --all --wait
Checkpoint fd9cfd3a-... completed at revision 2: no known failures; 3 test files, 2 already current, 1 run now
(exit 0)
```

In the first full run, `run --all --wait` came before any retry and printed `3 test files, 1 already current, 2 run now`. No `status` output in A printed an `Idle:` line.

## Limits

- One three-file fixture. The issue's worktree held 19,043 stale checks. At that scale `run --all` would queue all of them, which is the friction the issue names. The fixture covers the per-file paths only; it does not reproduce the scale.
- The fixture used Vitest. The issue's file is a `.cjs` test under another runner (`root:test:unit`). `retry` works by keyed test file across runners (read in source code, `retry.ts`), but only Vitest was probed.
- The `retry --reason load` ask ran at once because the file was stale, not a failure. Load gating covers counted failures only (011-16), so this probe does not exercise it.
- No product test was run, and none was needed for docs-only research.

## Related sections and issues

- C4 (explicit checkpoints, baseline `lookup-only`), C5 011-16 amendment ("`retry <file>` given a test file with no result at its current key ... queues one run"; the repair `68e8a1a5` covers a stale FAIL), C6 (status read-only, wording), C9 (start, stop), C15 (named line, promotion: retry's queued file is promoted by the named exact-path wait).
- gh-36 / `research/issue-36.md` / row 011-16: the same gap for `unknown` files, which 0.1.216 closed in `retry`. Its recommendation to name a command in refusals was carried into `retry`'s own reply (`waitText`), but not into the named no-verdict line or `Idle:`.
- 011-12 (`work-line.ts`): the `Idle:` line names `run --all --wait` for unknown files but counts no stale ones.

## Recommendation for Squeal

The exact-path half needs no new command. `squeal retry <test file>` already refreshes a stale file once at its normal priority, and its reply already names the named wait that promotes it. The gap is discoverability, and it costs only wording:

1. On a named wait that settles without a verdict and has nothing queued, end the line with the command per class, e.g. `` `squeal retry <files> --reason environment` runs these once; `squeal run --all --wait` runs every file without a result``. List up to C15's five groups. `status` stays read-only because it only prints.
2. Count stale-and-unqueued files in the `Idle:` line beside unknown ones (011-12).
3. Have `squeal --help` say that `retry` also runs once a file with no result at its key (011-16).

The source-path half is a design choice for the human. `retry <source path>` could expand to the files the selection names, using the selection `status <path>` already computes (C15: "a source path's selection is not promoted" because it reaches every consumer). Or the output could list the selected test files, so the agent can retry them by exact path. The second needs no new C-section. The issue's third acceptance criterion, a regression test under `lookup-only`, matches scenario A of the probe.

## Open questions

- Should a selection-wide refresh by source path exist, given that C15 declines to promote source selections because they reach many files? This is the human's call.
- What left cezarion#1281's worktree stale? Was it a restart after the config edit, or a start on a changed checkout? Not determined (Q8).

## Sources

- `gh issue view 38` (hearsay-tools/squeal#38), and the cezarion PR it links, which was not opened.
- `docs/specifications/011-core/spec.md` C4, C5, C6, C15 at `85f94301`; `status.md` (2026-10-18 triage round 6, row 011-16).
- `src/cli/retry.ts:160-246`, `src/cli/status-wait-lines.ts:172-213`, `src/core/status/work-line.ts:13-43`, `src/core/status/unknown-files.ts:77-108`, `src/core/scheduler/bootstrap.ts:165-190`, `src/cli/main.ts:83-90`, at `85f94301`.
- `docs/specifications/011-core/research/issue-36.md`.
- Probe: `docs/specifications/011-core/research/probes/issue-38/probe.sh` and `README.md`. Its outputs stayed in `/tmp` and are not committed.
