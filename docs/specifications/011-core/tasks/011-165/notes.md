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

- **Scan id.** A package is scanned once per identity, with its edges, not once per `<id>#<integrity>`. Peer variants share an id prefix but lie in different folders, so they scan separately. That costs one scan for each extra variant. It never shares one result between two folders.
- **Skipped marker.** A skipped optional package keys as `skipped:<id>#<integrity>`, without edges. It is not expanded or scanned, and it does not make the file opaque.
- **No integrity.** A snapshot without an integrity keys as `nointegrity:<id>` and is opaque (section 3, item 1). The other choice, `<id>` alone, would let a re-published tarball at the same URL keep the key.
- **Format of the pnpm former.** `formerReadAsOne` reads today's pnpm definition at the current format while `KEY_FORMAT_VERSION` is `FORMER_LAST_FORMAT` (20) or less. The validity bundles pin the format to 0, so the condition is `<=`, not `=== 20`; with `=== 20`, the `accept` case found nothing in the candidate. A raise to 21 reads nothing (`former-raise.test.ts`).
- **An equal former.** `DependencyKeys.formerPnpm` is left out when its environment hash equals the current one: the file then keys whole under both definitions, and the lookup at its own key already reads the row.
- **The order of the former reads.** 011-85's former entries come first, then today's pnpm one. When pnpm is read, 011-85's former is computed without a graph (its definition hashed `lock.yaml` whole).
- **`.modules.yaml` as JSON.** pnpm 10 and 12 write JSON. A file that does not parse as JSON keeps the whole fingerprint without a note, as an unknown layout does.
- **Not in the trust rule.** `.pnpm/node_modules`, the private hoisting, is not in the trust rule, as the design says. It is in the stale fallback's walk.
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
