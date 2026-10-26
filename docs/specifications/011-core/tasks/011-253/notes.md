# 011-253 notes: a first failure with no earlier pass at its inputs is not called a load flake

Row 011-253 (gh-103; wave 54 W1, `tasks/wave-54.md`; triage `research/issue-103.md`; 011 C5, C7). Worker run `8c9027d4`, 2026-10-26. Baseline `83a1dec6e`.

## Cause

`recordedText` (`src/core/retry/text.ts`) named `squeal retry <file> --reason load` for every failure recorded at or above one load per CPU with no retry asked (row 011-67). Nothing asked whether a pass at the failure's key came before it. In gh-103 the failing key was new: the test's import graph had changed, and its 42 earlier passes were at other keys. The later FAIL -> PASS note then read as a same-input flake. The advice and the note both pointed to load, and the race was in the changed code.

## The fact, and where it comes from

"A pass at this key came before this failure" is read from the flaky notes (`flaky-checks`, C5), with one new stored field.

- Every flaky note at a key has a pass at that key: a flip is `pass -> fail` or `fail -> pass`. When the row at the key is a fail now, a note of the check at that key means a pass there came before the current fail. So `withRecorded` (`src/core/retry/recorded.ts`) sets `RecordedFacts.noEarlierPass: true` when the check's newest note is absent or at another key than the producing row's. No store change.
- The later `fail -> pass` note overwrites the `pass -> fail` note that held the fact (one note per check). At display time an established flake (pass, fail under load, pass) and the gh-103 case (no row, fail, pass) then look the same. So `recordFlips` (`src/core/state/flaky.ts`) stores the fact on the note when it records it: `FlakyNote.noEarlierPass: true` on a `fail -> pass` note when the check had no note at that key before it. `isNote` accepts only `true` or absent.
- Approved shape: coordinator request `e3b9a380`, option (a), 2026-10-26. Both fields are optional; old notes read as before; no schema, key or JSON-field removal.
- `replaced-failures` is not read: C5 says no delivery reads it.
- `isNote` stays as released: it does not check `noEarlierPass`, and readers take the mark only when it is `true`. The key-format alarm (`test/keys/key-format.test.ts`) named `isNote`'s changed lines, because `flaky.ts` is on the validity path and no validity case parses a stored note: the heal case (`cases/accept/heal.ts`) records the first note only. The changed `recordFlips` lines run in that case. Leaving `isNote` unchanged was smaller than a new validity case.

### Known limit

Notes are the newest per check. If another worktree's flip of the same check at another key overwrites the `pass -> fail` note at key K before the failure at K is displayed, the failure reads as having no pass on record: it leads with the changed files and names no load retry. The wording says "on record", so it stays true, and the error is toward the changed-file lead. The coordinator accepted it. A per-(check, key) `meta` entry would remove it, at the cost of a second 1,024-capped entry. The same holds when a run under a key that may lack an observed preload records no note (C5's B2 stopgap).

## Texts

Approved by the coordinator (request `9ae121e3`, option (c), 2026-10-26): the clause leads, the load retry command stays as the last step, and "reads" in place of "imports", since a new test file and inputs other than imports give a new key too. `NO_EARLIER_PASS_TEXT` (`flaky.ts`) is the shared phrase "no pass at these inputs is on record before".

- Recorded facts (registration, `status`, `why`; one `recordedText`), with `noEarlierPass`: the clause leads the line; at or above one load per CPU with no retry asked, the load retry command of row 011-67 comes last, for when the changed files are not the cause. After any edit to a file a test reads its key is new, so most failures right after an edit have no pass at their key, and a real load timeout there still names its retry.
  `no pass at these inputs is on record before this failure: look first at the changed files it reads; recorded just now in this worktree at revision 4, load 2.56 per CPU when it ran; no retry asked at these inputs; if the changed files are not the cause, \`squeal retry src/auth.test.ts --reason load\` runs it once more when the one-minute load average is below the CPU count`
  Below one load per CPU the line ends at "no retry asked at these inputs". A retry asked keeps its clause as before. `why` and the registration capitalize the line as before.
- Flaky note (change notice, `why`; one `flakyText`), on a `fail -> pass` note with `noEarlierPass`:
  `Flaky: FAIL -> PASS under the same tracked inputs; no pass at these inputs is on record before the FAIL, so the flakiness may be new with the changed files it reads`
  The row 011-244 pointer follows as before. `groupKey` (`failure-groups.ts`) groups by `flakyText`, so it needs no change; a group is of failures, whose notes are `pass -> fail` and never carry the mark.
- Without the mark both read as before, load retry included.

## Proposed C5 sentence (the coordinator's to write)

Amended 2026-10-26 (the human, gh-103 "Approve fix", row 011-253, `research/issue-103.md`): every flaky note at a key has a pass there, so a known failure whose check has no flaky note at the key of the result that stands for it has no pass at these inputs on record before it. Its recorded facts then lead with "no pass at these inputs is on record before this failure: look first at the changed files it reads", in a registration, in `status` and in `why`; the load retry of row 011-67, when the line names one, comes last as "if the changed files are not the cause, `squeal retry <file> --reason load` runs it once more when the one-minute load average is below the CPU count". A `fail -> pass` note recorded when its check had no note at that key says so (`noEarlierPass` in `flaky-checks`; no schema or key change), and reads "Flaky: FAIL -> PASS under the same tracked inputs; no pass at these inputs is on record before the FAIL, so the flakiness may be new with the changed files it reads" in a change notice and in `why`. A failure whose check has a note at its key, from any worktree, reads as before. A limit: notes are the newest per check, so another key's flip of the check hides an earlier pass at this key, and the failure then reads as having none on record. Notes recorded before 011-253 read as before.

## Evidence

- `test/state/flaky.test.ts`: a `fail -> pass` note is marked with no note, with a note at another key; unmarked after a note at its key either way; a `pass -> fail` note is never marked; the mark survives a read; a mark that is not `true` reads as no mark.
- `test/retry/no-earlier-pass.test.ts`: the derived fact with no history (the lead, the load retry last under load, none below one load per CPU), with earlier passes at other keys in this worktree and another, with unparseable notes (all: none on record); with a pass at the current key from this worktree or another, and a `fail -> pass` note at the key with the FAIL back since (the line as before); the same recorded text in `why`, status and the registration; the retry asked kept beside the lead; the later note's text in `why` and the notice, and an earlier pass's note as before.
- Real Vitest runs: `test/scheduler/flaky-inputs.test.ts` (row 011-244's first-fail-then-pass flips now carry the mark and the new line in the notice and `why`); `test/scheduler/retry-delivery.test.ts` (the registration of a first failure under load leads with the clause and ends with the load retry; its load retry's pass gives the new note; the load retry test now passes at the key first, then fails under a forced run).
- Fixtures: `seededFailure` (`test/retry/load-retry-fixture.ts`) seeds a pass at `k1` by default (the row 011-67 case), `earlierPass: false` for the gh-103 case; `test/status/failure-age.test.ts`'s `seeded` seeds the same pass.

## Left for others

- `plugins/*/dist` hold the old texts until the coordinator rebuilds; the bundle-drift tests fail until then.
- 011 C5's text: the sentence above.
- The evals reader (`evals/lib/squeal-text.mjs`, now the 011-251 worker's) needs no change: it parses no recorded line and no registration failure block, and it reads a group's flaky line by its `Flaky: ` prefix (`GROUP_FACT`), which the new text keeps. Group notes are `pass -> fail` and never carry the mark.
- `test/evals/retry-texts.ts` and the eval transcripts are reference texts for the retry scenarios; their failures are recorded with no flaky note context and keep the old line. Not changed.
- The primer (`SKILL.md` copies) does not mention the new clause. Not changed: the Claude Code copy's 5,000-character budget is nearly spent (row 011-244 notes).
