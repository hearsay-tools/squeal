# 011-162 brief: design, per-package keys from pnpm's installed `lock.yaml`

The human, 2026-10-23: "Coordinate 011-162", after the question whether Squeal works in pnpm projects (task 793f861a). A design row first; code rows after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-162/design.md`, which the human can accept as an amendment to 011 C11.

Read: board row 011-162; 011 C11 and C3 (the key-format bullet); 013 V6 (what Vitest reports as packages); `001-core-loop/research/per-package-keys.md` F2 with its probes `001-core-loop/research/probes/per-package-keys/` (the fixture already ran under pnpm 10); `tasks/011-85/design.md` and board row 011-90 (rows read under the former definition); `src/core/keys/environment.ts` (`installedDependencies`, `graph` at `:257`), `packages.ts` (`InstalledGraph`), `pnpm-lockfile.ts`, `hidden-lockfile.ts`, `dependencies.ts`; `test/keys/key-format.test.ts` and `test/keys/validity/`.

Answer each question of the row's scope, each with a recommendation and the rejected options:

1. **Lookup.** How a package entry Vite resolved under `node_modules/.pnpm/<id>/node_modules/<name>/`, and a bare or required specifier from a project file, map to a `snapshots:` entry; peer suffixes in snapshot ids; `link:` workspace dependencies.
2. **Identity.** What a key holds in place of `location@version#integrity`, equal across two worktrees with equal installs.
3. **Trust.** When `lock.yaml` stands for the install, as `staleHiddenLockfile` decides for npm (task 001-104).
4. **Layouts.** Whether `node-linker=hoisted`, `shamefully-hoist`, `public-hoist-pattern`, and pnpm 10's global virtual store (packages outside the worktree) change the lookup or force the whole fingerprint.
5. **Opacity.** How C11 case (4)'s package scan finds a package's folder under `.pnpm`.
6. **Release cost.** Does the change re-key every check of a pnpm project once, or can a lookup read the whole-fingerprint rows as 011-90 does? Does the key-format alarm name a case?
7. **Count.** On a pnpm repository, between two installs a lockfile change apart, how many test files keep their key, and how many fall back through which of C11's five cases. A lead: a `/tmp` clone of cezar (`/home/agent/projects/cezar`) converted with `pnpm import`, which compares directly with C11's npm figure of 265 of 632; a public pnpm repository is the alternative. Say which you used.

Include the C11 text as a draft, and the decisions for the human at the top (as `tasks/011-62/design.md` does). Name each code row in order with its seam, owned files and the tests it lands red first: in a pnpm fixture a bump of a package one test file imports re-keys that file only; C11's five fallback cases still key by the whole fingerprint; a missing or unparsable `lock.yaml` keeps the whole fingerprint; a key-validity case covers the new path. Planned row 011-158 also changes keying (`src/core/scheduler/keying.ts`) and may move the key format: if a code row of yours crosses it, say so.

Owns `tasks/011-162/` only, probes under `tasks/011-162/probes/`. Leave alone: spec, status, board, product code, other rows' folders.

The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal a process. Probes run in a `git clone` under `/tmp` (never `git worktree add`: it shares the live store), with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `TMPDIR` under `/tmp`, and pnpm's `--store-dir` under `/tmp`. Install with `--ignore-scripts` unless a count needs the scripts, and say why. A scratch daemon uses `baseline.onStart: lookup-only`, no slow lane, at most 4 test workers. Run no agent tooling and nothing under `evals/bin/`. No build. Remove your clones at the end. Record the one-minute load beside every timing.

Test runs: run single test files only. A full-suite verdict, if a probe needs one, is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so.

Done when `design.md` answers questions 1 to 7, each answer tagged `measured`, `read in source code`, `read in official docs` or `inferred`, and is committed. Stop at the human's dated acceptance.
