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
