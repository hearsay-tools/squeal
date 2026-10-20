# Review of cand/0.1.234: `squeal status` leads with its verdict

Use /reviewer. Shape: review. Pinned to the `cand/0.1.234` SHA named in the spawn; the range is from the base named there to that SHA. It holds row 011-29 (seven commits, cherry-picked with `-x`), the release commit (0.1.234 and the bundles) and this brief. The first commit moves the per-file standing from `src/cli/named-files.ts` and `named-standing.ts` to `src/core/status/standing.ts` and `standing-facts.ts` with no behaviour change (the coordinator's decision, `tasks/011-29/notes.md`). The key format stays 20.

Read row 011-29, its brief (`tasks/011-24/briefs.md`), `tasks/011-24/design.md` sections 1.1 to 1.3, 3 and 5 R4 with its "most likely false" line, C6 as amended 2026-10-20, `tasks/011-29/notes.md` and the gh-44 E1 and gh-41 E1 samples. Check that:
- gh-44's E1 worktree prints the 7 lines of design 1.1; `--full` adds only detail (worktree, daemon, inheritance, the per-file list, closure method, schema, notes) and `--notes` implies it. The "most likely false" line: nothing an agent acts on moved behind `--full`. Try to break it;
- every listed test file that is not current is in exactly one `Outstanding:` group, the slow files the `Slow tier:` line counts left out (except gh-46's case), and each group's command is right for its files, including the order rule (a claim before stale or unknown);
- a down daemon, a stopped daemon and a daemon that died still say so in the default text, since the `Daemon:` line moved behind `--full`;
- the commit that moves the standing changes no behaviour: the named-wait tests pass unchanged at it;
- the pathless wait prints the default text, and its quiet line says the wait does not hold for the rest of the worktree;
- `squeal run --all --wait` and `squeal start` print the default text;
- `status --json`'s `outstanding` matches the text, and `readStatus`'s extra reads cost what the notes say;
- HELP, the three `commands.md` copies and the evals parser say what the code prints, and the eval pins round-trip the real formatters, plain and hook JSON.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; name each file that fails loaded and passes alone. Write `reviews/0.1.234.md` with a PASS or FAIL verdict and commit it.
