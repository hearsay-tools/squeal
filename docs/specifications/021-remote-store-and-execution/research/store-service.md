# Research: store-service (021-01)

Researcher 6b0d8161, 2026-11-11. Brief: `README.md`, topic `store-service`. This repository at `a3579d787`. Extends `../../018-ci-and-shared-results/research/remote-store.md` ("018-03" below) and does not repeat it; also reads `result-import.md`, `transport.md` and `shared-proof.md` there. Store copies of this repository and of cezar, taken 2026-11-11 12:17Z, read only. Node 24.22.1. Containers on loopback: PostgreSQL 17.11, Valkey 8.1.11, bazel-remote built from `6b51e7cb`, `ducktors/turborepo-remote-cache` 3.0.3. Outside docs and sources retrieved 2026-11-11 (commits in `probes/store-service/docs-facts.md`). Host: 24 vCPUs. The one-minute load stayed between 30 and 86 for the whole session, so no timing was kept (Q3, Q4). Probes: `probes/store-service/` (throwaway). Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What the git-ref route leaves unserved | The largest gap is not transport: in cezar, 0 of 195,943 imported results (18 exports) are at a live key, because every worktree runs Node 24.22.1 and the exports 26.13.0. Of the transport gaps only branch results are large (48% and 57% of cross-worktree reuse). Delay (about 2 min of transport), commits with no export (2 of 35) and main failures (2 and 9 rows in 7 days) are small. | exp, src, inf |
| 2 | Sharing model | CI on main writes `main`; PR runs write their branch's namespace; developers write nothing. No server in Q3 enforces namespaces by itself, and two of them overwrite. Provenance exists (018 D4, D15). The daemon's lookup stays local. | docs, exp, inf |
| 3 | A faster store for the remote path | The operation is the bulk read of one commit's results. No candidate beats the git ref once round trips and bytes are added; bazel-remote and Turborepo servers need one request per key. Loopback timings not measured (load 30 to 86). | exp, docs, inf |
| 4 | Is SQLite a bottleneck today? | No. Earlier costs were query shapes and lock waits between daemons on one file, fixed or held in code. | exp, src |
| 5 | Speak an existing protocol? | Yes over bazel-remote's HTTP action cache, verified: one `ActionResult` per key, results JSON in `stdout_raw`. No batched read, last writer wins, no place for closures or a commit manifest. | exp, src, docs |
| 6 | Fit and scope | The git-ref route is enough; no live store now. Later, if needed: an opt-in transport over a team's existing action cache. A multi-repository store is Hearsay's. | inf |

## Findings

### Q1. What the git-ref route leaves unserved

Counts from `q1-unserved.mjs` on the store copies, last 7 days (`out/q1-*.txt`) **[exp]**. "Main" means on `origin/main`'s first-parent line; one row is one check's result at one key.

| Results recorded locally | cezar rows | cezar check-seconds | squeal rows | squeal check-seconds |
|---|---|---|---|---|
| clean tree at a main commit | 12.9% | 14.9% | 12.9% | 18.3% |
| dirty tree on a main commit | 14.0% | 11.1% | 12.4% | 7.8% |
| clean tree on a branch commit | 34.1% | 35.1% | 29.7% | 30.8% |
| dirty tree on a branch commit | 39.1% | 38.9% | 45.0% | 43.0% |
| total | 3,222,077 | 3,249,474 s | 912,748 | 1,019,300 s |

| Gap named in the brief | Measured | Would a live store close it? |
|---|---|---|
| **Keys do not meet** (not in the brief's list) | cezar: 18 imports, 195,943 results, 12,613 keys since 2026-11-10 21:49Z. Known states with an imported origin now: 0. Worktree keys equal to an imported key: 0. Environments of all 477 worktrees: Node v24.22.1. The exports: v26.13.0 (`shared-proof.md` 2d). **[exp]** | No. A live store holds the same keys. This is the first gap to close, and it is host setup (cockpit on Node 26), not a store. |
| Results between developers | Current states: 81.3% (cezar, 739,288) and 82.3% (squeal, 187,155) are inherited from another worktree of the same clone. Of those, 47.9% and 57.3% were recorded at a branch commit. This is an upper bound for what other machines would miss: a branch result at a key whose content equals main's is also in main's export, and the store keeps one row per key, so it cannot say which. **[exp][inf]** | Only if developers write. On one machine the local store already serves it. |
| Pull-request and branch commits | 34.1% (cezar) and 29.7% (squeal) of rows are clean branch commits that a PR run could also produce. The worktree that made the commit ran them first; a PR run finishes later. A reader would be a reviewer or a teammate on that branch. In this host, reviewers are worktrees of the same clone. **[exp][inf]** | Yes for a teammate on another machine, if PR runs write a branch namespace (Q2). No data says how often a team checks out each other's branches. |
| Delay from a main merge to its import | Export created 15 to 49 min (median 17) after the merge-group commit was created: that is the CI run. Refs appear 0 to 99 s after landing (`shared-proof.md` 1). First import in the shared store: 1.5 to 200 min (median 18) after the export, when a daemon starts or moves to that commit (018 D14). **[exp]** | No. A live store written by the shards could save the export job's 80 s and the publish job's 33 s. The rest is CI and when a daemon moves. |
| A commit with no export | Since the first publish (`ef0c1ff0`), 33 of 35 main commits have `refs/squeal/<sha>`; `efcfb0e3` and `1b5939ba` have none (the merge group reused a PR run). 12 more refs name commits not on main: 8 merge groups that did not land and 4 unknown locally (`out/cezar-refs-squeal.txt`). D14 takes the nearest ancestor. **[exp]** | Only by letting PR results serve main, which is the poisoning case of Q2. No. |
| Failures and flaky history | Exports carry passes only (018 D2). Failures at clean main commits in 7 days: 2 of 414,396 rows (cezar), 9 of 117,968 (squeal). Failures elsewhere: 4,897 and 2,409, all work in progress. The flaky list (`meta` `flaky-checks`) has 1,024 entries in cezar and is per store. **[exp][src]** | Main seldom fails, so imported failures would rarely matter. Shared flaky history: not determined; nothing measured asks for it. |
| Closures for a fresh clone | Carried by the export (018 D2). A fresh clone gets 100% at its second daemon start and 2% at its first; the fix is row 018-28, running (`shared-proof.md` 2a). **[src]** | No change: a live store would carry the same closures. |

### Q2. Sharing model for a live store

- **Writers and readers [docs][inf].** The pattern of every tool in 018-03 Q1 and of Nx's fix for CVE-2025-36852 ("CREEP"): only protected-branch CI writes the shared cache; other branches write "an isolated remote cache accessible only by that specific branch". For Squeal: CI on main writes namespace `main`; a PR run writes `branch/<name>`; a developer writes nothing, or `dev/<user>` that only that user reads. A reader on branch B looks in `main` and `branch/B`. A poisoned PR result can then reach only readers of that branch, who already run its code.
- **Who enforces it [exp][docs].** Not the servers in Q3, as configured from their docs. bazel-remote's instance name is "optional but ignored" for CAS and separates AC keys only with `--enable_ac_key_instance_mangling`; its htpasswd users can write every instance. ducktors' team parameter (`?teamId=`) is a namespace, and its JWT mode has read and write scopes, but scopes per team are not documented. PostgreSQL row-level security or one schema per branch, and Valkey ACL key patterns, could enforce it, at the cost of user management per branch. **[inf]**
- **Last writer wins [exp].** bazel-remote and ducktors replaced an entry on a second PUT (`protocols.mjs`). Valkey `SET NX`, PostgreSQL `ON CONFLICT DO NOTHING` and S3 `If-None-Match: *` can refuse it **[docs]**. Write-once is what keeps a later PR write from replacing main's result.
- **Provenance [src].** An imported result already names its source: origin `imported`, "CI run <id> at <commit8>" (018 D4, D15). A live store would add the namespace and the writer to that record.
- **The lookup stays local [exp][inf].** 018-03 Q2: the daemon's lookup never leaves the local store. Q3's numbers keep it: a batched remote lookup costs one round trip plus 0.7 to 7 MB, against a local batched lookup of tens of ms (Q4). So any live store would still be a source the daemon imports from in bulk.

### Q3. A more performant store for the remote path

**The operation.** With the lookup local (Q2), the remote does four things. The bulk read of one commit's results is the import at daemon start; it is the only one on a user's path. The batched lookup of one worktree's keys is needed only for results with no commit to name (branches, Q1). Concurrent writes from CI shards: cezar's merge groups write 4 parts per run, about 46 runs a day (`transport.md` 2): no candidate is stressed. Retention: pruning by commit age, one call a day. So the operation that must be fast is the bulk read, and the batched lookup second.

**Loopback timings: not measured.** `bench.mjs` uses cezar data: one main commit's export (24,492 results over 1,456 keys) and one worktree's 1,921 keys (857 hits, 16,689 rows), on a server preloaded with 188,140 rows. The host's one-minute load stayed above the CPU count from about 12:10Z to the end of this session (`sar -q`: 30 to 86, mostly 46 to 72, from 12:00Z to 14:05Z; `timed.sh` never ran). One functional pass of `bench.mjs` (1 run each, at load 54 to 68) completed on all four backends: every import and every lookup returned the expected 24,492 and 16,689 rows. Its times are not kept. A later low-load run of `bench.mjs` gives them (see Open questions). The loopback floor from 018-03 Q3 still holds for the shape of the answer: for 1,358 keys at load 9 to 11, one HTTP request per key took 264 to 293 ms, 8 in flight 215 ms, one batched POST 27 to 29 ms, and the local batched query 57 to 83 ms **[exp, earlier]**. With a real network the round trips decide, not the engine (next table).

Payloads: the import is 9.8 MB as grouped JSON, 0.96 MB gzip. The lookup reply is 7.1 MB as JSON, 0.75 MB gzip. PostgreSQL and Valkey send rows as stored, uncompressed, unless Squeal compresses each value itself (0.89 MB summed per key) **[exp]**.

**Add the network by arithmetic [inf]** (RTT 20 ms and 80 ms; 10 Mbit/s):

| Backend | Round trips for the lookup | Round-trip time at 20 / 80 ms | Bytes | Transfer at 10 Mbit/s |
|---|---|---|---|---|
| git ref (shipped) | none: the lookup is local; one fetch per commit, measured 0.6 s to GitHub (`transport.md` 3) | 0 | 2.1 MB gzip per commit, with closures | 1.7 s |
| PostgreSQL | connect with TLS and SCRAM about 4, query 1 | 0.1 / 0.4 s | 7.1 MB rows | 5.7 s |
| Valkey | connect and AUTH 2, `MGET` 1 | 0.06 / 0.24 s | 0.9 MB if values are gzip | 0.7 s |
| bazel-remote HTTP, 16 in flight | 1,921 / 16 ≈ 120 | 2.4 / 9.6 s | 0.9 MB (zstd on request) | 0.7 s |
| Turborepo server, no batch | as bazel-remote | 2.4 / 9.6 s | as bazel-remote | 0.7 s |

**Candidates** (details and quotes: `probes/store-service/docs-facts.md`) **[docs][src]**:

| Candidate | Batch | Write-once? | Auth | The user runs or pays | Node client | Slow or down |
|---|---|---|---|---|---|---|
| PostgreSQL 18 docs, `pg` 8.23.1 | `= ANY($1)`, `unnest`, `COPY` | per statement (`ON CONFLICT`) | SCRAM, TLS, certs, grants | a server or a managed one | pure JS, 103 KB (+ protocol 202 KB) | no timeout by default (`statement_timeout`, `query_timeout`, `connectionTimeoutMillis`) |
| libSQL / sqld, Turso | `client.batch`, `/v2/pipeline` | `INSERT OR IGNORE` | JWT, read-only tokens | sqld, or Turso (free tier 5 GB; $4.99 a month next) | `@libsql/client` pulls a 9.7 MB native binary; `@tursodatabase/serverless` 288 KB pure JS | remote clients ignore `timeout` |
| Litestream | none: a backup stream of one writer to S3 | n/a | object-store credentials | a process beside the writer, a bucket | none; readers need a CGO VFS extension | readers wait for a snapshot |
| LiteFS | none: FUSE replica of one primary | n/a | not documented | FUSE on every machine, Consul | none | Fly: "outside our scope of support"; last release 2025-04-22 |
| S3-compatible, content-addressed objects plus a manifest | no batch GET; `DeleteObjects` 1,000 | `If-None-Match: *` | IAM, presigned URLs | a bucket and its bill ($0.0004 per 1,000 GETs on AWS); MinIO's community repository is archived | `@aws-sdk/client-s3` 3.3 MB pure JS | SDK retries 3 times; timeouts opt-in |
| Redis / Valkey | `MGET`, pipeline | `SET NX` | ACL users; default user has no password | a server; Redis 7.4+ RSALv2/SSPL (8: AGPL option), Valkey BSD | `iovalkey` 724 KB, `redis` 5.3 MB, pure JS; GLIDE 17 MB native | iovalkey: 10 s connect, 20 retries; offline queue on |
| bazel-remote (REAPI AC + CAS) | HTTP: none; gRPC: CAS batches only, AC one per key | overwrites (verified) | htpasswd, mTLS, unauthenticated reads | a Go server, `--max_size` required | none official; HTTP needs none, gRPC needs a gRPC stack | no client; Squeal's timer |
| Turborepo API, `ducktors/turborepo-remote-cache` | spec: `POST /artifacts` gives metadata only; ducktors: not implemented (404, verified) | overwrites (verified) | Bearer tokens, JWT read/write scopes, `READ_ONLY` | a Node server and storage (local, S3, GCS, Azure) | none needed (fetch) | turbo: 30 s and 60 s |

**Paused or absent server, client defaults** (`down.mjs`) **[exp]**: against a paused container, `pg`, `iovalkey` and `fetch` all were still waiting at the 20 s outer limit. Against a refused port, `pg` failed in 40 ms, `fetch` in 15 ms, and `iovalkey` after 10.6 s of retries. So every client needs Squeal's own kill timer, as the git reader has (018 D14).

**Verdict [inf].** No candidate is "more performant" where it counts. The bulk read is one download either way; the git ref already makes it in about 2 s to GitHub, compressed, with closures. A server helps only the batched lookup by keys, which only branch results need (Q1), and only Valkey and PostgreSQL do that in one round trip. Litestream and LiteFS replicate one writer's SQLite file and do not fit many writers.

### Q4. Is SQLite a bottleneck anywhere today?

- **Store sizes [exp].** cezar: `store.sqlite` 3.97 GB plus a 443 MB WAL, 3,578,445 result rows. squeal: 841 MB plus 43 MB, 954,398 rows (1,826,451 on 2026-10-31, 018-03 Q2: pruning works).
- **Lookup on cezar's copy** (`q4-local.mjs`, 1,921 keys over 3.58 M rows): not measured, because the load stayed above 24 (Q3). The last measurement is 018-03 Q3: one worktree's 1,358 keys over 1.83 M rows, 103 to 140 ms per key and 57 to 83 ms batched, at load 9 to 11 **[exp, earlier]**. The results index is a B-tree on `key`, so 3.58 M rows add about one level of lookup, not a multiple **[inf]**.
- **Import** of one export: 0.4 s into an empty store (`result-import.md` Q4) **[exp, earlier]**.
- **Earlier costs were query shapes, fixed in code [src].** A status wait's poll fell from 285 to 340 ms to 2 to 8 ms of CPU (row 011-42). `why` took 29 s from a quadratic dedup (gh-55, row 011-50).
- **Lock waits between daemons on one file [src].** SQLite has one writer per database. Several rows came from it: a status read gave up after 3 ms (011-113, fixed), the tier pump's busy writes held the event loop up to 10 s (011-126, fixed), one revision lost to "database is locked" at load 52 to 70 (011-104, held after one sighting; gh-138), and an exclusive lock from an unnamed holder (issue 8). These are many local daemons sharing one file. A remote server would not touch them, because each daemon would still keep its local store.
- **Host load [exp, earlier].** `load-slowdown.md`: Squeal's cost on this host is test CPU (762 worker-hours in 8.4 days) and the waits that grow above 16 busy vCPUs. It names no store cost.

Verdict: no local store operation costs enough to matter, by the evidence available. Nothing here argues for replacing SQLite, and ADR 0002 already rules out sharing the file across hosts.

### Q5. An existing protocol

**REAPI action cache over bazel-remote's HTTP API, unchanged server, validation on** (`protocols.mjs`) **[exp]**:

- Raw JSON at `/ac/<key>` is refused: `400`, "proto: cannot parse invalid wire-format data".
- A minimal `ActionResult` is accepted: `exit_code` (field 4) from the file's outcome, the file's results as JSON in `stdout_raw` (field 5), and the provenance text in `execution_metadata.worker` (field 9.1). A GET returns it re-encoded (6,670 of 6,672 bytes), with the JSON and the worker text intact.
- A second PUT with other content replaced the entry. A miss is `404`.
- Key: Squeal's key is a 64-character SHA-256 hex, which is what bazel-remote's AC path takes ("an arbitrary 64 character lowercase hexadecimal string") **[docs]**.

**Turborepo API, `ducktors/turborepo-remote-cache` 3.0.3** **[exp]**: PUT and GET of a gzip body under `/v8/artifacts/<key>?teamId=…` round-trip. The team parameter is required (`400` "querystring should have required property 'team'"). `x-artifact-duration` and `x-artifact-tag` sent on PUT came back as no headers on GET. A second PUT replaced the artifact. `POST /v8/artifacts` gave `404`.

**Mapping a Squeal result [inf]:**

| Squeal field | REAPI action cache | Turborepo |
|---|---|---|
| Key (one test file's content and environment) | AC key (`action_digest.hash`) | artifact hash |
| Check identity, outcome, duration, location per check | JSON in `stdout_raw`, or an output file in CAS | JSON in the artifact body |
| File outcome | `exit_code` | none (body only) |
| Failure text | `stderr_raw`, or a CAS blob | body |
| Provenance (CI run, commit, Node) | `execution_metadata.worker` and timestamps | `x-artifact-sha` (spec); ducktors did not return it |
| Closure lists and observed sets | **no place**; a CAS blob named by a manifest entry | **no place**; another artifact |
| "Results of commit C" | **no index**; an AC entry at a made-up key such as `sha256("squeal manifest " + C)` | same |

What does not fit **[src][docs][inf]**:
- REAPI keys the action cache by "a digest of the encoded Action", and over gRPC "the client MUST first upload the Action … along with its Command" (`remote_execution.proto` at `e0c0554b`). Squeal has no Action or Command; it would upload a made-up one, and a server with dependency checks (bazel-remote's gRPC `depsCheck`) may refuse an entry whose blobs are missing. bazel-remote's HTTP path does not check.
- No batched read of AC values in REAPI or of artifacts in the Turborepo API (ducktors lacks even the metadata query). One request per key: 120 round trips for one worktree (Q3).
- Both overwrite, so CREEP isolation is the client's job (Q2).
- A server shared with Bazel or turbo has its own eviction (`--max_size`, LRU). Squeal's entries compete with build outputs, and an evicted manifest loses a commit.

### Q6. Fit and scope

- **Vision [inf].** Principle 8: a live store is network I/O and an externally visible write with credentials on every machine, so it needs policy, off by default, as `shared.ref` does (018 D14). Decision filter 1 to 3: it would speed feedback only for branch results on other machines (Q1), and only once keys meet.
- **Secrets [docs][inf].** Failure text can carry environment values (Turborepo: "be aware of what you are printing"; 018-03 Q5). Exports are passes only today. A live store that carried failures would publish that text to everyone with read access.
- **What a team pays [docs].** PostgreSQL, Valkey, sqld, bazel-remote or a Turborepo server: one more service to run, back up and secure, and a token on every developer machine and CI. Turso: free to 5 GB, then $4.99 a month and up. S3: a bucket and per-request charges. The git ref: nothing beyond the git host they use.
- **Where it belongs [inf].** Not in Squeal now. The git-ref route covers what merges to main with no server. If a team later needs branch results across machines, reuse the cache it already runs (bazel-remote's HTTP action cache fits, verified), as an opt-in transport beside `shared.ref`. A store for many repositories, a dashboard, or distributed workers is a Hearsay service.

## Recommendation for Squeal

The git-ref route is enough; build no live store. First make the shipped route work: in cezar, 0 of 195,943 imported results are used today, because every worktree environment runs Node 24.22.1 and the exports Node 26.13.0. Land 018-28 (re-key after import, running) and move the cockpit's sessions to Node 26, then measure the live share again. Keep the daemon's lookup local; SQLite is not a bottleneck. Revisit a live store only when a team asks for branch results across machines. Then the smallest form is an opt-in transport over a team's existing action cache (bazel-remote HTTP, `ActionResult` with JSON in `stdout_raw`), passes only, with namespaces per branch, write-once where the server allows it, Squeal's own timer, and policy off by default.

## Open questions for the human

1. **Node in cezar's live sessions.** All 477 cezar worktree environments in the store are Node 24.22.1, so no imported result has been used since the first publish. Restart the cockpit on Node 26.13.0 (the 2026-11-10 decision), then re-measure the live share? Cost: a cockpit restart.
2. **Branch results across machines.** Is there a team, other than this host, that checks out each other's branches often enough to want PR-run results? Without one, nothing in Q1 needs a live store.
3. **Timings not measured here:** a short row that runs `bench.mjs` (4 backends, 3 runs) and `q4-local.mjs` when the load is below 24, about 10 minutes. It refines Q3 and Q4; it cannot change the verdict, which rests on round trips, bytes and the servers' semantics.
4. **Proposed later row, not run:** a two-machine trial of the action-cache transport against a throwaway bazel-remote on a second host, with a real round trip: lookup and import times, and behaviour when it is paused. Cost: one second machine or VM for about 2 hours, no account.

## Sources

- This repository at `a3579d787`: `src/core/store/schema.ts`, `imports.ts`, `transfer-import.ts`, `repos/results.ts`, `repos/unknown-runs.ts`, `repos/states.ts`, `busy.ts`, `src/core/types/state.ts`, `src/core/state/flaky.ts`; `docs/decisions/0002-content-keyed-shared-store.md`; `docs/board.md` rows 011-42, 011-50, 011-104, 011-113, 011-126, 018-28; 018 `spec.md`, `status.md`, `research/remote-store.md`, `result-import.md`, `transport.md`, `shared-proof.md`; 001 `research/issue-8-contention.md`; 011 `research/load-slowdown.md`.
- Store copies of `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite` (with `-wal`), 2026-11-11 12:17Z, removed after use. `git -C ~/projects/cezar log --first-parent origin/main` (fetched to 11:36Z) and one read-only `git ls-remote origin 'refs/squeal/*'`.
- REAPI: https://github.com/bazelbuild/remote-apis at `e0c0554b`, `build/bazel/remote/execution/v2/remote_execution.proto`. bazel-remote: https://github.com/buchgr/bazel-remote at `6b51e7cb` (`README.md`, `server/http.go`, `cache/disk/disk.go`, `utils/validate`). ducktors: https://github.com/ducktors/turborepo-remote-cache at `0c0f26d0`. Turborepo: https://turborepo.dev/api/remote-cache-spec.
- PostgreSQL https://www.postgresql.org/docs/current/ (18.6) and node-postgres at `2a5850fb`; libSQL at `a1d031cb`, its TS client at `9496c782`, https://docs.turso.tech, https://turso.tech/pricing; Litestream at `35e96618`, https://litestream.io; LiteFS at `062cff95`, https://fly.io/docs/litefs/; AWS S3 API reference and pricing pages; MinIO at `7aac2a2c` (archived); Valkey at `d5bf376a`, https://valkey.io, https://redis.io/docs/; clients node-redis `6dbcb598`, ioredis `b1413993`, iovalkey 0.4.0 and `pg` 8.23.1 as installed, valkey-glide `90ace988`. All retrieved 2026-11-11.
- Nx CVE-2025-36852 and Nx Cloud isolation: as cited in 018-03 Q1 and `result-import.md` Q3 (retrieved 2026-10-31), not fetched again.
- All quotes with exact URLs and lines: `probes/store-service/docs-facts.md`.
