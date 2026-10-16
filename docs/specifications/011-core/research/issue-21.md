# Issue 21: config problems are invisible to `squeal status`

## Verdict and provenance

Reproduced on 0.1.199, with one difference from the issue: `squeal status` exits 1 in a repository with no store, not 0. In a scratch Git repository whose `squeal.config.json` holds `"inputs": { "a.test.mjs": ["!docs/**"] }`, `squeal status` and `status --json` say only that there is no store; `setup --check` names the problem and exits 1; `setup --plan --json` names it under `config.problems` and `outdated` and exits 0. A valid-config control gives the same `status` output, and `setup --check` exits 0 with `Nothing is outdated.`

Host load at the start: `17.35 27.06 25.43` on 24 CPUs (`nproc`), so the live run went ahead. Load during the probes: `17.31`; at the end: `18.81`. CLI exercised: 0.1.199, `~/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`, run with `node` directly and once through the PATH launcher `~/.local/bin/squeal`, which also resolved 0.1.199. Checkout: 0.1.203 (`package.json`) at `7122a0c3`, not exercised. No daemon, store, build, install or test suite was started; `.git/squeal` was absent after every run.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `status` mention a config problem with no store? | No. Output is the same for a negated, a valid and a brace glob. | verified by experiment, 0.1.199 |
| 2 | Exit of `status` with no store | 1, not the issue's 0; also 1 through the launcher and under a pipe (`PIPESTATUS` `1 0`) | verified by experiment, 0.1.199 |
| 3 | Does `setup --check` report it? | Yes, under `Config:` and `Outdated:`, exit 1 | verified by experiment, 0.1.199 |
| 4 | Does `setup --plan --json` report it? | Yes, `config.problems` and `outdated`, exit 0 | verified by experiment, 0.1.199 |
| 5 | Valid control | No problem lines, `Nothing is outdated.`, `--check` exit 0, `status` unchanged | verified by experiment, 0.1.199 |
| 6 | Does `status` show it when a daemon has run? | Probably yes, as a daemon note, but not tested | read in source code, 0.1.199 dist; not run |
| 7 | Owning spec sections | 011 C6 (status), C10 (loader and its one note), C8 (session header); 005 D3 (`setup --check`) | read in spec, 011 at `7122a0c3` |

## Findings

**Issue report versus evidence.** [#21](https://github.com/hearsay-tools/squeal/issues/21), labelled `friction`, is agent-reported. Its cezarion#1099 history (the brace and fixtures globs, the request to confirm with `squeal status`) was not inspected here. Its scratch case was reproduced, apart from the exit code: issue "exits 0", observed exit 1 in every way it was run. What produced the issue's 0 is not determined, because the reporter's command line is not recorded.

**Q1 to Q5, outputs** (full captures in `probes/issue-21/output-*.txt`; scratch paths abbreviated):

```
$ squeal status                      # negated, valid and brace alike
Status unavailable, no Squeal store at /tmp/…/repo/.git/squeal/store.sqlite
[exit 1]
$ squeal status --json
{ "schemaVersion": 1, "available": false, "reason": "no-store", "message": "status unavailable, no Squeal store at …" }
[exit 1]
$ squeal setup --check               # negated
Config: squeal.config.json exists, tracked by git
  problem: "inputs" has a glob Squeal cannot use: squeal: negated input glob is not supported: !docs/**
Outdated:
  squeal.config.json: "inputs" has a glob Squeal cannot use: squeal: negated input glob is not supported: !docs/**
[exit 1]
$ squeal setup --plan --json         # negated
"config": { …, "problems": ["\"inputs\" has a glob Squeal cannot use: squeal: negated input glob is not supported: !docs/**"] }
"outdated": ["squeal.config.json: \"inputs\" has a glob …"]
[exit 0]
$ squeal setup --check               # valid control
Nothing is outdated.
[exit 0]
```

The brace variant, `docs/**/*.{md,txt}`, the form cezarion#1099's agent wrote, has no problem on 0.1.199: its output equals the valid control's (`diff` shows only the paths). This verifies brace syntax for the probe's pattern, not the exact cezarion edit; the negated probe is a problem.

**Q1, why.** `withStatusStore` (0.1.199 `dist/cli/squeal.mjs` around line 6493) opens the store with `create: false` and returns `unavailable("no-store", …)` before anything reads `squeal.config.json`. Read in source code.

**Q6, with a store.** The daemon's `#notePolicyProblems` (line 50075) writes one note, `squeal.config.json: <problems>; the defaults apply in their place`, and `#reloadPolicy` notes `squeal.config.json changed; policy reloaded: <problems>`. `status` prints stored daemon notes under `Notes:` (line 46186). So a worktree with a daemon that loaded the bad config most likely shows the problem in `status`, but phrased as a daemon note, only after a daemon read the file, and subject to C6's per-worktree note bound. Not verified, because starting a daemon was out of scope. Whether the issue's "never mentions the config" held in cezarion, where a daemon presumably ran, is not determined.

**Q7, owning sections.** 011 C10 owns the loader: it "never throws: unknown keys and wrong types are reported as problems, the defaults apply for those keys, the daemon persists one note". 011 C6 owns the snapshot, which lists "the latest persisted daemon notes" but no config check of its own and says nothing about a no-store read. 011 C8 owns the header injected at registration; the issue's "and the session header" is a C8 change for every harness. 005 D3 owns `setup --check`, which "exits 1 … when `squeal.config.json` does not parse or fails validation". A change to `status` is a C6 amendment; reusing `setup`'s check in it crosses into 005 D3's surface.

## Recommendation for Squeal

Treat #21 as reproduced, scoped to 011 C6: `status` (text and `--json`) runs the same policy loader `setup --check` uses on the worktree's `squeal.config.json` and names each problem, with or without a store, so the no-store branch is covered too; a valid config adds nothing. That fits vision "pull state" and the machine-first rule if the JSON gains an additive field (shape not designed here). Correct the issue's exit-code claim before writing acceptance criteria. Whether the session header (C8) also names it is a separate choice, since it reaches every harness. Existing holds stand.

## Open questions

1. With a running daemon, does `status` already show the policy note, and does the note bound evict it? Needs a daemon, which this probe did not start.
2. Should `status` with no store exit 1 when the config also has problems, or keep its no-store exit?
3. Where did the issue's exit 0 come from?

## Sources

- Issue: `gh issue view 21 --repo hearsay-tools/squeal`, read 2026-10-17.
- Spec: `docs/specifications/011-core/spec.md` C6, C8, C10 and `status.md` at `7122a0c3`; `docs/specifications/005-agent-adoption/spec.md` D3.
- Source: `~/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`, lines 2869 (`describeProblems`), 2883 (`compiles`), 6485 to 6527 (`withStatusStore`), 46186 (`Notes:`), 50075 and 50092 (policy notes).
- Probe: `probes/issue-21/probe.sh` and `output-negated.txt`, `output-valid.txt`, `output-brace.txt`. Commands: `cat /proc/loadavg`, `nproc`, `sh probe.sh negated|valid|brace`. The launcher check ran by hand in a scratch repository: `squeal --version` (0.1.199, exit 0), `squeal status` (exit 1), `squeal status | cat` (`PIPESTATUS` `1 0`).
