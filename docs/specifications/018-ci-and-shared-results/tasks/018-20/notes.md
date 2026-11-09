# 018-20 notes: `squeal ci publish` and the reader

Worker ab08dde9, 2026-11-09. Spec 018 D13, D14, D15, D16; `research/transport.md`. For the reviewer and for whoever continues (D17 in cezar).

## Where things are

| Part | File |
|---|---|
| The command | `src/cli/ci-publish.ts` (`ciPublishCommand`), dispatched from `src/cli/ci.ts`; help line in `src/cli/main.ts` (by agreement) |
| Publish: results commit, listing, prune order, one push | `src/core/ci/publish.ts` (`publishExport`) |
| git with bytes, kill timer, network environment | `src/core/shared/git.ts` (`gitCall`, `networkEnv`, `failureOf`) |
| Ref names, the export's name in the tree, `ls-remote` | `src/core/shared/refs.ts` (`EXPORT_NAME`, `remoteExports`) |
| Which export: upstream, M, candidates, first-parent check | `src/core/shared/choose.ts` |
| One fetch of one ref, the blob read | `src/core/shared/fetch.ts` (`fetchExport`) |
| The reader: when, notes, import | `src/core/shared/reader.ts` (`createSharedReader`) |
| Policy key | `src/core/daemon/policy-shared.ts` (`SHARED_SHAPE`, `isSharedRef`); `Policy.shared.ref` in `src/core/types/policy.ts` |
| Daemon call site | `src/core/daemon/daemon.ts`: made after `loop.start()`, `nudge()` at start and in `afterBatch`, `close()` at shutdown |

## The rule as built

Publish (in the export job's checkout): decode the export; refuse without a commit, or when the checkout lacks it. `hash-object -w --stdin`, `mktree` with one entry `squeal-results.json.gz`, `commit-tree --no-gpg-sign` with no parent, identity `Squeal <squeal@invalid>`, author and committer dates from `header.createdAt`, so one export gives one commit id. `ls-remote origin '<prefix>/*'`; each listed commit is placed by its position in `git rev-list --first-parent <commit>`; refs at position `keep` or later are deleted. One `git push --porcelain --no-verify origin +<result>:<prefix>/<sha> :<old>...`; a delete the remote refuses is counted, not fatal. The prefix is `shared.ref`, else `refs/squeal`.

Reader (daemon, only with `shared.ref`): each nudge reads `HEAD` without spawning (`gitHead`) and stops when neither `HEAD` nor `shared.ref` moved. Upstream: `origin` first, then each remote, the first whose `refs/remotes/<remote>/HEAD` resolves. M = `merge-base HEAD <that branch>`; stop when M did not change. Candidates: `rev-list --first-parent --max-count=1000 M`. When the store holds an import of M itself, nothing goes to the network. Otherwise one `ls-remote`, then the nearest candidate with a ref and nearer than any held import. A candidate off the default branch's first-parent line (`rev-list --first-parent <branch> --not <c>^@` ends at `c` only when `c` is on the line) gets a note, and the next candidate is tried. Fetch: `fetch --quiet --no-write-fetch-head --no-auto-maintenance --no-tags --no-recurse-submodules --no-prune --refmap= <remote> <ref>`, then `cat-file blob <oid>:squeal-results.json.gz` with the oid `ls-remote` gave. Refused when the header names another commit or `importRefusal` says so. Import: `importResults` with `rekeying` at the commit's blobs (D11), under the desk step `importing CI results`, then `requestRetries`, as `squeal import` tells a daemon.

## Decisions the spec did not settle

- **Listing before the fetch.** git 2.43 sends no ref prefix for `ls-remote` patterns (checked with `GIT_TRACE_PACKET`), so the remote advertises every ref: in cezarion about 1,500 `refs/pull/*` plus the results refs. The listing is still one round trip and names the nearest ref and its oid; the fetch then sends a prefix for its one ref. The listing is skipped when the store holds M's own export.
- **One try per start point.** A failed listing or fetch is one note, and the next try comes when M changes or the daemon starts (`transport.md` Q3). A busy store at import clears the start point, so the next batch tries again (and fetches again).
- **After a restart at M with only an older export held**, the reader lists again: CI publishes M's export minutes after main moved. It takes only an export nearer than the held one (no gap filling).
- **Off-line refusal is a note, and the next candidate is tried**; a fetch failure or a header mismatch ends the start point (one export per start point).
- **Timers**: listing 5 s, fetch 10 s (2 MB at about 2 Mbit/s), publish's network 120 s. ssh: `GIT_SSH_COMMAND`, else `core.sshCommand`, else `ssh`, with `-o BatchMode=yes -o ConnectTimeout=3` appended; `GIT_SSH` alone is left as it is (it may take no options), bounded by the kill timer. A timeout kills git and releases its pipes at once, since a child of git (ssh, `ext::`) can hold them.
- **`shared.ref` values**: a ref prefix under `refs/`, outside `refs/heads`, `refs/tags` and `refs/remotes` (every clone fetches or shows those), no wildcard, no trailing slash, no `..`, no `.lock`.
- **Publish pushes to `origin` only**, with no `--remote` flag; it force-writes its own ref, so a re-run replaces the export.
- **Orphans are not pruned.** The publishing checkout cannot tell a merge-group commit that never reached main from a newer main commit published by a concurrent run: neither is in its history. Such refs, and refs older than a shallow checkout, are kept and counted in the output. The export job needs `fetch-depth: 0` (or at least `keep` + 1) to prune; `actions/checkout`'s default depth 1 prunes nothing.
- **The import runs on the daemon's main thread**, about 2 s for cezar's 2 MB export (`import-trial.md` count 3); the front desk names the step meanwhile.
- **`test/cli/ci-usage.test.ts`** (018-16's) named `publish` as its unknown subcommand; it names `fetch` now (own commit).

## What the next rows must know

- **Two worktrees at one start point with different environments**: the second finds the import in the store and fetches nothing, so it has only the first worktree's re-keyed results. Not handled; a later row could keep the fetched oid and re-import from the local objects.
- The fetched objects stay unreachable in the clone until `git gc` prunes them (2 weeks).
- D15's other texts (`CI run <id> at <commit8>`, "observed set differs") are 018-18's `sourceLabel` and status lines; this row adds only the notes, each starting `CI results:`.
- `plugins/claude-code/dist` was not rebuilt (brief): the bundle test (`test/harness/plugin.test.ts`) fails on drift until the coordinator builds.
- Not tried on GitHub: whether it accepts `refs/squeal/*` pushes with `GITHUB_TOKEN` (`transport.md` open question 3); D17's cezar workflow is the first real run.

## Type changes

Additive: `Policy.shared: { readonly ref: string | null }`, `DEFAULT_POLICY.shared = { ref: null }`. New exports only under `src/core/shared/`, `src/core/ci/publish.ts` and `src/cli/ci-publish.ts`.

## Checks

`test/ci/publish.test.ts` (ref shape, prune, replace, refusals, unreachable remote), `test/cli/ci-publish.test.ts` (usage, prefix from `shared.ref`, refusals, help), `test/shared/reader.test.ts` (nearest export; nothing written to config, refs or `FETCH_HEAD`; no network when M's export is held; newer start point; off-line ref refused; header mismatch refused; offline note; kill timer; no `shared.ref`), `test/shared/policy.test.ts`, `test/daemon/shared-reader-daemon.test.ts` (a real daemon imports at start), and the defaults in `test/types.test.ts` and `test/daemon/policy.test.ts`.
