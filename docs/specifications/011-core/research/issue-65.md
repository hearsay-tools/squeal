# Issue 65: the selected files sit under `named` or `wait`, by whether `--wait` is given

Research for hearsay-tools/squeal#65, 2026-10-21. Documentation only: no product, spec, status, skill or board edit. Code read at commit `18aff2857` (package version 0.1.234). Live probes ran on copies of the installed plugins 0.1.234 and 0.1.233. Probes: `probes/issue-65/`.

**Host load before each live probe** (the one-minute load against 24 CPUs, from `/proc/loadavg` and `nproc`): 14.85 before the first check in this worktree, 21.02 before `run.sh` on 0.1.234, 20.03 before `run.sh` on 0.1.233. Every load was below the CPU count, so every probe ran. Each `run.sh` took about 10 s of wall time.

**Synthetic reproduction and the original incident are different evidence.** The incident was in a cezarion task worktree on 0.1.233, with 764 paths, 4 of them pending. It is known only from the issue text. The synthetic probe uses a scratch repository with 2 test files, one passing and one failing, and no pending file.

**Verdict: reproduced.** On 0.1.233 and 0.1.234, `status --json <paths>` puts the selection under `named` and has no `wait` key; `status --wait <ms> --json <paths>` puts it under `wait` and has no `named` key. The issue's filter on the wrong key prints nothing and exits 0, while the same selection holds a failing file. This is the specified and tested behaviour, not a regression.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the snapshot form put the selection under `named.testFiles`? | Yes. `has("named")` true, `has("wait")` false; 2 entries. | verified by experiment, 0.1.233 and 0.1.234 |
| 2 | Does the wait form put it under `wait.testFiles`? | Yes. `has("wait")` true, `has("named")` false; 2 entries. | verified by experiment, 0.1.233 and 0.1.234 |
| 3 | Does the issue's filter on the wrong key print nothing? | Yes: 0 lines, jq exit 0, on both forms. Without `[]?` jq errors instead (exit 5, `Cannot iterate over null`). `jq -e` exits 4. | verified by experiment |
| 4 | Are the two payloads otherwise the same? | Yes. The same keys, the same `testFiles` entries; only `outcome` differs (`snapshot` against `settled`). | verified by experiment; read in source code |
| 5 | Is the split intended? | Yes. One field name is chosen by `wait.snapshot` in `printNamed`; design 011-24 section 1.5 names the `named` field; a test pins `named` absent from a wait. | read in source code |
| 6 | Does any documentation name the named wait's JSON path? | No. The skill reference names `named` for the snapshot and `wait` for the path-less wait; `--help` names neither. | read in source code |
| 7 | Would the exit code have flagged the incident? | Likely yes: 4 pending files give no verdict, so exit 3. Not run here: the probe had no pending file. | read in source code; inferred |

## Findings

### 1. The two forms use two keys (verified by experiment, 0.1.233 and 0.1.234)

Command: `sh probes/issue-65/run.sh [plugin-dir]`, run from the scratch repository root after `squeal run --all --wait`. Paths: `test/pass.test.ts test/fail.test.ts`. From `output-0.1.234.txt`:

```text
=== snapshot: squeal status --json test/pass.test.ts test/fail.test.ts
exit 1
top-level keys holding testFiles: ["breakdown","named"]
=== wait: squeal status --wait 30000 --json test/pass.test.ts test/fail.test.ts
exit 1
top-level keys holding testFiles: ["breakdown","wait"]
=== snapshot.json has named: true; has wait: false
=== wait.json has named: false; has wait: true
=== payload of each form, testFiles shown
{"outcome":"snapshot","code":1,"testFiles":[{"path":"test/pass.test.ts","state":"current","verdict":"pass"},{"path":"test/fail.test.ts","state":"current","verdict":"fail"}]}
{"outcome":"settled","code":1,"testFiles":[{"path":"test/pass.test.ts","state":"current","verdict":"pass"},{"path":"test/fail.test.ts","state":"current","verdict":"fail"}]}
=== same keys inside the two payloads: true
```

(`breakdown` is the worktree's check breakdown, present in both, not the selection.) The issue's table calls the other key `null`. It is absent; jq reads an absent key as `null`, so the effect is the same. The 0.1.233 output matches the 0.1.234 output except for one JSON line number in the jq error text.

A first check in this worktree (daemon not yet listing test files, `test/keys/key-format.test.ts`) gave the same key split with an empty `testFiles` in both forms, exit 3. It is not counted as evidence for question 3, because an empty array prints nothing under either key.

### 2. The wrong key prints nothing and exits 0 (verified by experiment)

The issue's filter, `.<key>.testFiles[]? | select(.state != "current" or .verdict != "pass") | .path`:

| Output | Key | Lines | jq exit | `jq -e` exit |
|---|---|---|---|---|
| snapshot | `named` | 1 (`test/fail.test.ts`) | 0 | 0 |
| snapshot | `wait` | 0 | 0 | 4 |
| wait | `named` | 0 | 0 | 4 |
| wait | `wait` | 1 (`test/fail.test.ts`) | 0 | 0 |

So a "not passing" filter on the wrong key reads as "everything passes" while a known failure is in the selection. The `?` hides the only signal: without it, `.wait.testFiles[]` on the snapshot errors with exit 5. `jq -e` separates "no output" (exit 4) from a match, but it also exits 4 on the right key when every file passes, so it cannot tell a wrong key from a clean selection.

### 3. The split is designed and pinned (read in source code, `18aff2857`)

- `src/cli/status-wait-paths.ts:462-463`: `const field = wait.snapshot === true ? "named" : "wait";` then `JSON.stringify({ ...wait.result, [field]: payload })`. Both forms build the same `NamedWaitPayload` (`status-wait-paths.ts:249-258`: `outcome`, `waitedMs`, `code`, `testFiles`, `unmatched`, `leftForPause`, `verdict`).
- Introduced by commit `4c7bb6a9b` (row 011-28, 0.1.233). Its design, `tasks/011-24/design.md` line 76 (section 1.5): "`--json`: the snapshot plus a `named` field, the named wait's payload with `outcome: "snapshot"`". The same design, line 67, says the named wait's "`--json` is unchanged in shape: stdout is the snapshot plus `wait`".
- `test/cli/status-wait-paths.test.ts:345` asserts `payload.named` is undefined in a wait; `test/cli/status-paths.test.ts:204-206` asserts the snapshot's `named` payload.
- 011 C15 names `wait.testFiles` for a named wait (spec line 357). 005 D2 (spec line 63) gives the snapshot form's text and exit code but names no JSON key. Neither `status.md` records a decision on the key name.

### 4. Documentation (read in source code, `18aff2857`; identical in the installed 0.1.234 plugin)

- `plugins/claude-code/skills/squeal/references/commands.md` line 47: the snapshot's stdout is "the snapshot with a `named` field whose `outcome` is `snapshot`".
- Line 43 describes only the path-less wait: a `wait` field whose `edit` holds `testFiles`. That is a third location, `wait.edit.testFiles`, with a different entry shape. The named wait's `wait.testFiles` is not named in the reference.
- `squeal --help` lists `[--json]` on both forms and names no field.
- No in-repo consumer reads `named` or `wait.testFiles` from JSON: the evals parser (`evals/lib/squeal-text.mjs`) reads text.

### 5. The exit code is key-independent (read in source code; inferred for the incident)

Both forms exit through `namedCode` (`status-wait-paths.ts:403-405`): 0, 1 with a known failure among the selected files, 3 without a verdict. In the probe both forms exited 1 with the failing file. The incident had 4 pending files; a snapshot with pending files has no verdict, so it would have exited 3. The reporter piped stdout to jq and did not read the exit code. Not run here, because the fixture has no pending file.

## Recommendation for Squeal

The decision is the human's. Inputs:

- **The tradeoff.** One path for the selection (issue option 1: a new top-level key such as `selection`, `wait` keeping only `waitedMs` and `outcome`) is the clean shape, but it moves `wait.testFiles`, which C15 names and agents may already filter on. Writing the same payload under both keys in both forms (option 2) breaks no reader and makes either filter right, at the cost of a duplicated payload; `outcome` already says which form ran.
- **Smallest change that removes the silent pass:** option 2, an additive field, plus the JSON path of the named wait in `commands.md` (all plugin copies) and `--help`. The `schemaVersion` question (additive field or not) belongs to C6's payload rules.
- **Spec sections touched:** 011 C6 (`--json` payload of status), C15 (`wait.testFiles` wording), 005 D2 (the snapshot form's JSON), the skill reference.
- **Duplicates:** none found. Open issues #41, #43 and #51 concern queue wording and order; done row 011-28 created the split. Board rows gh-59 and gh-61 touch named waits, not the JSON key.

## Limitations

- Synthetic: 2 test files, no pending file, one worktree; the incident's 764-path store was not examined.
- The `jq -e` and exit-code points cover a passing or failing selection only; the pending case (exit 3) is from source.
- Pi and OpenCode plugin copies were not run; they use the same CLI bundle.

## Open questions

- Which external consumers (cezarion, harness scripts) read `wait.testFiles` today. Not determined, because only this repository was searched.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/65 (read 2026-10-21).
- `src/cli/status-wait-paths.ts` (`printNamed`, `NamedWaitPayload`, `namedCode`), `src/cli/named-file-lines.ts` (`fileEntry`), `src/cli/main.ts:222-225`, commit `4c7bb6a9b`.
- `test/cli/status-wait-paths.test.ts:345`, `test/cli/status-paths.test.ts:204-206`.
- `docs/specifications/011-core/tasks/011-24/design.md` lines 67 and 76; `docs/specifications/011-core/spec.md` C6 and C15; `docs/specifications/005-agent-adoption/spec.md` D2.
- `plugins/claude-code/skills/squeal/references/commands.md` lines 43 and 47.
- Probe: `probes/issue-65/run.sh`, `fixture/`, `output-0.1.234.txt`, `output-0.1.233.txt`.
