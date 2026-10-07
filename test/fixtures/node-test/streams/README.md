# Recorded event streams

Streams of Squeal's reporter (`src/runners/node-test/runtime/reporter.mjs`), one NDJSON line per `TestsStream` event, recorded by `node record.mjs` under Node 22.23.3 (`node22/`) and 24.21.0 (`node24/`) with `--enable-source-maps --import tsx`. The fixtures directory is replaced by `<fixtures>`. The Node 22 streams carry the research host's proxy warning in `test:stderr`, as a real project's would.

| Case | Source | Process |
| --- | --- | --- |
| `outcomes` | `outcomes.test.ts`: suites, nesting, `t.test` subtests, skip and todo in both forms, a failing `before` hook, a failing todo, a parent failing only through a subtest, a parent failing in its own body, duplicate names | one file |
| `pass`, `fail`, `syntax`, `missing-import`, `duplicate` | `../edge/test/<case>.test.ts` | one file |
| `busy-loop` | `../edge/test/busy-loop.test.ts`, killed after 3 s | one file |
| `ordering` | `busy-loop` and `pass` in one process, killed once `pass`'s wrapper `test:complete` arrived | two files |

## Why Squeal runs one file per process

`ordering` is the evidence. `node --test` sorts its files and forwards each child's events in report order: `FileTest#addToReport` buffers them until every earlier file has reported (`lib/internal/test_runner/runner.js`). From 24.18 on, `test:enqueue`, `test:dequeue` and `test:complete` skip that buffer (`kExecutionOrderedEvents`); 22.23.3, 24.17, 25.5 and 26.0 have no such set. So with `busy-loop` hanging, `pass`'s wrapper `test:complete` arrives but its inner `test:pass` never does: on Node 22 nothing of the file but the wrapper, on 24.21 only the inner `test:complete`. A SIGTERM to the group flushes nothing. A wrapper completion alone would store a file-level pass with none of the file's tests.

With one file per process (coordinator decision 2026-10-07, a spec 003 D5 amendment), a file is completed when its process exited and its stream holds the wrapper's `test:complete` and the run's final `test:summary` (`file: null`), written after every buffered event. A file that fails to load (`syntax`, `missing-import`) has no per-file `test:summary`, only the final one.
