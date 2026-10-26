# 011-257 notes: the 001-401 S1 case waits on the lowering's looks

Row 011-257 (`tasks/wave-55.md` W2). Worker run `e8fa9919`, 2026-10-26. Test only: `test/daemon/low-priority.test.ts` and the new `test/daemon/low-priority-helpers.ts`.

## What changed

The S1 case ("lowers a carrier its parent left in the daemon's group before a look found it") polled at most 3 s for the carrier's priority. Now it gives `lowerWhile` a watched `carriers` seam (`watched` in the helpers file) and waits on the lowering's own looks:

- It stops waiting at the start of a look once the carrier is at `nice` 10.
- If the carrier is not lowered, it waits for the second look that started at least one scan interval (`SCAN_EVERY_MS`, 1 s, the same as `ORPHANS_EVERY_MS` in `src/core/daemon/escaped.ts`) after the carrier's shell exited. A scan needs two things: a child of the leader was reaped since the last scan, and 1 s has passed since the last scan. The first look in that window meets both, unless a scan has run since the reap, and that scan also saw the carrier. That look returns before the next look starts, and `lowerWhile` lowers what it found in between. So, when the second look starts, a scan that saw the carrier has run and its result is applied.
- If `lowerWhile` settles, the wait also ends.
- On failure, the message says if any look returned the carrier: `a look returned it: false` means no scan returned it.

Load does not shorten the wait: the wait counts the product's looks, not milliseconds. The case timeout is 15 s, as for the file's other long cases, so that a stopped loop fails the case.

The second commit moves `LEADER`, `leaderGroup`, `SCAN_EVERY_MS` and `watched` to `low-priority-helpers.ts` with no other change. Without the move the test file has 368 lines; with it, 291.

## Why the 3 s bound was probably not the CI failure's cause

CI 40389788561 attempt 1 (Node 22, shard 2, cand/0.1.355) failed at the first carrier (`low-priority.test.ts:267`), `expected +0 to be 10`, after 3,708 ms. In that run the other cases of the file took the same time as on this host at low load:

| case | CI attempt 1 | here, load 2.97 / 24 CPUs |
| --- | --- | --- |
| short fork | 914 ms | 961 ms |
| 001-437 child still being forked | 7,039 ms | 7,037 ms |
| 001-437 once a second | 2,018 ms | 2,017 ms |
| wave-18 B1 (ran next) | 1,643 ms | 1,608 ms |
| wave-13bt S1 | 1,653 ms | 1,680 ms |

The old poll counted `waited += 50` per 50 ms sleep, in the same event loop as the looks. A 3.7 s case with a 3 s poll therefore ran at nominal speed. At that speed, a scan after the shell's exit runs at the latest about 1.1 s after the lowering starts. So in the failed run, at least one scan after the reap ran, and it did not return the carrier. With a longer bound, that run would still have failed, only later.

Causes ruled out from the code:

- A throw that ends the loop: `childrenOf`, `statOf` and `lowerProcess` catch their errors.
- The sleeper read as one of the group's strangers: `strangersOf` lists `/proc` (`readdirSync`) synchronously in the constructor, before the sleeper exists.
- An unchanged reap count: the leader's `cminflt` grows when it reaps the shell.

## The likely cause: a product race in the group scan's mark cache (not fixed here)

`#scanOrphans` (`src/core/daemon/escaped.ts`) reads each new member's mark once with `#markOf` and keeps it in `#orphanMarks` by pid and start, as long as the member lives. `exec` changes neither the pid nor the start. `#markOf` reads `/proc/<pid>/environ` with async `readFile`: the file is opened, and the read comes on a later thread-pool turn.

A probe (below; run 2026-10-26 from a private scratch folder, with `node environ-across-exec.mjs`) showed that an environ file opened before the process runs `exec` reads 0 bytes after it. A new read shows the mark:

```text
before exec: sh
after exec: sleep
read through the fd opened before exec: 0 bytes, marked: false
fresh read after exec: 4312 bytes, marked: true
```

The probe, `environ-across-exec.mjs`:

```js
// Opens /proc/<pid>/environ of a marked shell before it execs `sleep`, reads it after.
import { spawn } from "node:child_process";
import { openSync, readSync, readFileSync, closeSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
const child = spawn("/bin/sh", ["-c", "read x; exec sleep 5"], {
  env: { ...process.env, SQUEAL_PROBE_MARK: "fast" },
  stdio: ["pipe", "ignore", "ignore"],
});
await sleep(200);
const comm = () => readFileSync(`/proc/${child.pid}/comm`, "latin1").trim();
const fd = openSync(`/proc/${child.pid}/environ`, "r");
console.log("before exec:", comm());
child.stdin.write("go\n");
for (let i = 0; i < 100 && comm() !== "sleep"; i++) await sleep(20);
console.log("after exec:", comm());
const buf = Buffer.alloc(1 << 16);
const n = readSync(fd, buf, 0, buf.length, 0);
closeSync(fd);
console.log("read through the fd opened before exec:", n, "bytes, marked:", buf.subarray(0, n).includes("SQUEAL_PROBE_MARK=fast"));
const fresh = readFileSync(`/proc/${child.pid}/environ`, "latin1");
console.log("fresh read after exec:", fresh.length, "bytes, marked:", fresh.includes("SQUEAL_PROBE_MARK=fast"));
child.kill("SIGKILL");
```

An empty environ gives `undefined` (no mark). The scan stores that value, and no later scan reads the member again, so the carrier is never lowered. The kernel source also returns 0 bytes for a read in the window of `exec` before `create_elf_tables` sets `env_end`. That statement comes from the kernel source; the probe did not test it.

The S1 sleeper runs this risk when a scan comes during the `sleep 30 &` child's fork-to-exec phase (about a millisecond). In the old test, this was the first look at about 100 ms, when the leader had answered late. In both versions, it is also the look right after the second sleeper's shell is reaped. `#children` already handles the same problem for the daemon's own children: it reads again until the child is 100 ms old. `#scanOrphans` does not.

This is not reproduced here (no CPU load on purpose). Of the causes found, it is the only one that fits the CI timing. If CI fails this case again with `a look returned it: false` and the other cases at nominal speed, it is this race or another scan miss.

A product fix is the coordinator's decision. Candidates: do not keep an empty or missing mark for a member younger than about 100 ms, as `#children` does; or do not keep a 0-byte read at all.

## Checks (2026-10-26, this host, 24 CPUs)

- S1 alone, 20 runs: 20 of 20 pass, 1,986 to 2,038 ms each, 1-minute load 2.37 to 4.52 (another worktree's tests and three Squeal daemons running). An earlier set of 20 runs, at load 5.34 to 7.15, also showed 1,984 to 2,006 ms each, but its filter dropped the pass/fail mark, so it is not counted.
- Deliberate break, in a `git archive` copy under `$TMPDIR` so that Squeal did not rerun the importers of `escaped.ts`: `carriers` returns no group orphans (`const orphans: ProcessEntry[] = [];`). 3 of 3 runs fail at the first carrier, after 1,665 to 1,669 ms, with `a look returned it: false: expected +0 to be 10`. The worktree was not changed.
- Whole file, direct run at load 14.37: 9 of 9 pass. Squeal at revision 4: no known failures in `low-priority.test.ts`; the helpers file selects that file.
- `npm run lint` and `npm run typecheck`: clean.
