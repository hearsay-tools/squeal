# Wave 5: oxlint in the daemon, beside ESLint repairs and Stop news

Three workers and one researcher, on disjoint files, from main 0.1.391. Read `../spec.md` D1 to D11 and `../lessons.md` Round 1. Workers: test first; run `squeal status --wait 60000 <changed-path>...`, lint and typecheck; do not run `pnpm run build` or a full suite; at high load, name the pending files and finish. The final message lists the decisions the spec did not settle and any type change. Edit no board, `spec.md` or `status.md`; write `tasks/<row>/notes.md`.

## W1: 017-15, oxlint in the pass, policy, store and lines

Use /worker. Shape: slice. **Outcome:** with `lint.enabled`, a project with oxlint installed gets oxlint checks beside ESLint's, as D11 says, and ESLint-only output stays byte-identical.

- **Read:** `tasks/017-14/notes.md`, "Where `LintProvider` does not fit" and "What 017-15 must know".
- **Starting seam:** `src/core/types/lint.ts` `LintTool`, then `src/core/lint/pass/provider.ts` `LintDeclaration.tool`. Then one pass per provider, from `src/cli/daemon.ts:39` `lintProvider`.
- **Policy:** `lint.tools`, default `["eslint", "oxlint"]` (`src/core/daemon/policy-lint.ts`), with a key-validity case (D1).
- **Lines:** `FAIL lint: src/a.ts (oxlint): ...` (D11) in `src/core/lint/surface/format.ts`; `squeal lint` and `--json` name the tool.
- **Own:** `src/core/types/lint.ts`, `src/core/lint/pass/**`, `src/core/lint/store/**`, `src/core/lint/surface/format.ts` and `report.ts`, `src/core/daemon/policy-lint.ts`, `src/core/daemon/daemon.ts` (only the lint wiring), `src/cli/daemon.ts`, `src/cli/` lint command files, `src/core/lint/provider/oxlint/**` (only the small adjustments the notes name), and `test/lint/**` except `test/lint/provider/` and `test/lint/wiring/`. **Leave:** W2's and W3's files.
- **Done when:** a fixture with both tools gives two checks per file; an oxlint finding is delivered as D11's line; the 017-12 replay modes A and C through the daemon equal a fresh oxlint run; ESLint-only output is unchanged; `lint.tools: ["eslint"]` starts no oxlint process; key-format passes or compare-refs equal.

## W2: 017-24 and 017-27, the ESLint worker

Use /worker. Shape: repair. Rows and done-when on the board; `lessons.md` L7; `reviews/0.1.391.md` N1.

- **017-24:** with ESLint 9 and a nested `eslint.config.*` in the listing, the worker adds `v10_config_lookup_from_file` to `ESLINT_FLAGS` (D3 step 4), and `ESLINT_FLAGS` is keyed (D5).
- **017-27:** relative `statSync`, `existsSync`, `readdirSync` and the other relative file-system calls in the worker resolve against the root. One owner for the redirection, in `wraps.ts` or a new file.
- **Own:** `src/core/lint/provider/*.ts` (not `oxlint/`), `test/lint/provider/**`. **Leave** everything else.

## W3: 017-23, lint news at Stop

Use /worker. Shape: slice. D8 "At Stop": a lint change not yet told is news at Stop by itself, as a test change is. Stop holds once, tells it and never repeats it. A result that is not stored at Stop is not waited for. With `lint.blocking` off, Stop holds no further.

- **Starting seam:** `src/core/lint/surface/deliver.ts` (lint at Stop "only beside other news", `tasks/017-10/notes.md` decision 2) and `src/harness/shared/stop.ts`, `stop-lint.ts`.
- **Own:** `src/core/lint/surface/deliver.ts`, `news.ts`, `src/harness/shared/stop*.ts`, `src/core/delivery/delivery.ts` (lint parts only), `test/lint/wiring/**`, `test/harness/shared/` stop tests. **Leave** W1's `format.ts` and `report.ts`.
- **Done when:** in each harness, a lint change alone at Stop is told once; a second Stop is not held; a test change and a lint change at one Stop are told together once; the eval parser test on real formatter output still reads lint as code lines.

## R1: 017-26, where the lint daemon's memory goes

Use /researcher. Read-only on the product; scratch repositories under `/tmp` with their own `HOME` and `TMPDIR`. Measure RSS (not CPU) of the daemon and of the ESLint worker on a saas-like Nx fixture with no typed rules and a Svelte-like fixture with typed rules: at start, after the first pass, idle. Split the RSS between the ESLint instance, TypeScript, the program walk, the held-bytes maps and the daemon. Recommend a bound or a D10 amendment. Own `research/lint-memory.md` and `probes/lint-memory/`.
