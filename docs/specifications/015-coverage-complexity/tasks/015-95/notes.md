# Retained inline source maps (015-95)

The mapper now decodes a lazy inline map from the captured payload. It keeps the original source text and generated line lengths. It leaves unusable transform evidence unread. The recorder and its child exclusion are unchanged.

## Seam and decisions

- `own.ts` uses disk source bytes only when the script has no map-cache entry. An existing entry that cannot prove its original text and identity is unread.
- `own-map.ts` accepts a captured parsed v3 map or an inline `application/json` URL, base64 or percent encoded, with optional UTF-8 charset. Parsed data takes precedence when present. The parser never reads a disk map or fetches a URL.
- Supported maps name exactly one source, resolved against the script URL, equal to that URL. They carry exactly one original source string. Indexed maps, nonempty `sourceRoot`, multiple sources and other URL forms are unsupported and unread.
- URL length, mappings and original text are each capped at 16 MiB in JavaScript code units. Generated and original line counts and mapping segment count are each capped at 250,000. Generated line lengths are nonnegative safe integers with a safe total. VLQs, segment arity, source identity and positions are validated before the shared mapper decodes them. Invalid UTF-8 and permissive base64 recovery are rejected.
- `CachedSourceMap.url?: string | null` is the only type change. No store or protocol shape changed. The additional parser is inside the brief's adjacent-parser ownership.
- `own-fixture.ts` extracts the old esbuild fixture. The plain-source test now has no map entry; source-identity mismatch has its own unread regression. The actual-worker test fails on a fallback log, so main-thread recovery cannot hide a broken worker.

## Provider and keys

`COVERAGE_PROVIDER_VERSION` rises from 2 to 3 because the same old payload could give a different original blob, function hit or line count. Both coverage-enabled adapters already put this version in their resolved-config marker. Their environment keys therefore change; coverage-disabled markers stay absent. The node:test adapter test compares the real version-3 environment hash against its version-2 counterpart. Writer tests verify that a newly stored version-3 record is absent at version 2.

The parent owns the semantic key-format gate, any change it proves necessary, generated bundles, package/release versions and the unpublished Codex runtime seed. This worker changed none of them. A global key-format raise is not inferred from the coverage change alone.

## Red-first evidence

- Squeal revision 2 reproduced both original Node 24.22.1 adapter failures: `area` had 4/4 instead of 3/4, and edit-before-map used replacement blob `2f833eedad2b85b5e3dad64fd1b0776863b60da4` instead of original `619c64d849227598d84b34b98604bab17e631d1b`.
- Revision 3: all 19 initial retained-map regressions failed before the product edit. Revision 5: all 19 recovered, and the original two adapter failures recovered.
- Revision 12: three new malformed empty-segment regressions failed. An explicit Node 22 run also showed 3 failed / 54 passed. Revision 13: all three recovered after the separator check. These were parser defects fixed here, not transient failures.
- An early fixture extraction briefly omitted the shared `range` helper. Squeal reported two failures at revision 1; both recovered at revision 2 after the import was fixed.

## Checks

Explicit focused cross-Node runs are authorized by the brief. No full suite, build or generated-file update ran.

```sh
PATH=/home/agent/.nvm/versions/node/v${V}/bin:$PATH pnpm exec vitest run \
  test/code/coverage/own.test.ts test/code/coverage/own-inline.test.ts \
  test/code/coverage/mapper.test.ts test/code/coverage/writer-worker.test.ts \
  test/runners/node-test/coverage.test.ts --maxWorkers=1 --reporter=dot
```

| Node | Focused result | Duration |
| --- | --- | --- |
| 22.19.0 | Exit 0, 5 files / 57 tests passed | 13.47 s |
| 24.21.0 | Exit 0, 5 files / 57 tests passed | 9.99 s |
| 24.22.1 | Exit 0, 5 files / 57 tests passed | 13.33 s |

After making the key comparison change only the exact provider-version bytes, the adapter file was run again on each Node: 7/7 passed, exit 0 (22.19.0: 6.17 s; 24.21.0: 5.21 s; 24.22.1: 5.59 s).

`pnpm run lint`: exit 0, 2,526 files checked, no fixes. `pnpm run typecheck`: exit 0. These were repeated after the final parser and key assertions. `git diff --check`: exit 0.

The earlier Node 24.21.0 and 24.22.1 runs each passed 5 files / 40 tests before the additional parser edge checks. Node 22.19.0 passed 5 files / 57 tests after the empty-segment repair. Node 24.21.0 passed the final 5 files / 57 tests in 9.99 s, including the provider-key assertion. Node 22 prints its expected experimental SQLite warning.

Squeal revision 13's broad changed-path wait exited 3 after 60.4 s: 16 selected files passed, 896 remained queued during the 120-second quiet window, and zero known failures were reported. This was incomplete affected evidence, not a full-suite pass. The seven named own-map/mapper/writer-worker/adapter/default-off test files were current and passing at revision 16 (exit 0, 7.3 s). The worktree then had zero known failures, 883 queued files and 314 unknown files. The final broad changed-path `status --wait 60000` read at revision 17 exited 3 after 60.4 s. Of 912 selected files, 35 passed and 877 were pending (200 running, 677 queued). Whole-worktree counts: zero known failures; 1,191/1,306 files not current (including 314 unknown files). These pending/unknown files are not claimed passing. The final separate named read at revision 18 returned exit 0 after 2.2 s: all seven coverage targets current and passing, zero known failures. Broader pending/unknown counts were unchanged.
