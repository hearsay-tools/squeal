# 011-162 probes (THROWAWAY)

Throwaway experiments for `../design.md`. Not product code. Do not import from here. Raw output of the runs the design quotes: `output.txt`.

- Node 24.21.0, pnpm 12.11.2 (cezar's `packageManager`, a Rust binary) and 10.32.0 (JavaScript), Linux, 24 CPUs. One-minute load 21 to 30 during the runs; each timing in `output.txt` names its load.
- Everything ran in `/tmp/p162`: `git clone`s of `/home/agent/projects/cezar` at `28be188dc` (never `git worktree add`), `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `TMPDIR` under `/tmp/p162`, pnpm's `--store-dir` under `/tmp/p162`. Installs used `--ignore-scripts`: no count needs a script, since only Vite's closure walk runs, and no test. No daemon, no Squeal store, no agent tooling, no build. cezar's live installs were read only (`trust.mjs`, `lockread.mjs`). The clones are removed.
- `npx tsx` runs `measure-pnpm.mts` from the Squeal worktree root, so it reads this tree's `src/`.

| File | What it does |
|---|---|
| `pnpm-graph.mjs` | The design's lookup, identity and trust rule as a prototype: `readInstall` (lock.yaml, `.modules.yaml`, the folder map from pnpm's `depPathToFilename`), `staleLock` (section 3), `PnpmGraph` with `InstalledGraph`'s `identities` and `opaque`, so the core's `dependencyKeys` takes it unchanged. Parses with the `yaml` package (the line reader is `lockread.mjs`). |
| `measure-pnpm.mts` | Question 7. Walks two clones through Squeal's Vitest adapter, each over its own install, and keys every test file today (whole fingerprint) and under the design. Counts kept files and the fallback cases. `EDGES=0` keys identities without their edges. |
| `dirnames.mjs` | Whether pnpm 10's `depPathToFilename` over every `snapshots:` id gives exactly the `.pnpm` folder names the installing pnpm wrote. |
| `lookups.mjs` | Every package import the adapter reported, then every snapshot edge, against Node's own lookup on disk (`<dir>/node_modules/<name>`, each parent, realpath). |
| `orphans.mjs` | After `pnpm update`: folders no snapshot names, and whether any symlink points into one. |
| `trust.mjs`, `trust.sh` | Section 3's rule over installs, read-only; `trust.sh` breaks a fixture install one way at a time and asks pnpm (`install --frozen-lockfile --offline`) too. |
| `lockread.mjs` | A line reader for the three parts of `lock.yaml` a key reads, compared with the `yaml` package's parse: equal output, time of each. |
| `layouts.sh`, `modules-fields.mjs` | One small workspace under `isolated`, `nodeLinker: hoisted`, `shamefullyHoist`, `publicHoistPattern`, `enableGlobalVirtualStore` and an injected workspace dependency: where `lock.yaml` and the packages lie, what `.modules.yaml` records. |
