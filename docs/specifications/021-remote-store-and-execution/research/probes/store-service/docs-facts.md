# Remote store candidates: cited facts from official sources

Retrieved: 2026-11-11 (UTC), all items unless stated. Sources are official docs sites, official GitHub repos (shallow clones under `$TMPDIR/docs-clones`, SHAs below), the GitHub REST API for release/archive metadata, and `npm view` (registry, read-only). No downloaded code was run.

Repo commits used:

| Repo | Commit | Commit date |
| - | - | - |
| brianc/node-postgres | 2a5850fb0db18f5e40a642bbb4a4743de412ab54 | 2026-10-22 |
| tursodatabase/libsql | a1d031cb602fedefbcf55c568e98e998a2274400 | 2026-11-07 |
| tursodatabase/libsql-client-ts | 9496c782af413f6380235c7f5d0c97b5371f49b7 | 2026-09-02 |
| benbjohnson/litestream | 35e96618314c07256a5d57ba5803cca4bd4f4071 | 2026-11-10 |
| superfly/litefs | 062cff95225b072abd86897e7237bab7864d1a2c | 2026-10-29 |
| minio/minio | 7aac2a2c5b7c882e68c1ce017d8256be2feea27f | 2026-02-12 |
| valkey-io/valkey | d5bf376a3e594672473886a37b0921fc7dbec931 | 2026-11-11 |
| valkey-io/valkey-glide | 90ace988650641554b72c08abdb04e5ce86f142a | 2026-11-10 |
| redis/node-redis | 6dbcb5986e9a7a7e891a1198e3b69415d565e352 | 2026-11-10 |
| redis/ioredis | b1413993d6b51531b27fea72f336fdcb806b64d7 | 2026-11-09 |
| valkey-io/iovalkey | 96aa5a84b8e72da784445066c2765a555976d3eb | 2026-07-27 |
| buchgr/bazel-remote | 6b51e7cb2811e786a56d8afd5b6ba81b23152dc6 | 2026-11-10 |
| ducktors/turborepo-remote-cache | 0c0f26d0d6c169174bb5d20b8ffca1f18eb4955b | 2026-11-10 |
| vercel/turborepo | af729aba869736a9f03a0192d438cca35f4cc02b | 2026-11-10 |
| aws/aws-sdk-js-v3 (raw file only) | dee2abd898e7d1c69dd5ca5d74ecdce92e47d19d (main) | 2026-11-11 |

---

## 1. PostgreSQL (docs: current = 18, page footer "PostgreSQL 18.6 Documentation") + `pg`

**(a) Batch.**
- Multi-row write: "To insert multiple rows using the multirow VALUES syntax:" (example follows). https://www.postgresql.org/docs/current/sql-insert.html
- Bulk load: "COPY FROM copies data from a file to a table (appending the data to whatever is in the table already)." https://www.postgresql.org/docs/current/sql-copy.html
- Batched lookup with one array parameter: `expression operator ANY (array expression)`: "The right-hand side is a parenthesized expression, which must yield an array value ... The result of ANY is “true” if any true result is obtained." https://www.postgresql.org/docs/current/functions-comparisons.html (9.25.3)
- `unnest ( anyarray , anyarray [ , ... ] ) → setof anyelement, anyelement [, ... ]` (multi-array unnest for batched insert/lookup). https://www.postgresql.org/docs/current/functions-array.html
- `pg` sends a JS array as one parameter: "Array: Converted to a string that describes a Postgres array." https://node-postgres.com/features/queries
- `pg` pipelining (opt-in): "Query pipelining sends multiple queries to the server without waiting for responses ... Pipelining is opt-in. Pass pipeline: true to the Client constructor". https://node-postgres.com/features/pipelining
- Protocol note: Bind message parameter count is "Int16 The number of parameter values that follow" (so one `= ANY($1)` array avoids the per-statement parameter cap). https://www.postgresql.org/docs/current/protocol-message-formats.html

**(b) Write-once vs overwrite.** Configurable per statement: "ON CONFLICT DO NOTHING simply avoids inserting a row as its alternative action. ON CONFLICT DO UPDATE updates the existing row that conflicts with the row proposed for insertion as its alternative action." Without ON CONFLICT a duplicate key raises a unique-violation error ("an alternative action to raising a unique violation or exclusion constraint violation error"). https://www.postgresql.org/docs/current/sql-insert.html

**(c) Auth.**
- "The method scram-sha-256 performs SCRAM-SHA-256 authentication ... prevents password sniffing on untrusted connections". https://www.postgresql.org/docs/current/auth-password.html
- TLS: "PostgreSQL has native support for using SSL connections to encrypt client/server communications"; client certs via `clientcert=verify-ca` / `verify-full` in pg_hba.conf. https://www.postgresql.org/docs/current/ssl-tcp.html
- Read-only vs read-write roles via privileges: SELECT "Allows SELECT from any column ... of a table"; INSERT "Allows INSERT of a new row into a table". https://www.postgresql.org/docs/current/ddl-priv.html
- `pg` TLS: "you can provide an ssl property on the config object and it will be passed to the constructor for the node TLSSocket." https://node-postgres.com/features/ssl

**(d) What the user runs/pays.** A self-hosted PostgreSQL server process (or a third-party managed Postgres). Pricing: not determined: postgresql.org publishes no service pricing (checked sql-insert, auth, ssl pages).

**(e) Node client.** `pg` 8.23.1, unpacked 102,632 B; deps `pg-pool`, `pg-protocol` (202,040 B), `pg-types`, `pgpass`, `pg-connection-string`, optional `pg-cloudflare`; no `gypfile`, pure JS. Native is optional: `peerDependenciesMeta: { "pg-native": { optional: true } }` (brianc/node-postgres@2a5850fb packages/pg/package.json). `pg-native` 3.9.1 (33,816 B) depends on `libpq` 1.11.0 which has `gypfile: true`, install script `node-gyp rebuild`. Docs: "Native bindings between node.js & libpq are provided by the node-pg-native package" and need `apt-get install libpq-dev python3 g++ make`. https://node-postgres.com/features/native (npm view, 2026-11-11)

**(f) Slow/down.**
- Server-side: `statement_timeout`: "Abort any statement that takes more than the specified amount of time ... A value of zero (the default) disables the timeout." https://www.postgresql.org/docs/current/runtime-config-client.html
- `pg.Client` options: `statement_timeout` "default is no timeout"; `query_timeout` "number of milliseconds before a query call will timeout, default is no timeout"; `connectionTimeoutMillis` "number of milliseconds to wait for connection, default is no timeout"; also `lock_timeout`, `idle_in_transaction_session_timeout`. https://node-postgres.com/apis/client
- `pg.Pool`: `connectionTimeoutMillis`: "Number of milliseconds to wait before timing out when connecting a new client. By default this is 0 which means no timeout." https://node-postgres.com/apis/pool
- Retries: not determined: no retry option is documented on https://node-postgres.com/apis/pool or /apis/client, and `packages/pg-pool/index.js` has no retry logic (grep, @2a5850fb).

---

## 2. libSQL / sqld (Turso)

Status note: libSQL README: "Turso database and libSQL are two different projects from the same team ... If you're starting a new project, you probably want to look into Turso. libSQL is actively maintained, but new features are being developed in Turso." (tursodatabase/libsql@a1d031cb README.md). Pricing page banner: "Turso is joining Supabase to give every agent its own database" (https://turso.tech/pricing).

**(a) Batch.**
- `client.batch(stmts, "write")`: "A batch consists of multiple SQL statements executed sequentially within an implicit transaction ... success commits all changes, while any failure results in a full rollback". https://docs.turso.tech/sdk/ts/reference
- Wire protocol: Hrana 3 "To reduce the number of roundtrips, the protocol supports batches of statements that are executed conditionally" (tursodatabase/libsql@a1d031cb docs/HRANA_3_SPEC.md). HTTP: "`POST /v2/pipeline` ... accepts a series of operations to perform against a database connection." https://docs.turso.tech/sdk/http/reference
- Batched lookup is SQL (one `IN (...)` statement or a JSON-array parameter); SQLite's parameter cap: "SQLITE_MAX_VARIABLE_NUMBER, which defaults to 999 for SQLite versions prior to 3.32.0 (2020-05-22) or 32766 for SQLite versions after 3.32.0." https://www.sqlite.org/limits.html (~1,400 keys fits).

**(b) Write-once vs overwrite.** SQLite conflict clause: `conflict_action` "One of REPLACE, IGNORE, ABORT, ROLLBACK, or FAIL"; "IGNORE: Skip the row that caused the violation"; "REPLACE: Delete the conflicting row and insert the new row in its place". https://docs.turso.tech/sql-reference/statements/insert

**(c) Auth.**
- Turso Cloud: "Turso uses scoped, JWT-based tokens"; scopes include group, database, "Read-only | Queries only, no writes | Add `--read-only` flag", table+action (`-p comments:data_add`), and `--expiration 7d`. https://docs.turso.tech/sdk/authorization
- HTTP: "Turso uses Bearer authentication ... `Authorization: Bearer TOKEN`". https://docs.turso.tech/sdk/http/reference
- Self-hosted sqld: "configure client authentication by passing the `--auth-jwt-key-file FILENAME` ... The key is either a PKCS#8-encoded Ed25519 public key in PEM" (libsql@a1d031cb docs/USER_GUIDE.md); legacy `--http-auth basic:...` (libsql-server/src/main.rs, `SQLD_HTTP_AUTH`). TLS: USER_GUIDE.md covers CA cert/key setup (lines 47-62).

**(d) What the user runs/pays.** Either self-host `sqld` ("docker pull ghcr.io/libsql/sqld:main", USER_GUIDE.md) or Turso Cloud. Pricing page (https://turso.tech/pricing, as displayed): Free $0/month: 100 databases, 5GB storage, 500 Million rows read/month, 10 Million rows written/month, 3GB syncs. Developer $4.99/month: unlimited DBs, 9GB, 2.5 Billion reads, 25 Million writes. Scaler $24.92/month; Pro $416.58/month (yearly-discounted figures shown with "Save $X/month").

**(e) Node client.** `@libsql/client` 0.18.0, unpacked 156,563 B; hard deps `libsql` ^0.5.28, `@libsql/core`, `@libsql/hrana-client` (305,584 B), `js-base64`, `promise-limit`. `libsql` 0.5.29 (43,990 B) loads a prebuilt native addon from optional platform packages (`@libsql/linux-x64-gnu` 0.5.29 = 9,719,847 B, plus darwin/win32/musl/arm variants); no node-gyp. So installing `@libsql/client` pulls a ~9.7 MB prebuilt binary even if only `/web` is imported. Export map has `./web`, `./http`, `./ws`, `./node`, `./sqlite3` (libsql-client-ts@9496c782 packages/libsql-client/package.json). Docs: "The `@libsql/client/web` does not support local file URLs." Turso now recommends `@tursodatabase/serverless` for remote access: "Uses only `fetch` — zero native dependencies"; npm: 1.4.1, 287,646 B, no dependencies. https://docs.turso.tech/sdk/ts/reference

Embedded replicas: `syncUrl` + `syncInterval` (seconds): "Reads are always served from the local replica configured at `url`"; "Writes are sent to the remote primary database configured at `syncUrl` by default"; "Other replicas will see the new data when they call `sync()`, or at the next sync period". https://docs.turso.tech/features/embedded-replicas/introduction

**(f) Slow/down.**
- `timeout` option is local-only: "Busy timeout in milliseconds for local `file:` databases ... It only takes effect for local SQLite databases; remote clients ignore it." (libsql-client-ts@9496c782 packages/libsql-core/src/api.ts:66-75)
- Concurrency cap: "By default, the client performs up to `20` concurrent requests". https://docs.turso.tech/sdk/ts/reference
- Custom `fetch` option exists (api.ts:50-57), the only hook for a request timeout. Retries: not determined: no retry/timeout for remote requests in libsql-client-ts src (grep) or the TS reference.
- Interactive transactions: "lock the database for writing until committed or rolled back, with a 5-second timeout." https://docs.turso.tech/sdk/ts/reference
- Embedded replica offline: "You can write locally if you set the `offline` config option to `true`." https://docs.turso.tech/features/embedded-replicas/introduction

---

## 3. Litestream and LiteFS

### Litestream (latest release v0.5.18, 2026-11-03; repo not archived; README badge "status-beta")

**(a) Batch.** Not applicable as a network store: "Litestream is a standalone disaster recovery tool for SQLite. It runs as a background process and safely replicates changes incrementally to another file or S3." (benbjohnson/litestream@35e96618 README.md). Remote reads go through the VFS (SQL on the replica): "Serve read-only workloads from a remote replica (analytics, dashboards, reporting)." https://litestream.io/guides/vfs/

**(b) Write semantics.** SQLite's (local DB). Replica destination is single-writer: "Multiple applications replicating into the same bucket & path can cause situations" of corruption; "do not have multiple applications replicating concurrently." https://litestream.io/tips/ . "Each database replicates to a single replica destination." https://litestream.io/how-it-works/ . VFS write mode: "Write mode assumes a single writer. Multiple concurrent writers will trigger conflict detection." https://litestream.io/guides/vfs-write-mode/

**(c) Auth.** Object-store credentials only: VFS reads use backend env such as "AWS_ACCESS_KEY_ID , GOOGLE_APPLICATION_CREDENTIALS , AZURE_STORAGE_ACCOUNT". https://litestream.io/guides/vfs/

**(d) Runs/pays.** A Litestream process beside the writer plus an object store (S3, GCS, Azure, SFTP, file, NATS, WebDAV, Alibaba OSS listed). Remote readers need the VFS: "The VFS is read-only and requires CGO", loaded as a SQLite extension (`litestream-vfs.so`). https://litestream.io/guides/vfs/

**(e) Node client.** not determined: no npm client; the VFS is a C/Go loadable SQLite extension (https://litestream.io/guides/vfs/), so a Node CLI would need a native SQLite binding that can load extensions.

**(f) Slow/down.** VFS: "Network-bound latency: first access to a page incurs storage/network latency before it is cached"; "Missing L0 files (e.g., after aggressive retention) will surface errors"; "No data visible : VFS waits for an initial snapshot". https://litestream.io/guides/vfs/

### LiteFS (latest release v0.5.14, 2025-04-22; repo not archived, last push 2026-10-30)

**(a) Batch.** Not a network API; replicas read a local SQLite file: "LiteFS is a FUSE-based file system for replicating SQLite databases across a cluster of machines." (superfly/litefs@062cff95 README.md)

**(b) Write semantics.** Single primary: "SQLite operates as a single-writer database ... we use a lease system whereby a single node acts as the “primary” node"; leases "via Consul". https://fly.io/docs/litefs/how-it-works/ . On replicas: "SQLite will return a SQLITE_READONLY error when using the rollback journal and it will return a disk I/O error when using the write-ahead log"; app must forward writes using the `.primary` file. https://fly.io/docs/litefs/primary/

**(c) Auth.** not determined: no client auth model in README or https://fly.io/docs/litefs/how-it-works/ (cluster nodes trust each other; Consul for leases).

**(d) Runs/pays.** FUSE mount on every machine (`--device /dev/fuse --cap-add SYS_ADMIN` in README), Consul (or static lease). Support status: "Important: LiteFS is outside our scope of support . We are not able to provide support or guidance for it." https://fly.io/docs/litefs/ ; README: "This project is actively maintained but is currently in a beta state." Throughput: "LiteFS’ use of FUSE limits the write throughput to about 100 transactions per second". https://fly.io/docs/litefs/faq/

**(e) Node client.** not determined: none; any SQLite binding on the mounted path.

**(f) Slow/down.** "Compared to other replication tools, LiteFS has similar to tradeoffs to other asynchronous streaming replication methods"; rolling deploys "may have a short window of a few milliseconds of write availability loss". https://fly.io/docs/litefs/faq/ . Litestream vs LiteFS: Litestream "cannot replicate data to other live servers and it does not support automatic failover." (same page)

---

## 4. S3-compatible object storage (AWS S3, MinIO)

**(a) Batch.**
- Reads: one object per call: "GetObject Retrieves an object from Amazon S3." https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html . A batch GET API: not determined/none found in the S3 API reference pages checked (GetObject, PutObject, DeleteObjects).
- Deletes: "DeleteObjects ... delete multiple objects from a bucket using a single HTTP request. The request can contain a list of up to 1,000 keys". https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html
- Rate: "at least 3,500 PUT/COPY/POST/DELETE or 5,500 GET/HEAD requests per second per partitioned Amazon S3 prefix." https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html

**(b) Write-once vs overwrite.** Default overwrite: "If it receives multiple write requests for the same object simultaneously, it overwrites all but the last object written." Opt-in write-once: "If-None-Match - Uploads the object only if the object key name does not already exist". https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html . "The If-None-Match header expects the * (asterisk) value"; on existing object "the write operation fails, resulting in a 412 Precondition Failed response"; "You can also receive a 409 Conflict response in the case of concurrent requests if a delete request ... succeeds before a conditional write". https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html . Consistency: "Amazon S3 provides strong read-after-write consistency for PUT and DELETE requests of objects in your Amazon S3 bucket in all AWS Regions." https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html
- MinIO honours `If-None-Match` on PUT: `r.Header.Get(xhttp.IfNoneMatch) != ""` → `checkPreconditionsPUT` (minio/minio@7aac2a2c cmd/object-handlers.go:2020-2029).

**(c) Auth.** IAM credentials with SigV4; conditional writes need "the s3:PutObject permission" (conditional-writes page). Read-only sharing: "A presigned URL uses security credentials to grant time-limited permission to download objects." https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html . MinIO: "The MinIO deployment starts using default root credentials `minioadmin:minioadmin`." (minio README.md:77)

**(d) Runs/pays.** AWS: "if the data is stored in S3 Standard, you pay $0.0004 per 1,000 requests for all S3 GET and HEAD requests, or $0.005 per 1,000 requests for all LIST requests" (worked example on https://aws.amazon.com/s3/pricing/; the storage and PUT tables are rendered by script, not determined from static HTML). MinIO self-host status changed: README top: "**THIS REPOSITORY IS NO LONGER MAINTAINED.**" Alternatives "AIStor Free" / "AIStor Enterprise"; "The MinIO community edition is now distributed as source code only. We will no longer provide pre-compiled binary releases"; license AGPLv3. GitHub API: `archived: true` (minio/minio@7aac2a2c README.md).

**(e) Node client.** `@aws-sdk/client-s3` 3.1166.0, unpacked 3,312,142 B (own package only; deps `@aws-sdk/core`, `@smithy/core`, `@smithy/node-http-handler`, `@aws-sdk/credential-provider-node`, `@aws-sdk/signature-v4-multi-region`, `@aws-sdk/checksums`, ...), pure JS. `minio` (npm) 8.0.7, 2,092,892 B, 13 deps, pure JS. Plain `fetch` with SigV4 is also possible.

**(f) Slow/down.** SDK retries: standard mode "retries failed requests using exponential backoff with jitter"; `max_attempts` default 3: "one initial request and up to two retries." https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html . Timeouts are opt-in on `NodeHttpHandler`: `requestTimeout` "time limit (ms) for receiving response", `connectionTimeout` "time limit (ms) for establishing connection"; `maxSockets` "default is 50 per client" (aws/aws-sdk-js-v3@dee2abd8 supplemental-docs/CLIENTS.md:320-340).

---

## 5. Redis and Valkey

**(a) Batch.** MGET: "Returns the values of all specified keys." https://redis.io/docs/latest/commands/mget/ , https://valkey.io/commands/mget/ . MSET: "MSET is atomic, so all given keys are set at once"; "MSET replaces existing values ... See MSETNX if you don't want to overwrite existing values." https://redis.io/docs/latest/commands/mset/ . Pipelining: "send multiple commands to the server without waiting for the replies at all, and finally read the replies in a single step." https://redis.io/docs/latest/develop/using-commands/pipelining/

**(b) Write-once vs overwrite.** Default overwrite: "If key already holds a value, it is overwritten, regardless of its type." Write-once: "NX -- Only set the key if it does not already exist." https://valkey.io/commands/set/ (same text at https://redis.io/docs/latest/commands/set/). Batch write-once: MSETNX (mset page above).

**(c) Auth.** "AUTH <username> <password>"; default config `user default on nopass ~* &* +@all` ("require no password"). https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/ , https://valkey.io/topics/acl/ . Read-only users via ACL categories (e.g. `+@read`). TLS is a build option: "make BUILD_TLS = yes". https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/ . valkey.conf ships `# requirepass foobared` commented out and `protected-mode yes` (valkey@d5bf376a valkey.conf:1341, 112).

**(d) Runs/pays.** Self-hosted server or Redis Cloud. Persistence: "RDB persistence performs point-in-time snapshots"; "AOF persistence logs every write operation"; with RDB "you should be prepared to lose the latest minutes of data"; AOF everysec "you can only lose one second worth of writes." https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/ . Valkey defaults: save after 3600 s/1 change, 300 s/100, 60 s/10000; `appendonly no`; `# maxmemory-policy noeviction` default (valkey.conf:603-612, 1687, 1448-1450). Eviction: "noeviction : Keys are not evicted but the server will return an error when you try to execute commands that cache new data." https://redis.io/docs/latest/develop/reference/eviction/
- Licensing: "Redis 7.2.x ... remain subject to the BSD3 license. Redis Community Edition 7.4.x to 7.8.x remain subject to the dual RSALv2/SSPLv1 license"; Redis 8+: "RSALv2 ..., SSPLv1 ..., and the GNU Affero General Public License v3 (AGPLv3)". https://redis.io/legal/licenses/ . Valkey: "BSD 3-Clause License" (valkey COPYING); "forked from the open source Redis project right before the transition to their new source available licenses" (valkey README.md).
- Redis Cloud pricing (https://redis.io/pricing/): "Free Always $0 Up to 30 MB"; "Essentials From $0.007 /hour"; "Pro ... From $0.014 /hour *Minimum $200 /month".

**(e) Node clients (npm view, 2026-11-11).**
- `redis` 6.3.1: 299,801 B, meta-package over `@redis/client` 6.3.1 (5,336,142 B, no deps) + json/search/bloom/time-series; pure JS.
- `ioredis` 6.0.0: 1,290,811 B; pure JS. README: "maintenance is done on a best-effort basis ... For new projects, node-redis is the recommended client library." (ioredis@b1413993 README.md)
- `iovalkey` 0.4.0: 724,437 B; pure JS; "a friendly fork of ioredis" (iovalkey@96aa5a84 README.md:4).
- `@valkey/valkey-glide` 2.6.0: 2,343,052 B + native optional per-platform package (`@valkey/valkey-glide-linux-x64-gnu` 17,014,642 B); "core driver framework written in Rust" (valkey-glide@90ace988 README.md). Prebuilt binary, no node-gyp.

**(f) Slow/down.**
- node-redis: `socket.connectTimeout` default `5000`; `commandOptions.timeout` default `5000` "per-command timeout"; `disableOfflineQueue` default `false`; reconnect "Exponential backoff with a maximum of 2000 ms". FAQ: "commands that were already sent will reject ... The rest will remain queued in memory until a new socket is established." (node-redis@6dbcb598 docs/client-configuration.md:12-34, docs/FAQ.md:5-9)
- ioredis/iovalkey: "By default, all pending commands will be flushed with an error every 20 retry attempts ... setting `maxRetriesPerRequest`"; `enableOfflineQueue: false` to disable queuing (ioredis README.md:899-1011; iovalkey README.md:771-845). `commandTimeout`: "If a command does not return a reply within a set number of milliseconds, a "Command timed out" error will be thrown." (ioredis lib/redis/RedisOptions.ts:28-32)
- GLIDE: `requestTimeout` "encompasses sending the request, awaiting for a response from the server, and any required reconnection or retries ... a default value of 250 milliseconds" (valkey-glide node/src/BaseClient.ts:1107-1114).

---

## 6. bazel-remote (latest release v2.6.4, 2026-10-20)

**(a) Batch.** HTTP: one key per request: "Values are stored via HTTP PUT requests, and retrieved via GET requests. HEAD requests can be used to confirm whether a key exists". gRPC: "supports the ActionCache, ContentAddressableStorage and Capabilities services in the Bazel Remote Execution API v2" (README.md:34-35, 92-96 @6b51e7cb). Implemented: `FindMissingBlobs`, `BatchUpdateBlobs`, `BatchReadBlobs` (server/grpc_cas.go:43, 71, 243), `UpdateActionResult` (server/grpc_ac.go:223); `MaxBatchTotalSizeBytes: 0, // "no limit"` (server/grpc.go:128). Batch calls are CAS-only; AC GetActionResult is per key.

**(b) Overwrite.** Overwrites: LRU `Add` on an existing key replaces the value and counts `counterOverwrittenBytes` (cache/disk/lru.go:201-215). AC values are validated: "Values stored in the action cache are validated as an ActionResult protobuf message ... unless validation is disabled by configuration" (README.md:52-56); `--disable_http_ac_validation` "(default: false, ie enable validation)" (README.md:428-430).

**(c) Auth.** `--htpasswd_file` (basic auth); `--tls_ca_file` "Enables mTLS (authenticating client certificates)"; `--allow_unauthenticated_reads` "If authentication is enabled ..., allow unauthenticated clients read access. (default: false ...)" (README.md:205-226). No separate read-only credential: not determined beyond unauthenticated-reads (README checked).

**(d) Runs/pays.** Self-hosted Go server (HTTP + gRPC). `--max_size` "The maximum size of bazel-remote's disk cache in GiB. This flag is required." (README.md:155); `max_size_hard_limit`: "write requests will be rejected when max_size_hard_limit is reached" (README.md:469). Proxy backends: `--s3.*` ("The S3/minio endpoint"), `--gcs_proxy.*`, `--http_proxy.*`, Azure (README.md:269-384). "serving TBs of cache artifacts per day since April 2018" (README.md:21).

**(e) Node client.** not determined: no official npm client (README). HTTP via built-in `fetch`; gRPC via `@grpc/grpc-js` 1.14.7, 2,570,503 B, pure JS (npm view).

**(f) Slow/down.** Server timeouts `--http_read_timeout`, `--http_write_timeout` (config example 15s/20s; "these do not apply to the proxy"), `--idle_timeout` (README.md:197-228, 500-505). "Clients can then decide which requests to retry" when the hard limit rejects writes (README.md:470). Client-side behaviour: not determined (no client).

---

## 7. Turborepo remote cache: ducktors/turborepo-remote-cache and the official API spec

### Official spec (https://turborepo.dev/api/remote-cache-spec, OpenAPI 3.0.3 "Turborepo Remote Cache API" 1.0.0; viewer https://turborepo.dev/docs/openapi, lastUpdated 2026-11-10)

- Endpoints: `GET /artifacts/status`, `HEAD /artifacts/{hash}`, `GET /artifacts/{hash}`, `PUT /artifacts/{hash}`, `POST /artifacts` (queryArtifacts), `POST /artifacts/events`. "At this time, all versions of `turbo` are compatible with the `v8` endpoints." https://turborepo.dev/docs/core-concepts/remote-caching
- `POST /artifacts`: "Query information about multiple artifacts by their hashes. Returns metadata about each artifact including size, task duration, and tag. This endpoint is optional for basic cache functionality". Request `{ "hashes": string[] }`; response "A map of artifact hashes to their information. The value is `null` if the artifact was not found." (`ArtifactInfo`: `size`, `taskDurationMs`, `tag`; or `ArtifactError`). It returns metadata only, not bodies.
- turbo client: `query_artifacts` posts to `/v8/artifacts`; "An invalid or unsupported response is an error so callers can fall back to HEAD." (vercel/turborepo@af729aba crates/turborepo-api-client/src/lib.rs:380-405)
- PUT headers: `Content-Length`, `x-artifact-duration`, `x-artifact-tag` ("A base64-encoded tag ... typically used for verification"), `x-artifact-sha`, `x-artifact-dirty-hash`. PUT responses 200/202/400/401/403. Overwrite semantics: not determined: the spec says the server "should store this data and make it available for subsequent downloads" and nothing on repeats.
- Auth: "All endpoints require Bearer token authentication ... For self-hosted implementations, the token format and validation logic is up to the implementer." Signing: "Turborepo uses `HMAC-SHA256` signatures on artifacts" with `TURBO_REMOTE_CACHE_SIGNATURE_KEY`. https://turborepo.dev/docs/core-concepts/remote-caching
- Client timeouts: `remoteCache.timeout` "Default: `30`" s; `uploadTimeout` "Default: `60`" s; `0` disables. https://turborepo.dev/docs/reference/configuration

### ducktors/turborepo-remote-cache (npm `turborepo-remote-cache` 3.0.3, modified 2026-10-29)

**(a) Batch.** Not implemented: routes registered under `/${apiVersion}` are `GET/HEAD/PUT /artifacts/:id`, `POST /artifacts/events`, `POST /clean`, `GET /artifacts/status`; no `POST /artifacts` (src/plugins/remote-cache/index.ts:70-90, routes/*.ts @0c0f26d0). turbo falls back to HEAD per artifact (see above).

**(b) Overwrite.** PUT replaces: upload goes to a temp key and is promoted by rename; "a failed overwrite cannot destroy an artifact that is already cached" (src/plugins/remote-cache/storage/index.ts:293-301); local `promote` "readers see either the previous artifact or the complete new one" (storage/local.ts:48-53).

**(c) Auth.** `AUTH_MODE` `static` (default), `jwt` or `none`; `TURBO_TOKEN` "You can specify multiple tokens separated by comma"; JWT via `JWKS_URL`, `JWT_READ_SCOPES` / `JWT_WRITE_SCOPES`, `JWT_READ_ROLES` / `JWT_WRITE_ROLES`, `JWT_TEAM_CLAIM`; `READ_ONLY=true` rejects `PUT` and `POST /clean` "with a `403 Forbidden`" (docs/environment-variables.md:14-39).

**(d) Runs/pays.** Self-hosted Node (Fastify) server; `STORAGE_PROVIDER` `local`, `s3`, `google-cloud-storage`, `azure-blob-storage` (docs/environment-variables.md:30); listed: Local filesystem, AWS S3, DigitalOcean Spaces, GCS, Azure Blob, Minio (docs/supported-storage-providers.md). Deploy on Docker, Vercel, AWS Lambda, GCP Cloud Run, DigitalOcean, or `npx turborepo-remote-cache` (docs/deployment-environments.md). `BODY_LIMIT` default `104857600`. `TURBO_CACHE_READ_URL` serves reads by 302 redirect to a CDN.

**(e) Node client.** None needed: speaks the HTTP spec (fetch).

**(f) Slow/down.** Server: a Fastify handler timeout on PUT returns `412 { message: 'Error during the artifact creation' }` (routes/put-artifact.ts:39-44). Storage-side retries: not determined (repo docs checked). Client side is turbo's 30 s / 60 s timeouts.
