# 018-19 notes: node:test keyed without a path (D12)

Worker 4c277630, 2026-11-09. For the coordinator and whoever touches the node:test environment next.

## Where things are

| Part | File |
|---|---|
| The probe of the project's Node and the environment it keys | `src/runners/node-test/adapter-environment.ts` (`PROBE`, `probeNode`, `projectEnvironment`) |
| Callers | `src/runners/node-test/adapter-project.ts` (probe at open and after a missing Node returns), `adapter.ts` (a project whose graph does not build) |
| D12 tests | `test/runners/node-test/environment-build.test.ts` |
| The validity case text that named old keys | `test/keys/validity/cases/adapter/node-test.ts` ("a run with coverage off ...") |

## What changed

- The probe prints `process.version`, then one JSON line with keys sorted at every level: `{ arch, config, platform, versions }` from the project's own Node. The daemon hashes that line's text with sha256 and does not parse it. `resolvedConfig` holds `nodeBuild` (the hash) where `execPath` was. `runnerVersion` is still `process.version`.
- `NodeProbe` (exported type, node:test only): `{ ok: true; version; build }` in place of `{ ok: true; version; execPath }`.
- `node` (the config text) stays keyed. An absolute `node` in a user's config still keys the path, as any config text does.

## Decisions the spec left open

1. **No adapter version raise.** The brief said "Raise `NODE_TEST_ADAPTER_VERSION`". The key-format alarm refuses an adapter raise unless a case of its kinds has equal keys and different outputs (`test/keys/validity/verdict.ts`, `componentFailures`; pinned by `key-format.test.ts` "an adapter-only bump ... fails its own verdict alone"). Here every node:test case's keys differ (`execPath` left `resolvedConfig`), so no such case can exist, and the raise would fail the alarm. It is also not needed: no old `resolvedConfig` can equal a new one, so every node:test environment hash moves once, as D12 wants. `KEY_FORMAT_VERSION` and the other adapters' versions are unchanged.
2. **One hash for the whole build**, not separate `versions`, `config`, `platform` and `arch` fields. The first commit parsed the probe's JSON and keyed four fields. The alarm then failed on the `catch` of that parse, a changed line no validity case runs. Hashing the text needs no parse and no new branch. Cost: an import's environment difference names `nodeBuild` as a whole, not which part of the build differs; `runnerVersion` still names a version change.
3. **Canonical form**: keys sorted in the child (`Object.keys().sort()`), so a build that lists its configure options in another order keys alike. Tested.

## Evidence

- `pnpm exec tsx test/keys/validity/compare-refs.ts 57fda39b7 HEAD adapter:node-test` at `e7313780d`: only the node:test component fired (global 21, vitest 3, pytest 4, recorder 6 did not); all 7 `adapter:node-test` cases "keys differ, outputs equal"; 0 uncovered lines.
- The tests fake other builds with a `/bin/sh` wrapper `node` that `--require`s a preload redefining `process.config`, `process.versions`, `process.platform` or `process.arch` (all configurable on Node 24). One build at two paths uses a hard link, with a copy as fallback across file systems.

## Not done here

- Spec 003 D1 still says the environment holds "its path" (`docs/specifications/003-node-test-runner/spec.md:38`); 018 D12 supersedes it. An amendment line belongs in 003's `status.md` (coordinator's file).
- Still unkeyed, as before: runtime ICU data (`NODE_ICU_DATA`) and flags that a `node` wrapper script adds (`key-rules.md` 1).
