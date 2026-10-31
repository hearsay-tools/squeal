# Throwaway crash/cancel probe

Diagnosis for wave 64 R1. Do not ship these files. The probe imports unchanged Squeal source. It creates one private `/tmp/squeal-crash-cancel-*` fixture, links installed dependencies, and removes its fixture after each invocation. No dependency files are committed.

Source: Squeal `4e66b4b52`, Vitest 5.0.3, Node 22.19.0. The source files studied have no diff from CI candidate `fa02d697cc9ef33134838175aa18faa819be2486`. CI's source and installed runtime excerpts are preserved beside this README.

## Run from the repository root

Use the existing installation; do not install. The explicit pnpm setting is required for scratch copies with linked dependencies.

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH pnpm --config.verifyDepsBeforeRun=false exec tsx docs/specifications/011-core/research/probes/ci-crash-rekey-stall/adapter.mts
env -u PLUGIN_ROOT -u PLUGIN_DATA PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH pnpm --config.verifyDepsBeforeRun=false exec tsx docs/specifications/011-core/research/probes/ci-crash-rekey-stall/adapter.mts --fresh
```

The child rewrites its own test file. It then sleeps with `Atomics.wait` until the parent writes a release file. It cannot service graceful-cancel IPC during that hold. The wrapper calls the real `cancelCurrentRun` and only then writes the release. Thus Vitest has captured an active task before the child SIGKILLs itself. This uses no artificial CPU load.

Normal mode proves that the first crash leaves a pending cancellation, then observes that the second run reaches Vitest but spawns no worker. After 500 ms it aborts that second run so the existing 1 s + 5 s force-stop path can clean up. The `completed` cleanup report includes `workers did not stop`; it is not a passing result for the second file. Fresh mode closes and reopens the public adapter after the first crash, then requires the rewritten file to complete. It does not patch any product function. Each mode uses one real worker at a time.

## Actual observations

- `adapter-output.txt`: final normal mode, exit 0. First run crashed; same cancellation pending; first child gone; two `runTestSpecifications` calls; workers spawned stayed 1; no second log. Forced-stop cleanup finished.
- `fresh-output.txt`: final fresh mode, exit 0. Two instances created; fixed file completed with one test result.
- The first exploratory normal mode also reproduced the gap with an asynchronous child wait. The preliminary fresh mode instead got `completed` for the first run (`initial-control-output.txt`, assertion failure). Graceful cancellation could win while the child serviced IPC. The final probe uses the blocking sleep above. Four adapter-probe invocations total: two exploratory and the two final modes. These are not repetitions of the scheduler test.
- `original-output.txt`: **one** unchanged scheduler test invocation, one passed, 14 skipped, 3.39 s. It ran alone from `/tmp/squeal-crash-rekey-zbHndJ/source`, made with `git archive HEAD src test vitest.config.ts package.json tsconfig.json`, plus a `node_modules` symlink. Command:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH pnpm exec vitest run test/scheduler/runs.test.ts -t 'runs a file again when a batch during its crashed run gave it a new key' --maxWorkers=1
```

Launch load was below 24 CPUs (recorded readings 3.45–4.69). No full-suite run, build, or load generation was requested. The probe's fixture assertions are its validation; Squeal does not select a test for this research script.

**Environment side effect:** the original-test command omitted `--config.verifyDepsBeforeRun=false`. pnpm attempted an automatic dependency install through the scratch copy's symlink. It reported `Packages: -13`, then `ERR_PNPM_IGNORED_BUILDS`, and continued to the named test. Squeal saw `node_modules/.pnpm/lock.yaml` change and queued 1349 test files. This was not an explicit install or full-suite request. It means the initial inherited status is not completion evidence. The parent was told. No repair install was run; both final controlled modes disable pnpm's check. `original-output.txt` retains the whole warning. The script used no real harness session or real-HOME fixture.

`status-output.txt` records the final scoped Squeal read. Its global pending/unknown counts, if any, are not a pass. No lint, typecheck or build is claimed: only research files changed.
