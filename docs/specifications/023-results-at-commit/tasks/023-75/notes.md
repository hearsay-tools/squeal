# 023-75 notes: how round 10 ran

Row 023-75, wave 35, 2026-11-23. The results are in `../../lessons.md`, "Round 10 (023-75)". These notes are the residue: what changed from round 9's harness, where it ran, the browser, and where the data is.

## Scripts (`bin/`)

Round 9's scripts (`../023-69/bin/`, described in `../023-69/notes.md`), changed only where listed.

| Script | Change from round 9 |
|---|---|
| `deploy.sh` | Hub entry `5352468` ("squeal 0.1.611"), `install.sh` from `squeal--v0.1.611`; scratch `t/<id8>/w35`. `LAB` is the ssh target, never written down. |
| `setup.sh`, `session.mjs`, `batch.mjs`, `as-user.mjs` | User `squeal-w35`, case root `~squeal-w35/runs/w35`. No other change. |
| `prompts.json` | Unchanged: `s1`, `s1b` and `s2` byte-equal to round 9's. |
| `summarize.mjs` | New `lines10`: each line of a `squeal` call's result that holds "queued at", "still running at", "waiting for", "not started", "time unknown", "as it was at" or "run in the commit's worktree", with the call's second (023-71, 023-73). `lines9` and `hooks9` kept. |
| `results.mjs` | Unchanged. |

Claude Code stays at 2.1.327, as in rounds 4 to 9. The s1b file stays `packages/web/e2e/thread-scroll.e2e.ts` (round 9's choice, `../023-69/notes.md`).

## Where it ran

The lab VM, allowed for this round (the human, 2026-11-23). At 21:56Z the 1-minute load was 0.00, no other user job ran, `~/work` was empty, no throwaway user or AppArmor profile from an earlier round was left, and `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` were present by name in the login shell. Order: setup (21:56Z); the browser profile and the browser proof (21:57Z to 21:59Z); the `dryat` check (`data/dry-at.txt`, 21:59Z to 22:01Z); s1-01 alone as a trial (153 s, $0.10, 22:01Z); then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, s1b, s2 and s1 interleaved in round 9's order), 22:04Z to 22:39Z.

## The browser (Chromium for this round only)

As rounds 8 and 9: squawk's own e2e wrapper downloads `agent-browser` and Chrome for Testing into the throwaway user's home, and one AppArmor profile, `/etc/apparmor.d/squeal-w35-chrome` (unconfined, `userns`, for `~squeal-w35/runs/w35/home/.agent-browser/browsers/chrome-*/chrome` only), lets that Chrome start. No OS package was installed (`data/packages.txt`: 877 before and after).

- **Proof before s1.** As the throwaway user, `pnpm run test:e2e thread-scroll.e2e.ts` in a clone at `8be977ad6`: 1 file, 18 of 18 tests passed in 97 s, 121 s with the wrapper (`data/browser-proof.txt`). The 1-minute load was 0.40 before it.
- **Left by the proof.** squawk's e2e server and its lease watcher outlived the run, as in every round; they were stopped before `dryat`. `dryat` left the commit worktree's lease watcher (T3/V7); it was stopped before s1-01.
- **Removed at the end** (22:40Z): `setup.sh browser-remove` unloaded and deleted the profile and deleted `~/.agent-browser` and `~/.cache/agent-tools`; `setup.sh teardown` then removed the user, its home, `/opt/squeal-w35` and its 63 `/tmp` entries. Afterwards: no such user, no uid-1002 process or file, no `squeal` profile in `/etc/apparmor.d` or the kernel, 877 packages as before. The work folder, with the streams and transcripts, was deleted at 22:45Z, after the data was fetched and judged.

## Data (`data/`)

- `judgements.tsv`: per session, round 9's columns, with one column per fix under test: 023-70 (the lint folder files and any "not comparable"; commit-side results that came from another worktree), 023-72/74 (the hook's browser line; browser files with both sides), 023-71 (s1b: the named file's state lines, reason, and the seconds from the first `--at` call to its commit result), 023-73 (s2: the changed test file's line and whether the agent read it right).
- `summary.tsv`: as round 9's.
- `<id>/`: `timeline.txt`, `summary.json` (now with `lines10`), `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`.
- `batch.log` (the trial first), `dry-at.txt`, `browser-proof.txt`, `packages.txt`.

Home paths read `~squeal-w35` or `~`.

## How some counts were made

- **Browser files with both sides in s1 and s1b.** The wide call names only the files that are not unchanged. Where `activity.e2e.ts` is missing from every listed line and the unchanged count is one more than the unit files with both sides, it was counted as unchanged ("by count" in `judgements.tsv`). In s1-04, s1-05 and s1b-03 the hook also said the working tree was "running packages/web/e2e/activity.e2e.ts" at that time.
- **Commit-side results from another worktree.** "at d8abcfe46: run in this worktree" (and "at a5c9b7223: …") appears for `parity-runner-subset.test.ts` (s1) and `test/store/paths.test.ts`, `retry-while-busy.test.ts` (s2). A grep of their sources at the two commits finds no folder read (`readdir`, `glob`, `fs.`), so they are not 023-70's case.
- **Time to the named file's commit result (s1b).** Most results came inside a `--wait` call of 146 to 268 s, so the time is an upper bound: the end of that call minus the first `--at` call's start.

## Things worth knowing next time

- **The browser group's one slot is shared by a clone's working tree and its commit worktree** (the slot's scope is the repository; `tasks/023-71-notes.md`). The two sides of one browser file run one after the other, never at once. In s1b-05 the working tree ran the named file first, the commit side waited for the slot, and the agent stopped at 230 s.
- **Sessions still share one OS user**, so the worker pool, `squeal ps` and the load the agents saw include other sessions' daemons. No call this round said it waited for the pool.
- The ssh call that starts `batch.mjs` with `setsid nohup … &` stays open even with every stream redirected; `timeout 30 ssh …` ends it, and the batch survives (`KillUserProcesses` is off on the VM).
- `deploy.sh fetch` must run from `023-75/bin`.
