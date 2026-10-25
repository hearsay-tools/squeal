# 015 wave 7: the complexity line names the changed files it did not judge

Briefed by coordinator 52e58f23 on 2026-10-25, from issue #96 (triage row gh-96), approved by the human as option (a). One worker, beside wave 6 (015-47) on a disjoint seam.

## W1: 015-49

Use /worker. Shape: slice. Starts from main. Outcome: a count in the complexity line never reads as if every changed file was checked; the files the session changed that are not judged are named, capped, with the reason.
- Read `spec.md` D6 (**The other side**, **A file too big to count**, **A changed file not judged**, `--told`) and D1, `research/issue-96.md`, the 2026-10-25 #96 line in `status.md`, and board row 015-49.
- **Lead.** `toldOver` and `withToldOver` in `src/core/delivery/code-told.ts`, `toldOverLine` in `code-format.ts`, the `tooBigTold` key in `code-deliver.ts` (who was told about which large file), and the uncountable files `squeal code` lists under `Not judged:`.
- **Owns.** `src/core/delivery/code-*.ts`, `src/core/types/code-delivery.ts`, `src/cli/code-report.ts`, `src/cli/code-coverage.ts`, and their tests; in `src/core/delivery/format.ts`, only the `toldOverLine` call. Leave `src/core/code/crap/**`, `src/core/code/pass/**` and `src/core/code/store/**` alone (015-47 runs there): read through their existing exports, and ask me before you need a new store query. Ask before you change any other text.
- **Done when.** The row's done-when on the board is a set of tests, red first. Notes go in `tasks/015-49/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.
