# Spec 018 wave 1: the environment record

Dispatch only after the human approves `spec.md`.

## 018-06 environment record and named differences

Use /worker. Shape: slice.

Outcome: the daemon stores each environment hash's parts, and a pure function names the parts two descriptors differ in.

Read: `spec.md` D1 (all of it) and D5's reason list; `research/main-results.md` 3; `research/result-import.md` Q1 (the input table).

Starting seam: `src/core/scheduler/keying.ts` around lines 265 to 276, where `coreEnvironmentInputs(...)` and `environmentHash(core, environment, hashOf)` are both in hand. First edit offered as a lead: a `environmentDescriptor(core, environment, hashOf)` beside `environmentHash` in `src/core/keys/environment-hash.ts`, built from the same inputs, then a test that equal parts give equal hashes and each changed part changes the hash and appears in `describeDifferences`.

Owns: `src/core/keys/environment-hash.ts`, a new `src/core/keys/environment-descriptor.ts`, `src/core/scheduler/keying.ts`, a new `src/core/store/environments.ts` (tables created by the first write, as `src/core/store/import-edges.ts` does), their tests under `test/keys/` and `test/store/`.

Leave alone: `src/core/store/schema.ts` (a change there trips the key-format alarm), `src/cli/`, `src/core/status/`, `src/core/state/`, `src/core/delivery/` (018-07 owns them). No change to any key: `test/keys/key-format.test.ts` must pass unchanged.

Done when: the D1 tests pass; a descriptor never holds an allow-listed variable's value or a config field's value (a test proves it); `squeal status --wait 60000 <changed paths>` shows the affected tests current and passing; lint and typecheck clean. Final message: the exported names and signatures 018-07 will call (record, read by worktree and project, `describeDifferences`), and any choice D1 did not settle.
