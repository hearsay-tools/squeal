# 015-22 `squeal code` marks a count that is behind the file: notes

Worker cc6ad3e2, 2026-10-24. Brief: `tasks/wave-1b.md` W3. Commit `a5aafa41e`.

## What changed

- `src/cli/code-report.ts`: `readCodeReport` takes an optional `root`. With paths, each selected file's bytes are hashed (`blobHash`, the format read from the stored blob's length) and compared with the files row's blob and with the blob of each of its states. A file that differs is `pending`: its functions are not listed, and it is in `files` with `reason: "pending"`, `size` (the bytes now) and `revision` (the revision its stored count is of).
- `src/cli/code.ts`: the text line is `  <path>: pending: changed since revision N, not counted yet`. When a file is pending and the daemon's heartbeat is fresh, the command asks the daemon to sync (`syncDaemon`, as `squeal status <path>` does) and reads the stores every 50 ms for up to `STATUS_WAIT_SETTLE_MS` (750 ms). Without a live daemon it answers at once and stays synchronous, so `main(["code", ...])` still returns a number there.
- `test/code/delivery/code-pending.test.ts`: five tests.

## Seams found

- The pass writes the files row with the new blob first, then the count, then the states in a last transaction (`src/core/code/pass/pass.ts`, `runPass`). A read between them joined the new count's CC to the old state's outcome (the red output of the window test showed `complexity: 3` with the old state). Comparing the states' blobs too closes that window.
- A stored blob is the git blob id in the repository's object format (`pass/blobs.ts`, `countOne`), so its length names the format; no `git rev-parse` is needed, and the command stays synchronous.
- The sibling tests that call `squeal code` (`code-command.test.ts`, `code-errors.test.ts`, `move-history.test.ts`) store fake blobs for files not on disk. A file not on disk is not compared, so they are unchanged.

## Measured against this worktree's daemon

At load 37 to 49, with the daemon running tests for the same edits, the pass stored an edit 3.3 to 6.1 s after it (three runs, two with the sync request and one without; no clear difference). So on this host the 750 ms wait ends with the pending mark more often than with the new count. The mark is what fixes P4.

## Left for others

- `plugins/claude-code/skills/squeal/references/commands.md` lists `files` reasons as "too big, not parsed, or not counted yet"; it should add "pending, changed since it was counted". `src/cli/main.ts`'s help for `squeal code` can say the same. Neither file is this row's.
- Without paths, `squeal code` still lists failing functions from the stored states without a comparison (the brief names `<path>` only).
- A new file the agent just created and the pass has not seen has no files row, so `squeal code <it>` reads `0 functions` with no pending mark.
