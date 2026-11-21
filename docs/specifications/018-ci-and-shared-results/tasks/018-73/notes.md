# 018-73 notes: repair of review 0.1.587 (B1, S1)

Brief: `tasks/wave-24.md`, "## 018-73". Review: `reviews/0.1.587.md`.

## B1: a query on an aliased specifier

What tsx 4.23.15 does (`node_modules/tsx/dist/register-*.mjs`, `require-*.mjs`, minified):

- ESM `resolve`: `getSpecifierMetadataIndex(specifier, isCommonJsRequireContext)`. For a `require` context, or a specifier that is neither a file path (`isFilePath`: relative or absolute) nor URL-like (`node:`, `file:`, `data:`, `scheme://`), it cuts at the first `?`. Otherwise it cuts at the first `?` or `#`. Alias matching (`resolveTsPaths`) then reads the cut specifier. A `data:` URL is handled before the cut and stays whole.
- CJS `require` (`preserveQuery`): `request.split("?")`, then `resolveTsPaths` on the first part.
- So `@dep#frag` keeps its `#frag` (the review's control: tsx rejects it), and `#dep?q=1` resolves `#dep` through the package's `imports`.

The graph: `tsxSpecifier(specifier, kind)` in `graph/tsconfig.ts` does that cut. `resolveFrom` in `graph/resolver.ts` applies it under tsx rules only, before `targetOf` (alias candidates, `isBuiltin`, the plain resolution) and `pairOf`. Under Node's own rules nothing changes. The resolution cache keeps the full specifier as its key.

Tests, each failing on the candidate `0aa4a7f91` and passing at `bf2d96d6d` (`test/runners/node-test/graph-differential.test.ts`, group `QUERY`, real `node --import tsx --test` runs):

- "B1: an exact alias with a `?query`": the review's project.
- "B1: a wildcard alias with a suffix, and a `?query` after it": `"@lib/*.js": ["./lib/*.ts"]`, `@lib/dep.js?q=1`. A wildcard without a suffix (`~/*` → `./*`) already passed on the candidate: enhanced-resolve takes the query off the absolute candidate. Only a suffix after the `*` failed, since `endsWith(".js")` saw `.js?q=1`.
- "B1: a CommonJS require of an exact alias with a `?query`".
- "a package import with a `?query`": the review's `#dep?q=1` limit, now closed.

`graph-observed.ts` change: tsx's CJS loader names a module required as `@dep?q=1` by the path `dep.cjs?q=1` (`preserveQuery` appends the query), and reads `dep.cjs`. The observer now maps a path with `?` that names no file to the path before the `?`.

Unit cases of the cut: `graph-tsconfig.test.ts`, "matches the specifier tsx cuts at its query".

### Key format

The validity case "a tsx project's keys follow what tsx loads (row 018-66)" now also puts a query on its alias import (`~/y?alias`), so the new cut runs on a bare specifier there; its relative `?case` import ran the cut before. `test/keys/key-format.test.ts`: 12 of 12 pass, before and after that edit. No `NODE_TEST_ADAPTER_VERSION` raise is asked. The case's wildcard alias without suffix resolved on the candidate too, so it shows the cut runs, not the B1 key move; the differential pins B1.

## S1: the hashing child's git

`src/core/ci/endpoints-child.ts`: the child starts with `detached: true` (not on Windows), so it leads its own process group, and its `git ls-tree` joins that group.

- Past the limit, `abandon` kills the group (`process.kill(-pid, "SIGKILL")`), then the child as before.
- A child that exits without a result has its group ended too, on POSIX (a crash with a git still running).
- In the child, `disconnect` (the parent is gone) ends its own group, then exits. A detached child no longer gets the terminal's Ctrl-C with `ci record`; the disconnect covers that.
- Windows has no groups: `taskkill /PID <pid> /T /F` ends the child's tree, in the parent past the limit and in the child on disconnect. Not run here: no Windows host.

Tests, `test/ci/record-exit.test.ts`, "ci record leaves no git behind (row 018-73)", skipped on Windows. A `git` first on PATH runs the real git except for `ls-tree`, which execs a Node process that writes its pid and never ends.

- "ends the hashing child's git past the limit, with the command's code": floor 3 s, exit code 1 (the failing node:test test), the limit note, no `stable` in the part, and the git pid gone (a zombie counts as gone) within 3 s.
- "ends the hashing child's git when ci record itself is killed": floor 60 s, SIGKILL to `ci record` once git runs, git gone within 5 s.

Both failed on the candidate with "git <pid> outlived ci record"; each kills a leftover git itself, so a red run leaves nothing.

## Left

- A git stuck in an uninterruptible read (`D` state) dies only when the read ends; SIGKILL is queued, nothing waits for it.
- D30's text ("in its own process", "starts no other program") is the coordinator's to align (review, "Existing limits").
- The review's other limits stay: `extends` of a package whose manifest names `tsconfig`, and the npm root bin's runtime-asset lookup.
