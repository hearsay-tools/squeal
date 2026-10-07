# Wave 7.7 review

Reviewer task 001-64 for spec 001, 2026-10-07. Range `09bfc7c..57671b7` (6 commits): 001-63's repair of the 001-61 slice, plus the bundle rebuild. This is the second and last round on that slice. I read the range against D10 and D4 as amended, `reviews/wave-7.6.md` and the 001-63 brief in `tasks/wave-7.7.md`. I did not re-check what `wave-7.6.md` lists under "What fits".

## Verdict

**FAIL at `57671b7`.** Counts: 1 blocker, 0 should-fix, 4 nits.

Every finding from `wave-7.6.md` is closed: B1, B2 (as option (b)), S1, S2 and N1 to N5. Each new test fails when its fix is reverted. On this host, the hostile `/tmp/squeal-<uid>` cases, two worktrees sharing `/tmp/squeal-<uid>/tmp`, SIGKILL and the start order all behave as D10 says.

The new location opened one thing (B1). The temp directory is keyed by the worktree hash alone, but the lock that guards it is keyed by the common dir and the worktree hash. Say a second repository's worktree takes a path the first just left, and does so while the first repository's daemon is still alive. Then that daemon's exit removes the second daemon's temp directory. The second daemon then stores `FAIL` for a test that passes under `vitest run`. The trigger is narrow: a different repository at the same path, within the old daemon's exit window of about 5 s. The fix is one line plus a test.

## Verification

The brief's branch HEAD is `2dbb399`. It is one commit past the candidate and touches only `docs/board.md` and `tasks/wave-7.7.md` (N3). I ran everything on a detached worktree at `57671b7`.

```
$ git rev-parse HEAD
57671b70f404d75e9ad36ff9f6f389ab3dbd09ce   (detached worktree)
$ npm ci
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
Checked 340 files in 87ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
 Test Files  109 passed (109)
      Tests  848 passed | 7 skipped (855)
   Duration  47.48s
```

After the full suite, `/tmp/squeal-1001/tmp/` was empty: no test leaves a temp directory behind. The load average was 6 to 9 on 24 cores. A Squeal daemon of my own session served the candidate worktree during the probes. It re-ran the probe files as I wrote them, so each probe ran twice, and both runs agree.

## Previous findings (`reviews/wave-7.6.md`)

| Finding | Status | Evidence |
|---|---|---|
| B1, temp dir inside the repository | closed | `scratch.ts:29` puts `tempDir` at `/tmp/squeal-<uid>/tmp/<worktree-hash>/`. The real-daemon test in `scratch.test.ts` passes only when `git rev-parse` fails in `mkdtemp(tmpdir())`. With `tempDir` moved back under `storePaths(commonDir).dir`, the test fails (`expected 'fail' to be 'pass'`). |
| B2, a runner call's child pins the root | closed as option (b) | D10 is amended (`spec.md:153`). `scratch-children.test.ts` asserts that only a descendant of the daemon holds the root, not the daemon. It also asserts that `git worktree remove` succeeds without `--force`, the daemon exits 0 within 15 s, the service dies with it and the temp directory is gone. |
| S1, nothing removed at exit | closed | `removeScratch` runs in `#shutdown` after `runner.close` and before `setDaemon`, `store.close`, the socket and the lock (`daemon.ts:353`). It also runs in `abandon` (`open.ts:121`). Tests assert that the directory is gone after `squeal stop` and after removal. |
| S2, D4 figures | closed | The local figures are 001-60's `status.md` figures. I checked the CI figures against the log of run 37579065539 (head `5d2d86d`, which is `ae24aaf` plus docs). Node 22: cold 1917 ms, warm 17.6, afterAdd 20.5, afterEdit 20.5. Node 24: cold 1806, warm 15.0, afterAdd 18.7, afterEdit 18.3. D4 matches. |
| N1, `"main": "lib/"` | closed | `stale.ts:106` strips the trailing slash. The new `structural.test.ts` row fails with the strip reverted (`expected [] to deeply equal [ 'test/pkg.test.ts' ]`). |
| N2, `exports` match | closed | D4 now calls it defensive and says why. |
| N3, wave label | closed | The 001-60 line says 7.6. The 001-58 line was relabelled 7.6 as well, which `tasks/wave-7.6.md:3` supports ("001-58 … landed under wave 7.6"). |
| N4, placement | closed | Both lines are now in the amendment log, above "## Research". |
| N5, `git worktree remove` | closed | Both `scratch.test.ts` and `scratch-children.test.ts` remove the worktree with `git worktree remove`, without `--force`. |
| N6, branch HEAD | recurs | N3 below. |

## Probes

Real `squeal daemon` processes from the built CLI ran on fixture repositories. The probe file was a throwaway test, deleted afterwards.

| Probe | Result |
|---|---|
| `/tmp/squeal-<uid>` owned by another uid. I simulated this with a preloaded `process.getuid` returning 4242 against a `/tmp/squeal-4242` that I own. | The daemon exits 1. stderr and a persisted note both say `temp directory /tmp/squeal-4242 is owned by uid 1001, not 4242; refusing to use it`, and `squeal status` lists the note under "Notes". Nothing under the directory is touched. |
| `/tmp/squeal-<uid>` as a symlink to a directory of the attacker's (fake uid 4243) | The daemon exits 1 with `… is not a directory; refusing to use it`. The note and status are as above. |
| `/tmp/squeal-<uid>` with a loose mode | The unit test only (`scratch.test.ts`, mode 755, refused before `tempDir` exists). I did not run it with a real daemon, because loosening the live `/tmp/squeal-1001` would hit other sessions. This is **unverified** with a real daemon, but it takes the same `checkPrivateDir`, then `abandon` path as the two rows above. |
| Two worktrees' daemons in parallel | Each gets its own `tmp/<hash>`, and each test's `x-…` lands in its own directory. Stopping one removes only its own directory; the other's files stay. |
| SIGKILL after a test left `x-…` (esbuild-plugin config) | The directory and its files stay. No descendant survives: the esbuild service and the fork workers die with the daemon. The next daemon answers ping in 139 to 151 ms and finds the directory empty. |
| Start order (store before temp dir) against the spawn budget | Ping arrives 138 to 149 ms after the spawn with an empty leftover. The change only moved the emptying from before `openStore` to after it. Both points come before the socket binds, so the order change costs nothing. The size of a leftover does cost time (N1). |
| D10 option (b) wording against the esbuild fixture | It matches. "the daemon itself holds nothing": the test asserts that only descendants hold the root. "`git worktree remove` still succeeds, the daemon then exits … and the service with it": asserted as well. "which Vite 6 and 7 start for every TypeScript transform" is not exercised. The fixture runs Vite 8.3.2 with a plugin that calls esbuild itself, so that clause stays **unverified**, as in `wave-7.6.md`. |
| A worktree path reused by another repository | B1. |

## Blockers

### B1. The temp directory is keyed wider than the lock that guards it, so one repository's daemon can delete another's (proven)

`daemonScratch` (`scratch.ts:23-30`) names the directory `/tmp/squeal-<uid>/tmp/<worktreeId>`, and `worktreeIdFor` hashes only the root's realpath (`store/paths.ts:13`). The lock that makes emptying and removal safe is `<common-dir>/squeal/locks/<worktreeId>.sqlite` (`open.ts:63`), one per common dir. Two daemons for the same root path under different repositories hold different locks and share one temp directory. `removeScratch`'s comment says "no successor is using it yet" (`scratch.ts:45-48`), and D10 says the same ("after the runner closed and before the lock goes"). Neither holds across repositories. Before this range, the directory lay under `<common-dir>`, so the lock covered it.

Probe (a throwaway test, run twice):

1. Repository A adds a linked worktree at path `P`. Daemon A starts and becomes ready.
2. `git -C A worktree remove --force P`, then `git -C B worktree add --detach P`, and daemon B starts for `P`. B wins its own lock in B's common dir and prepares `/tmp/squeal-1001/tmp/<hash(P)>`.
3. Daemon A sees `<A-common-dir>/worktrees/<name>` gone, exits 0 and removes that directory: `tmp exists after A exit: false`.
4. In B, an edit re-runs `test/tmp.test.ts` (`mkdtempSync(join(tmpdir(), "x-"))`). The store and `squeal status` then show:

```
FAIL  test/tmp.test.ts > t
      ENOENT: no such file or directory, mkdtemp '/tmp/squeal-1001/tmp/b27a409d51dc7e85/x-XXXXXX'
      at test/tmp.test.ts:5:24, observed at revision 1, current
```

There is no note. The result is stored under the check's key as `fail`, and it stays that way until daemon B restarts. Under `vitest run` the test passes. This breaks goal 3 ("Everything the agent is told is true"), and the stored result is open to inheritance (goal 4).

It also runs the other way. B's `prepareScratch` empties the directory that A's runner may still be using during A's last seconds.

The trigger is narrow. A different repository must take the same absolute path while the old daemon is still alive, which is at most one root-check interval (5 s) plus shutdown. Worktrees made by the same repository at a reused path share a common dir, and therefore a lock, so they are safe. Harness layouts with a task id or the repository in the path never collide. The human may weigh this narrowness. By the rule, it is a proven break of a goal.

Fix (one worker, `scratch.ts`, `test/daemon/scratch.test.ts`, one D10 clause and one `status.md` line): key the directory by what the lock is keyed by. For example, use `tmp/<sha256(commonDir + "\0" + worktreeId), 16 hex>` or `tmp/<hash(commonDir)>-<worktreeId>`. The path stays short, and `scratch-helpers.ts`'s `daemonTempDir` already takes `commonDir`. Then turn the probe into a fixture test: two fixture repositories and one path, asserting that B's temp directory survives A's exit and that B's `mkdtemp(tmpdir())` test passes. In D10, "empties `/tmp/squeal-<uid>/tmp/<worktree-hash>/`" becomes the new key. Also correct the `removeScratch` comment.

## Should-fix

None.

## Nits

- **N1** (proven). A large leftover delays the socket. `prepareScratch` empties synchronously before the socket binds. With 20,000 leftover files, ping arrives after 450 to 456 ms. With 100,000 files it takes 2,170 to 2,179 ms, past D9's 2 s. With none, it takes 138 to 149 ms. Leftovers exist only after a crash or SIGKILL, and only that many if the test suite left that many files. Hooks return without waiting, so a slow start costs only a losing re-spawn. This predates the order change, because 001-61 also emptied before the bind. If wanted, rename the leftover to a sibling (`<key>.old-<pid>`) under the lock and remove it after the socket is up.
- **N2** (plausible, design). Every daemon now needs `/tmp/squeal-<uid>`, including one whose socket is under `XDG_RUNTIME_DIR`. So another local user who creates `/tmp/squeal-<victim-uid>` first now disables Squeal for that user entirely, where before only the socket fallback was affected. The refusal is correct and is reported (a note, plus `squeal status`). The location was the coordinator's decision. A possible hardening: fall back to a fresh `mkdtemp("/tmp/squeal-<uid>-")`, recorded in the store so the next start can reap it.
- **N3**. The brief's branch HEAD is `2dbb399`, not the candidate `57671b7`. The difference is docs only (`docs/board.md`, `tasks/wave-7.7.md`).
- **N4**. Two comments were edited without reflowing: `open.ts:35` runs past the comment width, and `daemon.ts:340` is uneven. Lint passes.

## What fits (do not re-check)

- **`wave-7.6.md` B1, B2 (b), S1, S2, N1 to N5.** See the table. Each new test discriminates: B1's real-daemon `git rev-parse` test and N1's `structural.test.ts` row both fail with their fix reverted.
- **`preparePrivateDir`.** It is shared by the socket fallback and the temp directory. It refuses a symlink, another owner and a loose mode before anything under the directory is removed. It creates a missing directory 0700 despite the umask. A refusal ends the daemon with exit 1, a persisted note and a status line. `socketPathFor`'s fallback path is unchanged (`userTmpDir()` is the same `/tmp/squeal-<uid>`).
- **Start order.** Lock, then store, then temp dir, then socket. A store failure leaves no temp directory. A temp-dir failure goes through `abandon`, which writes the note, closes the store, removes the directory and releases the lock. With an empty leftover, ping arrives in about 140 to 150 ms.
- **Shutdown order.** Loop, runner, temp dir, `setDaemon(null)`, store, socket, lock.
- **SIGKILL.** No descendant survives the daemon, the esbuild service included. The leftovers stay until the next daemon of the worktree empties them.
- **Two worktrees of different roots.** They have separate directories and never touch each other's.
- **The full suite** leaves nothing in `/tmp/squeal-<uid>/tmp/`.
- **D10 option (b) wording.** It matches the esbuild fixture, except for the Vite 6 and 7 clause, which is unverified.

## Inputs for the next wave

1. **B1 fix row, only if the human buys a third round.** It owns `src/core/daemon/scratch.ts`, `test/daemon/scratch.test.ts` (or `scratch-children.test.ts`), `test/daemon/scratch-helpers.ts`, one D10 clause and one `status.md` line.
   - Key the temp directory by the common dir and the worktree id together, so that the lock covers it.
   - Add a fixture test: two repositories, one linked worktree path removed from A and added from B, both daemons up. Assert that B's temp directory exists after A exits and that B's `mkdtemp(tmpdir())` test passes.
   - Budget: no new work before the socket binds; the full suite passes.
2. **Optional, its own row or folded in.** N1: move the emptying of a large leftover after the socket bind. N2: needs a coordinator decision on whether a refused `/tmp/squeal-<uid>` should fall back rather than stop Squeal.
3. **Carried, not this slice.** These are unchanged from `wave-7.6.md` input 3. `wave-7.5.md` N1 (an edited `package.json`), N2 (concatenated dynamic imports) and N5 (the closure gap at virtual ids and `node_modules`) need a spec decision first. N4 waits on 001-54, and N7 (the `waiter.test.ts` bound) is outside the slice.
