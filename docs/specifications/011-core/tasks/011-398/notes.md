# 011-398 notes: a named wait judges its named files; status texts say what is true

Wave 122 W3, shape repair. Issues #232 and #181. Research: `../../research/stuck-running.md`, shape 2 (c, d).

## What changed

### (c) A named wait or snapshot during an unlisted revision (#232)

Before: `readClasses` and `readVerdict` (`src/cli/verdict.ts`) set `unlisted` from the worktree's `runnerPartPending`. A named wait or snapshot then exited 3 ("revision N is not listed yet") even when every named file was current.

Now:

- `fixedSelection(paths)` in `verdict.ts` is true when every named path is a test file the worktree lists (`NamedPath.kind === "test-file"`).
- `readClasses` and `readVerdict` take a fourth parameter, `fixed = false`. With `fixed` and named files, a pending listing does not set `unlisted`. An awaited install (`awaitingInstall`) still sets it for every set.
- `src/cli/wait/named.ts` and `src/cli/wait/snapshot.ts` pass `fixedSelection(selection.paths)` to their three reads each. This also opens `selectionReady` (`wait/synced.ts`), which reads `all.unlisted`.
- A `source`, `unmatched` or `not-run` path keeps the old rule. The listing can change what such a path selects. The wait exits 3, and the verdict line names the listing: "revision 5 is not listed yet (…), so this result may not cover it".
- A named test file that is still pending during the listing: the verdict line now says "1 test file still pending at revision 5: 1 Vitest has not listed revision 5's test files yet; …". The file's own class holds it, and its pending line names the listing (`test/cli/status-wait-reasons.test.ts`).

Files outside the brief's ownership: `src/cli/wait/named.ts` and `src/cli/wait/snapshot.ts`. Only the flag is passed at the call sites. No sibling owns `src/cli/wait/**`. Without these call sites, `verdict.ts` cannot tell a test-file path from a source path, because it receives only the resolved test files.

### (d) The in-flight text (#181)

`unlistedText` (`src/core/status/next-step.ts`) printed "it waits for the run in flight, each of its calls bounded at N s" for every unlisted standing. Now:

- A run is open in the file's lane (`s.run`) or a yield is published (`s.yields`, which implies a run): the text is unchanged.
- Neither: "`<runners>` not listed revision N's test files yet; no tier starts until the listing ends". This is true by C4: no tier starts while runner work is pending. The text does not say that no run is in flight, and it does not say whether the listing runs now or is queued. The status reads cannot tell either for every line (W1 changes the queue).

`standing-yields.ts` is not changed. It already attaches `run` only for an open run of the file's lane (`runIn` reads open runs only). W4's lines in `withYieldFacts` and `runningStep` are not touched.

Why the no-run text does not say "no run is in flight": the `squeal status` outstanding line (`src/core/status/outstanding.ts:128`) adds a worktree-wide unlisted standing without `run` when no queued file's group says it. That happens, for example, when an edit queues nothing and a backlog tier runs. "No run is in flight" would be false there. Now that line names no run, which is incomplete but not false. `outstanding.ts` is not in W3's ownership. A follow-up can give that standing the open run, as `standingsOf` does for a file's standing; I propose it as a small row.

### Not done: "what holds it is unknown" (by the coordinator's decision, option A)

This text exists only in `src/cli/group-pending.ts:80` (`run <group> --wait`, the deadline passed before the daemon took the request). It prints when the daemon reports `GroupHolder` kind `unknown`. Naming the listing needs a new `HeldBy`/`GroupHolder` kind, which the daemon sets while a request waits on runner work. The coordinator (reply 2026-11-19) gave this to W2 (011-397).

## Tests

- New: `test/cli/named-unlisted-verdict.test.ts`. During an unlisted revision: named current passing test files exit 0 (wait); one with a known failure exits 1; a named source path exits 3 with the listing named; a snapshot gives 0 for test files and 3 for a source path; `fixedSelection` by path kind. Three of its five tests fail with the fix reverted (checked by hand).
- Changed to the new no-run text: `test/status/next-step.test.ts`, `test/status/yield-lines.test.ts`, `test/status/outstanding.test.ts`, `test/cli/status-wait-reasons.test.ts`. The text with a run or a yield stays in `yield-lines.test.ts`, `tier-yields-text.test.ts`, `status-wait-unlisted-run.test.ts` and `group-yields.test.ts`.
- No test or fixture expects the in-flight text without a run now. No eval fixture or parser quotes it (grep of `test/`, `evals/`, plugin skills).
- e2e: no file under `test/e2e` imports or quotes a changed path or text. `control-wording.ts` and `run-triggers-control.test.ts` match the worktree-wide "not listed" texts, which did not change. No e2e file was run.

No key-format or validity change: `test/keys/key-format.test.ts` needs no case.

## Residual risk

A named file that is current while the revision is unlisted gives its verdict now. The listing re-resolves the closures of the files it picks (`refinement.ts`: re-keyed files, the runner's `affected` answer, runtime-unresolved imports, and others). If the runner's module graph finds that a file the pass left current reads a changed path that the static index did not see, the file is re-keyed after the listing. A wait that ended before that gave the older result. The daemon's pass already re-keys every file whose stored closure holds a changed path, so this needs an import that the stored closure misses. The brief's outcome (c) accepts this. The edit-time check still reruns the file after the listing.

## Proposed spec amendments (plain text; the coordinator lands them)

005 D2, after "and exits as D1 for those files only.":

> Amended 2026-11-19 (the human, row 011-398, gh-232): while the runner has not listed the worktree's revision, a wait or snapshot whose named paths are all listed test files gives their verdict (exit 0, or 1 with failures) when each is current. A named path that is not a listed test file (a source path, a path that selects nothing, a test file Squeal does not run) may select other files once the revision is listed, so that wait still exits 3 and names the listing. An awaited install holds every wait as before.

011 C15, the unlisted reason (spec line about "revision N not listed yet, because the runner part waits for the run in flight, …"):

> Amended 2026-11-19 (row 011-398, gh-181): the run in flight and the bound on each call are said only while a run is open in the file's lane or the run yields. With neither, the line says "no tier starts until the listing ends".

011 C4 and C6: no change.
