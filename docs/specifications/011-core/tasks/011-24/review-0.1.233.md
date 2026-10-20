# Review of cand/0.1.233: the named output prints the selection

Use /reviewer. Shape: review. Pinned to the `cand/0.1.233` SHA named in the spawn; the range is from the base named there to that SHA. It holds row 011-28 (four commits, cherry-picked with `-x`), the release commit (0.1.233 and the bundles), a coordinator test repair the gate found (`test/cli/retry-no-result-daemon.test.ts` expected the long named output; the worker's checkpoint did not run it: say why if you can) and this brief. `src/cli` only: the key-format alarm stays silent and the format stays 20.

Read row 011-28, its brief (`tasks/011-24/briefs.md`, corrected 2026-10-20 for `--wait 0 <path>`), `tasks/011-24/design.md` sections 1.4, 1.5 and 5 R3 with its "most likely false" line, 005 D2 and C6 as amended 2026-10-20, 011 `status.md`'s 2026-10-20 line for 011-28, `tasks/011-28/notes.md` and the gh-42 and gh-44 samples. Check that:
- gh-44's E1 prints 3 lines ending with the verdict; `--full` gives the output 0.1.232 gives, and `--notes` implies it;
- `squeal status <path>...` without `--wait` syncs once within 750 ms, promotes nothing and exits 0, 1 or 3 for the selection; an edit the daemon has not stored within the bound gives no verdict (the "most likely false" line: an edit just before the call must never yield a stale exit 0). Try to break it with a probe in a throwaway repo, `HOME` and `XDG_*` pointed there;
- `--json`'s `named` payload has outcome `snapshot`; `--wait 0 <path>` stays a wait and sends no promotion;
- `test/cli/wait-reads.test.ts` passes and `selectNamedFiles`' closure read is unchanged (011-44's);
- HELP, the three `commands.md` copies and the evals parser say what the code prints, and the eval pins round-trip the real formatters, plain and hook JSON;
- nothing under `src/core/` moved.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; name each file that fails loaded and passes alone. Write `reviews/0.1.233.md` with a PASS or FAIL verdict and commit it.
