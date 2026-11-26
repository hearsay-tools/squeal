# 027 Docker execution: status

Stage: research
Started: 2026-11-26

## Decisions so far

- 2026-10-28, the human (spec 007 rows `007-57`, `007-58`, `007-59`, `007-60`): researched pytest-in-Docker (`007-pytest-runner/research/tests-in-docker.md`) against a PDM/PEP 582 project. Decided then to keep test processes on the host with reachable Compose services, defer container mode, and plan (not authorize) a per-batch slot env var (`007-60`).
- 2026-11-26, the human: asked to make sure Squeal can run the tests in `~/projects/saas-boilerplate` (`apptension/saas-boilerplate`), including tests that run in Docker today, and approved researching all Docker execution options (alongside a Jest runner adapter in spec 028).
- 2026-11-26, the coordinator (017fb3d3): opened spec 027 for research only (`research/README.md`, topic `docker-execution`), building on `007-pytest-runner/research/tests-in-docker.md` and the shipped Spec 021/026 remote runner-host seam. Dispatched `/researcher` on the standing researcher model (`claude`, `opus`, `high`). No product code or spec yet.

## Open questions

1. Which execution architecture best fits containerized test suites in Squeal: (A) host tests + Compose services + per-batch slot var (`007-60`), (B) opt-in per-batch `docker compose run --rm --no-deps` / `docker run --rm`, (C) a long-lived container running Squeal's runner host over `docker exec -i` (reusing Spec 021/026), or a phased combination?
2. How should Squeal isolate test databases and Compose projects across parallel batches and multiple worktrees without port, volume, or `container_name` collisions?
3. What policy, consent, mount verification, and environment keying rules preserve Squeal's no-stale-pass guarantee and Vision principle 8?
