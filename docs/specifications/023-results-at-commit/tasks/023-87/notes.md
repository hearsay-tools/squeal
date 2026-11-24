# 023-87 notes: how round 12 ran

Row 023-87, wave 41, 2026-11-24. The results are in `../../lessons.md`, "Round 12 (023-87)". These notes are the residue: what changed from round 11's harness, where it ran, the browser, and where the data is.

## Scripts (`bin/`)

Round 11's scripts (`../023-80/bin/`, described in `../023-80/notes.md`), changed only where listed.

| Script | Change from round 11 |
|---|---|
| `deploy.sh` | Hub entry `fdc7453` ("squeal 0.1.624"), `install.sh` from `squeal--v0.1.624`; scratch `t/<id8>/w41`. `LAB` is the ssh target, never written down. |
| `setup.sh`, `batch.mjs`, `as-user.mjs`, `session.mjs` | User `squeal-w41`, case root `~squeal-w41/runs/w41`. No other change. |
| `runs.mjs` | New section "023-83": every browser run of both sides in start order with its end, the turns each side took in a row on the shared slot, and the first browser file with a completed run on both sides (the later side's end, seconds from the session's start). |
| `prompts.json` | Unchanged: `s1`, `s1b` and `s2` byte-equal to round 11's (`cmp`). |
| `summarize.mjs` | New `lines12`: each line of a `squeal` call's result that holds "(in use)", "last try", "its turn went", "group's slot", "worker pool" (023-83's slot-wait reasons) or "will not count" (023-84); and `hooks12`, each hook or system event that holds them. Round 11's lists kept. |
| `results.mjs` | Unchanged. |

Claude Code stays at 2.1.327, as in rounds 4 to 11. The s1b file stays `packages/web/e2e/thread-scroll.e2e.ts`.

## Where it ran

The lab VM, allowed for this round (the human, 2026-11-24). At 20:29Z the 1-minute load was 0.04, no other user job ran (the only busy process was the OS's own release-upgrade check), `~/work` was empty, no throwaway user or AppArmor profile from an earlier round was left, 877 packages were installed, and `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` were present by name in the login shell. Order: setup (20:31Z); the browser profile and the browser proof (20:31Z to 20:34Z); the `dryat` check (`data/dry-at.txt`, 20:34Z to 20:36Z); s1-01 alone as a trial (169 s, $0.10, 20:36Z); then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, round 11's order), from 20:39Z.

## The browser (Chromium for this round only)

As rounds 8 to 11: squawk's own e2e wrapper downloads `agent-browser` and Chrome for Testing into the throwaway user's home, and one AppArmor profile, `/etc/apparmor.d/squeal-w41-chrome` (unconfined, `userns`, for `~squeal-w41/runs/w41/home/.agent-browser/browsers/chrome-*/chrome` only), lets that Chrome start. No OS package was installed.

- **Proof before s1.** As the throwaway user, `pnpm run test:e2e thread-scroll.e2e.ts` in a clone at `8be977ad6`: 1 file, 18 of 18 tests passed in 98 s, 124 s with the wrapper (`data/browser-proof.txt`). The 1-minute load was 0.40 before it.
- **Left by the proof and `dryat`.** squawk's e2e server and its lease watcher outlived the proof, as in every round; they were stopped before `dryat`. `dryat`'s commit daemon outlived `squeal stop` and `squeal stop --at HEAD~1` ended it; the processes it left were stopped before the trial.
- **Removed at the end** (21:18Z to 21:24Z): `setup.sh browser-remove` unloaded and deleted the profile and deleted `~/.agent-browser` and `~/.cache/agent-tools`; `setup.sh teardown` then removed the user, its home, `/opt/squeal-w41` and its `/tmp` entries. Afterwards: no such user, no uid-1002 process or `/tmp` entry, no `squeal` profile in `/etc/apparmor.d` or the kernel, 877 packages as before (`data/packages.txt`). The work folder, with the streams and transcripts, was deleted at 21:24Z, after the data was fetched and judged. The VM's 1-minute load was then 0.26.

## Data (`data/`)

- `judgements.tsv`: per session, round 11's first nine columns, then one column per question of this round: 023-83 (the first browser file with a completed run on both sides, from the store, and whether it came inside the first call; the turns in a row per side; each slot-wait line, whether it was true, whether the agent acted on it), 023-84 (the "will not count" line, whether the run was at an older key), the first-run re-runs on an empty store, and round 11's last three columns.
- `summary.tsv`: as round 11's.
- `<id>/`: as round 11's (`timeline.txt`, `summary.json` now with `lines12` and `hooks12`, `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`, `runs.txt` with its new "023-83" section, `hook-browser.txt`).
- `batch.log` (the trial first), `dry-at.txt`, `browser-proof.txt`, `packages.txt`.

Home paths read `~squeal-w41` or `~`.

## How some counts were made

- **A run cut by the harness reads `completed`.** Round 11's notes said a run ended by `squeal stop --at` reads `crashed`; in 0.1.624 the last browser run of a session, started a few seconds before the stop, reads `completed` with a short duration (s1-01's commit `agents-dock` 138 to 153 s, s1b-01's second commit `agents-dock`, s1b-04's commit `thread-scroll` 419 to 435 s, s1b-05's commit `agent-browser-tabs` 575 s, 0 s). `runs.mjs` counts them; the lessons do not: a pair is counted only when both runs ended before the agent's last call or are confirmed by a call.
- **A stale run reads `completed` too.** s1b-05's commit-side `thread-scroll` run from 270 to 419 s was the one 023-84's line said would not count; `runs.mjs` pairs it at 419 s. The lessons use the counting run (434 to 560 s).
- **First pairs in round 11.** Recomputed from `../023-80/data/<id>/runs.txt` with the same rule: s1 at 118, 214, 118, 134 and 155 s (median 134 s), each on the file the commit side ran last before the working tree's turn.
- **Files run twice (first-run re-runs).** As round 11: a commit-side tier of 193 to 195 files in s2 that a narrowed call cut short is listed again by the tier that resumes it, so the commit-side counts in s2-01, 04, 06, 08, 09, 10 are not re-runs.
- **The slot-wait lines' truth.** The "running for N s" of each holder line was checked against the store's start of the holder's run and the call's end: each was within 1 s. The hook's "(in use)" lines were checked against the store's run that held the slot at the hook's time.

## Things worth knowing next time

- **The `--at` call's slot line does not carry 023-83's reasons.** Only the hook and `squeal retry` say "(in use)", "(taken at its last try)" or "(its turn went to another worktree that waits for it)". A `status --at` line names a holder when one holds the slot and otherwise says only "waiting for the browser group's slot" (`src/cli/status-at-estimate-waits.ts`, `waitText`).
- **The first pair cannot come inside a 100 s first call in this repository.** The commit side's first browser run starts 60 to 104 s into the session (after its worktree setup and its tests), the working tree's after its own tests tier ends (102 to 149 s), and `activity.e2e.ts`, now the first file paired, takes 29 to 47 s per side.
- `deploy.sh fetch` must run from `023-87/bin`. A heredoc to `ssh … bash -l` avoids the nested-quote trap of `bash -lc "…"`.
