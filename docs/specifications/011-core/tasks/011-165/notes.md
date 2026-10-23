# 011-165 to 011-167: per-package keys from pnpm's installed `lock.yaml` (notes)

Rows R1 to R3 of the accepted 011-162 design (`../011-162/design.md`, section 9), against the brief `../011-162/code-brief.md`. The three rows are on the validity path and reach main in one candidate. R1's commit alone fails `test/keys/key-format.test.ts`: its changed lines run in no case until R2's cases land. This is expected in one candidate.

## 1. What landed

| Commit | Row | Change |
|---|---|---|
| `2495af3dd` | 011-165 (R1) | `readPnpmLockfile` and `pnpmFolderName` in `pnpm-lockfile.ts`; `PnpmGraph` in the new `pnpm-graph.ts`; the `PackageGraph` interface in `packages.ts`, which `InstalledGraph` implements. |
| `e1c257b91` | 011-166 (R2) | `readPnpmInstall` and `stalePnpmLockfile` in the new `pnpm-install.ts`; `installedDependencies` reads a pnpm install, trusts it or fingerprints its package folders with one note; six `key` validity cases (`PNPM_KEYS`). |
| `2b144e3c1` | 011-167 (R3) | `InstalledDependencies.formerPnpm` and `DependencyKeys.formerPnpm`; `formerReadAsOne` reads today's pnpm definition at the current format while it is 20 or less; the `accept` case "a pass stored over a trusted pnpm install". |
| `0515896e5` | 011-166 (R2) | The stale fallback also walks each workspace importer's `node_modules`, so a retargeted workspace link re-keys. |

Files outside section 9's lists: `test/keys/former.test.ts` and `test/keys/former-raise.test.ts` (the tests of `former.ts` and `dependencies.ts`, which R3 owns), and one line in `test/keys/validity/harness/accept.ts` that passes `input.packages` to `keyedOver`. The `accept` case of R3 needs that line. No other file under `src/` changed.

## 2. Check on real data (cezar)

`cezar-check.sh` and `measure-real.mts` in this folder: `../011-162/probes/measure-pnpm.mts` with the real `installedDependencies` and `dependencyKeys` in place of the prototype. Two `git clone`s of cezar at `28be188dc` under `/tmp/p165`. B is installed from `21e516ef5^`'s `pnpm-lock.yaml` and `packages/web/package.json`, then its project files are restored to HEAD. Isolation as the 011-162 brief says: scratch `HOME`, `TMPDIR` and `XDG_*`; the pnpm store under `/tmp`; `--ignore-scripts`; no daemon; nothing under `evals/bin/`. The clones were removed afterwards. pnpm 12.11.2; the two `lock.yaml` files are 36 lines apart. Raw output: `output.txt`.

| Pair | Files | Trusted (no note) | Own segment | Kept, today | Kept, code | Own segment kept | Re-keyed own segment | Today's key readable as one |
|---|---|---|---|---|---|---|---|---|
| A against B (`21e516ef5`) | 919 | both | 329, 329 | 0 | 328 | 328 | `web:packages/web/src/test/card-2-contrast.test.ts` | 919, 919 |
| A against A | 919 | both | 329, 329 | 919 | 919 | 329 | none | 919, 919 |

No difference from the design: 329 files with their own segment and 328 kept, and the one re-keyed file is the same (`card-2-contrast.test.ts` imports `@babel/parser`, which `21e516ef5` adds). R3 holds on real data: in each tree, every file's key under today's definition is either its key under the code or the `formerPnpm` key a lookup reads as one.

Times, in ms, with the one-minute load: the walks took 22,854 to 26,877 at load 41.7 to 54.2. Reading the install (`installedDependencies`) took 23 to 126. Keying all 919 files took 431 to 1,490, and the first keying in a process includes the package scans. The prototype took 157 to 243 to read and 666 to 2,389 to key (load 21.8 to 24.9, `../011-162/probes/output.txt`).

## 3. C11 and C3 against the code

No sentence of C11 or C3 is wrong. Four details are missing. Proposed text:

1. **A snapshot without an integrity.** C11 says a key holds `<snapshot id>#<integrity>` but does not say what happens when `packages` gives no integrity: a tarball, a git or a `file:` resolution. The code keys the file by the whole fingerprint, as for a folder no snapshot names. Proposed, after "A folder no snapshot names keys the file by the whole fingerprint until the runner resolves it again.": "So does a snapshot whose `packages` entry has no `integrity` (a tarball, git or `file:` resolution), since no identity names its content."
2. **Dot entries in the trust rule.** The code leaves dot entries (`.bin`, `.pnpm`, `.modules.yaml`) out of "each importer's `node_modules` holds only the names it declares". Proposed: "each importer's `node_modules` holds only the names it declares and, at the root, those hoisted publicly, dot entries left out".
3. **The stale fallback's walk.** "Otherwise the package folders are fingerprinted with one note, as for npm's hidden lockfile." Under pnpm the walk is wider than npm's hierarchy. Proposed addition: "under pnpm, every entry of each importer's `node_modules`, of `.pnpm/node_modules` (the private hoisting) and of each `.pnpm/<folder>/node_modules`, a folder by its path and its `package.json` name and version, a link by its path and target, unread."
4. **The file list.** C11's first paragraph names the code files. Proposed: add `pnpm-lockfile.ts`, `pnpm-graph.ts` and `pnpm-install.ts` beside `hidden-lockfile.ts`.

Case (4) says each package is scanned "once per installed version (`location@version#integrity`)". Under pnpm, a package is scanned once per identity (`<snapshot id>#<integrity>` and its edges). Each peer variant and each patched variant has its own `.pnpm` folder, so "once per installed version" stays true. Section 4 here records the difference from the design.

## 4. Decisions the design did not settle

- **Scan id.** A package is scanned for opaque code once per identity, with its edges, not once per `<id>#<integrity>`. The types-only scan uses `<id>#<integrity>` since the repair. Peer variants share an id prefix but lie in different folders, so they scan separately. That costs one scan for each extra variant. It never shares one result between two folders.
- **Skipped marker.** A skipped optional package keys as `skipped:<id>#<integrity>`, without edges. It is not expanded or scanned, and it does not make the file opaque.
- **No integrity.** A snapshot without an integrity keys as `nointegrity:<id>` and is opaque (section 3, item 1). The other choice, `<id>` alone, would let a re-published tarball at the same URL keep the key.
- **Format of the pnpm former.** `formerReadAsOne` reads today's pnpm definition at the current format while `KEY_FORMAT_VERSION` is `FORMER_LAST_FORMAT` (20) or less. The validity bundles pin the format to 0, so the condition is `<=`, not `=== 20`; with `=== 20`, the `accept` case found nothing in the candidate. A raise to 21 reads nothing (`former-raise.test.ts`).
- **An equal former.** `DependencyKeys.formerPnpm` is left out when its environment hash equals the current one: the file then keys whole under both definitions, and the lookup at its own key already reads the row.
- **The order of the former reads.** 011-85's former entries come first, then today's pnpm one. When pnpm is read, 011-85's former is computed without a graph (its definition hashed `lock.yaml` whole).
- **`.modules.yaml` as JSON.** pnpm 10 and 12 write JSON. A file that does not parse as JSON keeps the whole fingerprint without a note, as an unknown layout does.
- **Not in the trust rule.** An entry of `.pnpm/node_modules` (the private hoisting) that `.modules.yaml` does not list is not in the trust rule, as the design says. Since review 0.1.282 B2, each listed private hoist must exist. The folder is in the stale fallback's walk.
- **File size.** `environment.ts` is 335 lines. It was 316 before these rows, and the styleguide's limit is about 300. The pnpm read is in `pnpm-install.ts`; `environment.ts` only selects it. A split of `installedDependencies` is left for a quality scan.

## 5. Type changes (all additive)

- `PackageGraph` (`identities`, `opaque`), exported from `src/core/keys/index.ts`. `InstalledGraph` and `PnpmGraph` implement it.
- `InstalledDependencies.graph: PackageGraph | null` (was `InstalledGraph | null`).
- `InstalledDependencies.formerPnpm?: string | null` and `DependencyKeys.formerPnpm?: DependencyKeys | null`.
- New: `PnpmLockfile`, `PnpmGraph`, `PnpmInstall`.
- Tests: `KeyInput.packages` and `AcceptInput.packages` (`test/keys/validity/case.ts`); `keyedOver`'s fourth parameter `packages`.

## 6. Seam map for whoever continues

- `installedDependencies` (`src/core/keys/environment.ts`) decides per lockfile format. For pnpm, `readPnpmInstall` (`pnpm-install.ts`) returns `null` (layout or reader unknown: whole fingerprint, no note), a trusted graph, or a stale note with the folders' fingerprint.
- `readPnpmLockfile` is strict on purpose. Every line it does not know returns `null`, so a format change in pnpm keeps the whole fingerprint and never gives a wrong key. Its tests (`test/keys/pnpm-lockfile.test.ts`) list the null cases.
- `pnpmFolderName` copies pnpm's `depPathToFilename`. A changed rule makes the install stale ("missing"), never a wrong key. The tests pin two real cezar hashed names.
- `dependencyKeys` (`dependencies.ts`) builds the current keys, `formerPnpm` (no graph, today's whole fingerprint) and 011-85's `former`. `formerReadAsOne` (`former.ts`) turns them into the keys a missed lookup reads.
- Test helpers: `writePnpmInstall` and `pnpmLockfileText` (`test/keys/install.ts`) write an install on disk; no test runs pnpm.
- Open: the design's open question 1, which pnpm versions to name. This check used 12.11.2 only.

## Repair (review 0.1.282)

The first-round review of `cand/0.1.282` (reviewer 12ae2958) found two blockers and one should-fix. Each fix was red first; one commit per item.

| Commit | Item | Change |
|---|---|---|
| `b202788c7` | B1 | The reader passes over only the keys pnpm writes. It returns `null` for a part it reads (`importers`, `packages`, `snapshots`) written on its header line, for any other key at any level, for a block `resolution`, for a package written as a flow map, and for a file without the root importer `.`. Known metadata stays explicit in `UNREAD`, taken from pnpm 10.32.0's `convertToLockfileFile`; every key pnpm 12.11.2 wrote for cezar is in it. A `key` case covers the flow layout. |
| `adef063a0` | B2 | Every link a lookup resolves through must exist, unless it names a skipped package: each declared name, each hoisted name (public and private) and each edge beside a package folder. A missing one makes the install stale with the one note ("missing: …"), so no `formerPnpm` is offered. The validity fixtures write these links as folders, because `writeTree` writes no symlinks. A `key` case covers a missing declared link. |
| `17c60b3d5` | S1 | A types-only package keys as `<name>@types-only`, without its version, and a parent's edge list writes such a child the same way. An import of the package's `package.json` still keys its version. |

### The reviewer's probe after the fix

The fingerprints and keys are shortened to `…`.

```
FLOW_IMPORTERS {"results":[{"trusted":false,…,"former":false,"readerReturnedNull":true,"loaded":"a@1.0.0"},{"trusted":false,…,"former":false,"readerReturnedNull":true,"loaded":"a@2.0.0"}],"equalKeys":false,"equalFingerprints":false}
MISSING_IMPORTER_LINK {"before":{"trusted":true,…,"former":true,"loaded":"a@1.0.0"},"after":{"trusted":false,…,"former":false,"loaded":"a@2.0.0"},"equalKeys":false}
TYPES_ONLY {"results":[{"trusted":true,…,"former":true},{"trusted":true,…,"former":true}],"equalKeys":true}
MISSING_LINK_BUMP {"results":[{"trusted":false,…,"former":false,"loaded":"a@2.0.0"},{"trusted":false,…,"former":false,"loaded":"a@3.0.0"}],"equalKeys":false,"equalFingerprints":false}
```

### Cezar again, and the cost of B2

`cezar-check.sh` was run again on fresh clones with all three fixes (raw output: `output-282.txt`; the clones were removed). The results are the same as in section 2. Both installs are trusted with no note. 329 files keep their own segment and 328 keep their key across `21e516ef5`. The one re-keyed file is `card-2-contrast.test.ts`, and 919 of 919 keys are readable as one. So pnpm 12.11.2 creates every link that B2 now requires.

`time-trust.mts` times the trust check over 30 runs. The first run on the clone failed because of an argument-order error in my `env` command, and was run again; `output-282.txt` leaves the failed line out.

| Install | Snapshots | Added `lstat` calls | Trust check, median | Added calls, median | Load (1 min) |
|---|---|---|---|---|---|
| Synthetic (640 snapshots, 1,600 edges, 540 private hoists) | 640 | 2,140 | 16.6 ms | 11.3 ms | 28.9 |
| cezar at `28be188dc` (1,605 edges, 537 private hoists, 85 skipped) | 638 | 2,050 | 19.8 ms | 13.9 ms | 39.2 |

The trust check runs whenever `installedDependencies` reads the install, not per test file.

### C11 sentences these change (proposed)

1. **The trust rule.** Replace "`lock.yaml` stands for the install while every snapshot `.modules.yaml` does not list as skipped has its package folder, no such folder and no entry of an importer's `node_modules` is newer than it, and each importer's `node_modules` holds only the names it declares and, at the root, those hoisted publicly; …" with: "`lock.yaml` stands for the install while every snapshot `.modules.yaml` does not list as skipped has its package folder; every link a lookup resolves through exists unless it names a skipped package (each name an importer declares, each name `.modules.yaml` hoists, publicly at the root or privately in `.pnpm/node_modules`, and each edge beside a package folder), since Node walks past a missing link to another copy; no package folder and no entry of an importer's `node_modules` is newer than it; and each importer's `node_modules` holds only the names it declares and, at the root, those hoisted publicly, dot entries left out; …". This replaces section 3, item 2.
2. **The reader.** After "by a reader of pnpm's written layout", add: "which knows the keys pnpm writes (pnpm 10.32.0's `convertToLockfileFile`, and every key pnpm 12.11.2 wrote for cezar) and passes over the metadata among them unread". Change "and any line the reader does not know" to "and any line the reader does not know, a part it reads written on its header line, or a file without the root importer `.`".
3. **The types-only identity under pnpm.** In "Each test file's key adds the sorted set of identities (`location@version#integrity` for npm, `<snapshot id>#<integrity>` with its resolved edges for pnpm)", change the pnpm part to "`<snapshot id>#<integrity>` with its resolved edges for pnpm, a types-only child's written `<name>@types-only`". After "keys as a constant and is not expanded", add "(under pnpm `<name>@types-only`, without its version)".

### Decisions in the repair

- **A value on a part's header line.** Even `{}` returns null. pnpm 10 deletes an empty `packages` or `snapshots` and never writes a value there.
- **The root importer.** A file without `.` returns null. pnpm always writes the root importer. Without it, the trust rule would never list the root `node_modules`.
- **Private hoists.** They are in B2 as well as the public ones. The review named only the public hoists and the edges. A missing private hoist also sends Node from a package folder to the root.
- **Edge links.** The rule checks only that they exist, not that they are older than `lock.yaml`. A retargeted edge link that keeps its name is not caught. This is not measured on real pnpm, so I left it out.
- **The skipped-entry fixture.** `writePnpmInstall` no longer links a skipped package that an importer declares, as pnpm does not.
- **The types-only constant.** It is per name, so two types-only versions of one name in a closure count once. The types-only scan id is now `<id>#<integrity>`, because a package's own files do not depend on its edges. The opaque scan keeps its id, edges included.
- **The validity fixtures.** They write the required links as folders with a `package.json`. The rule needs only that the entry exists.
