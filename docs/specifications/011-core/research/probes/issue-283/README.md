# Issue 283 throwaway probe

This is a synthetic mechanism probe, not a performance benchmark or an
end-to-end reproduction of the reporting repository. It holds one fake
runner call after a mid-session edit: `invalidate()` for an ordinary test
edit, or `testFiles()` when that edit also adds a source file. The real scheduler,
request recorder and store see two test files. No daemon or real test runner
is started inside the fixture; the existing fixture removes its temporary
repositories and private capacity pool after the test.

From the repository root, using its installed dependencies:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-283/vitest.config.ts docs/specifications/011-core/research/probes/issue-283/probe.test.ts
```

The repository's normal Vitest projects include only `test/` and `src/`, so
Squeal does not cover this throwaway probe. The command uses one worker and a
650 ms held promise, not a busy loop. It asserts the request stays untaken
and the edited target does not rerun until the listing is released, then
only the target is selected and becomes current. Both cases save their
observations to `result.json`. It does not establish why
the incident's listing took more than 60 seconds.
