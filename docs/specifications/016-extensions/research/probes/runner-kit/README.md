# Probe: runner-kit (THROWAWAY)

Throwaway probe for `016-extensions/research/runner-kit.md` (brief 016-10). Not product code. Nothing imports it. `docs/` is outside lint, typecheck and the Vitest include.

- `scenarios.ts`: three runner-neutral scenarios. Each is a fixture of abstract modules (a value, a re-export, a test, a test that loads a module by a computed path, a test whose import is missing), an edit script, and the outcome of each check after each step.
- `packs.ts`: one pack per runner (Vitest, node:test, pytest). A pack gives each module's path and text in its runner's language, the project files, the full name of a check, how the adapter opens, where the adapter keeps observed paths, and the scenarios its spec documents it does not meet.
- `kit.ts`: the driver. It writes the fixture, then drives the adapter through `RunnerAdapter` alone (`testFiles`, `run`, `invalidate`, `affected`, `closure`). It prints one line per assertion and one verdict per (scenario, runner): `PASS`, `FAIL`, `KNOWN` (fails as the pack says it will) or `UNEXPECTED PASS`. There is no daemon, store or scheduler: the kit checks outcomes, and transitions stay with the core.
- `output.txt`: a full run at `f6320cd7e` (2026-10-24): 8 PASS, 1 KNOWN, exit 0.
- `output-shared-logs.txt`: the pytest pack with `RUNNER_KIT_SHARED_LOGS=1`, which gives every run the same `logDir`. The pytest adapter then reads the first run's events and reports stale passes. The daemon always gives a fresh directory per run (`src/core/scheduler/tiers.ts:476`).

Run it from a scratch directory. Every environment variable points under `/tmp`. The Python environment was made offline from the uv cache, outside the worktree:

```sh
mkdir -p /tmp/rk81/{home,run,cfg,tmp}
export HOME=/tmp/rk81/home XDG_RUNTIME_DIR=/tmp/rk81/run XDG_CONFIG_HOME=/tmp/rk81/cfg TMPDIR=/tmp/rk81/tmp
(cd /tmp/rk81 && UV_CACHE_DIR=<the user's uv cache> uv venv -q py && uv pip install -q --offline --python py/bin/python pytest)   # pytest 9.1.1, Python 3.12.3
cd /tmp/rk81 && RUNNER_KIT_PYTHON=/tmp/rk81/py RUNNER_KIT_SCRATCH=/tmp/rk81/s \
  <repo>/node_modules/.bin/tsx <repo>/docs/specifications/016-extensions/research/probes/runner-kit/kit.ts [vitest|node-test|pytest ...]
```

The Vitest fixture links `node_modules` to the repository's (Vitest 5.0.3). The probe adds no package to the repository. `/tmp/rk81` was removed after the run.
