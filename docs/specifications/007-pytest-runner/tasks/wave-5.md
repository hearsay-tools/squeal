# 007 wave 5: the last repairs

Read wave 4's preamble and docs/process.md "Test runs on a shared host" first. Product changes reach main only through a reviewed `cand/<version>`. Workers do not build and do not re-pin.

## 007-42 a live norecursedirs edit relists (wave 4 review S1)

Outcome: changing `norecursedirs`, `python_files` or `testpaths` in a project's existing pytest config changes the listed test files without restarting the daemon, in both directions.

Shape: repair, test first. Seam: `invalidate` in `src/runners/pytest/adapter.ts`, near line 218. It relists only when a path is not a `change`, or when nothing is built. Relist also when `reread` reports `rebuild`, or when a changed path is the project's config file. If `sameSettings` does not compare the listing inputs, make it, or compare them separately in `adapter-files.ts`. Additions and removals reach the graph through `built.graph.setTestFiles`, as they do now. `reviews/wave-4.md` S1 holds the reviewer's probe.

Owns: `src/runners/pytest/adapter.ts` (the listing seam only), `adapter-files.ts`, `environment/config-values.ts` if needed, and their tests.

Done when: one live adapter goes through allow, disallow and re-allow of `tests/build/test_a.py` by editing `pytest.ini` as a `change`, and lists, drops and lists the file again, with no reopen between edits. The regression fails on main and passes after. A no-environment project still lists from the config. Full-suite verdict: `squeal run --all --wait`; expect bundle and key-format drift.

Use /worker.

## Review of cand/0.1.191 (007-42)

Outcome: a PASS or FAIL verdict on `cand/0.1.191` at `41979b98`, which is main 0.1.190 plus 007-42 (`382d253e` picked), a key re-pin and the build. The verdict decides whether it may land.

Shape: review. Scope:
- 007-42's change to `invalidate` in `src/runners/pytest/adapter.ts`, against `reviews/wave-4.md` S1 and this file's 007-42 brief. Re-run the S1 probe (allow, disallow, re-allow on one live adapter).
- Check that a relist on every config change neither drops a file's results needlessly nor re-keys it.
- Check that a config moving to another file (a `pytest.ini` created over `pyproject.toml`) still relists.
- The worker reports that the listing reads `norecursedirs` and `python_files` but not `testpaths`. Say whether that leaves a gap D5 cares about.

Owns: `reviews/wave-5.md` only, which you commit. Your locked full run (`flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`) is also the landing gate, so name every failing test and say whether it fails alone.

Done when: every finding has a file and line, a failure scenario and a severity, and the verdict names `41979b98`.

Use /reviewer.
