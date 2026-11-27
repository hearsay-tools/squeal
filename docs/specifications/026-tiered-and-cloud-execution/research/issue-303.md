# Issue 303: remote staged index and failure reuse

Recommend a proposed Spec 026 row for staged-index fidelity, with a separate
acceptance case for post-commit result reuse. The stale index is reproduced at
the source sync seam. A persistent cached failure after commit is reported by
the issue and plausible from source, but not reproduced through a live daemon.

Examined 2026-11-27: source **0.1.658**, commit
`06c08dc790af8844d1c7d7c90a583b04d5dca682`. Installed launcher reports **0.1.657**;
Claude Code and Codex plugins 0.1.657, Antigravity plugin 0.1.640. The issue
reports 0.1.657 / Antigravity 0.1.640. The four probed sync modules have no diff
between `squeal--v0.1.657` and the examined source. This was a source probe,
not execution of the installed bundle.

| Question | Answer and evidence |
| --- | --- |
| Does a staged rename leave the remote index stale? | **verified by experiment, 0.1.658:** yes. After `git mv`, local listing is `src/new.ts`; remote listing is `src/new.ts`, `src/old.ts`, with the old path absent on disk. Reading the listing passes locally and throws `ENOENT` remotely. |
| Why does Git freshness accept it? | **read in source code, 0.1.658:** `localGitState` keys HEAD, branch/detached state and tags only. The index is absent from that key. **verified by experiment:** the rename leaves that key unchanged; `gitKeeper.sync(target)` says current with zero SSH calls, and a direct `ensureGitTree` call says `present`. |
| Does committing leave the sync mechanism permanently stale? | **verified by experiment, 0.1.658:** no. Commit changes the Git key; `sync(null)` says not current. An explicit `sync(target)` resets the remote index to the committed tree and the listing read passes. Before that refresh it still fails. |
| Is the issue's cached `ENOENT` after commit reproduced? | **inferred, 0.1.658; not determined end to end:** committing changes neither the fixture's synced file entries nor the observed `.git` kind hash. Source excludes `.git/` reads and the CLI reuses files classified current. The issue's exact stored inputs, daemon scheduling and refresh events were not captured. |
| Which spec owns this? | **read in source code/spec text, 0.1.658:** 026 D7.3 and D8.4 own Git bootstrap and conditional repository capability. Related: 026 D10/D12, 021 D10/D11/D19 and 011 C2/C3/C4. 021's original no-`.git` assumption is superseded by 026 here. |

## Evidence

**verified by experiment, 0.1.658.** The [throwaway probe](probes/issue-303/README.md)
uses real Git and source `ensureGitTree`, `gitKeeper`, `treeEntries`, `writesFor`
and `createTreeHost`, with the repository's local fake SSH helper. One committed
file is synced, renamed with `git mv`, synced again, then committed and refreshed.
It exercises the remote shell script without an SSH service or provider API.
[Raw output](probes/issue-303/result.txt):

```text
staged rename: gitStateUnchanged=true; reportedCurrent=true; keeperSshCalls=0
direct ensureGitTree: present
local ls-files: src/new.ts; remote ls-files: src/new.ts, src/old.ts
remote old exists=false; new exists=true; local read=PASS; remote read=ENOENT
commit: treeBytesUnchanged=true; gitKindHashUnchanged=true
before explicit refresh: current=false; read=ENOENT
after explicit refresh: current=true; remote ls-files=src/new.ts; read=PASS
```

**read in source code, 0.1.658.** In
`src/core/runner-host/remote/providers/agent37/bootstrap.ts`, `STATE` runs
`git symbolic-ref -q HEAD` and `git show-ref --head --tags`; `gitStateOf` builds
its key from those refs. `ensureGitTree` returns `present` for equal keys.
`SYNC_SCRIPT` populates the index with `git read-tree --reset HEAD`, never the
local staged index. Thus even a fresh bootstrap during a staged rename uses
HEAD's old index. The probe directly verifies the reuse case, not that fresh
bootstrap variant. `machine.ts`'s `gitKeeper` skips SSH while its key is current.
`tree-host.ts` separately removes old owned paths and writes new paths, without
updating Git's index. That is the verified disagreement.

**read in source code, 0.1.658.** The existing
`test/runner-host/remote/providers/agent37-git-sync.test.ts` covers commits,
tags, branch switches, detached HEAD and deleted-but-unstaged files. It does
not cover a staged rename with unchanged HEAD. Spec 026's status amendment
explicitly defines freshness in terms of HEAD, branch/detached state
and tags. Staged-index fidelity needs a clarified contract, not merely a claim
that the current predicate implements its documented inputs incorrectly.

**inferred, 0.1.658.** The second symptom can survive a correct Git refresh if
the failure is still reusable under the same tracked inputs. The probe confirms
unchanged tree entries across commit and unchanged `gitEntryByKind` output.
`src/core/keys/observed.ts` deliberately hashes `.git` by kind and says its
contents are not observed; `src/runners/observe/recorder.cjs` excludes `.git/`.
`src/cli/run-group-narrow.ts` prints “current; none runs again” from the daemon's
classification. These facts support an invalidation investigation, but do not
establish the actual issue's stored key or why its daemon skipped a new run.

**read in source code, 0.1.658.** `lane-repository.ts`'s missing-repository guard
matches Git's `fatal: not a git repository` diagnostic. An ordinary file-read
`ENOENT` does not match. With current repository capability,
`remote.needsRepository` also does not force local execution;
`remote.alwaysLocal` does. Routing the affected test locally is a possible
mitigation, but does not by itself prove an already cached failure is rerun.

## Commands and limits

Commands run from the worktree root:

```sh
gh issue view 303 --repo hearsay-tools/squeal --json title,body,comments,url
git rev-parse HEAD
node -p 'require("./package.json").version'
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
uptime
nproc
git diff squeal--v0.1.657 HEAD -- src/core/runner-host/remote/providers/agent37/bootstrap.ts src/core/runner-host/remote/providers/agent37/machine.ts src/core/runner-host/remote/tree.ts src/core/runner-host/remote/tree-host.ts
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-303/probe.ts
```

**verified by experiment, 0.1.658.** Initial load1 was 6.55 on 16 available CPUs.
The first probe ran at load1 6.28, exit 0; after moving the probe under the spec,
the preserved run used load averages 4.00/4.89/4.72, exit 0, about 0.69 s command
wall time. Runtime: Node 26.13.0, Git 2.43.0. Both runs gave the same behavioral
result. No full suite, production VM, provider provisioning or live daemon
reproduction ran. Squeal `checks` reported 582/2334 files current before edits;
that is environment context, not a suite pass. Biome formatting of the probe
reported the docs path ignored (exit 1, no files processed); no lint pass is
claimed.

Final path check: `squeal status --wait 60000` with this findings file and the
probe path returned exit 3: neither path belongs to a test file's closure.
It reported 0 known failures and 1748/2334 files not current (unknown).
The direct research probe above supplies the behavioral evidence.

## Decision and open evidence

**inferred recommendation, 0.1.658.** Retain one proposed issue row, owned by
026, and ask the human to approve work covering staged index fidelity and
recovery of previously stored remote failures. Tests using Git's index need a
consistent index, not just matching file bytes. The deciding tradeoff is the
cost and scope of metadata tracking versus preserving correct result reuse;
this research does not choose an implementation or broaden all result keys.

Still unknown: the issue's actual recorded closure/key, whether a later lane
split refreshed its remote Git state, whether a forced new run or daemon
restart cleared the failure, and whether identical cache behavior occurs
without remote execution. A follow-up should capture these at the exact
reported sequence before declaring the second symptom fixed.

Sources: [issue #303](https://github.com/hearsay-tools/squeal/issues/303),
[026 spec](../spec.md) D7.3/D8.4/D10/D12 and [status](../status.md);
[021 spec](../../021-remote-store-and-execution/spec.md) D10/D11/D19;
source and existing test paths above at the examined commit.
