# Wave 4: what the dogfood found

`lessons.md` (014-15) found that goals 3, 4 and 6 do not hold on this host. The three rows run in parallel, on disjoint files. Each reads `lessons.md` first: every proposed row there names its evidence and its done-when. A type change in a file another row owns is a request to the coordinator, never an edit. The spec amendments are the coordinator's, at integration: your final message states each rule you changed. Rules for every row: test first; verdict through `squeal run --all --wait`; the 650-process cost test (`test/ps/snapshot-cost.test.ts`) stays green, with its numbers in your final message; no `npm run build`; commit on your branch; `ps` writes, signals and connects nothing.

## 014-22, 014-25 and the size walk of 014-23: the leftover rule

Use /worker. Shape: repair. **Outcome:** `leftover-temp` lists only directories that Squeal makes and nothing uses, and its size walk spends nothing when it cannot finish. **Read:** `lessons.md` Flags, P1, P3, P5; `spec.md` D7 (the `leftover-temp` row and the rules paragraph), D10. **Seam:** `src/core/ps/flags-files.ts`; a first edit: the candidates are only Squeal's own names (the key directories under `/tmp/squeal-<uid>/tmp/`, and the `squeal-<uid>-<key>-XXXXXX`, `squeal-e2e-XXXXXX`, `squeal-e2e-oc-XXXXXX` and `squeal-update-XXXXXX` directories), each checked against the code that makes it; never `squeal-evals-<uid>`, `squeal-e2e-cache` or an agent's `squeal-review-*`. Then a path under a bound unix socket (`source.unixListeners()`) or an open file (`source.fds(pid)`) is a use; measure the cost of the fd reads and say what you chose. The size walk runs only when it can finish within its bound, or only with `--full`: choose, and say why. **Owns:** `flags-files.ts`, `test/ps/flags-files*.test.ts`. **Done when:** the done-when cases of P1 and P5; a walk past the bound that costs no read; `/tmp/sq-*` stays out of scope (a Later item).

## 014-21, 014-24 and 014-27: the CPU share, unknown memory, the departure text

Use /worker. Shape: repair. **Outcome:** Squeal's CPU counts the processes that end inside the window; a descendant that left adds nothing instead of making its head `?`; a total that skips an unknown value says so; the work text prints only the daemon's own departure. **Read:** board row 014-21; `lessons.md` Goal 3, P2, P4, P7 and Other observations; `spec.md` D4, D5, D6, D8. **Seam:** `src/core/ps/proc.ts`, whose `stat` parse gains `cutime` and `cstime`, then `measure.ts`; a first edit: a daemon's window CPU adds the growth of its `cutime + cstime` between the two readings. **Owns:** `src/core/ps/{source,model,proc,darwin,measure,processes,snapshot,snapshot-shape,snapshot-unknown,shape,render}.ts` and their tests. A shape change stays additive under `v: 1`, or raises `v`: say which. **Done when:** the done-when cases of P2 (row 014-21's too), P4 and P7; render cases for the lower-bound mark.

## 014-26, 014-28 and the store and number parts of 014-23

Use /worker. Shape: repair. **Outcome:** a store read creates no file; the open runs are one query per store and reading; numbers format without `Intl`; `orphan-test-process` waits for an age floor. **Read:** `lessons.md` No side effects, Goal 6, P3, P6, P8; `spec.md` Goal 4, D3, D7. **Seam:** `openReadOnly` in `src/core/ps/work.ts`; a first edit: a test that `ps` over a WAL store without `-wal` and `-shm` leaves the directory listing unchanged, then the open that makes it hold (`immutable=1` through a `file:` URI, or the store named in `unknown`). **Owns:** `src/core/ps/{work,flags-processes,render-units}.ts` and their tests. **Done when:** the done-when cases of P6 and P8; a test that counts one open-runs query per store and reading; `render-units` output unchanged.

## 014-29 review of wave 4

Use /reviewer. Shape: review. Pinned to the candidate SHA the dispatch names. **Check, each finding labelled proven, plausible or unverified:** each row's done-when; the D4 to D8 amendments against the code; read-only behaviour, the WAL case included; no leftover rule that can name a directory Squeal did not make. **Rules:** change no code; `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once, with the load; write only `reviews/wave-4.md` and commit it.

## 014-30 dogfood, round 2

Use /worker. Shape: finish. After wave 4 is released. **Outcome:** `lessons.md` gains a "Round 2" section that says whether goals 3, 4 and 6 now hold on this host. **Steps:** the round 1 method and scripts (`lessons.md` For the next worker, `/tmp/dogfood-014-15/bin/` if it is still there): three samples 10 minutes apart, two share windows, goal 6's timed runs, every flag judged. **Rules:** as 014-15. **Owns:** `lessons.md`.

Round 2 specifics (coordinator, 2026-10-21, after the release):

- **Bundle:** the released 0.1.248 (tag `squeal--v0.1.248`, bb3e3b540). While the installed plugins still read 0.1.247, run a pinned copy of the tag (`git archive squeal--v0.1.248 plugins/claude-code` into a new directory under `/tmp/dogfood-014-30/`), never a worktree's build, and say which copy each number came from.
- **Goal 3:** compare Squeal's CPU and memory share with the round 1 independent measure (`share.py`). A share marked `at least` holds when the independent value is at or above it and `unknown` names the cause (D4, D6, `reviews/wave-4.md` B3).
- **Goal 4:** judge every flag again, and read the store sidecars before and after each sample (no `-wal` or `-shm` created). `leftover-temp` either lists only Squeal's own directories that every use read proves unused, or withholds them into one `unknown` entry (D7, B2). Report how often it withholds on this host, and why (the unreadable processes by name), with the count and size withheld: the human weighs that cost.
- **Goal 6:** five timed runs of the whole command, with the load, the process count and the daemon count of each.
- Never run an end command `ps` prints. Send no signal and connect to no socket. Write only under `/tmp/dogfood-014-30/` and `lessons.md`.
