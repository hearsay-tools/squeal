# Issue 39: named wait paths and the caller's working directory

Recommendation: do not treat #39 as a path-resolution bug. Named paths already resolve against the caller's working directory on every version examined. The second symptom is #6/#30's selector, fixed in 0.1.204, on a plugin that was 0.1.199 until 12:50Z on the day the issue was filed. What is left is a human scope decision about guidance for an unmatched path that would match from the worktree root.

Examined 2026-10-19, 16:11 to 16:30 CEST. Checkout `036be0a0` (package 0.1.222). Installed Claude Code and Codex plugins are both 0.1.222 (`installed_plugins.json`: user scope `lastUpdated 2026-10-19T12:50:15Z`, commit `1612b9e0`), and `squeal --version` prints 0.1.222. Cached 0.1.199 was examined too. The checkout bundle and the installed 0.1.222 bundle hash the same (`94380a2e…`). Load before work was 3.60 / 4.36 / 4.64 on 24 CPUs (`uptime`, `nproc`). The probe ran at 3.2, and the live calls at 2.57 to 4.12. The load stayed below the CPU count throughout, so the live attempt was allowed. Documentation only: no product, board, spec, status or skill edits.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Does a subdirectory-relative named path resolve to the same file as its root-relative form? | Yes. The cwd-relative form from `packages/cezar`, the repo-relative form from the root, and the absolute path from either directory all select the same one file (1/0 on 0.1.222 and the checkout). A repo-relative path given from the subdirectory is joined to the cwd, and it is unmatched as `packages/cezar/packages/cezar/…`, exactly as in the incident. | verified by experiment, 0.1.199, 0.1.222, checkout |
| 2 | Does an unmatched path select unrelated browser consumers? | No. A path that names no listed test file and is in no valid closure selects nothing, and it is reported as unmatched with its resolved worktree path. A path outside the worktree is reported as given. Browser consumers are selected only when the path is in their closure. That happens for a source file, or for a test file that is not listed (81/81 in the probe). | verified by experiment, same targets |
| 3 | Is the 81-browser case distinct from fixed #6/#30? | Most likely the same. On 0.1.199 the listed `src/core/cursor-acp-runner.test.ts` named from `packages/cezar` selects 82 files: itself plus 81 browsers. On 0.1.222 it selects only itself. The incident's version is unproven (see Open questions). The only other route to 81 browsers is the test file not being listed at that read, which is ordinary D2 closure selection, not misresolution. | verified by experiment (selector); inferred (incident) |
| 4 | Is ordinary source-closure selection preserved? | Yes, and it is unchanged across versions. The source `src/core/cursor-acp-runner.ts` selects 82 (the unit test and the 81 browsers) from either base. | verified by experiment |

## Findings

1. **Resolution is cwd-based, as git and vitest do it.** `worktreePath` (`src/cli/status-wait-paths.ts:120`) returns `relative(root, resolve(base, path))` for `base` in `[cwd, realpath(cwd)]`, with `null` outside the root. `cwd` is `io.cwd ?? process.cwd()` (`:345`, `src/cli/index.ts:13`). The plugin's `bin/squeal` only `exec`s node and changes no directory. It has been this way since 005-11 (`9048e3d2`). *read in source code, checkout 0.1.222.* Issue #39's suggested fix ("resolve against the caller's working directory") is therefore already the behaviour. Its first case is a repo-relative path typed from a subdirectory. git, vitest and Squeal all treat that as cwd-relative. *inferred.*
2. **Probe output.** In the summary, each cell is selected/browsers:

   | Case (cwd) | 0.1.222 / checkout | 0.1.199 |
   | --- | --- | --- |
   | `src/core/cursor-acp-runner.test.ts` (sub) | 1/0 | 82/81 |
   | `packages/cezar/src/core/cursor-acp-runner.test.ts` (root) | 1/0 | 82/81 |
   | absolute (sub, root) | 1/0 | 82/81 |
   | `packages/cezar/src/core/cursor-print-capabilities.test.ts` (sub, incident 1) | 0/0, unmatched `packages/cezar/packages/cezar/src/core/cursor-print-capabilities.test.ts` | same |
   | `src/core/cursor-acp-runner.test.ts` (root, wrong base) | 0/0, unmatched `src/core/cursor-acp-runner.test.ts` | same |
   | `src/core/cursor-acp-runner.ts` source (sub; root form same) | 82/81 | 82/81 |
   | `src/core/missing.test.ts` (sub) | 0/0, unmatched `packages/cezar/src/core/missing.test.ts` | same |
   | listed-test path, file not listed (sub) | 81/81 | 81/81 |
   | `../../../elsewhere.test.ts` (sub) | 0/0, unmatched as given | same |

   Command: `node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-39/selection.mjs > …/output.txt`. It exited 0. Its first line is `{"at":"2026-10-19T14:13:54.633Z","node":"v24.21.0","load1":3.2,"cpuCount":24}` and its last is `PASS: cwd-relative, repo-relative-from-root and absolute forms select the same file on every target; no daemon started.` Full output, hashes included: `probes/issue-39/output.txt`. *verified by experiment.*
3. **The unmatched message already names the resolved path.** `No verdict: no test file's closure holds <resolved>` (`src/cli/status-wait-lines.ts:180`) is the incident's own first line. An unmatched path selects nothing else, and the outcome is `unmatched` (exit 3) once the read is ready. That covers most of #39's second acceptance criterion. The message does not say what the path was resolved against. It also does not suggest the root-relative reading when the cwd-joined path is missing and the root-joined one is a listed file. *read in source code, 0.1.222.*
4. **Declared inputs reach closures as concrete files.** `src/core/keys/closure.ts:82-91` resolves policy `inputs` globs against the worktree's files. A non-existent path under `packages/cezar/src/**` is therefore in no browser closure (probe row `missing.test.ts`). A real, unlisted file under that glob is in all 81. *read in source code, checkout.* Cezar at `2a5e7a7fb`: `packages/web/e2e/*.e2e.ts` declares `packages/cezar/src/**` (81 spec files). `packages/cezar/vitest.config.ts` includes `src/**/*.test.ts`. Both incident test files are old (added `a35d4ea00` on 2026-09-17 and `f9d6e9f63` on 2026-10-08), so they would normally be listed. *read in the cezar repository, read-only.*
5. **The live end-to-end attempt was inconclusive.** This was six calls of `squeal status --wait 90000 <path>` through the installed 0.1.222 CLI in this worktree: the cwd-relative, root-relative, absolute and doubled forms of `test/cli/status-wait-paths-overlap.test.ts`, a missing test, and a `../src/…` source path. Every call exited 3 after 90.2 s with `the runner has not listed the test files of revision N yet` and an empty `Selected:` line. The worktree has no `node_modules`, so the daemon never listed its files. The unmatched case also waits for listing, because `unmatched` requires `ready`. Each call appended to `probes/issue-39/live.txt` inside the worktree, which re-keyed the revision (2 to 7). Transcript: `probes/issue-39/live.txt`. *verified by experiment (the timeout only); selection was not reached.* No `npm ci` was run: it would have exceeded the time budget, and the brief excludes a full suite.

## Spec sections touched

- **005 D2**: the rules on cwd resolution, test path versus closure, and `no test file's closure holds <path>` all hold as written. 005-67 (0.1.204) is the repair for case 2 if the incident ran on 0.1.199.
- **011 C15**: promotion takes the same `worktreePath` resolution (`ownPathFiles(…, paths.map(worktreePath))`), so no separate path issue arises there. **011 C6**: the wait's text would carry any extra unmatched guidance.

## Open questions

- **Incident version: not determined.** The issue was filed at 13:28:45Z. The user-scope plugin moved to 0.1.222 at 12:50:15Z and the project scope at 13:44:41Z. The cezar session's harness, its plugin scope and the daemon version it talked to are not recorded. The incident may have predated the update, or run under a scope still on 0.1.199. The 82-on-0.1.199 result matches "81 unrelated browser specs", and nothing found reproduces it on 0.1.222. No cezar session logs or store were read.
- Whether the incident's `cursor-acp-runner.test.ts` was unlisted at the read (for example a lookup-only start mid-listing, as in gh-38) is not determined. That is the only 0.1.222 route to 81 browsers.
- **Human decision:** should an unmatched wait say its base directory, or suggest the root-relative reading when it is a listed file? Either option reduces noise, and either one is additive to D2 without changing resolution. Accepting root-relative fallback silently would make one argument mean two files; that is a design choice and is not recommended here.
- Duplicates: #6/#30 (005-67) cover case 2 if 0.1.199. #38 covers stale selected files under lookup-only. Neither covers case 1's guidance.

## Sources

- https://github.com/hearsay-tools/squeal/issues/39 (`gh issue view 39 -R hearsay-tools/squeal --json …`, 2026-10-19)
- `src/cli/status-wait-paths.ts` (`selectNamedFiles`, `worktreePath`, `waitForNamed`), `src/cli/status-wait-lines.ts:179-180`, `src/cli/index.ts:13`, `src/core/keys/closure.ts`, `plugins/claude-code/bin/squeal`, checkout `036be0a0`
- Installed bundles `~/.claude/plugins/cache/hearsay/squeal/{0.1.222,0.1.199}/dist/cli/squeal.mjs`, and `~/.claude/plugins/installed_plugins.json`
- `../../005-agent-adoption/spec.md` D2. `../../005-agent-adoption/research/issue-30.md` and its probe, whose method is reused here. Board row 005-67 in `docs/board.md`
- `spec.md` C6 and C15, and `status.md` (amendments through 2026-10-18)
- `/home/agent/projects/cezar` at `2a5e7a7fb`: `squeal.config.json`, `vitest.config.ts`, `packages/cezar/vitest.config.ts`, and `git log --diff-filter=A` for the two test files
