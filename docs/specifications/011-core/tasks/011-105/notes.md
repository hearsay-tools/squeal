# 011-105: removals at the key-format raise, and the raise to 21

Worker 7298f244, wave 66 W3 (`../wave-66.md`), base `3edfabbe0`, 2026-10-31 to 2026-11-01.

## Commits

| Commit | Part |
| --- | --- |
| `ef62df9ae` | (a) `listFailures`, `countFailures`, `FAILURE_WHERE`, `failureParams`, `FailureFilter`; (b) `rollback` reads `isTransaction`; (c) `latestForCheck` |
| `e5e186d9a` | (d) the key definitions read as one before 011-85, 011-158 and 011-167 |
| `d6cb9568e` | (e) `environment.ts` 364 to 211 lines |
| `1b918b353` | `KEY_FORMAT_VERSION` 20 to 21, `KEY_FORMATS_READ_AS_ONE` emptied |
| `945779497` | the alarm: an approved raise and what an emptied format releases (coordinator, option A of request 27a12639) |
| `4944bbad9` | `test/scheduler/runtime-files-protection.test.ts` lists two formats read as one |

## Why the alarm refused the raise

The validity bundles pin `KEY_FORMAT_VERSION` to 0 (`test/keys/validity/bundle.ts`, `pinFormat`). Every case compares what the two trees store and decide now. 0.1.387 already stores under the definitions after 011-85, 011-158 and 011-167, so the readers this row removes decide nothing in any case: the `former`, `absent` and pnpm accept cases agree at both trees. With the raise alone, `key-format.test.ts` failed twice:

- global: "KEY_FORMAT_VERSION moved from 20 at squeal--v0.1.387 to 21, and no key, rows, accept, assemble, store case's outputs differ: a raise needs a case whose outputs differ (task 011-37 D6)".
- vitest, node:test, pytest and the recorder, each: "changed lines no case runs ... src/core/keys/check-key.ts:61-63 (baseline bundle line 91-93)", the body of `absentSegment` at the release. Every component's bundle holds `KeyIndex`, and no case ran that body at the release.

So `VITEST_ADAPTER_VERSION` does not move with (d): no Vitest output changes. Without the alarm change it would have had to move, and so would the other three versions, for three deleted lines.

The fix, by the coordinator's contract: `test/keys/validity/approved.ts` records a format raise the human approved (21 only), and `failures` passes D6 for it. Under a format raise that empties the list, no component is held to its changed lines. The rule and its reason are decision 18 of `test/keys/validity/notes.md`.

## Tests deleted, each testing only removed code

- `test/keys/former.test.ts`, `test/keys/former-raise.test.ts`
- `test/scheduler/former-read.test.ts`, `former-sibling.test.ts`, `absent-read.test.ts`
- in `test/store/repos.test.ts`, "returns the newest result of a check across keys" (`latestForCheck`; its `listForCheck` test covers the order and an unknown check)
- in `test/keys/check-key.test.ts`, the `absentSegment` and `absentReadAsOne` test
- in `test/keys/key-index.test.ts`, the two `absentSegment` tests, replaced by one: a key read as one has no segment for an absent path, and leaves out a key equal to the current one or read twice

`test/runners/vitest/former-files.test.ts` is now `sibling-packages.test.ts`. It keeps one check, that a sibling config's builtin stays out of each other project's packages, which no other test makes.

## Tests the raise broke, outside test/keys

Both tested the reading code that stays, through the real list:

- `test/scheduler/formats-read-as-one.test.ts` mocks two listed formats (`KEY_FORMAT_VERSION - 2` and `- 1`). Its list test reads the real module through `vi.importActual` and expects formats from 21 to the one below the current one.
- `test/scheduler/runtime-files-protection.test.ts` uses the same mock for its seeded compatibility keys.

## Left for others

- `src/core/scheduler/accept.ts:26`, the comment on `ReadAsOne`: "a path with no file leaving it moves the key before 011-158" names a definition that is gone. That file is outside this row's ownership. The memo stays correct, because an entry's installed-dependency segment can still move alone.
- Bundles are not rebuilt (four bundle tests fail with "cli/squeal.mjs differs from the build").
- The coordinator records the D6 amendment in `status.md` and the spec.
