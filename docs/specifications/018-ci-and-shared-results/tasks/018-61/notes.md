# 018-61 notes: a limit on `ci record`'s endpoint hashing

Review `reviews/0.1.582.md` S1; spec D30, D20.2. Code: `src/core/ci/endpoints.ts` (`limited`, `HASHING_LIMIT`), its call in `src/cli/ci.ts`.

## The rule, in D30's terms

Each end of the endpoint hashing (before the command, after it) has its own time limit. An end begins when `ci record` asks for it: before the command, that includes reading `HEAD` and the one `git ls-tree`.

- **Measured rate.** The paths of the commit's tree the end has hashed, divided by the time since its hashing of paths began, at the moment the last of them finished.
- **Projected time.** The time the end takes for all its paths at the measured rate.
- **Limit.** `max(10 s, 4 × projected time)`. The rate counts once as many paths as are read at once (64, `FILE_CONCURRENCY`), or all of them, are hashed. Before that, the 10 s floor alone holds.
- **Past the limit.** The end reads no further path, and a read already started is left to end on its own. `ci record` starts the command (before) or writes the parts (after) without `stable` and `unstable`, so the export keeps D9's rule alone (D32). It prints one note: `no endpoint hashes: hashing the checkout passed its limit of <s> s (<hashed> of <total> paths)`. The command's exit code decides the step, as for any other Squeal failure (D20.2).

A stalled read stops the count of hashed paths. The projection then stops growing, so the limit does too. A hashing that is slow but keeps finishing paths keeps its projection, and finishes inside 4 × that time.

Why these numbers: D30 measured about 1 s per end for cezar's 4,967 tracked files (24 MB), and row 018-57 2.7 s on a developer checkout. The floor is ten times cezar's time and far inside any CI step's timeout. The multiple leaves room for files read cache-cold after the rate was measured on cached ones. Neither number is tuned to this host: the limit grows with the checkout's size and the machine's read speed, through the measured rate.

## Decisions the brief did not settle

- The two ends use the same rule. The end after the command does not reuse the time of the end before it: a command can leave the cache cold, and the measured rate already covers that end's own reads.
- Listing paths are now read with the asynchronous `readdir`, with `listingHash`'s rule (names hash, `ABSENT_LISTING` when it fails). A synchronous `readdirSync` that stalls would block the timer, and the limit would not hold. `.git`'s kind is still one `statSync`.
- An end past its limit records no `endpointsMs` in the cost, as when `HEAD` moved: the cost line counts only hashing that gave fields.
- The note is printed once, with the other notes after the command, as the existing "no endpoint hashes" note is.

## What remains

- A read that the operating system never ends (for example a hard-mounted network file system that hangs) still holds a request in Node's thread pool. The command starts and the parts are written, but the `squeal` process can stay alive after that until the read ends. Ending it needs a `process.exit` in the CLI entry (`src/cli/index.ts`), outside this row's files. The review's injected delay ends after 5 s, so it does not hit this.
- Four such reads take all four threads of Node's default thread pool. Later asynchronous file reads in the `squeal` process then wait too. Writing the parts uses synchronous calls, which do not use the pool.
