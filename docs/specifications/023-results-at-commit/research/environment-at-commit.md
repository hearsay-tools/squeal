# Environment at a commit (topic environment-at-commit, row 023-02, 2026-11-16)

When commit X's lockfile, runner config, setup files or Node pin differ from this worktree's, the first finding (`../../018-ci-and-shared-results/research/results-at-commit.md`) reports "not determined". Can Squeal compute X's environment hash anyway?

Short answer: yes for most recent commits, and with no new table. Squeal computes the installed-dependency part from X's committed lockfile, which is exact on every commit tried. It then looks up a stored environment whose git-held inputs equal X's. The `environments` table already holds these, and Squeal never prunes it. Over the last 7 days this recovers 100% of Squeal's and 78.3% of squawk's "not determined" test files. A record by commit recovers 2.6% and 9.1%. The rest needs the install at X that the auto-run makes anyway: its hash equals the live daemons' hash on 3 of 3 commits.

Source read at `d2678e570` (Squeal 0.1.523). The daemons in the experiments are the released 0.1.523 on Node v26.13.0. Stores were copied read-only on 2026-11-16 between 15:43Z and 16:09Z, at a one-minute load of 12 to 34 on 24 CPUs. No timing is a finding. Probes: `probes/environment-at-commit/` (its README lists each script and its output).

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Which environment inputs come from git objects at X, exactly | Runner file blobs, the installed-dependency part (pnpm, whole-fingerprint mode, install not stale) and the runner version: yes. The resolved config: no, because it is the output of running the config. The machine, Squeal and process parts are this machine's, not X's. |
| 2 | A record of each environment hash by commit | 550 rows (40 KB) for Squeal and 5,012 rows (413 KB) for squawk per 7 days. It recovers only 2.6% and 9.1% of the "not determined" files, and it records a stale install as the commit's environment. |
| 3 | Does a temporary install at X give the hash a daemon at X computes | Yes, where the daemon's tree is installed from its own lockfile. Squeal: 2 of 2 commits with different lockfiles give the exact live hashes. squawk: 7 of 7 projects give hashes that live daemons recorded. The one live tree that differs has a stale install. |
| 4 | Machine inputs | They stay this machine's. Node is `process.version`, never the pin file. Hashes that differ only in Node are always different hashes (16 of 16 pairs), so results under another Node are misses by design. |
| 5 | Recommendation | Derive the lockfile part, then look up a stored environment with equal inputs. Use the install at X for the rest. Do not add a record by commit. |

## Findings

### 1. Each input, from git objects at X

The environment hash encodes these fields (`src/core/keys/environment-hash.ts`, `encode`; read in source code):

| Input | Where it comes from | From git at X? |
|---|---|---|
| Key format, adapter version | Squeal constants | No. They are this Squeal's by design (read in source code). |
| Node version, platform, arch, allow-listed variables | `process` (`coreEnvironmentInputs`, `environment.ts`) | No. They are this machine's (question 4). |
| Runner name and version | The installed runner package | Yes. The committed lockfile names `vitest 5.0.3` at `d2678e570` and `1a92af9d1`, and `4.1.10` in squawk, as the descriptors hold (verified by experiment). For node:test projects the runner version is the version of the `node` on `PATH`, so it is a machine input (read in source code, `src/runners/node-test/adapter-environment.ts`). |
| Runner files (config, its imports, setup closures) | The file hash of each listed path | Yes. The hash is the git blob id (018 finding, 0 differences on 25,458 paths). The scratch hashes in question 3 reproduce them. |
| Installed dependencies, whole-fingerprint mode | `node_modules/.pnpm/lock.yaml` without linked specifiers (`installedDependencies`, `environment.ts`; `withoutLinkedSpecifiers`, `pnpm-lockfile.ts`) | Yes, from the committed `pnpm-lock.yaml`. pnpm 12 writes it as two YAML documents, and the installed file is byte-equal to the second (verified by experiment on `d2678e570`, `1a92af9d1` and squawk `2cab1e991`). The value computed from git equals the daemon's on all three (`installed-from-git.mjs`). In the stores, 3 of 5 Squeal descriptors and 315 of 331 squawk descriptors equal the value computed from a lockfile committed on some ref since 2026-10-25 (`installed-match.mjs`). The others came from installs no committed lockfile describes. |
| Installed dependencies, stale install | The package folders on disk (`stalePnpmLockfile`, `pnpm-install.ts`) | No. Staleness is judged from file times in `node_modules` (read in source code). |
| Installed dependencies, per-package mode (task 001-105) | Graph identities, on-disk scans for types-only and opaque packages, the runner's environment packages | No. These need the install and a runner load (read in source code, `dependencies.ts`, `pnpm-graph.ts`). The 318 descriptors that match a lockfile above hold whole-mode values, so at least 318 of the 336 recorded environments use the whole mode (verified by experiment). In whole mode the per-file dependency segment is empty, so it needs nothing from X. |
| Resolved config | Vitest loads and runs the config; node:test adds the Node build hash | No. Equal runner files mean an equal config only when the config reads nothing else. squawk's `web` config runs `packages/cezar/scripts/product-identity.mjs` in a child process, and that script reads `src/home/identity.ts`, which is not a runner file. In squawk, 16 groups of descriptors have equal git-held inputs, installs and versions but more than one hash. The fields that differ are `web` `serializedDefines` (13 local, 2 CI) and node:test `execPath` and `nodeBuild` (7, machine) (`config-only.mjs`, verified by experiment). Squeal: 0 such groups. |
| Node pin file (`.node-version`) | Not an input at all | Not needed (question 4). The 018 rule counted it only as a stand-in for a Node change. |

So from git alone, Squeal can compute exactly what a lockfile-only change does to the hash. It cannot compute a changed config. Two Squeal environments in the store differ only in `installedDependencies` (`f272b4c907fd` and `63bf6a90cd44`, `parts.mjs`). In squawk, runner files differ in 6 to 85 consecutive pairs per project and installs in 4 to 13.

### 2. Recording each hash by commit

Clean commits a local daemon had over 7 days come from revisions plus clean result labels, imports excluded. This is a lower bound, because revisions of removed worktrees are pruned. Measured in a scratch SQLite file with `dbstat` (`record-size.mjs`, verified by experiment):

| | Clean heads in 7 days | Projects | Rows | Bytes per row | Total | Existing `environments` table |
|---|---|---|---|---|---|---|
| Squeal | 550 (79 a day) | 1 | 550 | 74 | 40 KB | 5 rows, 20 KB |
| squawk | 716 (102 a day) | 7 | 5,012 | 84 | 413 KB | 331 rows, 1.49 MB |

Share recovered (`share.mjs`, verified by experiment). The asker is a worktree at its `HEAD`: this one at `d2678e570` for Squeal, and squawk's main checkout at `2cab1e991`. The population is every first-parent main commit X of the last 7 days times the asker's test files. A file is "not determined" when X's blobs at the asker's runner files, or X's lockfile, differ from the asker's (the 018 rule). The pin file is not counted.

| | Squeal | squawk |
|---|---|---|
| Main commits, test files | 1,997, 1,870 | 318, 1,912 (7 projects) |
| Not determined, share of file-commit pairs | 35.0% (lockfile only) | 84.8% (runner files; 75.3% of these also the lockfile) |
| **Of those, recovered by:** derive (only the lockfile differs) | 100% | 0% |
| record by commit (current Node and adapter) | 2.6% | 9.1% |
| record by commit, records of any Node or adapter | 7.3% | 19.3% |
| look up a stored environment with equal inputs (existing table) | 100% (one hash each) | 78.3% (70.4% one hash, 7.9% more than one) |
| any of the three | 100% | 78.3% |

By commit age, squawk's lookup recovers 100% under 1 day and from 1 to 3 days, and 68.9% from 3 to 7 days, where the Node move (2026-11-11) and a node:test adapter change (2026-11-12) end older matches. A record by commit recovers 8.1%, 14.9% and 7.2%. Squeal's not-determined files are all 3 to 7 days old: they are the commits before the lockfile change `467cb3d51` (`by-age.mjs`).

A record by commit has two more faults. It records the tree's install, not the commit's lockfile, so a stale install is stored as X's environment (question 3: 1 of 35 live worktrees). And a Node or adapter change ends every record at once.

### 3. The install at X against a daemon at X

Method (verified by experiment): scratch clones under `$TMPDIR`, `pnpm install --frozen-lockfile --prefer-offline`, a 0.1.523 daemon started in each and stopped, and its hash read from the clone's own store.

- Squeal `d2678e570` (lockfile after `467cb3d51`): `63bf6a90cd44…`. This worktree's daemon at the same commit keys with the same hash. 338 worktree rows in the live store keyed with it.
- Squeal `1a92af9d1` (the lockfile before): `f272b4c907fd…`. Live daemons first recorded it on 2026-11-11 at 18:45Z, and 38 worktree rows keyed with it. The two lockfiles differ in 108 lines.
- squawk `2cab1e991`: all 7 project hashes equal hashes that live daemons recorded and key with (82 to 326 worktree rows each). The main checkout's own daemon at that commit differs from the scratch install in `installedDependencies` only. Its `node_modules/.pnpm/lock.yaml` dates from 2026-11-06 and is not that commit's lockfile. The scratch install equals the value computed from git (`57887cc8…`).
- Live worktrees whose installed part differs from their `HEAD`'s committed lockfile: 0 of 17 (Squeal) and 1 of 18 (squawk) (`stale-installs.mjs`).

So the install at X gives X's hash as committed. A daemon at X gives the same hash when its tree is installed from X's lockfile, and in 34 of 35 live trees it is. The frozen installs took 0.29 to 0.45 s here with a warm pnpm store, at a load of 15.7 to 18.1. That is incidental: topic 023-01 owns the install cost.

### 4. Machine inputs

- Node, platform and arch are `process.version`, `process.platform` and `process.arch` of the daemon (`coreEnvironmentInputs`; read in source code). The scratch daemon at `1a92af9d1` recorded v26.13.0, the machine's Node (verified by experiment).
- squawk added `.node-version` 26.13.0 on 2026-11-10 at 10:29Z. Local daemons still recorded 84 Node v24.22.1 environments after that, until the host's Node moved on 2026-11-11 at 18:40Z. The pin did not decide the hash (verified by experiment).
- 1 Squeal pair and 15 squawk pairs of Vitest hashes are equal in every part except Node. Every pair is two different hashes (`node-pairs.mjs`, verified by experiment). A result recorded under another Node is never found: a miss by design.
- node:test runs the `node` on `PATH` and keys its build (read in source code). On a host whose version manager switches Node by directory, a temporary checkout at X could run X's pinned Node (inferred; this host's nvm does not switch, not tested).

## Recommendation for Squeal

To find X's environment hash for `status --at`, use this order. Stop at the first step that gives one hash.

1. Equal inputs: if X's runner file blobs and X's lockfile equal this worktree's, use this worktree's hash (018). Squeal: 65.0% of file-commit pairs. squawk: 15.2%.
2. Look up an equal stored environment. Compute X's installed part from X's committed lockfile. Then select the stored descriptors (current Node, platform, arch, key format, adapter and runner version) whose runner file hashes equal X's blobs and whose installed part equals the computed one. Use the hash when exactly one matches. This needs no new table, because `environments` is never pruned (`src/core/store/environments.ts` deletes nothing from it). It recovers 100% (Squeal) and 70.4% (squawk) of the not-determined files.
3. Derive: if only the lockfile differs and the runner version is equal, use this worktree's inputs with the computed installed part. This covers a lockfile no daemon on this machine has used yet. Squeal: 100% of the not-determined files.
4. Otherwise "not determined". With the auto-run flag, the temporary checkout's install gives the exact hash (question 3) at no extra cost, because the run needs that install anyway. squawk: 29.6% of the not-determined files (21.7% with no match, 7.9% with more than one).

Reject a record by commit. It costs little (40 to 413 KB a week) but recovers 2.6% and 9.1%, it stores stale installs as the commit's environment, and every Node or adapter change ends it.

The tradeoff that decides this: a one-hash match is exact only when the config reads nothing outside its runner files and the lockfile. squawk's `web` config breaks that, and the store shows it: 16 groups with equal inputs hold more than one hash. Step 2 treats more than one hash as "not determined". A single match can still be wrong if the other config was never recorded. For that case the safe rule is to send any project whose descriptors already show such a group to step 4 (inferred; see open question 1).

## Open questions for the human

1. A single stored match where the config reads more than its files (squawk `web`, and node:test through the Node build): accept it, or send projects with a known config-only difference to the install? In squawk such matches are 8.9% of the not-determined files (`out/flagged-single-cezar.json`). Accepting gives these without a run. Refusing gives no possible wrong result.
2. When the asker's own install is stale (1 of 35 live trees), its keys are keys of its install, not of its `HEAD`. Should `status --at` say so beside the comparison?
3. Lockfiles other than pnpm 12 were not tested: npm's hidden lockfile is not `package-lock.json` (read in source code), so step 3 for npm needs its own reading.

## Sources

- Code at `d2678e570`: `src/core/keys/environment-hash.ts`, `environment.ts`, `environment-descriptor.ts`, `dependencies.ts`, `pnpm-install.ts`, `pnpm-lockfile.ts`, `pnpm-graph.ts`; `src/runners/vitest/environment.ts`; `src/runners/node-test/adapter-environment.ts`; `src/core/store/environments.ts`, `imports.ts`, `import-edges.ts`, `schema.ts`; `src/core/scheduler/keying.ts` (lines 300 to 345).
- First finding: `../../018-ci-and-shared-results/research/results-at-commit.md` (lands `f17f9146b`).
- Stores, read-only: `~/projects/squeal/.git/squeal/store.sqlite`, `~/projects/cezar/.git/squeal/store.sqlite`. Git: Squeal `d2678e570`, `1a92af9d1`, `467cb3d51`; squawk `2cab1e991` (main checkout `HEAD`) and `5621be917` (`.node-version` added). squawk files read: `packages/web/vite.config.ts`, `packages/web/product-identity.ts`, `packages/cezar/scripts/product-identity.mjs`.
- Squeal binary: `~/.claude/plugins/cache/hearsay/squeal/0.1.523/dist/cli/squeal.mjs` (the release the live daemons run).
- Probes and outputs: `probes/environment-at-commit/` (README).
