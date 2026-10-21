# Recorded pytest reports

`pytest-tb-<style>.jsonl` are `squeal_pytest`'s event streams of one real pytest 9.1.1 run on Python 3.13.14 per traceback style, `long`, `short`, `native` and `line` (row 011-76, `test/status/test-frame.test.ts`). The `import` events are dropped and the worktree root is written `<root>`.

How they were made, on 2026-10-21:

1. `test/fixtures/pytest/small` was copied to `<root>/py` in a temp directory and synced there with `uv sync --locked --python 3.13`, so the project sits below the worktree root, as a monorepo's does.
2. Two files were added under `<root>/py/frames/`:

   `helpers.py`:

   ```python
   def check_total(value):
       assert value == 3, "total mismatch"


   def raise_value(value):
       raise ValueError(f"bad value {value}")
   ```

   `test_frames.py`:

   ```python
   from helpers import check_total, raise_value


   def test_helper_assert():
       total = 1 + 1
       check_total(total)


   def test_helper_raise():
       raise_value(7)


   def test_own_assert():
       assert 1 + 1 == 3
   ```

3. From `<root>/py`, once per style:

   ```sh
   SQUEAL_PYTEST_EVENTS=<out>/<style>.jsonl SQUEAL_PYTEST_ROOT=<root> \
   PYTHONPATH=<repo>/src/runners/pytest/runtime PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 \
   .venv/bin/python -m pytest -p squeal_pytest -p no:cacheprovider --tb=<style> frames/test_frames.py
   ```

4. Each stream was kept without its `import` events, with `<root>` for the temp root.

Long and short reports name paths from pytest's cwd (`frames/test_frames.py:6:`); native ones name absolute paths, which `relativizeText` makes root-relative (`py/frames/test_frames.py`); `--tb=line` keeps only the `E` line.

`pytest-tb-<style>-space.jsonl` (review 0.1.243 B1) were made the same way on 2026-10-21, with the two files under `<root>/py/test frames/` instead of `frames/`, for `long`, `short` and `native`, and `"test frames/test_frames.py"` as pytest's argument.
