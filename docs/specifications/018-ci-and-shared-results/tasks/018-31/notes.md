# 018-31 notes: status names a Node mismatch of shared results (D19)

Worker adeb251f, 2026-11-11. Spec 018 D19. Commit `442996680`.

## What status does

- `readImports` (`src/core/status/imports.ts`, `environmentOf`): an import whose environment differs gets `node: { exported, here, only }` when its export ran on another Node than this worktree's daemon. `only` is true when, for every differing project, the export would key as here with this worktree's Node: `nodeGap` (`import-environment.ts`) copies the local `nodeVersion`, and for node:test the local `nodeBuild` config field, into the exported descriptor and asks `importDifferences` (so D10's tolerated fields stay tolerated).
- `sharedOf(ref, imports, pin)` (`src/core/status/node-mismatch.ts`): nothing without `shared.ref`; `{ shared: { ref } }` when the newest import with a file here (imports are newest first) has no Node difference; else `shared.node` = needed Node, the daemon's Node, the pin state, the newest import's files with a differing environment, and the number of imports that differ only in Node. `pin` runs only in the last case, since 018-30's `pinnedNode` may start Node binaries.
- `nodeMismatchLines` (default status text, after D5's import line): one line, both versions and a reason with what to do, for `none`, `range`, `missing`, `session`, and `pinned` (the pin's version equals the daemon's Node: CI ran another version; it differs: the daemon started before the pin was installed, restart it).
- `importDefaultLines`: with `shared.ref` set, an import that differs only in Node gets no line of its own. An import that differs in Node and another part keeps its D5 line beside the Node line.

## Decisions the spec did not settle

1. The line follows the newest import only. Imports are never pruned, so after a CI Node change an older import would otherwise keep the line on. An older import on another Node is silent once the newest is on the daemon's Node.
2. "Only Node" uses D10's tolerance: Node plus `watch` or `coverage` counts as Node only, since those alone would not stop an imported pass.
3. The daemon's Node is the local descriptor's `nodeVersion` (the Node the daemon keys with), not the live process.
4. Restart advice is `squeal stop`, then `squeal start`.

## Type changes (additive, `src/core/types/status.ts`)

`ImportStatus.node?: ImportNode`; new `ImportNode`, `NodePin`, `NodeMismatch`, `SharedStatus`; `StatusSnapshot.shared?: SharedStatus`. Local type `PinnedNode` in `node-mismatch.ts` mirrors 018-30's agreed return type of `pinnedNode`.

## Wiring left for integration (agreed with the coordinator, 2026-11-11)

`src/core/node-pin.ts` (row 018-30) did not exist on this branch, so `snapshot.ts` does not call `sharedOf` yet. Apply this on top of 018-30. It was checked with a temporary stub `pinnedNode` (typecheck clean; a `readStatus` probe printed the Node line with `shared.ref` set and the old D5 line without it), then removed.

```diff
diff --git a/src/core/status/snapshot.ts b/src/core/status/snapshot.ts
index 342d85f22..fa962941d 100644
--- a/src/core/status/snapshot.ts
+++ b/src/core/status/snapshot.ts
@@ -5,6 +5,7 @@ import type { ShellSession } from "../delivery/code-since.js";
 import { resolveCommonDir, worktreeIdFor } from "../fs/git-layout.js";
 import { CLOSURE_METHOD } from "../keys/closure.js";
 import { testFileId } from "../keys/reverse-index.js";
+import { pinnedNode } from "../node-pin.js";
 import { readDaemonNotes } from "../notes.js";
 import { readPresence } from "../presence/decide.js";
 import { statusView } from "../presence/views.js";
@@ -44,6 +45,7 @@ import { statusIdentity } from "./identity.js";
 import { ignoredConfigOf, liveDaemonVersion } from "./ignored-config.js";
 import { readImports } from "./imports.js";
 import { lintStatusOf } from "./lint-status.js";
+import { sharedOf } from "./node-mismatch.js";
 import { type StatusStoreOptions, unavailable, withStatusStore } from "./open.js";
 import { openRuns } from "./open-runs.js";
 import { outstandingOf } from "./outstanding.js";
@@ -189,7 +191,7 @@ function snapshot(
     knownFailures,
     knownFailureCounts: knownFailureCounts(knownFailures),
     inherited: inheritedSources(store, states),
-    ...importsOf(store, worktreeId, keys, states),
+    ...importsOf(store, worktreeId, keys, states, at),
     breakdown: breakdown(states, keys, held),
     closureMethod: CLOSURE_METHOD,
     storeSchemaVersion: store.schemaVersion,
@@ -265,15 +267,22 @@ function openCheckpoint(
   return { checkpoint: { ...rest, owed: false } };
 }
 
-/** Spec 018 D5: the imports with a test file this worktree lists; nothing when none has. */
+/**
+ * Spec 018 D5: the imports with a test file this worktree lists; nothing
+ * when none has. D19: with `shared.ref` set, the Node the newest one needs.
+ */
 function importsOf(
   store: Store,
   worktreeId: WorktreeId,
   keys: readonly TestFileKeyRecord[],
   states: readonly KnownState[],
-): Pick<StatusSnapshot, "imports"> {
+  root: AbsolutePath,
+): Pick<StatusSnapshot, "imports" | "shared"> {
   const imports = readImports(store, worktreeId, keys, states);
-  return imports.length === 0 ? {} : { imports };
+  return {
+    ...(imports.length === 0 ? {} : { imports }),
+    ...sharedOf(readPolicy(root).shared.ref, imports, () => pinnedNode(root)),
+  };
 }
 
 /** Current inherited results grouped by source worktree and commit, largest group first. */
```
