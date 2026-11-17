# Issue #236: directory symlinks duplicate code identities

Recommend a scoped repair of code identity for directory aliases, with a live regression check when host load permits.

**Verdict:** source inspection supports the duplicate-path mechanism for complexity and CRAP. End-to-end daemon reproduction was **skipped**, because the one-minute load reached 53.66 on 24 CPUs before a probe. The reported CRAP failures and the total of 100 changes remain unverified. No product code, configuration, spec, board or runtime state was changed. No tests or probe ran.

## Scope and versions

Read on 2026-11-17: [issue #236](https://github.com/hearsay-tools/squeal/issues/236), spec 015 D2/D3/D4/D6/D9 and its amendment log. The issue names Squeal **0.1.531**, revision 11, after Squawk commit `e50c45c721dd224481960ae046c4fe46991abaf6`.

The source checkout is **0.1.543**, commit `9e58bb28ad73c036916d9f005968b9514cfc2cd7`. The local release tag `squeal--v0.1.531` resolves to commit `7e78f02ef246e73f1e94e766fc5fc2dce313a3e4`. The installed launcher answers **0.1.531** to `--version`; this identifies the invoked CLI, not an independently inspected daemon process.

## Questions and answers

| Question | Answer and evidence tag |
| --- | --- |
| 1. Does the reported repository really track this layout? | **read in source code**, Squawk `e50c45c721`: yes. GitHub's tree has one regular `check.mjs` and two directory symlinks. Both links contain `../../.ai/skills/auto-merge`. |
| 2. Can all three names enter the counted set? | **read in source code**, Squeal 0.1.531 and 0.1.543: the watcher expands linked directories using their alias names. Inclusion and the complexity pass do not canonicalize those names. **inferred**, same versions: all three reach code state when normal inclusion and watcher conditions hold. |
| 3. Does a shared blob prevent duplicate complexity results? | **read in source code**, both versions: it prevents repeat parsing, but states are constructed for each path. The counter's guard explicitly covers only a symlink at the last component. |
| 4. Can CRAP and delivery also retain those aliases? | **read in source code**, both versions: CRAP checks, loader lookup, coverage lookup and delivery grouping retain path identity. **inferred**: aliases can have separate states and messages; their coverage evidence need not agree. Exact failure values are not determined without the affected daemon's loaders and records. |
| 5. Was the complete reported event reproduced? | Not determined, because the required load check prohibited a live probe. The issue's excerpt is reported evidence, not output produced by this task. |

## Source findings

**read in source code, Squeal 0.1.531 and 0.1.543.** `watcher/candidates.ts` expands files under observed directory symlinks. `walkFiles()` builds each file name with `` `${next}/${entry.name}` ``. `observedLinks()` rejects ignored links, root/ancestor targets and targets in another repository; it does not collapse two links to the same in-repository target. `watcher/linked-files.ts` supplies these paths at startup. `scheduler/keying.ts` seeds both the Git listing and the linked files. `code/pass/source.ts` supplies stored paths to the code pass. This explains why mode 120000 on the directory does not by itself exclude its descendants.

**read in source code, both versions.** `code/pass/blobs.ts:60-75` groups by blob and language. Its guard at lines 119-129 says “a symlink at the last component is never followed”. For `.agents/skills/auto-merge/check.mjs`, the link is an ancestor, while the final component is the regular file. `code/pass/counted.ts:16-34` assigns `path: file.path` for every input file and function. `code/pass/judge.ts` keys a check by path, qualified name and occurrence. `code/store/states.ts` uses the same tuple in SQL. One cached parse can therefore feed three separate check identities. The existing `test/code/pass/policy.test.ts` case uses a **file** symlink, `src/alias.ts -> a.ts`; that case does not cover a directory alias.

**read in source code, both versions.** `code/crap/judge.ts` constructs checks with `checkOf(j.file.path, fn)` and keys prior states by path. `code/crap/file.ts` matches coverage with `s.path === file.path`. `code/crap/walk.ts` obtains each file's condition with `cache.condition(file.path, loaders)`. `delivery/code-format.ts:88-100` groups measures by `[path, qualifiedName, occurrence]`; `delivery/code-delta.ts` also includes path. Thus grouping several measures of one function does not merge aliases.

**read in source code, both versions; inference limit.** `code/crap/file.ts:57-70` explicitly returns `unknown`, cause `no-loader`, for a listed source with no loaders. Its comment names spec 020 D11.5, which reverses 015 D9's older zero-coverage rule. `code/gate/rule.ts` and `code/crap/judge.ts` preserve that distinction. Consequently, an untested fixture alone is not proof of the reported CRAP FAILs. The issue's scores 132, 156 and 182 equal `CC² + CC` for CC 11, 12 and 13, but that arithmetic does not establish which records or stored states produced them.

**inferred, both versions.** This is a code-identity problem, not evidence that tree-sitter counts the same bytes three times. D2 defines path-based identity; D3 defines counting; D4 shares counts by blob but retains per-check states; D6 groups by function identity; D9 joins coverage per source. A repair must account for those identities together. Preserve distinct regular files with equal bytes and the watcher's needed dependency paths. Whether to resolve aliases or exclude them from code checks is a spec decision, not settled by this research.

## Commands and actual output

Read-only commands; executed from this worktree. Shell command separators below do not imply that output lines came from a probe.

```sh
gh issue view 236 --repo hearsay-tools/squeal --json title,body,url,comments
```

Returned title: `Complexity and CRAP results repeat for files reached through symlinked folders`; comments: `[]`. Selected **issue text**, not a reproduced delivery:

```text
SQUEAL · 100 code changes; your edit queued 1904 test files at revision 11
FAIL CRAP: check (.agents/skills/auto-merge/check.mjs:203): 132, over 30 (complexity 11; ...)
FAIL CRAP: parseDiff (.agents/skills/auto-merge/check.mjs:130): 156, over 30 (complexity 12; ...)
FAIL CRAP: pathReasons (.agents/skills/auto-merge/check.mjs:187): 182, over 30 (complexity 13; ...)
FAIL CRAP: check (.claude/skills/auto-merge/check.mjs:203): 132, over 30 (complexity 11; ...)
FAIL CRAP: parseDiff (.claude/skills/auto-merge/check.mjs:130): 156, over 30 (complexity 12; ...)
and 95 more code changes; squeal code --changed lists them.
```

Load commands: `cat /proc/loadavg` and `nproc`. Initial outputs:

```text
23.69 12.25 9.56 56/4714 3943762
24
```

Repeated before any live probe:

```text
53.66 20.26 12.29 70/5218 3956385
24
```

Since `53.66 > 24`, live reproduction was skipped. No generated probe state exists to remove.

```sh
git rev-parse HEAD
git rev-parse 'squeal--v0.1.531^{commit}'
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
```

Outputs, respectively:

```text
9e58bb28ad73c036916d9f005968b9514cfc2cd7
7e78f02ef246e73f1e94e766fc5fc2dce313a3e4
0.1.531
```

```sh
gh api 'repos/hearsay-tools/squawk/git/trees/e50c45c72?recursive=1' --jq '.tree[] | select(.path == ".ai/skills/auto-merge/check.mjs" or .path == ".agents/skills/auto-merge" or .path == ".claude/skills/auto-merge")'
gh api repos/hearsay-tools/squawk/git/blobs/76bc17c386dd829309c7eabb8938c48044423019 --jq '.content' | base64 --decode
gh api repos/hearsay-tools/squawk/git/blobs/ea3f0aec8469c9529f79704b6fc817abf7b3cc07 --jq '.content' | base64 --decode | sed -n '125,145p;180,215p'
```

Tree output fields (URL fields omitted):

| Path | Mode | Blob | Bytes |
| --- | --- | --- | ---: |
| `.agents/skills/auto-merge` | 120000 | `76bc17c386dd829309c7eabb8938c48044423019` | 27 |
| `.ai/skills/auto-merge/check.mjs` | 100644 | `ea3f0aec8469c9529f79704b6fc817abf7b3cc07` | 14240 |
| `.claude/skills/auto-merge` | 120000 | `76bc17c386dd829309c7eabb8938c48044423019` | 27 |

The link blob returned `../../.ai/skills/auto-merge` with no trailing newline. The regular blob excerpts contain `function parseDiff(base, head)`, `export function pathReasons(diff)` and `function check({ title, base, head })` at the reported positions. The script was read, never executed.

```sh
git diff --stat squeal--v0.1.531 HEAD -- src/core/watcher/candidates.ts src/core/watcher/linked-files.ts src/core/code/pass/blobs.ts src/core/code/pass/counted.ts src/core/code/pass/judge.ts src/core/code/store/states.ts src/core/code/crap/judge.ts src/core/code/crap/file.ts src/core/code/crap/walk.ts src/core/delivery/code-format.ts src/core/delivery/code-delta.ts
git show squeal--v0.1.531:src/core/code/crap/file.ts | sed -n '57,76p'
```

The diff printed nothing. The release source includes:

```ts
if (loaders.length === 0) return { state: "unknown", cause: "no-loader", ready: [], set: set() };
```

## Open questions and sources

No findings are tagged **verified by experiment**. The next live check must establish the three complexity paths, the CRAP states and loader evidence at each path, the post-fast-forward delivery, and whether a restart changes them. The exact count of 100 and the reported 0.1.531 daemon process version are not independently verified here.

- [Squeal issue #236](https://github.com/hearsay-tools/squeal/issues/236): reported event and versions.
- [Squawk tree at the reported commit](https://github.com/hearsay-tools/squawk/tree/e50c45c721dd224481960ae046c4fe46991abaf6/.ai/skills/auto-merge): real tracked source; tree and blob API commands above fetched its identity and aliases.
- [Squeal source 0.1.531](https://github.com/hearsay-tools/squeal/tree/7e78f02ef246e73f1e94e766fc5fc2dce313a3e4/src/core) and [examined checkout 0.1.543](https://github.com/hearsay-tools/squeal/tree/9e58bb28ad73c036916d9f005968b9514cfc2cd7/src/core): source paths and functions cited above are relative to `src/core/`.
- [Spec 015](../spec.md), [status](../status.md): D2/D3/D4/D6/D9. Source comments also point to spec 020 D11.5 for the later no-loader rule.
