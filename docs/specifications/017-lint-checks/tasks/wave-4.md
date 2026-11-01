# Wave 4: ESLint repairs from dogfood 017-13, beside the oxlint provider

Three workers on disjoint files. Read `../spec.md` D2 to D5, D9 and D11, and `../lessons.md` Round 1. Test first. Run `squeal status --wait 60000 <changed-path>...`, lint and typecheck. Do not run `pnpm run build`. Do not request a full suite. Your final message lists the decisions the spec did not settle, and any type change. Edit no board, `spec.md` or `status.md`; write `tasks/<row>/notes.md`.

## W1: 017-17, 017-18, 017-19, 017-20, the ESLint worker

Use /worker. Shape: repair. **Outcome:** the ESLint worker runs from the project root, survives a cold typed start, loads a config that pnpm's shim loads, and recovers after an install with no daemon restart. The rows and their done-when are `lessons.md` Proposed rows L3, L4, L1 and L2.

- **Starting seam:** `src/core/lint/provider/session.ts` (constructed with `cwd: root`, but `process.cwd()` in the worker still returns the daemon's directory). First edit: in the worker entry, make `process.cwd` return the root before ESLint loads. Then raise `PROVIDER_VERSION` (`protocol.ts`).
- **L4:** `eslint-provider.ts` and `thread.ts` guards. The 5 s guard starts after the worker reports its program built; the build gets its own start budget.
- **L1:** discovery in `session.ts` and `worker.ts`. **L2:** `src/core/lint/pass/refresh.ts`.
- **Own:** `src/core/lint/provider/*.ts`, `src/core/lint/pass/refresh.ts`, `test/lint/provider/**`, new files under `test/lint/integration/`. **Leave:** `src/core/lint/provider/oxlint/`, `fingerprint.ts`, `transition.ts`.

## W2: 017-22, a line number inside a message

Use /worker. Shape: slice. **Outcome:** a pure code move gives no lint transition when a rule's message names a line (`lessons.md` L5).

- **Starting seam:** `src/core/lint/fingerprint.ts` `lintFingerprint`. First edit: normalize `line N` and `(at line N)` in the message before sorting.
- An upgrade must give no false notice: a file judged under the old fingerprint and unchanged reads no transition.
- **Own:** `src/core/lint/fingerprint.ts`, `src/core/lint/transition.ts`, `test/lint/transition.test.ts`, a new fingerprint test. **Leave** everything else.

## W3: 017-14, the oxlint provider

Use /worker. Shape: slice. **Outcome:** a module that runs a project's own oxlint per D11 and returns `LintFinding`s or `unknown` per file. It is not yet wired into the pass; that is row 017-15.

- **Read:** `research/oxlint-provider.md` and its probes (`replay.mjs`, `observe.mjs`, `contain.mjs`). Shape the module after `src/core/lint/pass/provider.ts`'s `LintProvider`. Where that interface does not fit (no reload levels, the `--import` preload's reads as held bytes), write the needed change in `tasks/017-14/notes.md`. Do not edit the interface.
- **Done when:** the probe's replay modes A and C equal a fresh CLI run; a blocking, throwing or exiting plugin gives `unknown` and kills the process group; a root with `options.typeAware` reads D11's off line; oxlint below 1.65 reads off; columns are UTF-16.
- **Own:** `src/core/lint/provider/oxlint/**`, `test/lint/oxlint/**`, and an `oxlint` devDependency in `package.json` and `pnpm-lock.yaml` (`pnpm add -D`). **Leave** everything else.
