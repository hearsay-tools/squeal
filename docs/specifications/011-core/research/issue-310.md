# Issue 310: installed pnpm lockfile touched without changed bytes

Recommendation: keep the incident open for diagnosis; the bounded probe does
not reproduce timestamp-only invalidation, and hashing already precedes revision
creation.

## Scope and provenance

- Report: [hearsay-tools/squeal#310](https://github.com/hearsay-tools/squeal/issues/310),
  filed 2026-11-27. Reported versions: **CLI 0.1.665 / Antigravity daemon 0.1.640**.
- Examined 2026-11-28: source version **0.1.665**, commit
  `018267eeae8a99e1cd7fb90a5cdb33e737eecf04`. Release tags resolve to
  `be89f7e56b02bd4b67c602600583ed2e5f169b11` (0.1.665) and
  `b857e6d24f0bc205abaab7af75bf3c1bf312cd15` (0.1.640).
- Probe: Node **v26.13.0**, Linux host, **16 CPUs**, load averages at its start
  **1.54 / 2.13 / 2.63** on the final run (the initial run was
  **2.41 / 2.47 / 2.78**, with the same outcomes). Its load guard refuses a run above CPU-count load.
  One synthetic package; no package-manager install, daemon, ESLint, test
  runner, full suite or benchmark. The fixture is removed in `finally`.
- Ownership: research and throwaway probe only; no product, spec, status,
  board or skill changes. No commit made by this researcher.

## Questions answered

| Question | Answer and evidence |
|---|---|
| Does an mtime-only installed-lockfile change create a revision? | **Not reproduced**, with an already populated stat cache. Touch, identical rewrite and identical atomic replacement created none. **verified by experiment**, 0.1.665. |
| Does it change the installed fingerprint or request a lint thread refresh? | The fingerprint stayed equal and the refresh classifier returned `none` for all three. **verified by experiment**, 0.1.665. |
| Does the control prove the path was observed? | A comment added to the lockfile created revision 1, changed its blob and whole-install fingerprint, and selected lint refresh `thread`. **verified by experiment**, 0.1.665. |
| Does this explain the reported 2,100 stale tests, 4,123-file lint pass and late heartbeat? | **Not determined**: no incident store, prior/current lockfile bytes or live daemon trace was supplied. The large-worktree effects were not recreated. **inferred**, report versions 0.1.665/0.1.640. |

## Findings

### F1. Hashing already filters timestamp-only candidates

**verified by experiment**, 0.1.665. The probe calls `createFsHasher`,
`reconcile`, `installedDependencies` and `refreshLevel` from the repository,
with the existing in-memory store fake and tiny trusted pnpm-layout fixture.
The file is `node_modules/.pnpm/lock.yaml`; its graph was readable and its
install had no stale-lockfile note throughout.

| Operation | Revision | Original blob retained | Original whole fingerprint retained | Lint refresh |
|---|---:|---|---|---|
| mtime moved by 10 seconds | none | yes | yes | none |
| Same bytes written in place | none | yes | yes | none |
| Same bytes written and renamed over file | none | yes | yes | none |
| Append comment, content-change control | 1 | no | no | thread |

The control recorded old blob `ee40cf3f2422e3db848f64037dbd0caff153fe52`
and new blob `94b966e16e68ee50821bde59e279462f70aba8fa`, with `ignored: true`.
This measures the revision/fingerprint/classifier boundary, not actual
test verdicts, provider refresh or daemon scheduling.

**read in source code**, 0.1.665 and unchanged files in 0.1.640.
`src/core/revision/reconcile.ts` hashes changed stats and adds a `FileChange`
only when the cached hash differs; `commitBatch` creates a revision only for
nonempty changes. `src/core/keys/environment.ts` hashes installed-lockfile
content through the pnpm reader; the fingerprint does not include the
lockfile's mtime. A diff from the daemon tag to the examined source is empty
for `src/core/hash/`, `src/core/revision/`, `src/core/keys/`, the lint refresh
classifier and the two fixture helpers. This is source equivalence evidence,
not execution of the 0.1.640 daemon binary.

### F2. The reported attribution is not proof of the proposed cause

**read in source code**, 0.1.665. `src/core/delivery/liveness.ts`
`readLiveHeader` adds the dependency-install attribution when a recorded
change names an installed lockfile and has a non-null new hash. It does not
compare installed package inventories or establish that the lockfile's only
change was its mtime. Its changed paths can cover several revisions since
the consumer's last delivery.

**verified by experiment**, 0.1.665. After the content control, with no further
filesystem edit, deliberately using an empty stat cache creates revision 2
with `oldHash: null` and the same new blob as revision 1. That demonstrates
that an unobserved file can produce the attribution without a fresh byte
change. It does **not** establish that the incident lost a cache entry.
The output's `hashUnchanged` and `fingerprintUnchanged` fields compare with
the original fixture, so they remain false in this last case.

**inferred**, report versions 0.1.665/0.1.640. The next discriminating evidence
is revision 39's stored lockfile `oldHash` and `newHash`, its preceding
revisions and daemon lifecycle, plus byte digests taken around the actual
helper invocation. A prior absence, different bytes or first observation
must be separated from a timestamp-only touch before choosing a repair.

### F3. Touch handling and real install changes are intentionally different

**read in source code**, 0.1.665. `src/core/scheduler/batch.ts` uses the same
diff/commit path. `scheduler.ts` sends unchanged touched paths to runner
work without creating a revision; `runner-work.ts` uses an empty-change
revision and no content re-key for this path. This is not a promise that a
touch costs no work: runners receive invalidation hints, and C11 deliberately
discards an in-flight tier when install stats move across it, even if bytes
return unchanged. That protection is distinct from invalidating every
cached verdict.

**read in source code**, 0.1.665. Lint `refreshLevel` chooses a new thread for
an installed-lockfile path among revision changes. Spec 017 D4 requires that
refresh; D5 currently keys lint by the whole install fingerprint. The comment
control therefore shows a conservative fingerprint change without a package
change. The issue's stronger assertion that bytes were unchanged remains
unverified on its original worktree.

## Commands and result

From the repository root:

```sh
gh issue view 310 --repo hearsay-tools/squeal --json title,body,url,createdAt,comments
git rev-parse HEAD
git rev-parse squeal--v0.1.640
git rev-parse squeal--v0.1.665
git diff --quiet squeal--v0.1.640 HEAD -- src/core/hash src/core/revision src/core/keys src/core/lint/pass/refresh.ts test/hash/fakes.ts test/keys/install.ts
pnpm exec tsx docs/specifications/011-core/research/probes/issue-310/probe.ts > docs/specifications/011-core/research/probes/issue-310/output.json
```

The diff exited 0. The probe exited 0 and all assertions passed, with the
table's results. No test-suite pass is claimed. Probe artifacts:
[README](probes/issue-310/README.md),
[source](probes/issue-310/probe.ts),
[raw output](probes/issue-310/output.json).

The session launcher check,
`~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-310.md docs/specifications/011-core/research/probes/issue-310/probe.ts`,
exited 3 at revision 7: neither path belongs to a test file's closure;
worktree known failures 0, with 4 of 2,348 test files unknown. These are
background status counts, not coverage of the probe. All local findings
links were checked and resolved.

## Limits and specification references

This did not invoke the original helper, pnpm, a filesystem watcher backend,
a complete scheduler, a running tier or a lint worker. It did not reproduce
the timeout or heartbeat lapse, and did not inspect the original database.
A heavy/live large-project reproduction was outside this bounded triage;
it would run on boat.dev under current host rules. No claim that upgrading
the mixed versions fixes the incident follows from this probe.

The applicable contract is [011 C2/C3/C4/C11](../spec.md): no revision for
unchanged bytes, content-based keys, validity by key, and install-stability
protection. Related lint behavior is [017 D4/D5](../../017-lint-checks/spec.md).
Their status logs preserve the prior decisions. The remaining decision is
whether to authorize incident-state diagnosis or a broader boat.dev
reproduction; adding a second hash gate is not supported by this evidence.
