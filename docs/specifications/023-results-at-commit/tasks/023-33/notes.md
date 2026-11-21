# 023-33 notes: how round 5 runs

Row 023-33, wave 19, 2026-11-21. The results go to `../../lessons.md`, "Round 5 (023-33)". These notes are the residue: what changed from round 4's harness, the plan, and where the data is.

## Scripts (`bin/`)

Round 4's scripts (`../023-28/bin/`, described in `../023-28/notes.md`), moved to a boat.dev sandbox with 023-32's transport, changed only where listed:

| Script | Change from round 4 |
|---|---|
| `deploy.sh` | `BOX` (the sandbox id, never written down) instead of the VM's ssh target; `boat ssh` and `boat scp`; hub entry `cf42b11` (0.1.584), `install.sh` from `squeal--v0.1.584`; scratch `t/<id8>/w19`; `fetch` packs `logs/` without the streams and transcripts. |
| `setup.sh` | User `squeal-w19`, case root `~squeal-w19/runs/w19`, Node under `/opt/squeal-w19`; `prepare` knows s1 and s2 only (no s7, no `prepare-copy`); new `dry` (a squawk clone, install, `squeal start`, `status`, `stop`, then `leftover`, with no model call) and `leftover` (each process of the user with its cwd and command line, and its `/tmp` entries); `teardown` also removes the user's `/tmp` entries. |
| `as-user.mjs` | User `squeal-w19`. |
| `session.mjs` | User and case root as above; ids `s1-nn`, `s2-nn`; the sandbox's own variable names are redacted too. New for R6: 5 s after `squeal stop`, each process of the user whose cwd or command line lies under the clone or under its folder in `~/.cache/squeal/checkouts/<sha256(clone/.git)[0..16]>` goes to `leftover.txt` and `meta.leftover`, and is then ended, so it cannot load the next session. |
| `batch.mjs` | Stops starting sessions at $8 (the brief's stop line; round 4: $10); ids s1, s2. |
| `summarize.mjs` | Adds the `leftover` column from `meta.json`. |
| `prompts.json` | s1 and s2, word for word as round 4 (checked with `diff`). |
| `results.mjs` | Unchanged. |

023-10's `timeline.mjs` is copied beside them at run time, as in round 4.

## Sandbox

- Type large: 8 vCPU, 16 GB, created with `--ttl 43200` for this row. The CPU was a Ryzen 9 9950X.
- Round 4's VM had 12 CPUs and no Chrome. This sandbox has 8 vCPUs and `/usr/bin/google-chrome`, which the throwaway user's `PATH` reaches. So squawk's browser group can start here (as in 023-32), where it failed in round 4. This is a difference from round 4, not a change to the harness.
- Claude Code 2.1.327, as round 4 (the sandbox's own is newer; the case root has its own copy).

## Setup done (2026-11-21, 06:42Z to 06:44Z)

`setup.sh user node dirs claude hub install src`, then `dry`:

- `squeal --version` and `claude plugin list`: 0.1.584, installed by the release's `install.sh` from the hub at `cf42b11`.
- `dry`: a squawk clone at `8be977ad6`, `pnpm install --frozen-lockfile`, `squeal start`, `squeal status` (1,920 test files, all unknown on the empty store), `squeal stop`; afterwards 0 processes of the user.

## Blocker: no model credentials in the sandbox

The sandbox has no `ANTHROPIC_*` variable and no Claude login, and the account's AI credentials proxy is off. Round 4 passed the VM's own `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` by name. Forwarding this host's values is not allowed (the coordinator, 2026-11-21). The coordinator is asking the human for a credential on the boat account or another place. No session has run.
