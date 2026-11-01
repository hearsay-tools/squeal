# Issue 133 throwaway probe

This is research evidence, not a product test. `duplicate.test.ts` deliberately
fails TypeScript with TS2783. Keep it out of repository test and typecheck globs.
No repository suite or build is needed. `node_modules` must stay out of git.

Examined: Node 24.22.1, pnpm 12.15.0, TypeScript 7.0.2, Vitest 5.0.3,
installed Squeal 0.1.390 on Linux, 2026-11-01.

## Re-run in an isolated directory

From the Squeal checkout with dependencies already installed. The copy below
is a safer repeat procedure, not the original setup: the observed run used a
shared `node_modules` symlink. Do not repeat that symlink, because pnpm changed
the target metadata. The independent-copy repeat procedure was not run here:

```bash
repo_root="$PWD"
probe_root="$(mktemp -d -t squeal-issue-133-XXXXXXXX)"
cp docs/specifications/011-core/research/probes/issue-133/{duplicate.test.ts,vitest.config.ts,tsconfig.json,package.json,squeal.config.json,.gitignore} "$probe_root/"
cp -a --reflink=auto "$repo_root/node_modules" "$probe_root/node_modules"
cd "$probe_root"
git init -q
cat /proc/loadavg
nproc
node -p 'require("os").cpus().length'
```

Skip live Squeal if the one-minute load exceeds the CPU count. This config includes
only `duplicate.test.ts`, uses one worker, and has no repository global setup.
The scratch repository has its own Squeal store. It has no commit or remote.

```bash
pnpm exec vitest run --config vitest.config.ts duplicate.test.ts
pnpm exec tsc --noEmit --pretty false -p tsconfig.json
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal start
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 duplicate.test.ts
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal why 'the spread wins at runtime' --json
```

Expected: Vitest exit 0; compiler exit 1 with TS2783; named Squeal status exit 0
with one current file. `baseline.onStart: lookup-only` avoids a checkpoint;
the named wait requests the unknown file once. No `run --all` is used.

Control: replace `{ size: 1, ...extra }` with `{ ...extra }`. Repeat the Vitest,
compiler and named-status commands. All exit 0. Then restore the duplicate and
add `// Reintroduce the type error after the passing control.` immediately above
`const entry`. Repeat compiler, named status and `why`. The comment gives fresh
bytes, so this edit tests a new key instead of reusing the first bad file's key.
The compiler now locates TS2783 at line 5. The fresh runtime result still passes.

```bash
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal stop
```

## Evidence

- `initial-output.txt`: initial commands and actual output excerpts.
- `control-output.txt`: captured control output and process exit codes.
- `reintroduced-output.txt`: captured edit output, process exit codes, and full
  `why --json` provenance for revisions 0, 1 and 2.

The first `pnpm exec tsc` also printed pnpm package-resolution progress
(`Packages: +12 -351`) despite no install command being requested. The declared
versions still resolved as above and a second compiler call produced only TS2783.
However, `node_modules/.pnpm/lock.yaml` and `.modules.yaml` changed in the worker
checkout, triggering broad background checks. The checkout daemon was stopped
with `squeal stop --until-start`; the dependency state was then repaired with
`pnpm install --offline --frozen-lockfile --ignore-scripts` (exit 0, 280 reused,
zero downloaded, no build). This was repair after the experiment, not initial
setup. The daemon remains stopped; no repository-suite pass is claimed.
The initial login shells also printed a Starship `TERM=dumb` warning. Neither
message is a compiler diagnostic; neither appears in the later non-login runs.
