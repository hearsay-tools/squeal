# 023-69 notes: how round 9 ran

Row 023-69, wave 33, 2026-11-23. The results are in `../../lessons.md`, "Round 9 (023-69)". These notes are the residue: what changed from round 8's harness, where it ran, the browser, the browser file named in s1b, and where the data is.

## Scripts (`bin/`)

Round 8's scripts (`../023-63/bin/`, described in `../023-63/notes.md`), changed only where listed.

| Script | Change from round 8 |
|---|---|
| `deploy.sh` | Hub entry `7b44459` ("squeal 0.1.610"), `install.sh` from `squeal--v0.1.610`; scratch `t/<id8>/w33`. `LAB` is the ssh target, never written down. |
| `setup.sh` | User `squeal-w33`, case root `~squeal-w33/runs/w33`. `prepare` takes `s1b-*` as a squawk clone. `browser [<spec>]` now passes the spec without `--` and under `timeout 900`: round 8's `-- <spec>` reached Vitest after the wrapper's own `--`, so the filter was ignored and every spec ran. Default spec `thread-scroll.e2e.ts`. |
| `prompts.json` | `s1` and `s2` byte-equal to round 8's. New `s1b`: `s1` plus "Include `packages/web/e2e/thread-scroll.e2e.ts` in the comparison." |
| `session.mjs`, `batch.mjs` | User and case root as above; ids `s1b-<nn>` allowed. No other change. |
| `as-user.mjs` | User and case root only. |
| `summarize.mjs` | New `lines9`: each line of a `squeal` call's result that names "not comparable", `thread-scroll`, "queued by a request", "waiting for `squeal run", a batch that holds a file, or "cut out", with the call's second (023-64 to 023-68). New `hooks9`: each hook or system event in the stream that holds "waiting for `squeal run" or "queued by a request" (023-67). |
| `results.mjs` | Unchanged. |

Claude Code stays at 2.1.327, as in rounds 4 to 8.

## The browser file named in s1b

`packages/web/e2e/thread-scroll.e2e.ts`. The change selects all 97 browser files. Round 8's browser proof (`../023-63/data/browser-proof.txt`) is the only record of single browser files run alone, with their times: `github-layout` 30 s (failed), `github-sidebar` 73 s, `thread-scroll` 93 s, `quick-list` 114 s, `task-thread-layout` 135 s. The median of the 5 is 93 s, which is `thread-scroll`. It passed alone, and it is not one of the 4 files that failed at file level in round 8's sessions (`agent-browser set viewport` failures). The sessions' own result lines carry no per-file time, so they could not be used.

## Where it ran

The lab VM, allowed for this round (the human, 2026-11-23). At 17:23Z the 1-minute load was 0.00, no other user job ran (only an OS release check), `~/work` was empty, no throwaway user or AppArmor profile from an earlier round was left, and `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` were present by name in the login shell. Order: setup (17:24Z); the browser profile and the browser proof (17:25Z to 17:28Z); the `dryat` check (`data/dry-at.txt`); s1-01 alone as a trial (125 s, $0.10, 17:30Z); then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, s1b, s2 and s1 interleaved), 17:33Z to 18:11Z.

## The browser (Chromium for this round only)

As round 8: squawk's own e2e wrapper downloads `agent-browser` and Chrome for Testing into the throwaway user's home, and one AppArmor profile, `/etc/apparmor.d/squeal-w33-chrome` (unconfined, `userns`, for `~squeal-w33/runs/w33/home/.agent-browser/browsers/chrome-*/chrome` only), lets that Chrome start. No OS package was installed (package count before: `data/packages.txt`).

- **Proof before s1.** As the throwaway user, `pnpm run test:e2e thread-scroll.e2e.ts` in a clone at `8be977ad6`: 1 file, 18 of 18 tests passed in 91 s, 118 s with the wrapper (`data/browser-proof.txt`). The 1-minute load was 0.2 before it.
- **Left by the proof.** squawk's e2e server and its lease watcher outlived the run, as in every round; they were stopped before `dryat`.
- **Removed at the end** (18:12Z): `setup.sh browser-remove` unloaded and deleted the profile and deleted `~/.agent-browser` and `~/.cache/agent-tools`; `setup.sh teardown` then removed the user, its home, `/opt/squeal-w33` and its `/tmp` entries. Afterwards: no such user, no uid-1002 process or file, no `squeal` profile in `/etc/apparmor.d` or the kernel, 877 packages as before. The work folder, with the streams and transcripts, was deleted at 18:17Z.

## Data (`data/`)

- `judgements.tsv`: per session, round 8's columns, with one column per fix under test: 023-64 (the lint files and any "not comparable"), 023-65 (`open.test.ts` at the commit: seconds into the call and from the first call), 023-66 (estimates, and whether a browser time came from unit files), 023-67 (the hook's browser line), 023-68 (browser files with both sides; the named file's times per side).
- `summary.tsv`: as round 8's.
- `<id>/`: `timeline.txt`, `summary.json` (now with `lines9` and `hooks9`), `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`.
- `batch.log` (the trial first), `dry-at.txt`, `browser-proof.txt`, `packages.txt`.

The `git show` line that named the commit's author reads `Author: [redacted]`; home paths read `~squeal-w33` or `~`.

## Things worth knowing next time

- **The commit daemon's named browser file waits for a pool permit under load.** With 3 sessions at once on one OS user, s2's commit daemons ran 200-file batches and held the shared worker pool ("pool 11 of 11 permits"). The s1b commit daemons then ran no browser file for minutes, and Squeal said "still running". s1b-01, the first session of the batch, got its commit result in 148 s. To measure the named-file path without that, run s1b alone or beside s1 only.
- **Where the two sides start the browser group.** The commit side runs `activity.e2e.ts`, then `agent-browser-tabs`, then `agents-dock`; the working tree leaves `activity.e2e.ts` queued (Y2 in the lessons). Look at that first when testing 023-68.
- **The proof clone runs one spec** only with `pnpm run test:e2e <spec>` (no `--`); with `-- <spec>` every spec runs.
- **ssh and long runs.** `nohup setsid node batch.mjs … &` inside `bash -lc` keeps the ssh call open; end the local ssh after the batch shows in `ps`: the batch is in its own session and survives it (`KillUserProcesses` is off on the VM).
- `deploy.sh fetch` must run from `023-69/bin`.
