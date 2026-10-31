# Research: remote-store (018-03)

Researcher: row 018-03, 2026-10-31. Source read at commit `6053220eb` of this repository. Store measured on a copy of this repository's live store, taken 2026-10-31 22:42. Host: 24 CPUs, one-minute load 8.7 to 11.0 during every timing (below the CPU count, so timings are reported). Node 24.22.1, git 2.43.0. External docs retrieved 2026-10-31.

## Questions answered

| # | Question | Answer in one line | Tag |
|---|---|---|---|
| 1 | Prior art protocols | All four are a key-to-blob map over HTTP (Bazel also gRPC). Lookup is per key; only Turborepo (`POST /artifacts`) and Bazel's CAS (`FindMissingBlobs`, `BatchReadBlobs`) batch. Writes are guarded by bearer or Basic credentials, and every one recommends that only trusted CI writes. | read in official docs, read in source code |
| 2 | Shared versus local tables | Shared, content-keyed: `results`, `checks` (by identity, not by integer id), `failure_texts`, plus the closure data (`test_files`, `meta` `observed*`) that keys are computed from. Everything else is local. The hot path stays local only if the remote is a bulk import into the local `results` table, never a per-lookup query. | read in source code, verified by experiment |
| 3 | Latency budget | Local lookup of 1,358 keys: 0.10 to 0.14 s per key, 0.06 s batched. Per-key HTTP on loopback alone: 0.26 to 0.29 s; with a real round trip, 27 s at 20 ms. One batched request: about 1 round trip plus a 445 KB gzip reply. | verified by experiment, inferred |
| 4 | Backends | Only a git ref (notes or a custom ref) and GitHub artifacts need no server and no new account. Only the git ref works with any git host and needs no GitHub API token. The Actions cache cannot serve developers at all. | read in official docs, verified by experiment |
| 5 | Write rights and trust | CI on main writes, everyone else reads. That is the pattern of all four tools and of GitHub's own cache. Writing anywhere outside the clone is externally visible, so it needs explicit policy (principle 8), off by default. | read in official docs, inferred |
| 6 | Scope | No store service in Squeal. If `result-import` finds keys portable, the smallest form is a per-commit results bundle that CI writes to a git ref and Squeal imports into its local store. A live shared service, if ever needed, belongs to Hearsay. | inferred |

## Findings

### Q1. Prior art: protocol and data model

This extends `specifications/001-core-loop/research/result-fingerprinting-prior-art.md`, which covers what each tool hashes. Here: where the data lives, what one lookup sends, how writes are authorized.

- **Turborepo** (Remote Cache API spec 1.0.0, "all versions of turbo are compatible with the v8 endpoints"). `HEAD`/`GET`/`PUT /artifacts/{hash}`, where the body is a gzip tarball of task outputs and logs. Metadata travels in headers: `x-artifact-duration`, `x-artifact-tag` (signature), `x-artifact-sha` (HEAD commit), `x-artifact-dirty-hash`. Batch: `POST /artifacts {"hashes": [...]}` returns metadata for many hashes and is optional. Auth: "All endpoints require Bearer token authentication … the token format and validation logic is up to the implementer". Integrity: optional HMAC-SHA256 signature with `TURBO_REMOTE_CACHE_SIGNATURE_KEY`; "Any artifacts that fail to verify will be ignored and treated as a cache miss". Client: `--cache=local:rw,remote:r` makes the remote read-only, `remoteCache.timeout` defaults to 30 s and `uploadTimeout` to 60 s, `--cache-workers` defaults to 10 concurrent operations. **read in official docs**
- **Nx self-hosted cache** (OpenAPI 1.0.0, page updated 2026-10-20). `PUT`/`GET /v1/cache/{hash}`, a tar archive as `application/octet-stream`. There is no batch. Bearer token from `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN`. `403` means "read-only token used to write". `409` means "Cannot override an existing record": entries are write-once. **Nx Cloud**: read-write CI tokens "should only be used for trusted environments such as protected branches"; results written with a read-only token go to "an isolated remote cache accessible only by that specific branch". Nx's CVE-2025-36852 ("CREEP") advisory: when pull requests and main share a cache, "first-to-cache-wins" lets a pull request upload a poisoned artifact under the hash main will compute later. Its fix is to let protected branches write the shared cache and keep other branches in their own isolated caches. **read in official docs**
- **Bazel** (REAPI at `c2c07e3d`, 2026-10-20; bazel.build/remote/caching). Two stores: the action cache (`ActionCache.GetActionResult` and `UpdateActionResult`, one action digest per call, no batch) and the CAS (`FindMissingBlobs`, `BatchReadBlobs`, `BatchUpdateBlobs`, size-limited by `max_batch_total_size_bytes`). The server can refuse action-cache writes (`ActionCacheUpdateCapabilities.update_enabled`). Over HTTP/1.1 the same split is `GET`/`PUT /ac/<sha256>` and `/cas/<sha256>`. The docs say: "You may want only your CI system to be able to write to the remote cache", with `--remote_upload_local_results=false` for readers. Known issue: "Bazel does not track tools outside a workspace … two users with different compilers installed will wrongly share cache hits". **read in source code** (proto), **read in official docs**
- **Gradle** (user guide 9.8.2). `GET`/`PUT <url>/<cache-key>`, `404` for a miss, `413` tolerated. HTTP Basic credentials, sent preemptively. Remote push is off by default: "We expect that developers will not be allowed to populate the remote build cache". On failure, Gradle retries 3 times, then "the remote cache will be disabled for the remainder of the build". **read in official docs**

What they share: the key is computed locally, and the remote is a dumb key-to-blob map. None stores per-workspace state remotely. A miss or a remote error always falls back to doing the work.

### Q2. Which of Squeal's tables could be remote

Measured on the copy (`probes/remote-store/table-sizes.mjs`; **verified by experiment**): `results` has 1,826,451 rows (461 MB, plus about 660 MB of its seven indexes), 213,331 distinct keys and 12,773 checks. Per table, from `src/core/store/schema.ts` and the repos (**read in source code**):

| Shared candidate (content-keyed, read-mostly) | Why |
|---|---|
| `results` (check, key, outcome, duration, location, fingerprint, failure id) | Keyed by content. Its provenance columns (`worktree_id`, `revision`, `run_id`) point at local tables and would need a remote kind (CI run, commit), as `known_states.origin_*` already has. |
| `checks` | Needed to read a result. The remote must use the identity `(project, test_path, kind, full_name)`; `checks.id` is a local integer. |
| `failure_texts` | Deduplicated by the hash of the text. It may hold secrets from test output (Q5). |
| `test_files` closure lists and `meta` `observed.*`, `observedDirect.*`, `observedModules.*` | The baseline computes keys "from stored closure lists" (ADR 0002). A fresh clone without them must ask the runner for every file's closure first. This data is not keyed by content: it is the newest list, merged across worktrees and "never pruned" (`keys/observed.ts`). Here it is 19.1 MB of JSON (822 KB gzip, 350 paths per test file on average) plus 3.5 MB (148 KB gzip) (`closure-size.mjs`). |

Local, never shared: `worktrees`, `revisions`, `file_hashes`, `test_file_keys` (also the cross-worktree claim table: `claimed`, `sharers`), `known_states`, `transitions`, `checkpoints`, `runs` and the `runs/` logs, `consumers`, `consumer_views`, per-worktree `meta` keys, and the history lists in `meta` (`retries`, `flaky-checks`, `replaced-failures`, `unknown-runs`, `failed-run-loads`). The locks directory stays local too.

The hot path: every run ends in `results.putMany`, and every lookup calls `results.byKey`, which also writes `last_used_at` (`repos/results.ts`). `acceptedAt` (`scheduler/accept.ts`) reads `byKey` once per file and, on a miss, once per older key format. A foreign fail is held until a local run confirms it (`heldFailure`). **Only one split keeps all of that local: the remote is a source the daemon imports from in bulk into its own `results`, `checks` and `failure_texts`, and the lookup never leaves SQLite.** A per-lookup remote tier would put the network inside `acceptedAt`. **inferred** from the code paths above.

Rows are `INSERT OR REPLACE` per `(check_id, key)`, so the last writer wins. Nx's server rejects an overwrite (`409`). An import needs a rule for an imported row that meets a local one; that rule belongs to `result-import`. **read in source code**

### Q3. Latency budget

Local lookup of one worktree's 1,358 keys, all hits, 11,881 rows (`lookup-time.mjs`, 3 runs; **verified by experiment**):

| Mode | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `byKey` per key, read-only | 103 ms | 110 ms | 140 ms |
| `byKey` per key with the `last_used_at` update, one transaction | 237 ms | 132 ms | 136 ms |
| One batched query (temp table of keys) | 83 ms | 57 ms | 57 ms |

The same 1,358 keys over HTTP on loopback, so no network round trip at all (`http-loopback.mjs`, 2 runs; **verified by experiment**): one key at a time 293 and 264 ms; 8 in flight 215 and 216 ms; one batched POST 27 and 29 ms. The request was 91 KB. The reply was 2.29 MB raw and 445 KB gzip. A reply that names only pass or fail per key is 50 KB gzip.

Adding a real round trip, by arithmetic (**inferred**): per key with no concurrency, 1,358 × RTT, which is 27 s at 20 ms and 109 s at 80 ms. With 8 in flight, 3.4 s and 13.6 s. Batched: one round trip plus the transfer, 0.36 s for 445 KB at 10 Mbit/s. Today a new worktree's lookup is about 0.1 s. A per-key remote is therefore 30 to 1,000 times slower than the step it would replace, and only a batched or bulk transfer fits.

What must stay true when the remote is slow or down (**inferred**, from the prior art in Q1 and the daemon's design):

- No hook waits on the network. Hooks read the local store. In this session the SessionStart primer printed "A daemon is starting; results are as of revision 0" and did not wait.
- A fetch has a short timeout. After one failure the remote is off for the rest of that daemon's life (Gradle's rule) and status says so. A remote error is never a test failure.
- Offline means the last import stands. Keys that are not found are misses and run locally, as today.
- Turborepo's 30 s default is too long for a baseline that is 0.1 s today. Squeal's bound should be set from measurements in a later row, not copied.

### Q4. Backends and their cost to a user

| Backend | Server the user runs | Reach from a developer machine | Fit for "main only" | Evidence |
|---|---|---|---|---|
| Plain HTTP service (Turborepo/Nx/Gradle style) | Yes, or a vendor | Token on every machine | Needs per-branch write rules (CREEP) | read in official docs |
| S3-compatible bucket | No code, but a bucket, credentials, and a bill | Credentials on every machine | Bucket policy; the CREEP advisory names bucket caches as the main case | read in official docs |
| GitHub Actions cache | No | **None.** The REST API only lists, sizes and deletes caches (`/repos/{o}/{r}/actions/caches`); there is no download outside a workflow run | CI to CI only. Writes to the default branch's scope come only from trusted triggers (`push`, `schedule`, …). Entries are evicted after 7 days unused, 10 GB per repository by default | read in official docs |
| GitHub artifacts | No | REST `GET …/artifacts/{id}/zip` with a token holding "Actions" read; it returns a redirect that expires in 1 minute; finding one commit's artifact means listing its workflow runs | Yes: upload only from the main-push workflow | read in official docs |
| Git ref (`refs/notes/squeal` or a custom ref) | No; the git host the team has | `git fetch` with the repository's own credentials; works with any host | Yes: one note per main commit, written by the main-push job | verified by experiment (local bare origin) |
| Shared filesystem | A mount | Same mount | — | ADR 0002: WAL does not work across network filesystems, so only an exported file could live there, never the store |

The git-ref experiment (`git-ref.sh`, fixture repository, local bare origin, 17 real result documents of which 9 differ; **verified by experiment**):

- A default `git clone` does not bring `refs/notes/squeal` (0 notes refs after clone). `git ls-remote` shows it. One explicit `git fetch origin refs/notes/squeal:refs/notes/squeal` brings all of it, in 14 ms on local disk. One note is 1.6 MB of JSON.
- The 17 documents total 25.9 MB raw. They pack to 1.18 MiB in the origin after `git gc`, because consecutive result sets differ little. The fetching clone held 3.5 MB of loose objects. One more landing fetched incrementally in 16 ms.
- git has no post-fetch hook. `reference-transaction` runs on every ref update, `post-merge` after `git pull`'s merge (git 2.43.0 `githooks` page; **read in official docs**). Squeal already watches HEAD moves, so an import "when main moves" needs no hook. A daemon that fetches by itself does network I/O in the background, which is a principle 8 question (Q5).

Not determined, because the rules say read-only on GitHub: whether GitHub rulesets or branch protection can guard a non-branch ref such as `refs/notes/*`, how GitHub serves a large notes history, and how two CI jobs that push notes at once resolve (git would reject the second push as non-fast-forward, and the job must fetch, merge and retry; **inferred**). A CI experiment for this is proposed in Open questions.

### Q5. Write rights and trust

Every tool examined lets trusted CI write and makes developers read. Gradle pushes nothing from developers by default. Bazel says "only your CI system". Nx wants read-write tokens only on protected branches and isolates other branches. GitHub's own cache gives low-trust triggers read-only access to the default branch's scope. Turborepo adds signatures. **read in official docs**

For Squeal (**inferred**):

- Writers: one main-push CI job. A developer's daemon never writes the remote. A pull-request job never writes the shared ref or bucket, which closes CREEP by construction.
- Principle 8: an upload, a fetch from a third-party service, or a push to a ref is externally visible. Each needs explicit policy in `squeal.config.json`, off by default. Reading a ref from the team's own origin is the smallest step, but it is still network I/O started by a daemon, so it should also be policy.
- Secrets: tokens only from the environment, as Nx (`NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN`) and Turborepo (`TURBO_REMOTE_CACHE_SIGNATURE_KEY`) do. Never in the store or in config. Failure text can carry environment values from test output, so the default bundle holds passes only, or outcomes without failure text. Turborepo warns that "logs [are] artifacts, so be aware of what you are printing".
- Anyone who can read the repository can read a notes ref: check names, durations and outcomes become as visible as the code. That is acceptable for most teams and must be stated in the policy text.

### Q6. Where it belongs

- **Not a store service in Squeal.** Every tool in Q1 needs a server, a vendor, or a bucket plus tokens on every machine. Squeal's promise is a local sensor (vision, principle 5), and its hot path must stay local (Q2, Q3). **inferred**
- **The git-ref route makes a service unnecessary for ideas 2 and 3 together.** It covers "what merges to main" with no server, it uses the auth the team already has, it works offline after a fetch, and the experiment shows the size is small. CI writes one results bundle per main commit (keys, check identities, outcomes, durations; no failure text by default; optionally the closure lists), and the daemon imports it into the local store. **inferred** from Q3 and Q4 measurements.
- **GitHub artifacts** are the fallback for teams that refuse new refs in their repository. They are GitHub-only and need a token on every developer machine. **read in official docs**
- **A live shared store** (many repositories, a dashboard, distributed workers) would be a Hearsay service, not Squeal. Nothing in ideas 2 and 3 needs it. **inferred**
- All of this has value only if a key computed on CI equals the key a developer computes. That is `result-import`'s measurement, and it gates every recommendation here.

## Recommendation for Squeal

Do not build a remote store. Keep the one local SQLite store as the only thing the daemon's hot path touches. If `result-import` shows that keys are portable, the smallest useful form is a results bundle per main commit: a main-push CI job writes it to a git ref of the team's own repository, and Squeal imports it in bulk into the local store when main moves. Every network step (fetch, push) is explicit policy and off by default, and a slow or absent remote only means more local runs.

## Open questions for the human

1. Is a ref in the team's own repository (for example `refs/notes/squeal`) an acceptable place for CI to write test outcomes? Anyone with read access to the repository could read them.
2. Should Squeal's daemon fetch that ref by itself (network I/O without a command), or only import what `git fetch` with a configured refspec already brought?
3. Should an exported bundle carry failure text? It is useful for a teammate, but test output can leak environment values.
4. Proposed later row, not run: one GitHub Actions experiment on a scratch repository. A main-push job writes a notes ref with `GITHUB_TOKEN`; it measures push time, the ruleset options for `refs/notes/*`, two concurrent pushes, and fetch time from a laptop. Cost: one scratch repository, about 10 workflow runs of 1 to 2 minutes, and a human to approve the repository and token.

## Sources

- This repository at `6053220eb`: `src/core/store/schema.ts`, `src/core/store/repos/results.ts`, `test-files.ts`, `replaced.ts`, `unknown-runs.ts`, `src/core/scheduler/bootstrap.ts`, `accept.ts`, `src/core/state/inherited.ts`, `src/core/keys/observed.ts`, `key-format.ts`; `docs/decisions/0002-content-keyed-shared-store.md`.
- Probes: `research/probes/remote-store/` (README lists each script).
- Turborepo: https://turborepo.dev/docs/core-concepts/remote-caching, https://turborepo.dev/docs/openapi, https://turborepo.dev/api/remote-cache-spec (spec 1.0.0), https://turborepo.dev/docs/reference/configuration, https://turborepo.dev/docs/reference/run (retrieved 2026-10-31, "Latest").
- Nx: https://nx.dev/docs/kb/self-hosted-caching (updated 2026-10-20), https://nx.dev/docs/kb/access-tokens, https://nx.dev/blog/cve-2025-36852-critical-cache-poisoning-vulnerability-creep (retrieved 2026-10-31).
- Bazel: https://bazel.build/remote/caching (retrieved 2026-10-31); https://github.com/bazelbuild/remote-apis at `c2c07e3d718d3d490a4958344d9c3e47de0bfaf3`, `build/bazel/remote/execution/v2/remote_execution.proto`.
- Gradle 9.8.2: https://docs.gradle.org/current/userguide/build_cache.html, https://docs.gradle.org/current/userguide/build_cache_use_cases.html, https://docs.gradle.org/current/userguide/build_cache_performance.html (retrieved 2026-10-31).
- GitHub: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching, https://docs.github.com/en/rest/actions/cache, https://docs.github.com/en/rest/actions/artifacts (retrieved 2026-10-31).
- git 2.43.0 `githooks` manual page (local).
