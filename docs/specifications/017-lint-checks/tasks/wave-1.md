# Wave 1: the ESLint provider and the daemon's lint pass

Two rows in parallel on disjoint folders, joined by the interface below. Each row copies it as written. At integration the coordinator points the pass's default factory at the provider (one line) and removes any duplicate of these types. Workers run on claude opus xhigh.

```ts
// src/core/lint/pass/provider.ts (017-05 owns the file; 017-04 matches it structurally)
// Amended 2026-10-26 on 017-05's design request: refresh() added, lint() takes no refresh, LintOff from refresh and lint.
export type LintRefresh = "none" | "instance" | "thread"; // spec 017 D4
export interface LintOff { readonly off: string } // open refused, or the provider turned itself off (D9: 3 restarts in 10 minutes)
export interface LintDeclaration {
  readonly tool: "eslint";
  readonly toolVersion: string;
  readonly providerVersion: number;
  readonly configFiles: readonly RelativePath[];
}
export interface LintFileInputs {
  readonly config: string; // calculateConfigForFile, as JSON
  readonly wholeProgram: boolean; // typed signals, or a known cross-file plugin's rules (D5)
}
export interface LintEnvironment {
  readonly closure: readonly RelativePath[]; // project files the config loaded, tsconfig files included (D4)
  readonly packages: readonly string[]; // package roots the config loaded
  readonly program: readonly RelativePath[]; // the tsconfig program's files, [] when none
  readonly env: Readonly<Record<string, string>>; // the keyed variables (D5)
}
export interface LintSnapshot extends LintEnvironment {
  readonly declaration: LintDeclaration; // may change after "thread" (a new ESLint install)
}
export interface LintRunReport extends LintEnvironment {
  readonly results: ReadonlyMap<RelativePath, { readonly findings: readonly LintFinding[] } | { readonly unknown: string }>;
}
export interface LintProvider {
  open(): Promise<LintDeclaration | LintOff>;
  refresh(level: LintRefresh): Promise<LintSnapshot | LintOff>; // applies the D4 level, then reports; "none" only reports
  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>>; // only files ESLint lints, as of the last refresh
  lint(files: readonly { readonly path: RelativePath; readonly text: string }[]): Promise<LintRunReport | LintOff>;
  close(): Promise<void>;
}
```

## 017-04 the ESLint provider in its own worker thread

Use /worker. Shape: slice. Outcome: a `LintProvider` that loads the project's own ESLint 9 or 10 in a worker thread and gives the CLI's results, contained.

Read: spec 017 D3, D4, D5, D9, goals 5, 6 and 9; `research/eslint-provider.md`, with its probe; 016 `research/binding-cost.md` finding 4.

Starting seam: a new `src/core/lint/provider/`. First edit, as a lead: port 017-01's 200-edit replay (`research/probes/eslint-provider/`) into a failing test that compares every step with a fresh `eslint` CLI run.

Owns: `src/core/lint/provider/**`; `test/lint/provider/**` and `test/fixtures/lint/**`; in `package.json` and `package-lock.json`, test-only dev dependencies: ESLint 9 (an npm alias), ESLint 10 and `typescript-eslint`; in `src/harness/build.ts`, only the bundle entry of the worker, as 015 D8's map worker has.

Leave alone: `src/core/lint/pass/**`, `src/core/lint/store/**`, `src/core/daemon/**`, delivery and status.

Done when:
- the replay equals a fresh CLI at every step on ESLint 9 and 10 (goal 5); each D4 refresh level, D9 row and `wholeProgram` signal has a test;
- a plugin that blocks, throws in a timer or exits gives `unknown` with the reason, the host's timers keep running (a heartbeat gap under 100 ms), and 3 restarts in 10 minutes turn the provider off (goal 6); nothing runs in the host's thread;
- `test/keys/key-format.test.ts` passes, or compare-refs at the last release tag is equal; lint and typecheck pass; no `npm run build`, no full suite.

## 017-05 the daemon's lint pass

Use /worker. Shape: slice. Outcome: a lint pass beside 015's code pass that keys, looks up, lints, judges and stores every included file's state, against a fake `LintProvider`.

Read: spec 017 D2, D5, D6, D7 and goals 1, 3, 7; `research/lint-seams.md` Q3; `tasks/017-03/notes.md`; `reviews/0.1.344.md` S1; `src/core/code/pass/` (read only) and `src/core/daemon/daemon.ts:646` as the template.

Starting seam: a new `src/core/lint/pass/`. First edit, as a lead: a failing test with a fake provider: two revisions, a hit, a miss and a config change, and the states and transitions D2 expects.

Owns: `src/core/lint/pass/**`, with `provider.ts` as above; in `src/core/lint/transition.ts`, the S1 fix only (count occurrences, not object identities); in `src/core/daemon/daemon.ts`, only the lines that create the pass while `lint.enabled` holds and give it the code pass's nudges, with the provider factory as an option that has no default yet; `test/lint/pass/**`.

Leave alone: `src/core/lint/provider/**`, `src/core/code/**`, delivery, status, the lint store's schema.

Pool slot, agreed with 011's coordinator on 2026-10-26 (spec 017 open question 2): go through `TierCapacity` (`src/core/scheduler/capacity.ts`), never the raw pool. An edit's own files lint under `running(1)`; the first pass and the idle re-lint take `take(1, "slow", 1, "backlog")`. Each releases in a `finally` at its part's end and never holds a lease across parts or while it waits for files. On `WAIT_FOR_CAPACITY` the part looks again at `CAPACITY_RECHECK_MS`. A test shows a backlog test tier's grant one smaller while a lint part holds its lease. `tasks/017-05/notes.md` measures the first pass over this repository: wall time and busy cores beside the real load. The coordinator amends 011 C10 and 011's `status.md` at integration.

First step: send me a request with the test's result and your design, including which idle signal re-lints `stale` files (004's slow tier), before you build past it.

Done when:
- with the policy off, no pass starts and no `lint.sqlite` appears (goal 1);
- every D5 key part re-keys its file; a second worktree at the same key lints nothing (goal 7); whole-program files get one program segment, the changed ones lint at once and the rest read `stale` until idle;
- a config change gives no per-file transition; parts hold at most 16 files, changed files first; S1 has a test;
- `squeal status --wait 60000` is green on `test/lint/` and the daemon tests you touch; key-format passes or compare-refs is equal; lint and typecheck pass; no build, no full suite.

## Review of the wave 1 candidate (017-04, 017-05)

Use /reviewer. The candidate is `cand/0.1.348` at `6e24679fa`. The range is `bf140a5b2..6e24679fa`: the five commits of worker 2e373245 (017-04), the eleven of worker 8f337351 (017-05), the coordinator's integration commit `c63cd9a61` (one interface file, and the `squeal daemon` command gives the ESLint provider) and the version raise with the bundle commit. `bf140a5b2` is 0.1.346 (017-03, review `reviews/0.1.344.md` PASS). Write `docs/specifications/017-lint-checks/reviews/0.1.348.md` and commit it alone on your branch.

Read: spec 017 goals 1, 3, 5, 6, 7 and 9, D3 to D7 and D9, as amended (`status.md`, 2026-10-26); this file's briefs; `tasks/017-04/notes.md`, `tasks/017-05/notes.md`; `research/eslint-provider.md` Q2 to Q4.

Check, with proof where you can:
1. Off by default: with no `lint` section, no pass starts, no worker thread or ESLint loads, no `lint.sqlite` appears, and status and delivery are as at `bf140a5b2`.
2. Containment: ESLint runs only in the worker thread, from the project's own install, never Squeal's; `cli/lint-worker.mjs` bundles no package. A plugin that blocks, throws or exits gives `unknown` and the host's timers keep running; the third failure in 10 minutes gives `off`.
3. Keys: each D5 part re-keys its file, `<root>` makes keys equal across worktrees, and the program segment covers the program, every linted file and the tsconfigs before any lint. Name every input that can change a file's findings without moving its key: that is the expensive failure. The notes name two known gaps (the policy narrows the program segment; modules that `eslint.config.ts` loads through jiti); say whether either is a break.
4. Whole-program files: the changed ones lint at once with changed program files fed, hits included; the rest read `stale` until idle.
5. Transitions: a config or environment change gives no per-file transition, across passes too; S1 counts occurrences.
6. Pool (agreed with 011): the scheduler's own `TierCapacity`; `running(1)` for an edit's files, `take(1, "slow", 1, "backlog")` for the first pass and idle re-lint, released in `finally`, never held across parts, never closed by the pass. Say what happens when `lint.enabled` turns off while the daemon runs.
7. Dependencies are dev-only; the `ts-api-utils` override and the `file:` toolchain change nothing at run time.
8. Stored keys: `test/keys/key-format.test.ts` passes; compare-refs at `squeal--v0.1.345` gives equal keys, uncovered 0, `KEY_FORMAT_VERSION` unchanged.

Run lint, typecheck, `test/lint/`, `test/code/pass/daemon.test.ts`, `test/scheduler/` files that touch capacity, the four harness bundle tests and key-format, on Node 22 and Node 24. No local full suite and no `squeal run --all` (human, 2026-10-25): read CI run 40336791244 for full-suite coverage and report its result as you find it. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
