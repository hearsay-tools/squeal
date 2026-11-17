FAIL d25962b0c4cb02ff5e84dbdb5ce3da591074d053 — 3 blockers, 2 should-fix items.

Reviewed `5e485fc1a..d25962b0c4cb02ff5e84dbdb5ce3da591074d053`, candidate `cand/0.1.533`. HEAD matched the candidate. The tree was clean during verification and after the build. Contracts: board rows `private-material-guard` and `private-material-scrub`, plus the review brief. No product code was changed for this review.

## Verification

- Dependency installation was already completed by Squawk. It was not repeated.
- `pnpm run lint`: exit 0, `Checked 3576 files in 1576ms. No fixes applied.`
- `pnpm run typecheck`: exit 0.
- `pnpm run build`: exit 0. `git status --short` remained empty.
- `squeal status --wait 60000` with the explicit test paths below: exit 0, `Named test files at revision 0: no known failures; 13 test files, each with a current result`. The actual command used the absolute Squeal launcher supplied by this session.
- The first broader status request also selected unchanged readers of the setup and process fixtures. It returned exit 3: 16 current passes and 32 lookup-only unknown test files. Those 32 were not claimed as passes or rerun for comment-only fixture changes. The worktree also has unrelated unknown checks. No local full suite was run.
- `gh run view 43980444475 --json headSha,status,conclusion`: Private material **success**, exact candidate SHA.
- `gh run view 43980641922 --json headSha,status,conclusion`: full CI **in_progress**, exact candidate SHA at the last read. Its eventual result is unverified here.
- Whole-tree scan of tracked HEAD blobs, including paths, against the private denylist: **0 matching contents, 0 matching paths**. Literal recording-host home-path scan: **0**. No denylist value was printed or copied into this report.
- Targeted temporary-repository probes imported the candidate's `privateReport`. Their results appear below. Temporary repositories were removed after each case.

The 13 test paths were:

```text
test/harness/check-private.test.ts
test/cli/codex-hash.test.ts
test/cli/setup/plan-runners.test.ts
test/daemon/composite-runner.test.ts
test/daemon/socket.test.ts
test/harness/primer-listing.test.ts
test/harness/primer-wait.test.ts
test/harness/setup-skill.test.ts
test/scheduler/edit-cut-readers.test.ts
test/scheduler/editor-scratch.test.ts
test/harness/codex/hooks.test.ts
test/harness/codex/review.test.ts
test/runners/node-test/run-streams.test.ts
```

## Blockers

### B1 — proven: valid JSON encodings bypass all three content checks

Locations: `scripts/check-private.ts:30`, `:33`, `:220`, `:247`.

The guard tests the raw patch text only. A new JSON file containing a home path with JSON slash escapes (`\/`) returns `problems: []`. A JSON object whose `input` is a serialized recording with both `session_id` and `cwd` also returns no problems: the closing key quotes are escaped, so the key regexes miss them. A synthetic denylist entry `review-marker` is missed when the JSON text stores `review\u002dmarker`. These are valid JSON encodings of the same values, not a change in their meaning.

Reproduction: create a clean base commit; add one of these files in a second commit; call `privateReport(root, base, env)` with a nonempty denylist and a candidate ref. Each case reports one file and one added line, with no problems. The equivalent plain text fails. This breaks the promised rejection of private material and the brief's explicit encoded-form check.

Fix: add bounded decoding of JSON string escapes, including nested serialized payloads, before applying the content rules. Keep the added-line boundary, raw-text checks and output redaction. Do not execute source code. Add regression cases for escaped slashes, escaped key quotes and a Unicode-escaped denylist character. Confirm that diagnostics contain neither decoded values nor denylist entries.

### B2 — proven: spaces in a filename disable the multi-line JSON recording check

Locations: `scripts/check-private.ts:129`, `:251`.

For a new file named `log name.json`, Git emits the patch header `+++ b/log name.json\t` with a literal trailing tab. `addedLines` keeps that tab in the path. The later `.endsWith(".json")` test fails. A pretty-printed object with `session_id` and `cwd` on separate added lines passes the guard.

Reproduction: commit that four-line object as `log name.json` after a clean base. `privateReport` returns `files: 1, lines: 4, problems: []`. The same contents in `log.json` produce a session-log problem. This is an ordinary supported filename, and the current quoted-filename test does not cover it.

Fix: parse Git's unquoted header terminator correctly, or obtain exact paths from a NUL-delimited Git interface and associate hunks with them. Do not trim meaningful filename whitespace. Add a spaced-filename test that checks both detection and the exact reported path.

### B3 — proven: recorded agent sessions remain outside the allow-list

Locations, for example:

- `docs/specifications/003-node-test-runner/research/probes/dogfood/logs/s1.timeline.txt:3`: developer instructions, a user request at line 18, assistant text at line 20, tool calls at line 22 and returned tool output at line 25.
- `docs/specifications/004-slow-suites/research/probes/dogfood/logs/cz1.timeline.txt:1`: another recorded agent-session timeline.
- `docs/specifications/005-agent-adoption/research/probes/wave-0-checks/logs/sessions-extract.txt:1`: session initialization, tool calls and assistant results, under named session sections.

These are retained session transcripts, not source code or a findings summary. The candidate changes home paths inside several of them but leaves the transcripts committed. Fourteen tracked files ending in `.timeline.txt` remain under docs, and the sessions extract is an additional example. None is exempt in `.private-allow`.

This breaks the scrub row's done-when, “The tree holds no session logs outside allow-listed fixtures,” and review focus (c). Absence of the guard's exact JSON keys does not prove absence of a recorded session.

Fix: inventory and remove the remaining agent-session timelines and extracts. Preserve research conclusions in short findings text. Update references to removed evidence as the existing scrub does. Keep fixtures needed by tests only within the agreed allow-list. Check the other transcript formats as well as JSON-key matches; rerun the deleted-file reader scan and affected tests.

## Should fix

### S1 — proven behavior; hardening beyond a Git-added-lines contract: attributes can hide text contents

Location: `scripts/check-private.ts:232`.

Adding a plain UTF-8 `doc.txt` containing a synthetic denylist entry, together with `.gitattributes` setting `doc.txt -diff`, returns no problems. Only the attributes line is scanned. The script deliberately skips Git binary diffs, and its tests pin binary skipping, so this is separate from the blockers: Git supplies no added content lines in this case.

Fix: distinguish actual binary data from attribute-forced binary treatment, or explicitly reject newly added binary declarations that conceal text from this check. A whole-tree secret scanner can be a separate policy decision. Test real binary input and attribute-marked text separately.

### S2 — proven: the home-path regex excludes home roots and non-ASCII user names

Location: `scripts/check-private.ts:30`.

A standalone home-directory path with no slash after the username passes. A home path whose username contains a non-ASCII letter also passes. The current regex requires both an ASCII username and a following slash. These limits should be explicit or removed before relying on the guard for all absolute home paths.

Fix: accept a path boundary after the username, and use a username segment that covers supported filesystem names. Preserve the three public-user exceptions and the URL exclusion. Add root-path, non-ASCII-name and URL regression cases.

## Notes and what fits

- N1 — proven: new-branch/missing-before fallback, an available divergent force-push base, and a synthetic pull-request merge all detect a plain added denylist hit. The workflow passes an available before commit and otherwise uses the documented merge-base fallback. CRLF input is detected. Denylist matching is case-insensitive in the existing passing tests.
- N2 — proven: missing or whitespace-only denylist fails on main and candidate refs. A pull-request ref without the secret warns and skips that rule, as documented. Workflow permission is `contents: read`; it uses `pull_request`, not `pull_request_target`. The secret is supplied through an environment variable, not interpolated into shell source. Normal denylist-hit diagnostics redact denied path names and omit line contents. No leak was observed in these paths; this is not a proof about arbitrary future error messages.
- N3 — proven: a rename-only move from an allowed fixture path to a non-allowed path has no added lines and passes the session rule. A truly binary file also passes. These are limitations of the documented text-added-lines scope, not additional blockers. A future policy that treats newly exposed files as additions must cover both deliberately.
- N4 — proven: a pretty-printed recording named with uppercase `.JSON` passes because the suffix check is case-sensitive. Include it when repairing B2. The existing one-line check still works irrespective of suffix.
- N5 — proven: no exact deleted-file path is referenced by tracked product code, scripts or tests in the scanned directories. No Markdown link in changed docs resolves to a file deleted by this range. Sampled research references explicitly say raw logs were removed. This was a link and reference scan plus samples, not a line-by-line review of all docs.
- N6 — proven: the Codex hash test's run-time path reconstruction preserves the original command bytes that Codex hashed. It does not read that host path or execute the command. It still compares against the recorded hash file, and its targeted test passes. This is justified for that external hash oracle; anonymizing the command without new Codex evidence would weaken the test. The retained hash inputs it reads were not deleted.
- N7 — proven: changed runtime source lines are comments. Fixture home-path replacements retain the test purpose; the socket test keeps its original long-path length. Recorded hook and node:test stream consumers pass. Other detected home-like strings are public examples, synthetic fixtures or scratch-relative paths; the scan found no literal recording-host home path or denylist name.

## Repair handoff

One guard repair can own `scripts/check-private.ts` and `test/harness/check-private.test.ts` for B1/B2, with S1/S2 and N4 made explicit in its brief. A separate scrub repair can own the remaining logs and their references for B3. Keep the denylist private. Review the repair at a new pinned SHA; a green Private material run on this candidate does not resolve the reproduced false negatives. Full CI is still required before release.
