# 015 wave 7: the complexity line names the changed files it did not judge

Briefed by coordinator 52e58f23 on 2026-10-25, from issue #96 (triage row gh-96), approved by the human as option (a). One worker, beside wave 6 (015-47) on a disjoint seam.

## W1: 015-49

Use /worker. Shape: slice. Starts from main. Outcome: a count in the complexity line never reads as if every changed file was checked; the files the session changed that are not judged are named, capped, with the reason.
- Read `spec.md` D6 (**The other side**, **A file too big to count**, **A changed file not judged**, `--told`) and D1, `research/issue-96.md`, the 2026-10-25 #96 line in `status.md`, and board row 015-49.
- **Lead.** `toldOver` and `withToldOver` in `src/core/delivery/code-told.ts`, `toldOverLine` in `code-format.ts`, the `tooBigTold` key in `code-deliver.ts` (who was told about which large file), and the uncountable files `squeal code` lists under `Not judged:`.
- **Owns.** `src/core/delivery/code-*.ts`, `src/core/types/code-delivery.ts`, `src/cli/code-report.ts`, `src/cli/code-coverage.ts`, and their tests; in `src/core/delivery/format.ts`, only the `toldOverLine` call. Leave `src/core/code/crap/**`, `src/core/code/pass/**` and `src/core/code/store/**` alone (015-47 runs there): read through their existing exports, and ask me before you need a new store query. By agreement (2026-10-25, the worker's request `ce3fa6ca`, option 2): the pass records a could-not-count file's edit revision beside `tooBigEdits`, kept across retries, restart retries and recounts, in `src/core/code/pass/too-big.ts` and the place in `pass/**` that writes failed counts, as its own commit; no schema, record or key change; `delivery.ts` unchanged. Ask before you change any other text.
- **Done when.** The row's done-when on the board is a set of tests, red first. Notes go in `tasks/015-49/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## 015-51: review of candidate 0.1.312 (wave 7)

Use /reviewer. Candidate `cand/0.1.312`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: 015-49 (two commits: a failed count keeps its edit revision; the complexity line names the changed files not judged), one coordinator commit (the `squeal code` help text) and one build commit (bundles, version 0.1.312). Write `docs/specifications/015-coverage-complexity/reviews/0.1.312.md` and commit it on your branch.

Read `spec.md` D6 (**The other side**, **A file too big to count**, **A changed file not judged**, `--told`) and D1, `research/issue-96.md`, `status.md` (2026-10-25), `tasks/015-49/notes.md`, and this file's W1 with its two agreements.

Check, with proof where you can:
1. **The line.** It names at most 3 files the session's own edit changed that are over `complexity.maxFileBytes` or could not be counted, newest edit first, each with its reason, then `and N more`. It comes on every test-news delivery while such a file stands, with or without a function told over. Another session's file, an unedited large file and a file judged again (shrunk, or counted) are never named. The issue's case (a 572 KiB file the session edited) is named.
2. **Ownership.** A failed count's edit revision survives a retry, a restart's retries and a recount, and a first count records none, as the too-big rule does (015-39). No schema, `user_version`, record or result-key change.
3. **`--told`** lists exactly the files the line names, uncapped, from the same read; plain `squeal code` still lists every file not judged. `--json` keeps its shape.
4. Every text with no file not judged is byte-identical to main, in every harness.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
