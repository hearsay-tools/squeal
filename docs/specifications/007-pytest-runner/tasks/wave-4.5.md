# 007 wave 4.5: repair of candidate 0.1.181

Review `reviews/wave-4.md` (codex, over `cand/0.1.181` at `bd86815c`) found two blockers in the candidate. This is the first-round repair on the candidate; a narrow re-review follows. Read wave 4's preamble and its host test-run policy first.

## 007-41 the candidate's two blockers

Outcome: a stale environment note is replaced only when there is one, and two different failures never share a fingerprint.

Shape: repair, test first, one commit per blocker.

1. **Notes.** Seams: `src/runners/pytest/adapter.ts` (the start ready note, `e4871cd6`), the `noted` callback in `pytest-runners.ts` and `daemon.ts`.
   - Replace `noted?: (text) => boolean` with a topic lookup, `latestNote?: (topic) => string | undefined`, which reads the latest stored note of that topic in the latest-per-topic view.
   - At start, write the ready note only when the topic has a latest note and it is not the ready text.
   - Tests through the real store:
     - a fresh start writes no ready note (the e2e expectation at `test/e2e/pytest.test.ts:202` stays as main has it);
     - a tagged no-environment note followed by a ready start shows the ready note;
     - an untagged ready note from an older daemon plus a tagged no-environment note, followed by a ready start, shows the ready note (the reviewer's probe);
     - a second start stores nothing.
2. **Scrubbing.** Seam: `scrubBasetemp` in `src/runners/pytest/run/basetemp.ts`.
   - Replace only the basetemp path itself and the counter pytest appends to its numbered directories (`test_reads0` becomes `test_reads<n>`, `mktemp("data")`'s `data0` becomes `data<n>`). Never replace a whole path component.
   - Test: `open(getbasetemp() / WHICH)` with `left.json` and then `right.json` gives two fingerprints, and 007-37's `tmp_path` test still gives one.

Owns: those files and their tests. Leave `key-format.ts`, `plugins/*/dist` and `package.json` alone, and do not build.

Done when: every test above fails on `bd86815c` where it should, and passes after.

Use /worker.

## Re-review of the repaired candidate (cand/0.1.183)

Outcome: a verdict, PASS or FAIL, on whether `cand/0.1.183` at `6b43de67` repairs `reviews/wave-4.md` B1 and B2, resolves S2 as `status.md` records, and may land.

Shape: narrow re-review. Scope:
- the repair commits `87a86efc` (B1, scrubbing) and `986e9c25` (B2, the start note through `latestNote(topic)`);
- `test/e2e/pytest.test.ts`, which must pass unchanged with the rebuilt bundles;
- whether rebasing the candidate onto main `ef4e5c78` (the earlier commits picked again; key 10 re-pinned; version 0.1.183) dropped or changed anything against `bd86815c`. Use `git range-diff`.
Do not re-review the rest of wave 4; S1 is row 007-42.

Owns: `reviews/wave-4.5.md` only, which you commit. Your full run follows the host test-run policy.

Done when: B1, B2 and S2 each have a verdict backed by a probe or test. The reviewer's probes are in `reviews/wave-4.md`; the left.json and right.json probe and the untagged-ready probe are re-run against the candidate. The verdict names `6b43de67`.

Use /reviewer.

## 007-43 B1 by the failing test's own name (the human's choice, 2026-10-15)

Outcome: the counter after the failing test's own `tmp_path` folder name is the only counter replaced, so `<basetemp>/data1` and `<basetemp>/data2` keep two fingerprints, and 007-37's `tmp_path` failure keeps one.

Context: `reviews/wave-4.5.md` B1 is still open after the first repair (second round). The human chose option (d) of three: derive pytest's own name for the test's folder and do not guess from digits. pytest's `_mk_tmp` (`_pytest/tmpdir.py`, identical in every copy on this host, including 8.4.2) uses `name = re.sub(r"[\W]", "_", request.node.name)[:30]` and then `factory.mktemp(name, numbered=True)`.

Shape: repair, test first, one commit. Seams:
- `scrubBasetemp` in `src/runners/pytest/run/basetemp.ts`, which takes an optional folder name;
- `readBatch` and `joinPhases` in `run/report.ts`, which pass the item's node name (the last `::` segment of its node id, or a name field if you add one to the plugin's `collected` event; say which and why).

Rules:
- Replace `<basetemp>/<name><digits>` only when it ends at a path boundary. Python's `\W` is Unicode-aware, so mirror it, not ASCII `\W`.
- The basetemp itself is still `<basetemp>`.
- A collection error, which has no test, gets only the basetemp replaced.
- Nothing else is replaced. If pytest changed its naming, the name would not match and nothing would be replaced, which fails safe.

Owns: those two files, `run/events.ts` and the runtime's `collected` event if you add a field, and their tests. Leave `key-format.ts`, `plugins/*/dist` and `package.json` alone, and do not build.

Done when (live, on Python 3.10 and 3.13, through `runPytest`):
- `getbasetemp() / WHICH` with `data1` and then `data2` gives two fingerprints. This test fails on `6b43de67` and passes after.
- `left.json` and `right.json` still give two fingerprints.
- 007-37's `tmp_path` failure keeps one fingerprint, including the twin-name case (`test_reads1`).
- A parametrized test (`test_x[a-1]`) and a name longer than 30 characters each keep one fingerprint across two runs.
- A file the test names after itself but writes directly under basetemp is the accepted residual: say what it gives, and do not test for it.

Use /worker.

## Re-review of cand/0.1.190 (007-43 and the rebase)

Outcome: a PASS or FAIL verdict on `cand/0.1.190` at `1bedfc23`, which is `cand/0.1.183` (`6b43de67`) rebased onto main 0.1.187, plus 007-43. The verdict decides whether it may land.

Shape: narrow re-review. Scope:
- 007-43's commit `df8f2d84`, against `reviews/wave-4.5.md` B1 and the human's option (d), recorded in `status.md`. Re-run your `data1` and `data2` probe and the `tmp_path` stability probes on both Pythons.
- The rebase. Main changed `src/core/daemon/daemon.ts` and `src/core/types/scheduler.ts`, which the notes commits also change. Check with `git range-diff ef4e5c78..6b43de67 origin/main..1bedfc23` that every picked commit's patch is unchanged, and that the merged `daemon.ts` still wires `latestNote` and the note topic as `6b43de67` did, next to main's pool and retry changes.
- Not in scope: B2, S2 and the rest of wave 4, which already passed.

Owns: `reviews/wave-4.75.md` only, which you commit. Your independent full run follows `docs/process.md` "Test runs on a shared host". The coordinator's gate is also queued on the lock, so wait your turn.

Done when: B1 and the rebase each have a verdict backed by a probe or diff, and the verdict names `1bedfc23`.

Use /reviewer.
