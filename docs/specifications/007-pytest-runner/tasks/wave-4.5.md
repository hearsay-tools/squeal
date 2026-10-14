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
