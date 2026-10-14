# pytest end-to-end fixture

Static files `e2eSuite("pytest")` (`test/e2e/harness.ts`) adds over `../project/` for spec 007's end to end (`test/e2e/pytest.test.ts`). The harness also copies `test/fixtures/pytest/small` to `python/small` and writes `python/billing/src/billing/rates.py` itself (`RATES` in `test/e2e/sources.ts`), with a counter comment.

- `python/billing/`: the second pytest project, a `src` layout package built by hatchling. `tests/test_invoice.py` and `tests/test_tax.py` (two parametrized cases) import `billing.rates`, `tests/test_fmt.py` imports `billing.fmt` only. Its `uv.lock` pins pytest 8.4.2 (`pytest>=8,<9`), while `small`'s pins 9.1.1, so every scenario runs both majors in one daemon.
- `python/.gitignore`: `.venv/`, as a user would ignore it.

Each worktree syncs both projects with `uv sync --locked` on the scenario's Python (`uvSync` in `test/e2e/install.ts`, through `test/helpers/pytest-env.ts`); `squeal.config.json` is written by the shipped plugin's `squeal setup --yes`, under a HOME of its own. Never sync this directory in place.
