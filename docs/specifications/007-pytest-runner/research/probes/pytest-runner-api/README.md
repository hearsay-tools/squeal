# Throwaway pytest runner API probes

Research evidence for 007-01, not product code or a supported runner. Expected test failures, collection errors, hangs and crashes are deliberate. These probes run pytest only, never agent tooling. Run from this directory on Linux with `uv` available. `setup.sh` keeps managed Python downloads, uv's cache, temporary files and both virtual environments here; it never installs into user/system Python or changes HOME.

## Reproduce

```sh
bash setup.sh
PYTHONDONTWRITEBYTECODE=1 .venv-3.10/bin/python run.py > run-3.10.txt 2>&1
PYTHONDONTWRITEBYTECODE=1 .venv-3.13/bin/python run.py > run-3.13.txt 2>&1
PYTHONDONTWRITEBYTECODE=1 .venv-3.10/bin/python warm.py
PYTHONDONTWRITEBYTECODE=1 .venv-3.13/bin/python warm.py
PYTHONDONTWRITEBYTECODE=1 .venv-3.10/bin/python edges.py
PYTHONDONTWRITEBYTECODE=1 .venv-3.13/bin/python edges.py
PYTHONDONTWRITEBYTECODE=1 .venv-3.13/bin/python sources.py
PYTHONDONTWRITEBYTECODE=1 .venv-3.13/bin/python verify.py
```

`run.py` deletes and regenerates only its own `work/<major.minor>/`; run `edges.py` afterwards. Do not run two copies for the same Python version together. The captured run used CPython 3.10.20 and 3.13.14, uv 0.12.2, Linux x86-64 with 24 CPUs. Python installations are selected by minor version; use the captured patch versions if exact reproduction is needed. All installed distributions are pinned in `packages-*.txt`. The editable packages are installed from the generated fixture into those venvs with uv and no build isolation. Caches/venvs/generated trees are ignored; none are committed.

`fixture.py` generates an editable `src/probe_pkg`, pyproject pytest options, `tests/conftest.py`, nested conftest and tests, a parametrized module, an installed syrupy fixture consumer, an independently configured editable second package, 20 timed files and edge cases. No real database/network service is used. Hangs spawn a 120-second sleeping child; the harness kills their process groups after recording whether parent-only termination leaked the child. A 25-second per-command fallback prevents an uncontrolled hang.

## Evidence map

| File | Evidence |
|---|---|
| `results-3.10.json`, `results-3.13.json` | 50 cases each: argv, exit, wall time, hook events, JUnit/JSON artifacts, partial-stream/child status; ten timing groups |
| `warm-*.json` | Repeat-main, stale fork, clean fork and reload behavior |
| `edges-*.json` | xdist outcome fidelity/unstable IDs, override flags, disabled reporter, collect-only side effects, module skip, packaged conftest, process-group termination |
| `run-*.txt` | Probe execution log and timing samples |
| `reporter.py` | Minimal flushed JSONL hook collector; suppresses duplicate worker writes under xdist |
| `sources.json` | Fetched official docs/source excerpts and URL/content hashes; failed fetches remain explicit |
| `source-code.txt` | Versioned installed-package source snippets, with original file paths and line numbers |
| `verify.py`, `verification.txt` | Assertions against saved evidence plus syntax checks; this does not rerun pytest |
| `lint.txt`, `typecheck.txt` | Optional repository checks attempted; unavailable tools, not passing results |

Every `<PROBE>` in evidence replaces this probe directory's absolute path. PIDs, addresses and timestamps are observations, not stable identities. Timings include subprocess launch; five repetitions for startup/collection, three for 20-file scheduling. The two main sweeps overlapped on an already busy host (initial load 18.5/21.1). Interpret them as startup/batching evidence, not controlled Python-version benchmarks. The 50-ms test fixture is deliberately cheap; it does not measure real database/session-fixture economics.

Official pytest, xdist, asyncio and Django documentation sites initially returned HTTP 403; `sources.py` fetches their pinned official repository documents instead. The versioned json-report README URL returned 404, so the findings use the installed 1.5.0 source excerpt. Python 3.13 documentation was fetched on 2026-10-13. Findings on Python 3.10 come from its experiment, not an assumption that every 3.13 API detail applies.

## Verification scope

Captured `verify.py` output:

```text
Python 3.10.20: 50 main cases, warm/fork/reload, 10 edge records and 10 timing groups verified
Python 3.13.14: 50 main cases, warm/fork/reload, 10 edge records and 10 timing groups verified
PASS: 161 evidence and syntax checks
```

The parent coordinator explicitly retained build and the full repository suite for this docs-only commit (reply `56599616-5244-4dbd-8eed-433a6809534e`). This worker did not run them or modify plugin dist. Optional `npm run lint` and `npm run typecheck` both exited 127 because this worktree has no `biome` or `tsc`; no Node installation was made outside the assigned folder.
