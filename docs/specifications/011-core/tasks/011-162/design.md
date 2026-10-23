# 011-162: per-package keys from pnpm's installed `lock.yaml`, a design for the human

Board row 011-162, a docs-only design draft (brief `tasks/011-162/brief.md`). The human asked for a design row first on 2026-10-23, from the question whether Squeal works in pnpm projects (task 793f861a). Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 8 go into 011 C3 and C11, `status.md` gets a dated line, and the board numbers the code rows of section 9.

Sources: 011 C3 (the environment hash and key format bullets), C11 and `status.md`; 013 V6; `001-core-loop/research/per-package-keys.md` F2 and its probes; `tasks/011-85/design.md` and board row 011-90; the source at `b849e80ed` (main, key format 20): `src/core/keys/environment.ts`, `packages.ts`, `pnpm-lockfile.ts`, `hidden-lockfile.ts`, `dependencies.ts`, `former.ts`, `src/core/scheduler/keying.ts`, `lockfiles.ts`, `src/runners/vitest/packages.ts`, `adapter.ts`; `test/keys/validity/`. New probes in `probes/` (`probes/README.md`, raw output `probes/output.txt`): `git clone`s of cezar under `/tmp` at `28be188dc`, scratch `HOME`, `XDG_*` and `TMPDIR`, pnpm's store under `/tmp`, installs with `--ignore-scripts` (no count runs a script: only Vite's closure walk runs, no test), no daemon, no build. cezar's live installs were read, never written. One-minute load 21 to 30 during the probes. The clones are removed.

**Brief defect.** The board row says "Squeal's own repository and cezar install with npm", and the brief's lead converts a cezar clone with `pnpm import`. cezar moved to pnpm on 2026-10-11 (`cf6d7038a`, "use pnpm hardlinks for dependency installs", #955; `packageManager: pnpm@12.11.2`). So no conversion was needed: the count runs on cezar as it is, and it compares directly with C11's npm figure, measured on the same repository before the move.

Evidence tags follow `docs/process.md`: `measured` (verified by experiment), `read in source code`, `read in official docs`, `inferred`.

## Summary

- **Today every pnpm key holds the whole fingerprint.** `installedDependencies` returns a package graph only for npm's trusted hidden lockfile (`environment.ts:257`), so `dependencyKeys` puts the whole fingerprint in every pnpm project's environment hash. On cezar, any change of `lock.yaml` re-keys all 919 test files. *Measured:* 0 of 919 keep their key in each of three install pairs.
- **pnpm's installed `lock.yaml` holds the graph a key needs.** `importers` name each workspace's dependencies, `packages` each package's integrity, `snapshots` each resolved node with its edges, peers included. A package entry Vite resolved lies in `node_modules/.pnpm/<folder>/node_modules/<name>/`, and pnpm names `<folder>` from the snapshot id by a fixed rule. *Measured:* pnpm 10's rule gives all 553 of cezar's folders as pnpm 12 wrote them; every import the Vitest adapter reports (43) and every snapshot edge (1,453 to 1,594 per install, four installs) maps to the folder Node finds on disk.
- **Recommendation: read `lock.yaml` as a graph, R1 to R3.** A lookup maps a resolved entry's folder to its snapshot, and a bare or required name to the importer that declares it. A key holds `<snapshot id>#<integrity>` with the snapshot's resolved edges. `lock.yaml` stands for the install under a rule like npm's, which ignores the old folders pnpm keeps after an update. Only pnpm's default layout gets the graph; every other layout keeps the whole fingerprint. C11's five fallback cases stay as they are.
- **Count on cezar.** 329 of 919 files can keep their own segment; 590 fall back (84 through an opaque `e2e` setup, 435 through case (1), 4 through cases (1) to (3) by `module`, 67 through case (4), none through (5)). Across cezar's last real lockfile change, 328 files keep their key (today 0); across 86 bumped application packages, 69 (today 0); across a full `pnpm update` that moves Vitest, 0. C11's npm figure was 265 of 632 on 2026-10-07. *Measured.*
- **The release need not re-key.** Every input of the new key is a function of today's pnpm inputs while `lock.yaml` is trusted, so a lookup can read today's rows as one, as 011-90 reads the definition before 011-85. Without it, 835 of cezar's 919 files re-key once in each live worktree. The alarm should name no case. *Inferred.*
- **Six decisions for the human**, Q1 to Q6, each with a default (next section). Three code rows, in one candidate (section 9).

## Decisions for the human

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | How does a package import map to a `snapshots:` entry? | (a) A package entry Vite resolved, `node_modules/.pnpm/<folder>/node_modules/<name>/…`: `<folder>` is looked up in a map from each snapshot id to its folder name under pnpm's rule; a bare or required name: the nearest importer at or above the importer's directory that declares it, then the public hoisting `.modules.yaml` records; a `link:` version is a workspace. (b) Every entry re-looked-up by name from the project file that imported it (the adapter reports the importer). (c) Read the disk: realpath each `<dir>/node_modules/<name>` and each folder's `package.json`. | (a). It matched Node's lookup on every import and edge measured, reads no package folder, and keeps Vite's own resolution (`resolve.dedupe`, aliases), which (b) would replace by Node's. (c) costs a `stat` chain per lookup and still needs the integrity from `lock.yaml`. Section 1. |
| Q2 | What does a key hold in place of `location@version#integrity`? | (a) `<snapshot id>#<integrity>` and the snapshot's resolved edges (`name@version(peers)`, sorted). (b) `<snapshot id>#<integrity>` alone. (c) `<.pnpm folder>/node_modules/<name>@version#integrity`, npm's form. | (a). The edges make the set name exactly the subgraph Node loads; in the probes they kept the same files as (b) (328 and 69). (c) ties keys to pnpm's folder naming, which hashes long names. Section 2. |
| Q3 | When does `lock.yaml` stand for the install? | (a) While every snapshot not skipped has its package folder, no such folder and no importer's `node_modules` entry is newer than `lock.yaml`, and each importer's `node_modules` holds only declared names (and the public hoisted at the root). A `.pnpm` folder no snapshot names is an orphan and is ignored. Otherwise the package folders are fingerprinted, with one note, as for npm. (b) Always, as pnpm itself trusts it. (c) (a), with orphans counted as unlisted. | (a). It is npm's rule (task 001-104) on pnpm's layout. It flags each of four broken installs, three of which pnpm leaves as they are, and trusts all 33 live cezar installs. (c) distrusts every install for up to 7 days after an update (`modules-cache-max-age`). Section 3. |
| Q4 | Which layouts get per-package keys? | (a) Only `nodeLinker: isolated` with the local virtual store `.pnpm` and lockfile format 9; hoisting settings are read from `.modules.yaml`. `nodeLinker: hoisted`, the global virtual store, another `virtualStoreDir` or another lockfile format keep the whole fingerprint. (b) (a), and map `hoisted` folders by their `package.json`. (c) (a), and map the global store's paths. | (a). `hoisted` has no folder map and keeps today's key. Under the global store every package lies outside the worktree, where C11 leaves an entry out: a per-package key there would hold nothing and miss every bump. Section 4. |
| Q5 | How is `lock.yaml` read? | (a) A line reader for pnpm's written layout of the three parts a key reads; a line it does not know keeps the whole fingerprint. (b) Add the `yaml` package as a runtime dependency. | (a). It gave the same graph as `yaml` on 8 files, cezar's in 1.8 to 3.4 ms against 86 to 155 ms (best of 5, load 27), and adds nothing to the bundles. Today's `withoutLinkedSpecifiers` reads the same layout as text. Section 1.4. |
| Q6 | The release changes the key of every pnpm project whose environment becomes scoped. Does a lookup read the rows stored under today's definition? | (a) Yes: today's pnpm definition (the whole fingerprint in the environment hash, no segment) joins the former definitions C3 reads as one, while `lock.yaml` is trusted. (b) No; each such check re-keys once. | (a). The human's rule of 2026-10-20 is that results survive releases, and 011-90's mechanism carries it. Under (b), 835 of cezar's 919 files go stale once in each of its 33 live worktrees under `lookup-only`. Section 6. |

## 1. Lookup (brief question 1)

### 1.1 What the adapter reports

The Vitest adapter turns each first-hop file under `node_modules` into `{ from, name }`, `from` being the path before the last `node_modules/` (`src/runners/vitest/packages.ts:62`). Vite resolves real paths, so for pnpm's isolated layout an entry is `node_modules/.pnpm/<folder>/node_modules/<name>/…` and `from` is `node_modules/.pnpm/<folder>`. A specifier Vite left bare and a literal `require` target come with the importer's directory; a docblock environment with the project root. Entries outside the worktree are left out (`:31-34`). The adapter needs no change: 013 V6 stays as it is. *Read in source code; measured:* on cezar its 919 closures report 43 distinct imports, 31 of them resolved entries under `.pnpm`.

`InstalledGraph.#resolve` walks `<from>/node_modules/<name>` and each parent through npm's lockfile locations (`src/core/keys/packages.ts:119`). Under pnpm no lockfile location is a path, so that walk finds nothing. *Read in source code.*

### 1.2 The change

- **Folder map.** pnpm names each snapshot's folder by `depPathToFilename(id, virtualStoreDirMaxLength)`: `/`, `:` and the like become `+`, a peer suffix `(…)` becomes `_…`, and a name over the limit (120 by default, in `.modules.yaml`) or with capitals is cut and ends in `_` and 32 hex digits of its SHA-256 (pnpm 10.32.0, `dist/pnpm.cjs`). The graph builds `folder -> snapshot id` once per read. *Read in source code; measured:* over cezar's 638 snapshots it names all 553 folders pnpm 12.11.2 (a Rust rewrite) wrote, 48 of them hashed; the other 85 snapshots are the platform packages `.modules.yaml` lists as `skipped`. It also names the folders of a pnpm 10.32.0 install and of a patched package (`hono@4.12.29_patch_hash=…`).
- **A resolved entry** `{ from: node_modules/.pnpm/<folder>, name }`: the snapshot the folder maps to, whose name is `name`. A `name` that is not the folder's own (a sibling, as Node would find it next) resolves through the snapshot's edges, then pnpm's private hoisting (`.pnpm/node_modules`, `.modules.yaml` `hoistedDependencies` marked `private`), then the root, as Node's walk does. A folder no snapshot names (a closure resolved under an earlier install) keys the file by the whole fingerprint; the instance is recreated when the installed lockfile changes and closures of a recreated project are fetched again (`src/runners/vitest/adapter.ts:351`, `src/core/scheduler/refinement.ts:76`), so this lasts one revision. *Read in source code; measured* (cezar's closures against another install's map name 21 such folders, all old versions).
- **A bare or required name** from a project directory: the nearest importer at or above it (`importers:` keys are workspace paths, `.` the root) whose `dependencies`, `devDependencies` or `optionalDependencies` declare it; at the root, also a name `.modules.yaml` hoists publicly (`shamefullyHoist`, `publicHoistPattern`). pnpm creates `node_modules` only in importers and in `.pnpm`, so this is Node's walk. Not found keys as absent, as today. *Measured:* of the 12 bare or required names cezar's closures report, 11 resolve to the folder Node finds and 1 is absent on disk and in the graph.
- **Edges.** A snapshot's `dependencies` and `optionalDependencies` hold its resolved peers too (`'@hono/node-server@1.19.14(hono@4.12.29)': dependencies: hono: 4.12.29`). A child id is `<name>@<ref>`, or `<ref>` itself for an alias (`other@1.0.0`). A skipped optional child keys as present-but-skipped and is not expanded or scanned. *Measured:* every edge of four installs (1,453 to 1,594) names the folder Node's lookup from the parent's own folder finds; skipped children are absent on disk and in the graph alike.
- **Peer suffixes** are part of the id, so two peer variants of one package are two nodes with their own edges. cezar has none (0 packages with two snapshots); the fixture's `@hono/node-server@1.19.14(hono@4.12.29)` is one. *Measured.*
- **`link:` workspaces.** A `version: link:../contract` keys as `workspace:packages/contract`, its files being project files in the closure, as for npm (`packages.ts:40`). Vite resolves a linked package to its project path, so it never reaches the graph as an entry. *Measured* (fixture: `app -> lib` is `packages/lib`).

Rejected: (b) would replace Vite's resolution by Node's from the importer, and a project with `resolve.dedupe: ['react']` loads the root's copy where Node would find the importer's; the adapter would also need to report importers (013 V6). (c) does a `stat` and `realpath` per lookup step and reads no integrity. *Inferred.*

### 1.3 Accepted misses that stay

The graph covers what declared edges load. An undeclared `require` from inside a package resolves through pnpm's private hoisting (`hoistPattern: ["*"]` by default, cezar's 537 hoisted names), which no edge names: C11's existing accepted miss "a package loaded in-process by a package without declaring it". A bundled dependency (`bundledDependencies` in `packages:`) lives in the package's own `node_modules`, which the scan skips; one cezar entry has it, a platform package skipped on Linux. *Measured (counts); inferred (effect).*

### 1.4 Reading `lock.yaml` (Q5)

The core reads no YAML today: `withoutLinkedSpecifiers` filters pnpm's file as text (`src/core/keys/pnpm-lockfile.ts`), and Squeal's runtime dependencies hold no YAML parser (`package.json`). A key reads three parts: each importer's `dependencies`, `devDependencies` and `optionalDependencies` (`specifier`, `version`), each package's `resolution.integrity`, and each snapshot's `dependencies` and `optionalDependencies`. pnpm writes them in a fixed layout: two-space indents, one key per line, single-quoted keys where needed, `resolution` as a one-line flow map, and sequences (`transitivePeerDependencies`, `cpu`) only where a key reads nothing. `.modules.yaml` is JSON under both pnpm 10.32.0 and 12.11.2. *Measured:* a line reader of those parts (`probes/lockread.mjs`) gives the same graph as the `yaml` package on 8 files (four cezar installs, cezar's live one, three fixtures, a patched one among them), cezar's in 1.8 to 3.4 ms against 86 to 155 ms (best of 5, load 27). A line it does not know, a double-quoted key or a `lockfileVersion` other than 9 returns nothing, and the install keeps the whole fingerprint: a split, never a wrong key.

## 2. Identity (brief question 2)

A key holds, per node of the closure, `<snapshot id>#<integrity>` followed by its resolved edges, sorted (`hono@4.12.29#sha512-…`, `@babel/parser@8.0.7#sha512-…>@babel/types@8.0.6`). The snapshot id carries the version and the peers; the integrity, from `packages:<name@version>.resolution.integrity`, the content; a patch adds `(patch_hash=…)` to the patched package's id, to every edge and importer version that names it, and to the id of a dependent that takes it as a peer. Markers stay as for npm: `absent:<from>><name>`, `workspace:<path>`, `<id>@types-only`. All of these come from `lock.yaml` and `.modules.yaml` and none names the worktree, so two worktrees with equal installs key equally. *Measured:* cezar against itself keeps 919 of 919; the 33 live cezar installs hold one `lock.yaml` (`98b71d50…`); a patch moves the ids.

Why the edges: npm's identity is a location, and Node's lookup from a set of locations is fixed, so the set alone names the loaded tree. A pnpm id omits its non-peer edges, so in principle a re-resolution that swaps two edges between nodes already in the set keeps the set. The edges close that, at no cost measured: the same 328 and 69 files kept with and without them. *Measured; inferred (the swap).*

The scans of C11 case (4) and of types-only packages key by `<name>@<version>#<integrity>`, the content, so peer variants share one scan. *Inferred.*

Rejected: (b) leaves the swap open; (c) keys by pnpm's folder name, which differs for one id under another `virtualStoreDirMaxLength`. *Inferred.*

## 3. Trust (brief question 3)

### 3.1 The rule

npm's hidden lockfile stands for the install only while npm itself would trust it (`staleHiddenLockfile`, task 001-104). pnpm writes `node_modules/.pnpm/lock.yaml` after every folder it creates: on a fresh cezar install no package folder is newer than it, and on all 33 live cezar installs none is. *Measured.* pnpm 12 itself, asked to install over a broken copy with `--frozen-lockfile --offline`, recreated a deleted folder and reported "up to date" for each other break, repairing nothing (`probes/trust.sh`). *Measured.*

The proposed rule: `lock.yaml` stands for the install while

1. every snapshot not listed in `.modules.yaml`'s `skipped` has its package folder `.pnpm/<folder>/node_modules/<name>`;
2. no such package folder is newer than `lock.yaml` (compared with `lstat`, as npm's);
3. each importer's `node_modules` holds only names that importer declares, plus at the root the names hoisted publicly, dot entries left out, and none of those entries is newer than `lock.yaml`.

Otherwise the fingerprint hashes the package folders, as npm's stale fallback does (each folder's path with its `package.json` name and version, each link's target), and one note names the first unlisted, newer or missing entry of each kind (C3). *Measured, `probes/trust.sh`:* a deleted folder (missing), a file added to a package folder (newer), a package copied into the root's `node_modules` (not listed) and a retargeted importer link (newer) are each stale; an untouched install, a folder moved out and back, and an install after `pnpm update` are trusted. Cost: 4 to 29 ms per install (load 23 to 30), against 10 to 19 ms for npm's on cezar's 470 packages (001-104).

### 3.2 Orphans

pnpm keeps a folder no snapshot names after an update, until `modules-cache-max-age` (7 days by default) prunes it at a later install. *Read in source code* (pnpm 10.32.0: the default is `7 * 24 * 60` minutes, and an install prunes the virtual store only once `.modules.yaml`'s `prunedAt` is older than that). *Measured:* a `pnpm update` of 16 cezar dependencies left 206 such folders, a full one 284. No symlink a lookup follows points into one (1,932 and 1,864 checked), so nothing loads them. The rule ignores them. The first version of the probe counted them as unlisted and called both installs stale: under option (c), every pnpm install is distrusted for a week after any update. *Measured.*

What the rule does not see, as npm's does not: an edit inside a file, and a folder replaced with an older mtime. Also left out: a `node_modules` folder outside every importer, which pnpm never creates and Node would read. *Inferred.*

Rejected: (b) keys a hand-broken install by a lockfile that does not describe it, the hole 001-104 closed for npm.

## 4. Layouts (brief question 4)

*Measured, `probes/layouts.sh` on pnpm 12.11.2:*

| Setting | `lock.yaml` | Where a package lies | Effect on the lookup |
| --- | --- | --- | --- |
| default (`isolated`) | `node_modules/.pnpm/lock.yaml` | `.pnpm/<folder>/node_modules/<name>` | the graph of section 1 |
| `shamefullyHoist: true` | same | same; the root also links every package (`publicHoistPattern: ["*"]`, 5 of 5 `public`) | a bare name no importer declares resolves through the public hoisting `.modules.yaml` records |
| `publicHoistPattern: [ws]` | same | same; the root links `ws` (1 `public`, 4 `private`) | as above, for the names it hoists |
| `nodeLinker: hoisted` | same | real folders `node_modules/<name>`, npm's layout; no hidden lockfile | no folder map: whole fingerprint |
| `enableGlobalVirtualStore: true` | same | outside the worktree, `<store>/links/<scope>/<name>/<version>/<hash>/node_modules/<name>`; `.modules.yaml` `virtualStoreDir` `../../../store/v11/links` | whole fingerprint |
| `injected` workspace dependency | not reproduced: pnpm 12.11.2 linked the workspace both with `dependenciesMeta.injected` and `injectWorkspacePackages` | | inferred: a snapshot with no integrity keys the file by the whole fingerprint |

Hoisting changes no folder and no resolved path; it adds root links, which `.modules.yaml` records with each id (`hoistedDependencies: { "<id>": { "<alias>": "public" } }`). So `shamefullyHoist` and `publicHoistPattern` change only the bare-name step of section 1.2, and the trust rule's list of names allowed at the root.

The global virtual store must keep the whole fingerprint. C11 leaves out "an entry outside the worktree … as no install of this worktree holds it", and the adapter drops such entries (`packages.ts:31-34`). Under the global store every package Vite resolves lies outside the worktree, so a per-package key would hold none of them and a bump would keep every key. Detected by `virtualStoreDir` other than `.pnpm`. *Measured (layout); read in source code (the drop); inferred (the miss).*

Lockfile formats other than `lockfileVersion: '9.x'` (pnpm 8's `6.0`) keep the whole fingerprint. yarn stays out of scope.

## 5. Opacity (brief question 5)

C11 case (4)'s scan reads a package's code files, nested `node_modules` left out (`package-scans.ts:87`). Under pnpm the package's folder is `node_modules/.pnpm/<folder>/node_modules/<name>`, `<folder>` from the map of section 1.2; the graph records it for each identity it produces, as `InstalledGraph` records a location (`packages.ts:155`). A pnpm package folder has no dependencies inside it (they are its siblings), so leaving out nested `node_modules` skips only the `.bin` links pnpm puts there (33 such folders on cezar, all 33 holding only `.bin`) and a bundled dependency (section 1.3). *Measured.*

On cezar the scan finds the same opaque packages C11 names for npm: `commander` (7.2.0, 8.3.0), `es-toolkit`, `import-meta-resolve` and `marked` (16.4.2, 17.0.6) in 66 `web` files, `cross-spawn` in 1 `server` file. A daemon's first keying of 919 files scans 400 packages in 0.46 to 0.56 s and keys in 0.65 to 0.81 s in all (load 23 to 29; 2.2 s on a file cache cold after the install). *Measured.*

## 6. Release cost (brief question 6)

**What changes.** A pnpm project whose environment becomes scoped changes every key: the environment hash holds the scoped input where it held the whole fingerprint, and each file adds a segment. A project whose environment stays whole (an opaque setup, cezar's `e2e`) keeps its keys, while `lock.yaml` is trusted. On cezar that is 835 of 919 files in each of 33 live worktrees, which run `lookup-only`: they go stale, not run, until `run --all` or an edit. *Measured (projects); inferred (effect).*

**Reading today's rows (Q6 (a)).** Today's pnpm key hashes `lock.yaml` without linked ranges, under `squeal-installed/2`, in the environment hash, with no segment (C11, 011-85 R3). While `lock.yaml` is trusted, every input of the new key is a function of that: the identities and edges are read from it, a package's content is fixed by its integrity, so the opaque and types-only scans are too, and the closure's packages are Vite's resolution over that install. So a row stored under today's key means what a row under the new key means, the condition under which 011-37 reads formats and 011-90 reads the definition before 011-85. The mechanism is 011-90's: `installedDependencies` returns today's fingerprint as a former input for a trusted pnpm install, `dependencyKeys` builds its keys with no graph (whole in the environment, an empty segment for every file), and `formerReadAsOne` adds that environment hash at the current format. Rows under today's definition exist at format 20 only, since 0.1.253, so one hash per project; the definition before 011-85 stays as it is. A stale install reads no former row: its new key, the package folders, is not a function of `lock.yaml`. *Inferred, from read source.*

Two former definitions then apply to pnpm, and the existing one must keep its own graph: the definition before 011-85 had no pnpm graph either, so its keys stay whole when R2 gives the current definition one (`dependencies.ts:40-41` builds the former keys from `installed` with the current graph today). *Read in source code.*

**The alarm.** C3: "A change to what a key is computed from re-keys the affected checks by itself and moves nothing". No row, observed set or decision changes, so no case can have equal keys and different outputs. The alarm will report the new lines as run by no case until the rows add a `key` case over a pnpm install and an `accept` case for the former read, as 011-85's did (`tasks/011-85/design.md` 4.2). No format raise. *Inferred; the alarm was not run, as no candidate code exists.*

**011-158.** Planned row 011-158 changes `src/core/scheduler/keying.ts` and may raise the key format. None of the rows below edits `keying.ts`: the former read goes through `dependencyKeys` and `formerReadAsOne`, which it already calls (`keying.ts:251`). A raise empties every definition read as one: if 011-158 raises the format in the same release or before, R3 has nothing to read and is dropped. *Read in source code.*

## 7. Count (brief question 7)

Repository: cezar at `28be188dc`, 919 test files in 5 Vitest projects, pnpm 12.11.2. Each tree's closures come from Squeal's Vitest adapter over its own install (18 to 23 s per walk, load 22 to 29). Keys from the core's `dependencyKeys` with the prototype graph of `probes/pnpm-graph.mjs` in `InstalledDependencies.graph`. *Measured, `probes/measure-pnpm.mts`.*

| Pair (project files equal) | Packages apart | Kept today | Kept under the design |
| --- | --- | --- | --- |
| A against A | 0 | 919 | 919 |
| A against B: cezar's last lockfile change, `21e516ef5` (adds `@babel/parser` and `@babel/types` to `web`) | 5 | 0 | 328 (the 1 own-segment file that re-keys, `card-2-contrast.test.ts`, imports `@babel/parser`) |
| A against E: 16 application dependencies updated in range (`react`, `zod`, `hono`, …), Vitest's snapshot equal | 86 only in E, 177 only in A | 0 | 69 |
| A against C: `pnpm update -r`, Vitest 4.1.10 to 4.1.12 | 224 only in C, 325 only in A | 0 | 0 |

Per C11 case, the same in every pair:

| | `api-client` | `contract` | `e2e` | `server` | `web` | All |
| --- | --- | --- | --- | --- | --- | --- |
| Own segment | 2 | 16 | | 113 | 198 | 329 |
| Environment whole (its `globalSetup`, `packages/web/e2e/environment.ts`, imports `child_process`) | | | 84 | | | 84 |
| (1) `child_process`, `worker_threads` or `cluster` | | | | 422 | 13 | 435 |
| (1) `module`, or (2) or (3) (the adapter reports all three as `module`) | | | | 3 | 1 | 4 |
| (4) an opaque package | | | | 1 | 66 | 67 |
| (5) no packages reported | | | | | | 0 |

C11's npm figure, 265 of 632 kept on 2026-10-07 with 367 falling back, is the same measure on the same repository under npm. The suite has grown since, mostly in `server` files that spawn processes, so the share of files with their own segment fell from 42% to 36%. A file whose segment holds a bumped package re-keys, as it should; a change to Vitest's closure re-keys everything, under npm too.

## 8. Spec text drafts

**C3, environment hash bullet.** After "(tasks 001-104, 001-105, 001-109).", add:

> pnpm's installed `lock.yaml` stands for the install under C11's rule for it (task 011-162).

**C3, key format bullet.** After "A raise empties it with the list.", add:

> The pnpm key definition before task 011-162 is read the same way while `lock.yaml` stands for the install (C11): a lookup that misses also computes the key with that definition's whole fingerprint in the environment hash and no segment, at the current format, and copies the newest set found as for a format read as one. Every input of the current key is a function of `lock.yaml`, so such a row means what a row under the current key means. A raise empties it with the list.

**C11, installed dependencies bullet.** From "While npm's hidden lockfile is trusted, the environment hash holds only" to "While npm's hidden lockfile or pnpm's `lock.yaml` is trusted, the environment hash holds only". From "Each test file's key adds the sorted `location@version#integrity` set" to "Each test file's key adds the sorted set of identities (`location@version#integrity` for npm, `<snapshot id>#<integrity>` with its resolved edges for pnpm)". After the sentence that ends "then each parent directory, closed over `dependencies`, `optionalDependencies` and `peerDependencies`.", add:

> Under pnpm (task 011-162) a package entry Vite resolved, `node_modules/.pnpm/<folder>/node_modules/<name>/…`, is the snapshot whose folder pnpm names `<folder>` (`depPathToFilename` with `.modules.yaml`'s `virtualStoreDirMaxLength`); another name from such a folder resolves through that snapshot's edges, pnpm's private hoisting, then the root. A bare or required name resolves to the nearest importer at or above the importer's directory that declares it, at the root also to a name `.modules.yaml` hoists publicly; a `link:` version is a workspace. The closure follows each snapshot's `dependencies` and `optionalDependencies`, which hold its resolved peers; a skipped optional package keys by its identity and is not expanded or scanned. A folder no snapshot names keys the file by the whole fingerprint until the runner resolves it again. `lock.yaml` stands for the install while every snapshot `.modules.yaml` does not list as skipped has its package folder, no such folder and no entry of an importer's `node_modules` is newer than it, and each importer's `node_modules` holds only the names it declares and, at the root, those hoisted publicly; a `.pnpm` folder no snapshot names is an orphan pnpm keeps until `modules-cache-max-age` and is ignored. Otherwise the package folders are fingerprinted with one note, as for npm's hidden lockfile. The graph is read only for `nodeLinker: isolated` with the virtual store `.pnpm` inside the install and `lockfileVersion` 9, by a reader of pnpm's written layout; `nodeLinker: hoisted`, the global virtual store (whose packages lie outside the worktree) and any line the reader does not know keep the whole fingerprint.

**C11, formats.** From "for every other lockfile format (pnpm's `lock.yaml` and yarn's are not read for packages yet; pnpm's enters the fingerprint without a linked range, above)" to "for every other lockfile format (yarn's are not read for packages; pnpm's enters the whole fingerprint without a linked range, above, and is read for packages under the conditions above)".

**C11, the count.** After the sentence ending "(load 7 to 42; `tasks/001-105/notes.md`).", add:

> Under pnpm (cezar at `28be188dc`, pnpm 12.11.2, 919 files, task 011-162): 329 files can keep their own segment; 84 fall back through `e2e`'s opaque `globalSetup`, 439 through cases (1) to (3) and 67 through case (4). Across its last real lockfile change 328 keep their key, across 86 updated application packages 69, across an update that moves Vitest none; with the whole fingerprint, none in each.

## 9. Code rows, in order

The three rows are product code on the validity path, so they reach main in one candidate (`cand/<version>`), and no release carries R2 without R3 under Q6 (a). Type changes are additive: a `PackageGraph` interface (`identities`, `opaque`) that `InstalledGraph` and the new `PnpmGraph` implement, as `InstalledDependencies.graph`'s type, and an optional `former` list beside `DependencyKeys.former`.

### R1: pnpm's graph

- **Seam:** `src/core/keys/pnpm-lockfile.ts` (beside `withoutLinkedSpecifiers`): `readPnpmLockfile(text)`, the line reader of section 1.4 (`probes/lockread.mjs`), and `pnpmFolderName(id, max)`. A new `src/core/keys/pnpm-graph.ts`: `PnpmGraph` with `identities` and `opaque` (`probes/pnpm-graph.mjs`), reading `.modules.yaml`'s `skipped`, `hoistedDependencies` and `virtualStoreDirMaxLength`.
- **Owns:** those two files, `src/core/keys/packages.ts` (the `PackageGraph` interface), `src/core/keys/index.ts`; `test/keys/pnpm-graph.test.ts` (new), `test/keys/pnpm-lockfile.test.ts`.
- **Red first:** pnpm-graph, over a written install: a resolved entry, a sibling through an edge, a bare name from a nested directory, a publicly hoisted name, a `link:` workspace, an absent name, two peer variants with their own edges, an alias, a skipped optional child, and a folder no snapshot names, each to the identity of section 2; pnpm-lockfile, the reader equals a fixture's expected graph, and returns `null` for a line it does not know and for `lockfileVersion: '6.0'`; `pnpmFolderName` gives a cezar hashed name and a patched name.

### R2: trust and wiring

- **Seam:** `installedDependencies` (`src/core/keys/environment.ts:219`): for `PNPM_LOCKFILE`, read `.modules.yaml` and apply section 4's layout test and section 3's rule (`stalePnpmLockfile`, in `pnpm-lockfile.ts` or a new `pnpm-install.ts` beside `hidden-lockfile.ts`); a stale install hashes its package folders with the note; a trusted one returns a `PnpmGraph`. `dependencyKeys` is unchanged.
- **Owns:** `src/core/keys/environment.ts`, `src/core/keys/pnpm-install.ts` (new); `test/keys/pnpm-install.test.ts` (new), `test/keys/install.ts` (a `writePnpmInstall` helper); `test/keys/validity/case.ts`, `harness.ts` (a `key` input `packages`, the environment's and the test file's `RunnerPackages`, keyed through `dependencyKeys` when `installed` is given), `cases/key/installed.ts`, `cases/index.ts`.
- **Red first:** pnpm-install, in a pnpm fixture of two test files: a bump of the package one file imports re-keys that file only; each of C11's five fallback cases keys by the whole fingerprint; a missing `lock.yaml`, one that does not parse, `nodeLinker: hoisted` and an outside `virtualStoreDir` keep the whole fingerprint; a missing package folder, a newer one, an undeclared root entry and a retargeted importer link are stale with one note; an orphan folder stays trusted.
- **Validity:** `key` cases over a trusted pnpm install with packages (the segment), a stale one and a hoisted one. The alarm then names no case at format 20 (section 6).

### R3: today's pnpm definition read as one

- **Seam:** `InstalledDependencies` gains a second former input for a trusted pnpm install (today's whole fingerprint); `dependencyKeys` builds each former definition with its own graph (none for pnpm in either); `formerReadAsOne` (`src/core/keys/former.ts`) iterates the former definitions, each with the formats it was stored at (≤ 20 for the one before 011-85, 20 for today's pnpm one).
- **Owns:** `src/core/keys/dependencies.ts`, `former.ts`, `environment.ts` (shared with R2, same candidate); `test/scheduler/former-read.test.ts` (a pnpm case beside 011-90's); `test/keys/validity/harness/keyed.ts` (the closure's packages as an input), `cases/accept/former.ts`.
- **Red first:** former-read, "a pass stored under today's pnpm definition makes the file current under `lookup-only` after R2, with its provenance, and copies it to the new key"; a stale pnpm install reads no former row; the definition before 011-85 still keys whole for pnpm.
- **Validity:** an `accept` case whose release tree stores over a pnpm install at today's key and whose candidate finds it through the former read.

### Seams of other rows

011-158 owns `src/core/scheduler/keying.ts` and may raise the key format; no row here edits `keying.ts` (section 6). Shared files: `test/keys/validity/cases/index.ts` and `harness.ts`, where every row on the validity path adds its case; merges there are additions.

## Open questions

1. Should C11's note say which pnpm versions were measured (10.32.0, 12.11.2), since the folder rule is pnpm's and not a documented format? The trust rule's "missing" turns a changed rule into a stale install, never a wrong key (a renamed folder is missing).
2. cezar's `e2e` project keys 84 files by the whole fingerprint because its `globalSetup` reaches `child_process`. That is cezar's choice, as 011-85 Q6 left squeal's; not a Squeal change.
