# 007 wave 4 briefs: dogfooding repairs

The defects 007-18 found on briefcase (`lessons.md`, numbered there). Rows 007-35, 007-36 and 007-38 run first, in parallel, on disjoint files; 007-37 and 007-39 follow; 007-40 waits for 005's agreement on its texts. Workers read `docs/vision.md`, `docs/styleguide.md`, spec 007 as amended, `status.md` and `lessons.md` (its defect and its reproduction) first. Python environments come only from `test/helpers/pytest-env.ts`, which forces `UV_LINK_MODE=hardlink`. Do not run `npm run build` and leave `plugins/*/dist` and `src/core/keys/key-format.ts` alone; the coordinator rebuilds and re-pins. Load on this host is high: re-run a failing file alone before calling the failure yours. Each row ends with a regression that fails on main and passes after.

## 007-35 every configured test file is listed (defect 1)

Outcome: a test file that `include` and pytest's `norecursedirs` allow is listed and run, wherever it sits; a directory Squeal skips anyway is named in a note.

Shape: repair. Seam: `SKIPPED` in `src/runners/pytest/adapter-files.ts:13`. Walk what the include globs and the project's `norecursedirs` allow (pytest's default list when none is set; read it from the config the environment library already parses). Always skip the environment directory itself and `.git`. One note per project names any directory skipped that holds a file matching `python_files`.

Owns: `src/runners/pytest/adapter-files.ts`, `src/runners/pytest/environment/config-values.ts` if `norecursedirs` needs reading, and their tests.

Done when: on a fixture with `norecursedirs = []`, a `tests/build/test_x.py` and a `tests/venv/test_y.py` are listed and run. With pytest's default list, they are skipped and the note names them. The environment directory is never listed.

Use /worker.

## 007-36 a first pass runs each file once (defects 2, 4, 13)

Outcome: a baseline runs each test file once; editing a test package's `__init__.py` or a nested `conftest.py` re-runs the files below it, not every file.

Shape: repair, test first. Seam: how `squeal_pytest.py` attributes imports made while a batch collects (`src/runners/pytest/runtime/squeal_pytest.py`) and how the adapter files them (`adapter-observed.ts`, the session set from 007-22). A collection-time import of a test package or a conftest belongs to the test files below it, never to the session. Then measure whether defect 2's re-runs remain. If they come from the growth loop in core (each run observes more and re-keys its own files), report the cause with numbers and ask before touching `src/core/`. Also close the events file at session end (defect 13).

Owns: `src/runners/pytest/runtime/**`, `src/runners/pytest/adapter-observed.ts`, `adapter-run.ts`, and their tests.

Done when: on `gen-big.py`'s output, a baseline runs each file once (count file-runs from the store); a nested conftest edit re-runs only its directory; no `ResourceWarning` appears in a batch's stderr; the session-observation tests from 007-22 still pass.

Use /worker.

## 007-37 one failure keeps one fingerprint (defect 7)

Outcome: the same failure in two runs has the same fingerprint, so no spurious `fail-changed` is delivered.

Shape: repair. Seam: the command line in `src/runners/pytest/run/command.ts`. Give each batch a fixed `--basetemp` under the run's own scratch directory (removed with the run, like 007-29's bytecode prefix), or normalise `pytest-<n>` in failure text before fingerprinting; pick one and say why.

Owns: `src/runners/pytest/run/**`, their tests.

Done when: a test that fails with a `tmp_path` in its message keeps one fingerprint across two runs; the basetemp leaves nothing behind.

Use /worker.

## 007-38 a project versioned from git shares results across commits (defect 3)

Outcome: two worktrees synced at different commits, with no dependency change, inherit each other's results.

Decided by the coordinator (2026-10-15), amending D2: when a distribution's `direct_url.json` names an editable install inside the worktree, the environment hash takes that distribution's site-packages entries (its `.dist-info` and its `__editable__` `.pth` or finder files) without their version. The closure already keys its code. Every other distribution keeps name and version.

Shape: repair. Seam: the installed-set part of `src/runners/pytest/environment/hash.ts`.

Owns: `src/runners/pytest/environment/hash.ts`, `fingerprint.ts` if the fingerprint must agree, and their tests.

Done when: two synced copies of a fixture whose editable distribution is named `app-0.1.dev1+gAAA` and `app-0.1.dev2+gBBB` hash equal, and a third-party version change still changes the hash.

Use /worker.

## 007-39 batch size, admission and environment notes (defects 5, 8, 9, 11)

Outcome:
- `pytest[].batchSize` is a policy value (default 5, open question 5).
- An environment that gains pytest after its `pyvenv.cfg` is admitted within seconds, and a checkpoint that crashed on it says so.
- The no-environment note names a sync that works for the project.
- Resolved environment notes leave status.

Shape: repair. Seams:
- `src/core/daemon/policy-pytest.ts` and `pytest-runners.ts:153`, for `batchSize`;
- `adapter-environment.ts`, for admission while the installed set is still settling;
- D2's note text, chosen from the lockfile present, saying "create `.venv`" when there is none;
- the note store's resolution for environment notes. Ask before touching core notes.

Owns: those files and their tests, the `pytest` key in `references/policy.md`.

Done when: a policy test covers `batchSize`; an admission test installs pytest after `pyvenv.cfg` and is admitted within 5 s; there is a note test for each lockfile case; status drops the no-environment note once the environment is ready.

Use /worker.

## 007-40 agent texts name Python (defects 6, 10, 12)

Outcome: a synced Python worktree is never told "No dependencies are installed"; `squeal setup --yes` does not ask the user to trust Codex hooks it then trusts itself; the skill's trigger names `pytest`.

Shape: repair. Seams:
- `dependenciesInstalled` in `src/core/delivery/attribution.ts:141`: an admitted pytest environment counts as installed.
- The setup output (005's file; 005 must agree first).
- Line 3 of both `SKILL.md` copies, kept identical apart from Codex's CLI paragraph.

Owns: those, and their tests.

Done when: there are text tests for each case.

Use /worker.

## Host test-run policy (from 2026-10-15, adopted by the human)

For every remaining row and review of this spec:
- A worker's full-suite verdict is `squeal run --all --wait`. Only when Squeal is unavailable does it fall back to `npx vitest run --maxWorkers=4`, and its report says so.
- Every independent full run, whether a reviewer's or the coordinator's landing gate, takes the host's turn with `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`.
- There is one gate per bundle of rows, and at most 3 of this coordinator's workers and reviewers run at once.
- A file that fails a loaded gate and passes alone is named in the landing note.
