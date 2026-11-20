# Unread inputs: can the export certify an input no process of the file's own command read? (row 018-56)

Researcher, 2026-11-20. Squeal: candidate 0.1.580 bundle (`plugins/claude-code/dist` of this branch), patched only to write debug files. cezar (`hearsay-tools/squawk`) runs: merge group 44805319389 at `cd8cea696` (Squeal 0.1.579 parts, Vitest and node:test) and the newest merge group 44808547913 at `d5762f11` (Squeal 0.1.522 parts, Vitest only, after the revert of #3989). Probes: `probes/unread-inputs/` (throwaway).

**Method** (`verified by experiment`). I replayed both exports with the 0.1.580 bundle in fresh clones installed as the export job installs them. Both replays give CI's own counts: 1,330 exported and 568 left out for inputs on 44805319389 (row 018-55's numbers, nested Vitest parts left out); 1,163 and 583 on 44808547913, equal to that run's export log. `rules.mjs` gives every left-out (file, input) pair a kind from the file's own part, every other part and the clone, and counts what each candidate rule recovers. On a separate quiet VM I re-recorded cezar's Vitest shard 3/8 at `d5762f11` with the raw evidence kept (`record-shard.sh`, `shard-writes.mjs`). `fixture.sh` and `simulate.mjs` run six one-test fixtures through `ci record` and `ci export`, including review 0.1.421-r2 B1's wrapper cases, and apply the candidate rule to the raw evidence.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Soundness of rules C and D | **Rule C as written (another shard's read) is not sound alone.** Another machine's read says nothing about the file's own checkout. A shell or `git` that changes the input in the own command and does not restore it goes unseen. **One rule covers both kinds:** an input that no hooked process of the file's own command read, listed or wrote is certified when its hash at the command's start, at its end and in the export checkout are equal. Absent paths and ignored paths are left out of the rule. Its remaining risk is **the same kind the human accepted on 2026-11-09** (D8's condition): a program outside Node changes the input and restores it within the command, and only native code reads it. Today's 0.1.580 export already writes such a wrong pass when any Node process read the file first. The new part: the wrong pass no longer needs that Node read. | verified by experiment (fixtures); inferred (the general claim) |
| 2 | Alternatives in the key | **Keying only loaded files (a)** drops the static graph that spec 011 C3 keeps as the safety net. A run whose loads depend on something unkeyed then misses a re-run. **Keying dynamic-import targets only once a run loaded them (b)** covers most of cezar's C inputs. But it does nothing for D, misses a re-run when a lazy load depends on unkeyed state, and moves every key of a file with a dynamic import once. Neither alternative needs a `KEY_FORMAT_VERSION` raise by C3's rule. Neither is better than the evidence rule for the export. | read in spec and source; inferred |
| 3 | Gain, measured | **About 99% of cezar's test files exported, up from 66 to 70%.** 44808547913: +565 Vitest files, 5,452 of its 9,260 test seconds. 44805319389: +435 Vitest files (3,854 s) and +113 node:test files (269 s). Squeal's own CI writes no parts. | verified by experiment |
| 4 | Recommendation | **Adopt the one rule, as a decision for the human.** It needs part format 6, with endpoint hashes and the command's touched paths, and no key change. Do not adopt rule C on its own. Do not adopt the key alternatives for this purpose. | inferred |

## Findings

### 1. Soundness

**What today's evidence already bounds** (read in source and spec, D8, D9, rows 018-23 and 018-43):
- Any read through a hooked process (Node's `fs`, the module loader, descriptors and file handles, children and Workers, which get the hooks back) records the content at the read. Another content of the same path cancels it (`readRecorded`: conflicting).
- Any write through a hooked process cancels the path, and so do a `rm` of a tree and a withheld child (`""` cancels all).
- A file named in a spawn's arguments is hashed at the spawn (row 018-43). So `execFile('cat', ['data/x'])` gets evidence. `execSync('cat data/x')` does not, because the shell string is not a path.

So an input with no read-time evidence and no write was **touched by no hooked process**. Only a non-hooked program could have read or changed it: native code, a shell, `git`, or a process the hooks do not reach.

**The fixtures** (`probes/unread-inputs/fixture-output.txt`; "truth" is plain Vitest at the content the export would certify):

| Mode | What the command does | Today (0.1.580) | One rule | Truth |
|---|---|---|---|---|
| shell-restore-import (review 0.1.421-r2 B1 case B) | `sh` writes the imported module, Vitest runs, `sh` restores it | left out | left out: Vite's read is hooked and recorded the changed content | fail |
| shell-generate-import (B1 case C) | `sh` creates a module, Vitest imports it, `sh` removes it | left out | left out, for the same reason | fail |
| node-restore-native-read | Node writes `data/value.txt`, `cat` reads it, Node restores it | left out | left out: a hooked write | fail |
| untouched-native-read | `cat` reads the committed `data/value.txt` | left out | **exported, correct** | pass |
| shell-restore-native-read | `sh` writes `data/value.txt`, `cat` reads it, `git checkout` restores it | left out | **exported, wrong pass** | fail |
| today-node-read-first | as above, with a Node read of the committed file first | **exported, wrong pass** | (no change) | fail |

The last two rows have the same cause. A non-hooked writer changes the input and restores it, and only a non-hooked reader sees the change. D8's condition names this case: "a file only native code or that program reads". The human accepted it on 2026-11-09, and today's export already gives the wrong pass when a Node read happened first. The rule removes the need for that first read. So the risk reaches files whose inputs no Node process opened. In cezar these are the lazily imported TypeScript modules and the listing of kind C, which no native code reads (inferred), and the declared files of kind D, which `git ls-files`, `git grep` or nothing reads.

**Each named way an input could still differ, under the rule:**
- **Writes by non-hooked processes.** A persistent change makes the end hash differ, so the input stays left out. A change that is restored by the end is the residual above.
- **A write followed by a revert.** Through a hooked process, the write cancels the path (verified). Through a non-hooked process, it is the residual, and it matters only if a non-hooked reader read the changed content.
- **Native readers.** They are the only readers the rule trusts without a read. They see the start content unless a non-hooked writer acts (D8).
- **Files the test generates.** A hooked write cancels the path. A non-hooked generator that also cleans up leaves the path absent at both ends. That is why **absent paths are not certified by the rule**: the review's "normal generate/test/cleanup commands" pattern. The cost is 8 files and 5 s on 44808547913, and 10 files and 6 s on 44805319389.
- **Symlinks.** The rule must hash a path as its key holds it (`hereOf`) at both ends. A path through a committed directory symlink hashes as its target's bytes. A link to a file outside the repository is a gap in the key today, not a new one (inferred).
- **`.gitignore`d inputs** (built files, generated files). They have no commit blob, and the shard's and the export job's copies can differ. **They are left out of the rule.** No measured pair was of this kind.

**Rule C needs more than cross-shard evidence.** It proves the content on another runner, which a fresh checkout of the same commit gives anyway. It does not see a non-hooked change in the file's own command that persists, and an ignored input can differ between runners. Its condition "no write in any shard cancelled it" also needs data the parts do not carry: `readRecorded` drops written and conflicting paths silently, so a part cannot tell "unread" from "cancelled". Both rules therefore need the part to carry the command's touched paths.

**Own-shard writes in practice** (verified by experiment, shard 3 re-recorded, 219 files): the hooks recorded 4,034 evidence paths, 0 conflicting, 0 writes and 0 written trees inside the checkout. `git status` before and after was equal (5 ignored `node_modules` entries). All 339 left-out pairs of that shard's 88 CI left-out files were also never read, listed or written in the re-record. One test file failed on the loaded VM with two 35 s timeouts; this is not related.

### 2. Alternatives in the key

- **(a) A closure of loaded files only.** Spec 011 C3: the closure is "its transitive static and dynamic project imports from Vitest's transform graph … and … the project paths the file's runs were observed to read", and the observed set is "never pruned, so a read that disappears over-runs and never misses". Dropping the static graph removes that over-approximation. A file whose loads depend on something unkeyed (time, network, an environment variable outside the allowlist, a shared worker with `isolate: false`) can then reuse a result after an edit to a module it would load now. It also loses the unresolved-import candidates of a file that failed before it loaded anything. It recovers nothing of kind D: declared inputs stay keyed on purpose.
- **(b) Dynamic-import targets keyed apart.** That means `dynamicDeps` (`src/runners/vitest/graph.ts:165-168`, already kept apart for spec 015 D11), and what only they reach, keyed only once some run loaded them. Most C inputs are of this shape: the `runners/*/…-model-catalog.ts`, `login-probe.ts` and `model-probe-spawn.ts` modules behind `await import()` since cezar #3978, and the `lazy()` web routes. It would not cover the `packages/cezar/scripts/mock-skill-data/` listing, which is in 352 of the 583 files on 44808547913. The risk is the same as (a), limited to lazy loads, and bounded by the never-pruned observed union after the first load anywhere. A local benefit exists: spec 015's `research/edit-reach.md` found dynamic imports that coverage did not see loaded in 14% of squeal's transitive pair-seconds. That is a local speed question for spec 015 or 011, not a fix for the export.
- **Keys.** Both change closure lists, so the affected keys move by themselves once. Every result of a file with a dynamic import (b) or with any unloaded static import (a) runs once again per store. By C3, "a change to what a key is computed from re-keys the affected checks by itself and moves nothing", so no `KEY_FORMAT_VERSION` raise is needed. The key-format alarm and `test/version-sensitive.test.ts` would decide (not run). CI and developers must compute the same narrower closure, so a local observed union wider than CI's loses reuse (inferred).

### 3. Gain (`probes/unread-inputs/summary-*.txt`, per file in `files-*.tsv`)

| Run | Runner | Left out for inputs | Rule C only | Rule D only (files, start = end) | One rule (files and listings, no absence) | Stays left out |
|---|---|---|---|---|---|---|
| 44808547913 (newest) | Vitest | 583 files, 5,487 s | 565, 5,452 s | 0 | **565, 5,452 s** | 18 (absence or touched in own command) |
| 44805319389 | Vitest | 452, 3,893 s | 435, 3,854 s | 0 | **435, 3,854 s** | 17 |
| 44805319389 | node:test | 116, 271 s | 4, 3 s | 106, 128 s | **113, 269 s** | 3 (absence) |

- Exported share: 44808547913 goes from 1,163 of 1,749 files (66%) to 1,728 (99%). 44805319389 goes from 1,330 of 1,902 (70%) to 1,878 (99%). The recovered seconds are 59% and 39% of each run's recorded test time (9,260 s and 10,457 s).
- **Listings are needed.** Without them, the one rule recovers only 214 of the 565 files on 44808547913.
- Kinds of the 44808547913 pairs: 3,530 tracked files and 352 listings that another shard read at the commit's content, 172 absent paths no part probed (`require` in strings, skipped snapshots), 13 touched by the own command, 1 read with other content.
- Squeal's own repository: its workflows run no `ci record`, and its only artifact name is `intake-output` (read with `gh api`).
- Cost of the endpoint hashes: hashing every tracked file of cezar (4,967 files, 24 MB) in Node took 1.07 s at a host load of about 40 (verified). That happens twice per recorded command. Listing hashes of the directories were not measured.

## Recommendation for Squeal

**One rule, "an input nothing touched", put to the human.** Design sketch for a spec section:
1. `ci record` hashes, as the key holds it (`hereOf`), every path git does not ignore and the listing of each directory that holds one. It does this before it starts the command and after the command's processes exit, in its own process, with no `git status`.
2. Part format 6 carries the paths whose two hashes are equal, with that hash (or, compressed, those that differ from the commit's tree). It also carries the command's **touched** paths: written, read with two contents, below a written tree, or all of them when a process withheld (`""`). Readers keep formats 3 to 5 under today's rule.
3. `FileReuse.evidence` (one owner for `ci export` and the gate's `--parts`) certifies an input that has no read-time evidence when it is not touched, is not ignored, is not absent, and its endpoint hash equals the content here. Every other input keeps D9's rule. No key, `KEY_FORMAT_VERSION` or adapter version changes.
4. D8's condition and `ci record --help` say that an input no Node process read is certified by its hashes at the start and end of the command.

**Tests that would prove it.** The six fixture modes, with the outcomes in the table above. The wrong pass of shell-restore-native-read is pinned as the documented residual. Also: an input changed by `sh` and not restored stays left out; an absent input and an ignored input are never certified by the rule; a withheld child cancels every input; a listing changed and kept by `sh` stays left out; format-5 parts export as today. Acceptance on cezar: the first merge-group run after the release exports at least 98% of its Vitest files.

**Question for the human, in plain words.** "Should CI results also count for a test file when some files it depends on were never opened by anything that Squeal watches during the CI step? Squeal would check that each such file had the commit's content at the start and at the end of the step. Gain: about 565 more cezar test files are shared per merge (66% to 99% of files, about 90 minutes of test time). Risk, one example: during the step, a shell command overwrites `config.txt`, a test reads it with `cat` and passes, and the shell puts the old content back before the step ends. Squeal sees neither the shell's change nor `cat`'s read, so it shares a pass that belongs to the temporary content. Today this can already happen when any Node code opened `config.txt` first (you accepted that on 2026-11-09). The change makes it possible also when nothing did."

## Open questions

1. For the human: the question above.
2. The rule's own cost on a real shard: the hashes of directory listings and the part size of format 6. Not measured; the file hashes take about 1 s per end on cezar.
3. Whether the gate (`squeal code --base --parts`) takes the same rule or names a difference. `FileReuse` is shared on purpose (row 020-52).
4. One shard re-recorded: other shards may write inside the checkout. The part's touched paths decide this per run, so the rule does not depend on it.

## Sources

- Runs, read-only: `gh run download 44805319389` and `44808547913 -R hearsay-tools/squawk` (parts), `gh run view 44808547913 --job <export> --log`, retrieved 2026-11-20. `gh api repos/hearsay-tools/squeal/actions/artifacts`.
- cezar at `cd8cea696` and `d5762f11`: `squeal.config.json` `inputs`, `.github/workflows/ci.yml` (`record-shard`), `packages/cezar/src/runners/*/definition.ts` (`await import`), `packages/cezar/scripts/mock-skill-data.mjs`.
- Squeal 0.1.580 (this branch): `src/core/ci/inputs.ts` (`readRecorded`, `uncertifiedWhy`), `reuse.ts` (`FileReuse.evidence`), `export.ts`, `export-inputs.ts`, `parts.ts:318-323`, `src/runners/vitest/graph.ts:44-50,154-168`, `version.ts`, `src/runners/node-test/version.ts`.
- Spec 018 D8, D9, D22 to D29; `status.md` (rows 018-23, 018-43, 018-55); `reviews/wave-5-0.1.421-r2.md` B1; `research/left-out-files.md`, `research/node-test-left-out.md`. Spec 011 C3 and C12. Spec 015 D11 and `research/edit-reach.md`.
