# Probes for topic docker-execution (spec 027): throwaway

Everything here is throwaway research code. Nothing in Squeal imports it. Run on
2026-11-26 against a `git archive` copy of `apptension/saas-boilerplate` at
`caa46d26` under `$TMPDIR`; the checkout itself was only read.

| File | What it does |
|---|---|
| `deps.compose.yml` | Probe Postgres 16.1, Redis 7.2.4 and stripe-mock: ports on `127.0.0.1` ephemeral only, tmpfs data, label `org.squeal.probe=027`. Project `squeal-probe-027-deps`. |
| `test.compose.yml` | `backend` and `workers` services on the probe images, the scratch copy and Squeal's pytest runtime mounted, `init: true`. |
| `run-1-backend-container.sh` | One backend pytest batch by `docker run --rm --init --user`, Squeal's runtime mounted `:ro` and appended to the image's `PYTHONPATH`. |
| `run-2-backend-timing.sh` | 1-file and 5-file batch wall times: host `.venv`, `docker run --rm`, `compose run --rm -T --no-deps`, `docker exec -i`. |
| `drive-host.mjs` | Speaks Squeal's runner-host protocol (`src/core/runner-host/protocol.ts`) over any stdio command: `start`, `run`, then cancel, stdin end or client kill. |
| `run-3-host-endings.sh` | Runner host inside a container over `docker exec -i`; what is left after each ending; control with plain `docker exec`. |
| `run-4-parallel.sh` | 3 to 4 concurrent batches on one Postgres and Redis: shared names against per-slot names. |
| `run-5-identity.sh` | Missing source mount (stale baked code), mount dev:inode, costs of inspect calls, `docker events` on a rebuild. |
| `run-6-safety.sh` | Socket access, file owners, `-v` against `--mount` for a missing source, killed client, reap by label. |
| `out/` | Captured output. Host paths are shortened. |

Images built for the probes (`squeal-probe-027/backend:{a,b,c}`, `squeal-probe-027/workers:a`) and the two pulled bases (`python:3.11-slim-bookworm`, `segment/chamber:2`) were removed afterwards. Postgres, Redis, stripe-mock and `debian:bookworm-slim` images were already cached and were reused. BuildKit cache entries from the builds stay, because `docker builder prune` cannot filter by label.
