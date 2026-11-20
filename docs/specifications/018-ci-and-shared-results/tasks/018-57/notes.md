# Row 018-57 notes: endpoint hashes and touched paths (part format 6)

## What a format 6 part holds

- `stable`, `unstable`: written only when `ci record` hashed the checkout at both ends. Both absent: not hashed (no commit, `HEAD` moved during the command, or hashing threw; `ci record` says `no endpoint hashes: <why>`). A hashed part holds both, `{}` and `[]` when empty.
- Hashed paths: every path `HEAD`'s tree holds, each blob (file or symlink) and the listing path of each directory it holds (`./` among them), also when gone from the disk (a deleted tracked file: `null`; an emptied directory: `ABSENT_LISTING`). Paths the commit does not hold are not hashed: D33.3 never certifies them. This narrows D30's "every path git does not ignore"; the coordinator accepted it.
- `stable`: equal at both ends and other than `atCommit` (the commit's blob; a listing's names in the commit's tree). The root listing is always there in a real checkout: `.git` is on the disk, never in a tree. `unstable`: the two ends differ (D32 amended for it).
- `touched`: in every format 6 part, `[]` when empty. Entries are the hooks' own: file paths and listing paths (`dir/`, `./`) a process wrote or read with two contents, bare paths of removed trees (everything below touched), `"all"` when a child or Worker withheld (`""` tree). A single withheld test file (`evidence.withhold(file)`) gives that file's path, not `"all"`.
- `header.cost.endpointsMs`: both ends summed. `afterMs` excludes the second hashing (the command's end is taken after it).

## Seams

- `src/core/ci/inputs.ts`: `atCommit` / `committedInputs` (one `git ls-tree -r -z --full-tree`), `readRecorded` returns `Recorded` with `touched`.
- `src/core/ci/endpoints.ts`: `endpointsBefore`, `endpointsAfter`.
- `src/cli/ci.ts` `record`: hashes before `runCommand` and right after it; errors become notes, never a failed command.
- `src/cli/ci-parts.ts` `writeParts(…, CommandRecord)`: writes the fields into every part of the command.
- `src/core/ci/cost.ts`: `CostSummary.endpointsMs` (optional) and the cost line's "; N s hashing the checkout before and after it", which `ci export` prints too.

## Measurement (open question 1)

Read-only on a local cezar checkout at `c11e4edf0` (a developer checkout with `node_modules`, not a CI shard), this host (24 vCPUs), load average 52 to 57, 2026-11-20 21:31Z. Script: `node --import tsx measure.ts <worktree> <checkout>` calling `committedInputs`, `hereOf` and the endpoints functions (kept in the task's scratch, not committed).

| What | Result |
|---|---|
| Paths hashed | 4,714 files, 215 listings |
| `git ls-tree` | 87 ms |
| Files, one end (3 runs) | 1,041, 826, 1,234 ms |
| Listings, one end (3 runs) | 6, 10, 15 ms |
| Both ends through `endpointsBefore`/`endpointsAfter` | 2,746 ms |
| `stable` entries | 9, all listings (directories holding ignored names) |
| `unstable` entries | 0 |
| Added part size (`stable`, `unstable`, empty `touched`) | 557 bytes |

The listing hashes cost about 1% of the file hashes. The part grows by about half a kilobyte per part on a clean checkout; each modified tracked file adds about 60 bytes. A shard whose processes write tracked paths adds one entry per path to `touched`.
