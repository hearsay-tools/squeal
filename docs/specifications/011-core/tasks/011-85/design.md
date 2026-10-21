# 011-85: a version raise or a sibling project's config does not re-key a whole suite, a design for the human

Board row 011-85, a docs-only design draft (brief `tasks/011-85/brief.md`). The human asked for a design row first on 2026-10-21, from row 011-81's findings (`research/key-split.md`). Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 7 go into 011 C3, C4, C7, C11 and C14, `status.md` gets a dated line, and the board numbers the code rows of section 8.

Sources: `research/key-split.md` and `research/probes/key-split/`; `research/host-load.md` 3; 011 C3 (the environment hash and key format bullets), C4 step 3, C7, C11, C14 and `status.md`; `tasks/011-37/design.md` (formats read as one); the source at `90e442f7f` (Squeal 0.1.245, key format 20). New probes in `probes/` (`probes/README.md`): a `git clone` under `/tmp` with a copied install, scratch `HOME`, `XDG_*` and `TMPDIR`, single test files only, no daemon and no build. One-minute load 41 to 66 on 24 CPUs during the probes. The clone is removed.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`.

## Summary

- **Two inputs split whole suites today.** In npm repositories, the installed-dependency fingerprint hashes npm's hidden lockfile whole, and that file holds the root package's own `version`. In squeal every key holds the whole fingerprint (its `globalSetup` reaches `node:child_process`), so each version raise re-keys every check (9 times in 4 worktrees on 2026-10-21, up to 4.16 of 6.7 run-hours). In multi-project Vitest repositories, every project hashes every project's config file, so an edit of `e2e`'s config re-keys cezar's 5 projects. *Research 011-81, verified by experiment.*
- **R1, npm.** Hash the hidden lockfile without the root's `name` and `version` and without each workspace entry's `version`, tagged `squeal-installed/2`. Everything under a `node_modules` folder stays whole. *Verified by experiment:* a raise of the root's or a workspace's version keeps the fingerprint (red at 0.1.245, green at the candidate); an upgrade, a new workspace and a retargeted link still move it, and a stale lockfile still falls back to the package folders.
- **R2, Vitest projects.** Each project hashes the root's config file, its own and the `configFileDependencies` of these two, not a sibling's. *Verified by experiment:* an edit of `e2e`'s config re-keys only `e2e`; the root config and a file both configs import re-key every project that reads them.
- **R3, pnpm.** cezar's release tool rewrites each dependent's range of a linked workspace package at every release (8 releases from 2026-09-22 to 2026-10-08). pnpm's installed lockfile records that range, so each release splits cezar's whole suite as a version raise splits squeal's. Leave out the `specifier` of a dependency whose `version` is `link:`.
- **No format raise.** The key-format alarm, run on the candidate, names no case whose outputs differ. It asks only for cases that run the changed lines. With three such cases it passes at format 20 (*verified by experiment*).
- **R4, the release keeps every stored result.** Each change only drops inputs, so a row stored under 0.1.245's definition is valid under the new one. A lookup can read it as 011-37 reads the formats 13 to 19. Without it, the release re-keys every squeal check (each worktree runs its suite again) and every cezar check (each worktree's files go stale under `lookup-only`).
- **This repository's `globalSetup` stays.** 787 of 820 squeal test files reach `child_process` on their own (static estimate), so removing the setup's reach would narrow a real dependency change to 96% of the suite, not less.
- **Six decisions for the human**, Q1 to Q6, each with a default (next section). Four code rows, in one candidate (section 8).

## Decisions for the human

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | What does npm's hidden lockfile contribute to the whole fingerprint? | (a) The file without its top-level `name` and `version` and without the `version` of each entry outside every `node_modules` folder (the workspaces' own), tag `squeal-installed/2`. (b) As today, the whole file. (c) As today, and make the environment non-opaque instead (Q6). | (a). It is 011-81's recommendation, and the probe confirms it on the five regressions. (c) leaves 96% of squeal's files on the whole fingerprint. Section 1. |
| Q2 | Which config files enter a Vitest project's environment hash? | (a) The root's config file, the project's own, and the `configFileDependencies` of these two. (b) As today, every project's. | (a). Vitest loads each `projects` entry as its own config; a sibling's config changes no option of this project. Section 2. |
| Q3 | pnpm's installed lockfile and a linked workspace's range. | (a) Leave out each `specifier` line whose next line is `version: link:…`; every other line stays. (b) Not now. (c) Leave Squeal as it is and ask cezar to use `workspace:^` ranges, which a raise need not rewrite. | (a). cezar's releases rewrote these ranges 8 times in 17 days, and each one splits the whole suite. The filter is a few lines and keeps the link target. (c) fixes one repository only. Section 1.3. |
| Q4 | The release that ships R1 to R3 changes every squeal key and every cezar key. Does a lookup read rows stored under 0.1.245's definition? | (a) Yes, all three changes: the core computes each project's environment hash under the former definition too (the whole hidden lockfile or `lock.yaml`, every project's config files) and reads it as a format read as one. (b) Only the former fingerprint (R1, R3), core only; cezar re-keys once for R2. (c) No; every affected check re-keys once. | (a). The human's rule of 2026-10-20 is that results survive releases. Each change only drops inputs, so the read is valid. It reuses 011-37's lookup. Without it, every live worktree pays at its first daemon of the release, and those start close together. Section 4. |
| Q5 | A test that reads the root `package.json` at runtime, with `observe.runtimeInputs` off and no declared input. | (a) It keeps its key across a raise: an accepted miss, named in C11 and pinned by a test. (b) Keep the root `package.json` in the whole fingerprint. | (a). Today the lockfile re-keys it by accident. Observation (on by default) or a declared input keys such a read, as for any other project file. (b) brings back the split. Section 3, regression 4. |
| Q6 | Should this repository's `globalSetup` stop reaching `node:child_process`? | (a) No. (b) Yes, beside R1: list processes from `/proc` instead of `ps`. (c) Yes, instead of R1. | (a). After R1 a raise re-keys nothing anyway. A real dependency change (1 on main in 7 days) would still re-key at least 96% of the files. (b) works on Linux only. (c) does not fix the raise. Section 5. |

## 1. Npm input (brief question 1)

### 1.1 Today

`installedDependencies` hashes `format.path + "\0" + content` of the installed lockfile it finds (`src/core/keys/environment.ts:211-212`). npm's hidden lockfile `node_modules/.package-lock.json` has a top-level `name` and `version`, copied from the root `package.json`. Its `packages` map has one entry per installed folder (`node_modules/…`, with `version`, `resolved`, `integrity`, `link` and edges) and one entry per workspace folder (`packages/x`, with its own `name`, `version` and edges). It has no `""` entry. *Read in source code; verified by experiment in 011-81 (two installs at 0.1.240 and 0.1.242 differ in line 3 only).*

The whole fingerprint enters a key in two places. The environment hash holds it when the environment is opaque or the graph is unusable (`src/core/keys/dependencies.ts:38`). A test file's segment is `whole:<fingerprint>` when its own closure is opaque (`:52`). Scoped inputs hold `location@version#integrity` identities under `node_modules` and a workspace link's location, never an own version. So R1 changes only keys that hold the whole fingerprint of a trusted hidden lockfile. *Read in source code.*

### 1.2 The change (R1)

`installedDependencies`, for a hidden lockfile `staleHiddenLockfile` trusts, hashes `format.path + "\0" + "squeal-installed/2" + "\0" + text`. The text is the file parsed and written back with:

- the top-level `name` and `version` removed;
- `version` removed from the `""` entry, if any, and from each entry whose location lies inside the install and outside every `node_modules` folder (the workspace folders; `insideInstall && !isInstalledFolder` in `hidden-lockfile.ts`);
- everything else kept as written: every entry under a `node_modules` folder whole, a workspace entry's `name` and edges, `lockfileVersion`, `requires`, and a `file:` location outside the install.

The stale fallback (`packageFoldersFingerprint`), the patches, every other lockfile format and `"none"` stay as they are. The stale fallback holds no own version: it lists package folders and each link's target (`hidden-lockfile.ts`, `packageFoldersFingerprint`). *Read in source code; verified by experiment, regression 3.*

`staleHiddenLockfile` has already parsed the file and returned "not valid JSON" when it does not parse, so the new code has no not-JSON branch. The probe's first version had one, and the alarm flagged it as a line no case can run (`probes/alarm-cases.log`). The code row parses the file once and shares it with `listedPackages` and `packagesOf`. *Verified by experiment.*

Why the top-level `name` goes too: no install reads it, and the root package is a project file that a closure, an observed read or a declared input keys where a test reads it (C3). It never changes at a raise, so this costs nothing. *Inferred.*

**Effect.** *Verified by experiment* (`probes/regressions-*.log`, `test/keys/own-versions.test.ts` in `candidate.patch`): at 0.1.245 the fingerprint moves for a raise of the root's version and of a workspace's version; at the candidate it holds for both. An upgrade, a new workspace, a retargeted link and a changed workspace edge move it at both trees, and a stale lockfile falls back to the package folders at both. 011-81 found that the 5 live squeal worktrees installed at 0.1.235 to 0.1.244 have 4 fingerprints today and 1 under this encoding, and that the stale install of `04a258b0` (0.1.237 over a 0.1.242 checkout) joins them (`research/key-split.md` 2 and 5).

### 1.3 pnpm's `link:` specifier (R3)

pnpm's installed lockfile `node_modules/.pnpm/lock.yaml` holds no own version, but its `importers` hold each dependency's `specifier`, the range in the dependent's `package.json`. For a linked workspace package it reads, in cezar's installed file:

```yaml
      '@open-mercato/cezar-contract':
        specifier: ^0.16.0
        version: link:../contract
```

*Read in source code (cezar's installed `lock.yaml`, lines 30 and 31).* cezar's release commits raise every workspace's `version` and rewrite each dependent's range to the new one: `c961c04ab` (0.16.0, 2026-10-08), `b903048c1` (0.15.1), `e97c63146` (0.15.0) and `a80064fbf` (0.14.9) each change `"^0.15.1"` to `"^0.16.0"` and so on. There were 8 such releases from 2026-09-22 to 2026-10-08 and none since. *Read in source code (cezar's git history, read-only).* After each one, every cezar worktree that installs gets a new fingerprint for every project (the graph is not usable for pnpm, so every key holds the whole fingerprint), and it shares no key with the worktrees still on the older install. This is the squeal split in another form. The 7-day store window of 011-81 holds no cezar release, so its cost is not measured. *Inferred from verified parts.*

The change: for `node_modules/.pnpm/lock.yaml`, hash the file under the `squeal-installed/2` tag without each line `<indent>specifier: <range>` whose next line is `<indent>version: link:<path>`. pnpm writes `specifier` before `version` in each dependency, as in the file above. The `version: link:` line stays, so a retargeted link still moves the fingerprint. A range of a registry dependency stays, since its `version` line follows it and is not `link:`. If pnpm writes another layout, nothing is left out and the fingerprint is today's: a split, never a wrong hit. *Inferred.*

This is a text filter, not a reading of pnpm's format: C11's "pnpm's `lock.yaml` and yarn's are not read yet" still holds for packages and scoped keys.

## 2. Per-project config (brief question 2)

### 2.1 Today

`configFiles(vitest)` collects the `configFile` and `configFileDependencies` of the root's Vite config and of every project's (`src/runners/vitest/project.ts:7-14`). `projectInputs` gives that one set to each project (`:45`). Three readers use it:

1. `projectEnvironment` lists it in each project's `RunnerEnvironment.files`, which the core hashes (`src/runners/vitest/environment.ts`).
2. `environmentPackages` scans each config file for bare imports and builtins (`src/runners/vitest/packages.ts:119`), so a sibling's plugin is in this project's environment packages, and a sibling config that imports `child_process` makes this project's environment opaque.
3. `affected` marks every test file of a project as affected through its environment when a changed path is a project input (`src/runners/vitest/affected.ts:63`).

`recreateTriggers` uses the same set to recreate the Vitest instance after a config edit (`project.ts:63-64`). *Read in source code.* cezar's 5 projects therefore hash the same 9 files (011-81, `cezar-runner-files.json`).

### 2.2 The change (R2)

`projectInputs` gives each project `projectConfigFiles(vitest, project)`: the `configFile` and `configFileDependencies` of `vitest.vite.config` (the root's) and of `project.vite.config`. All three readers above follow. `recreateTriggers` keeps `configFiles(vitest)`, so a sibling's config edit still recreates the instance; only the keys stop moving. In a repository without `projects`, Vitest's one project has the root's config file, and nothing changes. *Read in source code; verified by experiment* (`probes/env-files.jsonl`): squeal's one project lists `vitest.config.ts` and no other config file at both trees. In `five-projects`, every project lists `e2e/vitest.config.ts` at base; at the candidate only `e2e` does, and the four inline projects list only the root's `vitest.config.ts`.

**Why it is safe.** Vitest loads each `projects` entry as its own config, so a sibling's file changes no option this project receives. The root's config stays in every project: its options and an inline project's `extends: true` reach every project, and an inline project lists the root's file and no other (`probes/env-files.jsonl`). A file that two configs import stays in both. *Inferred, from Vitest's projects model; verified by experiment for the three edits below.*

**What it does not see**, an accepted miss: a sibling config's top-level code runs in Vitest's own process, so a side effect there (an assignment to `process.env`) can reach this project's workers. A sibling's `globalSetup` has the same reach, and C3 already keys setup closures per project. *Read in source code.*

**Effect.** *Verified by experiment* (`test/runners/vitest/project-config.test.ts` in `candidate.patch`, the `five-projects` fixture with a `shared.config.ts` both configs import): an edit of `e2e/vitest.config.ts` re-keys only `e2e` (red at 0.1.245: all three projects re-key); an edit of the root's config or of `shared.config.ts` re-keys `e2e`, `server` and `web` at both trees. On cezar's pair, `api-client`, `contract`, `server` and `web` would share and only `e2e` would re-key (011-81, `inferred`).

One existing test pins today's rule and changes with R2: `test/runners/vitest/exclude-projects-filter.test.ts`, "excluding e2e: file-based, so its config file leaves every environment" expects `server` to re-key. At the candidate it does not (`probes/existing.log`). Both of its rows then read "excluding a project re-keys no survivor".

## 3. Regressions (brief question 3)

The findings' five, each as a test. "Base" is 0.1.245 (`90e442f7f`), "candidate" is `probes/candidate.patch`. The first three and the fifth ran in the probe.

| # | Must hold | Test (file, name) | Fixture | Base, candidate |
| --- | --- | --- | --- | --- |
| 1 | An upgrade under `node_modules` (a version or an integrity) re-keys every opaque test file and the opaque environment. | `test/keys/own-versions.test.ts`, "moves it for an upgrade under node_modules: a version or an integrity"; and a second case on `dependencyKeys(installed, opaque)`: its `environment` and `of(opaque packages)` both move. | A hidden lockfile with `node_modules/a` (version, integrity), a workspace `packages/ws` linked from `node_modules/ws`, folder times before the lockfile's, as in `hidden-lockfile.test.ts`. | pass, pass (the fingerprint case, verified) |
| 2 | Adding or removing a workspace folder, a link's new target, or a workspace's changed edges re-keys. | Same file, "moves it for a workspace added or a link retargeted". | Same, plus `packages/other`. | pass, pass (verified) |
| 3 | A stale hidden lockfile still falls back to the package folders (001-104), and a raise does not move that fallback. | Same file, "still keys a stale lockfile by its package folders". `test/keys/hidden-lockfile.test.ts` keeps 001-104's cases. | Same, plus an unlisted `node_modules/b`. | pass, pass (verified) |
| 4 | A test that reads the root `package.json` at runtime re-keys on a raise when its run observed the read or it declares the file; with neither, it keeps its key (Q5). | `test/scheduler/own-version.test.ts` (new), two cases over one fixture and a raise of `package.json` and of the hidden lockfile's `version`. With `observe.runtimeInputs` on, a file whose observed set holds `package.json` re-keys. With it off, a file whose `inputs` name `package.json` re-keys, and a file with neither keeps its key. | `createRepo` and `openHarness` (`test/scheduler/helpers.ts`), `writeInstall` (`test/keys/install.ts`) given a top-level `name` and `version`. | the file with neither: re-keys, keeps its key (*inferred from source*: observed and declared paths enter closures, C3) |
| 5 | An edit of one project's config re-keys only that project; the root's config re-keys all; a file two configs import re-keys each importer. | `test/runners/vitest/project-config.test.ts` (new), three rows of one `it.each`. | `five-projects` with `shared.config.ts` imported by the root's and `e2e`'s configs. | row 1 fails then passes; rows 2 and 3 pass at both (verified) |

The tests that land red first, the change itself:

- `test/keys/own-versions.test.ts`, "keeps it across a raise of the root's version" and "keeps it across a raise of a workspace's version": fail at base, pass at the candidate (verified).
- `test/keys/install-inheritance.test.ts`, a new case: a second worktree whose install differs from the first's only in the hidden lockfile's top-level `version` runs no test file (the harness that case 001-105 already uses).
- `test/runners/vitest/project-config.test.ts`, row 1 (verified).
- `test/keys/pnpm-lockfile.test.ts` (new, R3): a release that rewrites a linked dependency's `specifier` keeps the fingerprint; a registry dependency's `specifier`, a `version: link:` target and a registry `version` each move it.

## 4. Release cost (brief question 4)

### 4.1 What the release re-keys without help

- **squeal**, and every npm repository whose keys hold the whole fingerprint: every such check, once, in every worktree. Its environment is opaque, so that is every check. Under the default `baseline.onStart: "lookup-then-run-missing"`, each worktree's first daemon of the new release runs its misses at once. Worktrees with equal keys share through claims (001-205). 011-81 measured up to 4.16 run-hours for 5.7 suites on 2026-10-21, so about 0.73 run-hours per suite at most. *Inferred from verified parts.*
- **cezar**: every check, once (R2 changes all 5 projects' file lists; R3 changes every fingerprint). cezar runs `lookup-only`, so nothing runs at once, but every file of every live worktree becomes stale until a `run --all` or an edit runs it. In 24 hours cezar picked about 25 suites of files in 66.0 run-hours (`host-load.md` 2 and 4). *Inferred.*
- Not affected: pnpm repositories without a linked range, yarn and bun, stale installs, scoped inputs, and single-project Vitest repositories (R2).

Each live worktree re-keys when its first daemon of the new release starts (C9). The host's plugins follow release tags, so these starts come close together. *Inferred.*

### 4.2 The alarm (no format raise)

*Verified by experiment.* `test/keys/key-format.test.ts` on the clone, against the tag `squeal--v0.1.245`:

1. The `src/` change alone (`probes/alarm-candidate.log`): the alarm fires for `KEY_FORMAT_VERSION`, `VITEST_ADAPTER_VERSION`, `NODE_TEST_ADAPTER_VERSION` and `RECORDER_VERSION`; `PYTEST_ADAPTER_VERSION` does not fire. Each failure is "changed lines no case runs". No case has equal keys and different outputs, so the alarm names no case.
2. With a `key` case over a trusted hidden lockfile and an `adapter:vitest` case that reads two file-based projects' environments (`probes/alarm-cases.log`): only an unreachable not-JSON branch and the line for every other lockfile format stay unrun.
3. With that branch removed and a `key` case over a pnpm `lock.yaml` (`probes/alarm-cases2.log`): 11 of 11 pass at format 20.

So, by C3's rule, R1 and R2 move no version. Their keys differ, and a differing key is never by itself a reason to raise. The three cases join the corpus in R1 and R2. They need two harness additions: a `key` input `installed`, a tree written under the case's scratch directory whose `installedDependencies` fingerprint replaces the core's input, and an `adapter:vitest` input `environment: true`, whose projects' environment files are reported as `keys`, so the two trees' runs are compared only where the environments are equal. R3 extends the pnpm case's fixture with a linked importer. R4 needs an `accept` case (section 4.3).

### 4.3 Reading the former definition (R4)

**Why it is valid.** A key under the new definition is a function of the inputs of the key under 0.1.245's definition: `withoutOwnVersions(content)` and the pnpm filter are functions of the file's bytes, and a project's new file list is a subset of its old one, hashed with the same file hash. So two worktrees with equal former keys have equal new keys. A row stored under this worktree's former key was produced by inputs equal to this worktree's, with more of them compared, so it is a valid row for the new key. This is the condition under which 011-37 reads formats 13 to 19 as one: the row means the same thing. *Inferred, from read source.*

**The mechanism.** It extends 011-37's read (C3, C4 step 3, C7), and changes no store code:

1. `installedDependencies` also returns `former`, the fingerprint 0.1.245 computes (the trusted hidden lockfile or `lock.yaml` whole), or `null` where it equals `fingerprint` (stale fallback, other formats, `"none"`).
2. `dependencyKeys` also returns the former environment input (the former fingerprint where the environment holds the whole one, else the scoped input) and the former whole segment `whole:<former>`.
3. The Vitest adapter reports `RunnerEnvironment.formerFiles`, the file list 0.1.245 builds (every project's config files), and omits it when it equals `files`. This is an additive, optional field (C14). Other runners never set it.
4. `WorktreeKeys.setEnvironments` adds, for each project whose former inputs differ, the environment hash under the former inputs at the current format and at each format read as one, to the project's list read as one. Each such entry carries the segment rule: a file whose segment is `whole:<fingerprint>` reads `whole:<former>`; every other segment is the same.
5. `KeyIndex.keysReadAsOne` computes each entry's key with its segment rule (`src/core/keys/key-index.ts:202`, `keyOf` at `:235`). The rest is 011-37's: a lookup that misses at its key copies the newest set found under these keys to its key, once per file and key in a daemon, only while no row is stored there (`src/core/scheduler/accept.ts:69`), and catch-up reads them too (`stored-keys.ts`).

**What it reads.** The rows a worktree's own daemons stored before the release, and the rows of any worktree with equal former inputs (the same installed version, the same config files). Once copied, the set lies under the new key, where every worktree with that key finds it, whatever its version. *Inferred.*

**Cost.** Up to 8 more keys per missed file (15 in place of 7), only for projects whose former inputs differ; they are computed once per key in a daemon (`Keyed.readAsOne`) and looked up in the same query (`copyNewest`). The former environment hashes the files the environment already tracks. *Read in source code.*

**End.** The next format raise empties the former definition as it empties `KEY_FORMATS_READ_AS_ONE`, since rows stored under an older format mean something else then. A later row may drop it sooner.

**Its case.** An `accept` case whose run each tree stores at the key it computes over one install with a root version: the release's tree stores under the former definition, the candidate's under the new one. The candidate's decision over the release's store must give the same hit as over its own. That case runs R4's changed lines; without R4 it passes too (keys differ), so the alarm cannot require R4. Q4 decides.

**Rejected variants.** Copying every stored row to its new key at the first start (a migration): it writes the whole store at once on a loaded host and needs each row's former inputs, which a store does not keep. Keeping the former definition forever: every miss would pay its keys after no store holds such rows.

## 5. This repository's `globalSetup` (brief question 5)

`vitest.config.ts` sets `globalSetup: ["test/global-teardown.ts"]`, which imports `test/daemon/strays.ts`, which imports `execFileSync` from `node:child_process` to list processes with `ps` (lessons, defect 29). So squeal's environment is opaque and holds the whole fingerprint (C11). *Read in source code.*

Making it non-opaque changes little, because the test files are opaque on their own. *Verified by experiment, a static estimate* (`probes/opaque-count.json`): 787 of 820 test files reach `child_process`, `worker_threads`, `cluster` or `module` through relative imports (C11 case 1), and 607 call `require.resolve`, `createRequire` or `import.meta.resolve` (case 2). `src/core/fs/git.ts` alone is in 684 closures. The estimate leaves out bare imports and opaque packages (case 4), so the true count is at least this high for case 1.

- **Instead of R1** it does not fix the raise: those 787 files would key by `whole:<fingerprint>` and split at each raise, as 011-81 inferred.
- **Beside R1** it narrows only a real dependency change, from every file to at least 96% of them. Main took one in 7 days (`c12dc371d`).
- It costs a process listing without `child_process`: reading `/proc/*/cmdline` works on Linux only. Hiding the import from C11's scan (a computed specifier) would defeat the rule that protects a child process's packages.

Recommendation: leave it (Q6 (a)).

## 6. Rejected options

| Option | Why not |
| --- | --- |
| Fix only the opacity of squeal's environment (Q6 (c)) | 787 of 820 test files stay opaque on their own and split at each raise (section 5). |
| The scoped input for opaque cases too | 001-109 keys opaque cases by the whole install because a child process or a worker can load packages no import names. R1 keeps that guarantee; this would drop it. |
| Hash only the `node_modules/…` entries | It drops workspace entries' edges and a new workspace, which change resolution (regression 2). |
| Hash the committed `package-lock.json` | It holds the root's version too, and it is not what is installed (001-104). |
| Raise `KEY_FORMAT_VERSION` | The alarm names no case (section 4.2); C3 forbids a raise for a differing key. |
| Keep the root `package.json` in the whole fingerprint (Q5 (b)) | It brings back the split R1 removes. |
| Hash a sibling's resolved config in place of its file | It still re-keys this project for a sibling's edit, and a project's resolved config is already its own input. |
| Parse pnpm's `lock.yaml` as YAML for R3 | It needs a YAML reader for a one-line rule. The text filter fails safe (section 1.3). |
| Leave pnpm to the repository (Q3 (c)) | It fixes cezar only, and only once cezar changes its release tool. |
| Migrate stored rows to the new keys at start | See section 4.3, rejected variants. |

## 7. Spec text drafts

**C3, environment hash bullet.** From "the contents of the config file and its `configFileDependencies`," to:

> the contents of the root's config file, the project's own config file and the `configFileDependencies` of these two, never a sibling project's (task 011-85: Vitest loads each `projects` entry as its own config; as for a sibling's `globalSetup`, a sibling config's effect on Vitest's shared process is not keyed),

**C3, key format bullet.** After "A raise after the guard's replacement empties that list.", add:

> The key definition before task 011-85 is read the same way: a lookup that misses also computes the key from the inputs that definition hashed (npm's hidden lockfile and pnpm's `lock.yaml` whole, every project's config files, the runner's `formerFiles`, C14) at the current format and each format above, and copies the newest set found as for a format read as one. Every input of the current key is a function of those, so such a row means what a row under the current key means. A raise empties it with the list.

**C4 step 3.** From "A key with no result is first read at the formats C3 reads as one," to "A key with no result is first read at the formats and the former definition C3 reads as one,".

**C7.** From "A set copied from a format read as one (C3)" to "A set copied from a format or the former definition read as one (C3)".

**C11, installed dependencies bullet.** From "The *whole fingerprint* hashes the installed lockfile metadata under `node_modules` (or the package folders, above) plus `patches/`." to:

> The *whole fingerprint* hashes the installed lockfile metadata under `node_modules` (or the package folders, above) plus `patches/`. Neither the root's nor a workspace's own version enters it, since a release raises them and a test that reads one reads a project file, which a closure, an observed read or a declared input keys (C3; task 011-85, `research/key-split.md`): npm's hidden lockfile enters without its top-level `name` and `version` and without the `version` of the `""` entry and of each workspace folder (an entry inside the install and outside every `node_modules` folder), and pnpm's `lock.yaml` enters without the `specifier` line of a dependency whose `version` is `link:`, under the tag `squeal-installed/2`. Every entry under a `node_modules` folder stays whole (location, version, integrity, resolution, link and edges), and so do a workspace's name and edges, a linked dependency's target and every other format.

And in the same bullet, from "the bare imports and literal `require`s of the config file and its `configFileDependencies` (the config's plugins)" to "the bare imports and literal `require`s of the root's config file, the project's own and their `configFileDependencies` (the config's plugins; C3)".

**C11, accepted misses.** After "a package that the runner or a config plugin starts in a child process or worker," add:

> a project file a test reads at runtime with `observe.runtimeInputs` off and no declared input, the root `package.json`'s version included, which the hidden lockfile no longer carries (task 011-85),

**C11, formats.** From "(pnpm's `lock.yaml` and yarn's are not read yet)" to "(pnpm's `lock.yaml` and yarn's are not read for packages yet; pnpm's enters the fingerprint without a linked range, above)".

**C14.** From "`environment` (`RunnerEnvironment`, its files and packages)" to "`environment` (`RunnerEnvironment`, its files, its `formerFiles` where the files under the definition before task 011-85 differ (C3), and packages)".

Only under Q4 (a) or (b): the C3 key format sentence, C4 and C7 (and C14 only under (a)). Under Q4 (c) they are left out.

## 8. Code rows, in order

Each row is product code on the validity path, so the four rows reach main in one candidate (`cand/<version>`), and no release carries R1 to R3 without R4. Under Q4 (c), R4 is dropped and the rows may release apart.

### R1: the npm input

- **Seam:** `installedDependencies` (`src/core/keys/environment.ts:210-212`), with a new `withoutOwnVersions` in `src/core/keys/hidden-lockfile.ts` beside `isInstalledFolder` and `insideInstall`. The file is parsed once.
- **Owns:** `src/core/keys/environment.ts`, `src/core/keys/hidden-lockfile.ts`; `test/keys/own-versions.test.ts` (new), `test/keys/install-inheritance.test.ts`, `test/keys/install.ts` (a top-level `name` and `version` in `writeInstall`), `test/scheduler/own-version.test.ts` (new); `test/keys/validity/case.ts`, `harness.ts`, `cases/key/installed.ts` (new), `cases/index.ts`.
- **Red first:** own-versions, "keeps it across a raise of the root's version" and "… of a workspace's version"; install-inheritance, a second worktree that differs only in the root's version runs nothing.
- **Guards:** regressions 1 to 4. **Validity:** the `key` case over a trusted hidden lockfile and the one over a pnpm `lock.yaml`; the alarm passes at format 20.

### R2: each project's config files

- **Seam:** `projectInputs` (`src/runners/vitest/project.ts:45`), with `projectConfigFiles(vitest, project)` beside `configFiles`; `recreateTriggers` unchanged.
- **Owns:** `src/runners/vitest/project.ts`; `test/runners/vitest/project-config.test.ts` (new), `test/runners/vitest/exclude-projects-filter.test.ts` (the "excluding e2e" row); `test/keys/validity/harness/vitest.ts`, `case.ts`, `cases/adapter/environment.ts` (new), `cases/index.ts`.
- **Red first:** project-config, "an edit of e2e/vitest.config.ts re-keys only e2e". exclude-projects-filter's row changes from `true` to `false` in the same commit.
- **Guards:** regression 5, rows 2 and 3. **Validity:** the `adapter:vitest` environment case; `VITEST_ADAPTER_VERSION` stays 3.

### R3: pnpm's linked ranges

- **Seam:** the non-npm branch of `installedDependencies`, with `withoutLinkedSpecifiers(text)` in a new `src/core/keys/pnpm-lockfile.ts`.
- **Owns:** `src/core/keys/pnpm-lockfile.ts` (new), `src/core/keys/environment.ts`; `test/keys/pnpm-lockfile.test.ts` (new); `test/keys/validity/cases/key/installed.ts`.
- **Red first:** pnpm-lockfile, a release that rewrites a linked range keeps the fingerprint.
- **Guards:** a registry range, a `link:` target and a registry version each move it; a file with no `importers` hashes as today's bytes under the tag. **Validity:** the pnpm `key` case's fixture gains a linked importer.

### R4: the former definition read as one

- **Seams:** `installedDependencies` (`former`), `dependencyKeys` (`former`), `RunnerEnvironment.formerFiles` (`src/core/types/runner.ts`, additive), the Vitest adapter's `projectEnvironment` (`src/runners/vitest/environment.ts`, from `configFiles(vitest)`), `WorktreeKeys.setEnvironments` (`src/core/scheduler/keying.ts:215-228`) through a new `src/core/keys/former.ts` (keying.ts is 571 lines), and the read-as-one entries of `KeyIndex` (`src/core/keys/key-index.ts`), which carry the segment rule.
- **Owns:** those files, `src/core/scheduler/lockfiles.ts`; `test/scheduler/former-read.test.ts` (new, modelled on `test/scheduler/formats-read-as-one.test.ts`); `test/keys/key-index.test.ts`; `test/keys/validity/harness/accept.ts`, `cases/accept/former.ts` (new), `cases/index.ts`.
- **Red first:** former-read, "a pass stored under the former definition makes the file current under `lookup-only` with its provenance, and copies it to the new key"; a second worktree with another root version then finds it at the new key. Also: a whole segment reads `whole:<former>`, a scoped one reads itself.
- **Guards:** no former entry where the former inputs equal the current ones (a stale install, `"none"`, a single-project repository); a row at the former key of another install is not read. **Validity:** the `accept` case of section 4.3.

### Other designs' seams

The briefs name these seams: 011-82 `tiers.ts`, `claims.ts`, `queue.ts` and `store-decision.ts`; 011-83 `src/core/capacity/pool.ts` and `src/core/scheduler/capacity.ts`; 011-84 `lifecycle.ts`, `daemon.ts`, `slow-instance.ts` and `policy.ts`. No row here edits those files. R4 widens the keys `keysReadAsOne` returns, which `ledger.ts` and `stored-keys.ts` read unchanged. Shared files: `test/keys/validity/cases/index.ts` and `test/keys/validity/harness.ts`, where any row that changes the validity path adds its case. Merges there are additions.

## Open questions

- R3's cost is not measured: no cezar release fell in 011-81's 7-day store window. The evidence is cezar's git history and its installed `lock.yaml`.
- Regression 4 did not run in the probe; its outcome is inferred from how observed and declared paths enter closures (C3, C12).
- R4 did not run in the probe. Its validity argument is in section 4.3; its `accept` case is the check.
