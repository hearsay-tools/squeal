# 023-33 notes: how round 5 runs

Row 023-33, wave 19, 2026-11-21. The results go to `../../lessons.md`, "Round 5 (023-33)". These notes are the residue: what changed from round 4's harness, where it ran, and where the data is.

## Scripts (`bin/`)

Round 4's scripts (`../023-28/bin/`, described in `../023-28/notes.md`), changed only where listed. They were first moved to a boat.dev sandbox with 023-32's transport, then back to the lab VM (see "Where it ran").

| Script | Change from round 4 |
|---|---|
| `deploy.sh` | Hub entry `cf42b11` (0.1.584), `install.sh` from `squeal--v0.1.584`; scratch `t/<id8>/w19`. `LAB` is the ssh target, never written down. |
| `setup.sh` | User `squeal-w19`, case root `~squeal-w19/runs/w19`, Node under `/opt/squeal-w19`; `prepare` knows s1 and s2 only (no s7, no `prepare-copy`); new `dry` (a squawk clone, install, `squeal start`, `status`, `stop`, then `leftover`, with no model call) and `leftover` (each process of the user with its cwd and command line, and its `/tmp` entries); `teardown` also removes the user's `/tmp` entries. |
| `as-user.mjs` | User `squeal-w19`. |
| `session.mjs` | User and case root as above; ids `s1-nn`, `s2-nn`. New for R6: 5 s after `squeal stop`, each process of the user whose cwd or command line lies under the clone or under its folder in `~/.cache/squeal/checkouts/<sha256(clone/.git)[0..16]>` goes to `leftover.txt` and `meta.leftover`, and is then ended, so it cannot load the next session. |
| `batch.mjs` | Stops starting sessions at $8 (the brief's stop line; round 4: $10); ids s1, s2. |
| `summarize.mjs` | Adds the `leftover` column from `meta.json`. |
| `prompts.json` | s1 and s2, word for word as round 4 (checked with `diff`). |
| `results.mjs` | Unchanged. |

023-10's `timeline.mjs` is copied beside them at run time, as in round 4.

## Where it ran

- **boat.dev first (06:39Z to 07:10Z).** A large sandbox (8 vCPU, 16 GB, Ryzen 9 9950X) was set up fully: the user, Node 24.21.0, Claude Code 2.1.327, Squeal 0.1.584 from `install.sh` and the hub at `cf42b11`, both sources, and the dry check (0 processes left). It had no model credential: no `ANTHROPIC_*` variable, no Claude login, and the account's AI credentials proxy off (`boat ai` answers 403 through the local API). The coordinator ruled out forwarding this host's credential. The human then chose the lab VM for this round only. The sandbox was deleted at 07:10Z: 3,699 billed seconds at the large type's double rate, $0.037. It ran no session.
- **The lab VM (07:10Z to 08:41Z)**, as round 4. Idle at the start (load 0.00, no user job, no earlier throwaway user). Setup steps as above, then the dry check, then s1-01 alone as a trial (175 s), then the other 19 sessions, 3 at once (`batch.mjs --parallel 3`, interleaved s1 and s2). Teardown removed the user, its home, `/opt/squeal-w19`, its 170 `/tmp` entries and the work folder; no uid-1002 file and no process was left.

## Data (`data/`)

- `judgements.tsv`: per session, `--run` used, both sides filled, the `--at` calls and their revisions, the calls on HEAD (and refusals), calls past 120 s (moved to the background), the answer's grade and reason, swaps, misread text, and the processes left after the session (R6).
- `summary.tsv`: as round 4's, plus `leftover`.
- `<id>/`: `timeline.txt`, `summary.json`, `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`.
- `batch.log`; `dry.txt` (the dry check on the VM).

The streams and transcripts were deleted with the work folder. One `git show` line in `s2-02/squeal-results.txt` named the commit's author; it reads `Author: [redacted]`.

## Things that cost time

- `nohup` and `setsid` keep the batch alive on the VM, but the ssh call that starts it does not return while the remote shell holds its output; start it inside `( … & )` with every stream redirected, and poll a file.
- A narrowed `--at … <file> --run` in Squeal's own repository can run the whole budget when an earlier `--run` left its files queued in the daemon (T1). Read the narrowed call's output from the stream: in 4 sessions the agent never read it.
