# 023-80 notes: how round 11 ran

Row 023-80, wave 37, 2026-11-24. The results are in `../../lessons.md`, "Round 11 (023-80)". These notes are the residue: what changed from round 10's harness, where it ran, the browser, and where the data is.

## Scripts (`bin/`)

Round 10's scripts (`../023-75/bin/`, described in `../023-75/notes.md`), changed only where listed.

| Script | Change from round 10 |
|---|---|
| `deploy.sh` | Hub entry `8966745` ("squeal 0.1.614"), `install.sh` from `squeal--v0.1.614`; scratch `t/<id8>/w37`. `LAB` is the ssh target, never written down. |
| `setup.sh`, `batch.mjs`, `as-user.mjs` | User `squeal-w37`, case root `~squeal-w37/runs/w37`. No other change. |
| `session.mjs` | User and case root as above. New: after the commit daemon is stopped and the leftovers are ended, it copies the clone's `.git/squeal/store.sqlite*` (both sides share it: the commit worktree is a worktree of the clone), runs `runs.mjs` on the copy into `runs.txt`, and deletes the copy. |
| `runs.mjs` | New. Every run the store kept, in start order, with its side (`commit` for a worktree under Squeal's checkouts, `tree` for the clone), duration and files; then per side the browser files in start order and the files with a run on both sides (023-78); then per side the test files that ran more than once (023-81). |
| `prompts.json` | Unchanged: `s1`, `s1b` and `s2` byte-equal to round 10's (`cmp`). |
| `summarize.mjs` | New `lines11`: each line of a `squeal` call's result that holds "holds (", "it starts when", "can start after", "N pending (", "not comparable" or `lint-ast-grep` (023-76 to 023-79); and `hooks11`, each hook event that holds "N pending (" (023-79). `lines9`, `lines10`, `hooks9` kept. |
| `results.mjs` | Unchanged. |

Claude Code stays at 2.1.327, as in rounds 4 to 10. The s1b file stays `packages/web/e2e/thread-scroll.e2e.ts`.

## Where it ran

The lab VM, allowed for this round (the human, 2026-11-24). At 08:10Z the 1-minute load was 0.02, no other user job ran, `~/work` was empty, no throwaway user or AppArmor profile from an earlier round was left, 877 packages were installed, and `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` were present by name in the login shell. Order: setup (08:12Z); the browser profile and the browser proof (08:12Z to 08:15Z); the `dryat` check (`data/dry-at.txt`, 08:15Z to 08:17Z); s1-01 alone as a trial (167 s with its clone, $0.09, 08:17Z); then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, round 10's order), 08:21Z to 08:57Z. No other user's job ran on the VM during the round; all load came from the throwaway user's sessions.

## The browser (Chromium for this round only)

As rounds 8 to 10: squawk's own e2e wrapper downloads `agent-browser` and Chrome for Testing into the throwaway user's home, and one AppArmor profile, `/etc/apparmor.d/squeal-w37-chrome` (unconfined, `userns`, for `~squeal-w37/runs/w37/home/.agent-browser/browsers/chrome-*/chrome` only), lets that Chrome start. No OS package was installed (`data/packages.txt`: 877 before and after).

- **Proof before s1.** As the throwaway user, `pnpm run test:e2e thread-scroll.e2e.ts` in a clone at `8be977ad6`: 1 file, 18 of 18 tests passed in 92 s, 116 s with the wrapper (`data/browser-proof.txt`). The 1-minute load was 0.11 before it.
- **Left by the proof and `dryat`.** squawk's e2e server and its lease watcher outlived the proof, as in every round; they were stopped before `dryat`. The processes `dryat` left (the commit worktree's lease watcher, an e2e server and its lease watcher) had ended by themselves before the trial.
- **Removed at the end** (09:02Z): `setup.sh browser-remove` unloaded and deleted the profile and deleted `~/.agent-browser` and `~/.cache/agent-tools`; `setup.sh teardown` then removed the user, its home, `/opt/squeal-w37` and its `/tmp` entries. Afterwards: no such user, no uid-1002 process or `/tmp` entry, no `squeal` profile in `/etc/apparmor.d` or the kernel, 877 packages as before. The work folder, with the streams and transcripts, was deleted at 09:02Z, after the data was fetched.

## Data (`data/`)

- `judgements.tsv`: per session, round 10's columns, with one column per fix: 023-76 (the lint folder files, which side ran them first, any "not comparable"), 023-78 (browser files with both sides by the session's end, from the store, and each side's order), 023-77 (the slot-holder line, whether it was true, whether the agent acted on it), 023-79 (the hook's browser line and the files it named), 023-81 (files run twice on one side).
- `summary.tsv`: as round 10's.
- `<id>/`: `timeline.txt`, `summary.json` (now with `lines11`, `hooks11`), `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`, and new `runs.txt` (the store's runs) and `hook-browser.txt` (each distinct `browser: 97 test files …` line in the stream, with its count; the first is the status call's, the second the hook's).
- `batch.log` (the trial first), `dry-at.txt`, `browser-proof.txt`, `packages.txt`.

Home paths read `~squeal-w37` or `~`.

## How some counts were made

- **Run times in `runs.txt`** are the store's `started_at` and `ended_at` less the session's start (`meta.json` `start`). A run is one tier: all its files share the times. The store copy is taken after `squeal stop --at`, so a run that started before the stop and was ended by it reads `crashed` (s1b-03's last `agents-dock`).
- **Files run twice (023-81).** `runs.mjs` counts a file twice when two runs of one side list it. In s2, a commit-side tier of 200 files that a narrowed call cut short is listed again by the tier that resumes it, so the commit-side counts of 149 to 194 in s2-01, 02, 03, 06, 08, 10 are not re-runs; `judgements.tsv` gives only the working tree's count for s2. For s1 and s1b, the re-runs are small tiers of 2 to 6 files 24 to 42 s after the first. In the 8 s1 and s1b sessions that ran the lint files, the first call's end (about 104 s) read some of them "running" or "queued" while the store shows that they had already run once on that side.
- **Browser files with both sides** in `judgements.tsv` come from the store, by the session's end. The agents' calls showed a browser file on both sides only for the named file in s1b (`thread-scroll.e2e.ts: pass -> pass`, 4 sessions); no s1 call showed one.
- **The slot-holder line's truth.** The "running for N s" of each line was checked against the store's start of the working tree's run of `thread-scroll.e2e.ts` and the call's end: each was within 2 s.

## Things worth knowing next time

- **The commit worktree's runs and the working tree's runs share one store** (`<clone>/.git/squeal/store.sqlite`), so one copy after the session gives both sides' order. `squeal ps` and the pending counts in `commit-left.txt` still include other sessions' daemons, because sessions share one OS user.
- **The working tree's first browser run started 94 to 146 s into the session, the commit side's 56 to 84 s.** In 5 of 10 s1 and s1b sessions the hook said the working tree's 97 browser files were "waiting for capacity (whether the browser group's slot or the shared worker pool holds it is not known)". With 3 sessions at once under one user, the worker pool is shared by up to 6 daemons, so part of that wait may be this harness's, not a user's.
- The ssh call that starts `batch.mjs` with `setsid nohup … &` returns at once when wrapped in `bash -lc "…"` with every stream redirected; `timeout 30 ssh …` is still a good guard.
- `deploy.sh fetch` must run from `023-80/bin`.
