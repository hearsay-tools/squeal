# Issue 45: stale checks beside a zero known-failure count

Researcher findings for [hearsay-tools/squeal#45](https://github.com/hearsay-tools/squeal/issues/45), 2026-10-19. Spec 011 C6, related C4, C5, C8. Documentation only; no product, spec, status or board edit.

## Reproduction verdict

**Reproduced in shape, with a synthetic store, on Squeal 0.1.222 (the incident's version), 0.1.223 (installed and this checkout, `3c993aea`).** A worktree with no failing check and 60 stale plus 20 queued passing checks prints `Known failures: 0` alone on its line; the stale and queued counts appear only on the `Affected checks:` line two lines below, as checks, with no count of test files. The original cezarion workload (5,542 stale checks in 176 files, 29 red server tests) was not re-run, by design of the brief.

The second half of the issue reproduces as described but is spec-conforming: a failure observed at revision 6 whose test file's key has not moved prints `observed at revision 6, current` at revision 26. By C4 that check is current, not stale; "stale" means its key moved. A failure whose key did move already prints `stale` and is not counted (gh-34, 0.1.216).

Host load immediately before each live probe: `5.84 12.75 18.10` (checkout, `run.sh`) and `5.55 12.46 17.95` (installed, `installed.sh`), on 24 CPUs; both below the CPU count. Node v24.21.0.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | With zero known failures and stale or pending checks, does the headline name them beside the count? | No. `Known failures: 0` stands alone; stale and queued checks are only on the `Affected checks:` line. | verified by experiment (0.1.222, 0.1.223, checkout 0.1.223) |
| 2 | Does any status line give stale or pending **test-file** counts? | No. The counts line names checks and their tests (`60 stale (60 tests)`); 6 stale files and 2 queued files are not counted anywhere in the head. A "test files loaded" part appears only for file-level checks. | verified by experiment; read in source code (`countedText`, `partsSuffix`) |
| 3 | Does the registration header do the same? | Yes in shape: its count line (`Revision N: a current, b pending, c stale, d unknown.`) and `Known failures: N` are separate lines. Seen in this session's own SessionStart header on 0.1.223. | read in source code (`src/core/delivery/header.ts`); observed in this session's header, not a probe |
| 4 | Does a known failure observed at an older revision show that revision? | Yes, already: `observed at revision 6, current`. | verified by experiment (all three versions) |
| 5 | Should such a failure read as stale? | Not under C4: validity is per key, not per revision. Same key since revision 6 is `current` and counted; a moved key is `stale`, printed `observed at revision 6, stale` and not counted (gh-34). | verified by experiment; read in source code (`classify`, `src/core/state/derive.ts`); read in spec 011 C4, C6 |
| 6 | What decides the `[web]` case (passes when run directly, kept 20 revisions)? | C5: a failure caused outside its keyed inputs "stays a counted FAIL, current while its key stands"; the remedy is `squeal retry <file> --reason load|environment`, never a timer. The issue's ask to mark it stale contradicts C4/C5. | read in spec 011 C5 |

## Findings

### Q1, Q2: zero known failures beside stale checks

`run.sh` (checkout) and `installed.sh` (0.1.222, 0.1.223) print the same head for scenario `zero`:

```
Revision: 26
Known failures: 0
Affected checks: 20 passed (20 tests), 0 running, 20 queued (20 tests), 60 stale (60 tests)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)
```

`status --json`: `counts {"current":20,"pending":20,"stale":60,"unknown":0}`, `knownFailureCounts {"current":0,"pending":0,"stale":0}`. The JSON already carries the stale and pending check counts; it has no per-file stale or pending count in `counts` (per-file numbers exist only as `fileLevelCounts` for file-level checks, and `testFilesWithoutChecks`).

gh-34's `Earlier failures:` line covers failures only; with no failure at all, nothing beside the zero says the 60 stale checks have not been rerun. That is the issue's headline gap. The vision's "no known failures, not everything passes" is honoured by the word "known", but a reader who stops at that line, as two cezar workers did, takes it as a verdict.

### Q4, Q5: older revision versus changed-key stale

Scenario `oldrev`, all three versions identical (the `recorded at an unknown time` line, an artefact of seeding without result rows, is omitted):

```
Known failures: 1 (1 test)
Earlier failures: 1 pending rerun, 1 stale (not counted until a rerun fails)
  FAIL  src/moved-key.test.ts > moved-key
        observed at revision 6, stale
  FAIL  src/queued.test.ts > queued
        observed at revision 6, pending
  FAIL  src/same-key.test.ts > same-key
        observed at revision 6, current
```

Two distinct facts are in play:

- **Changed-key stale.** The file's key moved and no run is queued. Already shown as `stale` with its revision and excluded from the count since 0.1.216. No gap here.
- **Old revision, same key.** Nothing the check reads changed since revision 6, so by C4 the result is the current truth for revision 26, and it is counted. The issue's `[web]` failure is this case: it passed when run directly, so its cause lay outside the keyed inputs (load, a server). C5 keeps it counted until a retry passes. The revision is shown; what the line does not say is that the result is 20 revisions old with no rerun since, nor point at `squeal retry`.

### Source evidence

`formatStatus` (`src/core/status/format-status.ts:56-66`) builds `Known failures:` from `splitByValidity(...).current`, then `earlierFailuresLines`, then each failure with `observed at revision ${f.observedAt}` and `f.validity`; `affected()` (lines 257-290) puts stale and unknown on the `Affected checks:` line. `classify` (`src/core/state/derive.ts:49-59`) returns `current` whenever the result's key equals the file's current key, whatever the revision.

## Recommendation for Squeal

1. **Headline (in scope, small).** When the worktree has stale or pending checks, append them to the `Known failures:` line in `status`, the registration header and Stop's known-failures line, e.g. `Known failures: 0; 60 stale and 20 queued checks in 8 test files not yet rerun at this revision`. It needs a per-file stale/pending count the snapshot does not yet expose in `counts`; `status --json` should gain it beside `knownFailureCounts`. Coordinate with gh-42/gh-44, which reshape the same head (human direction 2026-10-19: shorter, organized around verdict and outstanding work).
2. **Old-revision failure (decline the "stale" wording).** Keep `current` for a same-key failure; marking it stale would break C4's one validity rule and C5's counted-until-retry rule. If anything changes, it is wording: `observed at revision 6 (inputs unchanged since), current`, and, for a failure older than the current revision, the `squeal retry` hint. That is a human choice of wording, not a defect fix.
3. Regression coverage: a CLI test over a seeded store for each scenario above (the probe's shape), plain and `--json`, and the header and Stop formatters round-tripped as for gh-34.

## Open questions

- Why cezarion held 5,542 checks `stale` (key moved, nothing queued) rather than `pending` after an edit: C4 marks re-keyed files `queued` in the revision's first transaction, so a large stale set while the daemon drains suggests keys refined by the runner part, a slow-tier policy, or a dropped queue. Not determined, because the original store and workload were not examined (out of scope); it bears on whether "stale" or "pending" is the right word in the headline.
- Whether "test files" in the acceptance criteria means files with any stale check, or file-level checks; the brief's wording supports the former.
- The `[web]` failure's retry history (asked, not asked) was not examined.

## Limitations

Synthetic stores written with the checkout's store API; no daemon, no Vitest run, no hook process. The registration header and Stop line were not probed; Q3 rests on source and this session's header. Original cezarion incident not re-run.

## Sources

- Issue: `gh issue view 45 --repo hearsay-tools/squeal` (read 2026-10-19).
- Spec: `docs/specifications/011-core/spec.md` C4 (validity), C5 (retry, header), C6 (status, gh-34 amendment), C8; `status.md`; `docs/vision.md` ("no known failures").
- Prior research: `research/issue-34.md`, `research/probes/issue-34/`.
- Code at `3c993aea` (0.1.223): `src/core/status/format-status.ts`, `src/core/status/checks.ts`, `src/core/state/derive.ts`, `src/core/delivery/header.ts`.
- Installed CLIs: `~/.claude/plugins/cache/hearsay/squeal/0.1.222/bin/squeal`, `.../0.1.223/bin/squeal`; launcher `~/.local/bin/squeal --version` → 0.1.223.
- Probes: `research/probes/issue-45/` (`run.sh`, `installed.sh`, `probe.mjs`, README).
