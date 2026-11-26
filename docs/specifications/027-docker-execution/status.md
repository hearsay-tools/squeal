# 027 Docker execution: status

Stage: research
Started: 2026-11-26

## Decisions so far

- 2026-10-28, the human (spec 007 rows `007-57`, `007-58`, `007-59`, `007-60`): researched pytest-in-Docker (`007-pytest-runner/research/tests-in-docker.md`) against a PDM/PEP 582 project. Decided then to keep test processes on the host with reachable Compose services, defer container mode, and plan (not authorize) a per-batch slot env var (`007-60`).
- 2026-11-26, the human: asked to make sure Squeal can run the tests in `~/projects/saas-boilerplate` (`apptension/saas-boilerplate`), including tests that run in Docker today, and approved researching all Docker execution options (alongside a Jest runner adapter in spec 028).
- 2026-11-26, the coordinator (017fb3d3): opened spec 027 for research only (`research/README.md`, topic `docker-execution`), building on `007-pytest-runner/research/tests-in-docker.md` and the shipped Spec 021/026 remote runner-host seam. Dispatched `/researcher` on the standing researcher model (`claude`, `opus`, `high`). No product code or spec yet.
- 2026-11-26, wave 0 research `027-01` done (`research/docker-execution.md`, researcher `07c5893b`, `claude` `opus` `high`):
  - On `saas-boilerplate` (`caa46d26`; `packages/workers` has 1 test file, 2 tests): host `uv` + `-o env_override_existing_values=0` passes 68/71 sampled backend tests (3 Stripe webhook tests hardcode `http://stripemock:12111`) and 2/2 workers tests once its DB exists (`setup.py create_db` hardcodes `db`). Inside the container, 71/71 backend and 2/2 workers pass.
  - Option (C), `squeal runner-host` inside a long-lived container over `docker exec -i`, runs at host speed (5.8/9.0 s for 1/5 files vs 6.0/9.9 s host and 11.3/15.3 s per-batch `docker run` without a bytecode dir), works for pytest and `node:test`, eliminates path mapping with same-path bind mounts, and cleanly reaps its test process group on cancel, stdin EOF, client SIGKILL, and daemon SIGKILL. Blockers for (C): requires Node 22.19+ (`node:sqlite`, while `saas-boilerplate` images ship Node 20; mounted host Node fails without `libatomic.so.1` or on musl), and `saas-boilerplate`'s `/pkgs/.venv` editable install triggers pytest D2's outside-worktree refusal.
  - Parallel batches collide on Postgres (`test_backend` cold: 2/3 fail), Redis rate limits (4/6 fail + signup `Rate limit exceeded.`), and `workers_test` (6/9 fail); per-slot names (`TOX_PARALLEL_ENV`, per-slot Redis DB, per-slot workers DB) fix all three.
  - `compose run --pull never` still builds a missing image (`run` has no `--no-build`); root `dev:inode` proves a live bind mount against baked-in code; `--mount` refuses missing host paths where `-v` creates root-owned directories; `--no-cache` rebuilds produce new image IDs with identical packages.
  - Recommendation: (A) host + services + slot/env templating now for `saas-boilerplate`, (C) later as the general container mode, not (B). Awaiting human decisions before writing `spec.md`.

## Open questions

1. Host runs vs container mode first: is host execution (A) acceptable now (with the 3 hardcoded `stripemock` tests noted, or fixed in `saas-boilerplate`), or should we build container runner-host (C) right away so the container network works untouched?
2. Service lifecycle: does the developer start Compose services (Squeal reads ports/network), or may Squeal start labelled Compose services?
3. Slot isolation (`007-60`): export `TOX_PARALLEL_ENV` directly beside `SQUEAL_SLOT` + env templating (`redis://.../{slot}`, JSON `dbname`), and should slots be unique per worktree?
4. For (C): may Squeal mount a self-contained Node 22.19+ binary into containers, or require images to ship Node 22.19+?
5. Container result keying: content-based keys (shareable across builds/CI, computed inside the container) or image-ID keys (exact, never shared across rebuilds/CI)?
