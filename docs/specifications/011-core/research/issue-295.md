# Issue 295: explain why status selects a test file

Date: 2026-11-27. Source: [#295](https://github.com/hearsay-tools/squeal/issues/295), agent-reported `friction`.

## Verdict

**Partially reproduced on Squeal 0.1.647:** a read-only named status returned 628 selected files without a static import chain, declared-input glob or recorded-read origin. The original guard test, its 622 recorded paths and the later CI import were **not reproduced**, because those belong to the reporting repository and its store; neither was available as a named local fixture. No recording, import, test run or store mutation was performed.

The one-minute host load was 3.44 on 16 online CPUs before reproduction (later 2.98). The live probe was cheap and below the load gate. The installed launcher identified itself as 0.1.647, matching the issue; the source checkout package version was 0.1.654, origin/main `967d41d85c2c1d635b9a237b39be88b366e54276`. The separate main checkout used only for its existing stored selection was at `b8d32f6b9f341dbd27d156e7d0bb42fc5d5dc3e9`.

## Findings

| Question | Evidence and answer |
| --- | --- |
| Does selected-file JSON explain the dependency link? | **Verified by experiment, 0.1.647:** the main checkout returned 628 entries. Their combined field names were `project`, `path`, `state`, `reason`, `next`, `command`. `reason` explained missing validation, not why the source selected the test. No entry carried a link kind, chain, glob or recording source. |
| Does the closure description mention recorded reads? | **Verified by experiment, 0.1.647:** `closureMethod` was `static imports plus declared inputs`. **Read in source code, 0.1.654:** `src/core/keys/closure.ts` defines that constant and also includes every supplied observed path in `assembleClosure`. This establishes misleading general wording; it does not prove which observed paths contributed to the stored selection. |
| Is this a fresh, complete selection? | **Verified by experiment, 0.1.647:** no. The main checkout reported revision 1497, `selection.complete: false`, `selection.reason: no-daemon`, and every selected file `unknown`. This probe proves missing explanatory fields in a stored partial selection, not a current passing guard incident. The task worktree's first read returned no files while startup listing was pending. |
| Does a newer CI recording necessarily remove old inputs? | **Read in source code (specification), 0.1.654:** 011 C3 explicitly merges observed inputs and never prunes them. 018 D3 adds an observed entry only when none exists locally; an existing entry is never changed or merged. Thus the issue's expected next-recording cleanup is not the present contract. The incident's precise recording/import history remains unverified. |
| What does current source emit? | **Read in source code, 0.1.654:** `src/cli/named-print.ts:148` maps selected files through `fileEntry`; `src/cli/named-file-lines.ts:278` emits identity, state, verdict, pending/unknown reasons and scheduling fields, with no dependency provenance. |

A sample entry was:

```json
{"project":"","path":"test/ci-action/record-squeal-fails.test.ts","state":"unknown","reason":"no result: never run at this key: the baseline is lookup-only, so nothing queued it","next":"<retry command> runs it once","command":"<retry command>"}
```

## Exact commands

The commands below read existing state. JSON files were temporary captures outside the repository; no throwaway product fixture was needed.

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue view 295 --repo hearsay-tools/squeal --json body
# In the task worktree:
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status src/core/status/snapshot.ts --json > /tmp/issue295-status.json
# With working directory /home/agent/projects/squeal:
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status src/core/status/snapshot.ts --json > /tmp/issue295-main-status.json
node -e 'const x=JSON.parse(require("fs").readFileSync("/tmp/issue295-main-status.json","utf8")); console.log(JSON.stringify({files:x.selection.testFiles.length,keys:[...new Set(x.selection.testFiles.flatMap(Object.keys))],first:x.selection.testFiles[0],closureMethod:x.closureMethod,complete:x.selection.complete,reason:x.selection.reason},null,2))'
```

Both status commands returned code 3 (no verdict), as expected from startup/no-daemon state. No validation pass is claimed. The launcher also warned about differing installed plugin versions; the task startup reported that 0.1.647 does not recognize `remote.alwaysLocal`. Neither warning changes the JSON fields observed.

## Ownership and human decision

**Inferred from the contract:** 011 C3/C6/C12 owns selection explanations; 018 D3/D4/D5/D8/D11/D15 supplies imported recording and result provenance. Fit: trustworthy machine-readable status with less direct store inspection.

Recommend a proposed row for explaining selection and accurately naming observed inputs. Keep input retirement separate: open, triaged #258 already covers obsolete observed sets; #262 covers selection reasons at a commit, #279 declared-input failure attribution, and #217 finding `reach`. They overlap but do not duplicate this per-file explanation request. Decide whether to approve a compatible JSON/text explanation contract, including how it reports missing historical provenance. Do not promise that another recording clears old reads under the existing rules. Existing holds stand; this research authorizes no implementation.
