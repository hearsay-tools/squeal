# 023-63 notes: how round 8 ran

Row 023-63, wave 31, 2026-11-23. The results are in `../../lessons.md`, "Round 8 (023-63)". These notes are the residue: what changed from round 7's harness, where it ran, the browser, and where the data is.

## Scripts (`bin/`)

Round 7's scripts (`../023-56/bin/`, described in `../023-56/notes.md`), changed only where listed.

| Script | Change from round 7 |
|---|---|
| `deploy.sh` | Hub entry `1cb3f8f` ("squeal 0.1.609"), `install.sh` from `squeal--v0.1.609`; scratch `t/<id8>/w31`. `LAB` is the ssh target, never written down. |
| `setup.sh` | User `squeal-w31`, case root `~squeal-w31/runs/w31`. New steps: `browser-allow` and `browser-remove` (the AppArmor profile, below), and `browser [<spec>]` (a clone `brw` that runs squawk's own `pnpm run test:e2e -- <spec>`, without Squeal, so no store is seeded). |
| `as-user.mjs`, `session.mjs`, `batch.mjs` | User `squeal-w31`, case root `~squeal-w31/runs/w31`, Node under `/opt/squeal-w31`. No other change. |
| `summarize.mjs` | `estimates` also takes "time unknown" lines (V2's rest). New `lines8`: each `--at` line that names `open.test.ts` (W3) or "not selected" (W5), with the call's second. |
| `results.mjs`, `prompts.json` | Unchanged (`prompts.json` is byte-equal to round 7's). |

Claude Code stays at 2.1.327, as in rounds 4 to 7.

## Where it ran

The lab VM, allowed for this round (the human, 2026-11-23). At 12:59Z the 1-minute load was 0.00, no other user job ran, `~/work` was empty, no throwaway user from an earlier round was left, and `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` were present by name in the login shell. Order: setup (13:00Z); the browser proof (13:01Z to 13:13Z); the `dryat` check (`data/dry-at.txt`); s1-01 alone as a trial (166 s, $0.10); then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, s1 and s2 interleaved), 13:18Z to 14:00Z. Teardown at 14:00Z.

## The browser (Chromium for this round only)

squawk's browser files run through its own e2e environment: `.ai/scripts/test-env-up.sh` downloads `agent-browser` 0.39.4 (pinned in `.ai/scripts/test-env.inputs.json`) into `~/.cache/agent-tools`, and `agent-browser install` downloads Chrome for Testing 158.0.8127.36 into `~/.agent-browser/browsers`. Both went into the throwaway user's home, as the wrapper does by itself.

- **Why round 7 had no browser.** Chrome was there but could not start: Ubuntu 24.04 sets `kernel.apparmor_restrict_unprivileged_userns=1`, and Chrome died with "No usable sandbox!". `ldd` found no missing library. `--no-sandbox` by hand started it, but the wrapper's own retry with that flag still failed, and it reported "installed Chrome failed to launch with resolved settings" (the text round 7 saw).
- **What was added.** One AppArmor profile, `/etc/apparmor.d/squeal-w31-chrome`, shaped as Ubuntu's own `/etc/apparmor.d/chrome`: unconfined, with `userns`, for the path `~squeal-w31/runs/w31/home/.agent-browser/browsers/chrome-*/chrome` only (`setup.sh browser-allow`). No OS package was installed: the package list before and after the round is equal (877 packages).
- **Proof before s1.** As the throwaway user, `pnpm run test:e2e -- smoke.e2e.ts` in a clone at `8be977ad6` (`data/browser-proof.txt`). Before the profile: "E2E SKIPPED … installed Chrome failed to launch with resolved settings". With it: the wrapper ignored the file filter and ran every spec. 5 files ran in about 10 minutes: `quick-list` (43 tests, 114 s), `task-thread-layout` (35, 135 s), `github-sidebar` (23, 73 s), `thread-scroll` (18, 93 s) passed; `github-layout` failed 29 of 41 tests (30 s). The run was then stopped by hand.
- **Removed at the end.** `setup.sh browser-remove` unloaded and deleted the profile and deleted `~/.agent-browser` and `~/.cache/agent-tools`; the teardown then removed the user and its home.

## Data (`data/`)

- `judgements.tsv`: per session, round 7's columns, with one column per fix under test: W1 (all 13 unit files on both sides), W2 (a stale "still running"), W3 (`open.test.ts` at the commit: seconds from the first call, and in which call), W5 (the not-selected count in `--wait`), V2 (the estimate quoted, and what was measured), and the browser results per side.
- `summary.tsv`: as round 7's.
- `<id>/`: `timeline.txt`, `summary.json` (now with `lines8`), `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`.
- `batch.log` (the trial's line first), `dry-at.txt`, `browser-proof.txt`.

The streams and transcripts were deleted with the work folder. The `git show` line that named the commit's author reads `Author: [redacted]`; home paths read `~squeal-w31`.

## Things worth knowing next time

- **The browser files are slow and run one at a time.** squawk's e2e config sets `fileParallelism: false`. Alone, a file took 30 to 135 s. Beside two other sessions, the best side got 15 results in about 550 s (s1-02's working tree); the commit side got 1 to 8 results in 100 to 650 s. 96 files need an hour or more per side, so no 1,200 s session can compare them. A browser question needs a longer session or a prompt that names one browser file.
- **The two sides run the browser files in different orders.** In s1-03 the commit side had `activity`, `artifact-project-links` and `automations-github`, and the working tree had `agent-browser-tabs`, `chat-code-fence`, `command-palette` and others. So no browser file had both sides in any session.
- **4 browser files fail at file level on this VM** with `agent-browser set viewport 1440 900 failed` (`assistant-line-breaks`, `assistant-reply-copy`, `automations-disabled`, `automations` or `automations-github`), on either side. It is the environment under load, not the commit.
- **In s2 the commit daemon's first batch now holds 200 files** (round 7: about 65), so a named file that sits in it waits longer when it is not cut out.
- **The id `c294d61d-…` in every lease watcher's command line is the VM's boot id**, not a shared lease.
- `deploy.sh fetch` must run from `023-63/bin`.
