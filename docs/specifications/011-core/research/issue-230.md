# Issue 230: catalog readers after a test move

## Verdict

Not reproduced, because the one-minute host load was 49.67 on 24 online CPUs. The triage rule requires skipping live reproduction above the CPU count. No researcher, daemon experiment or probe was started. This is an intake finding, not proof of a product defect.

## Evidence and versions

- **Reported in issue (unverified):** Squeal 0.1.516 did not select `run-states.test.ts` / `cites tests that exist` after test groups moved between test-kit files. Named waits and the prepr Squeal step passed; CI failed with `expected [ 'running.done-late-permission' ] to deeply equal []`. The reader uses paths and titles as data, without imports. The report supplies no full reader path, source tree, policy, observation history or Squeal revision.
- **Read in repository metadata:** checkout version 0.1.532; this session's Squeal runtime is 0.1.531. Neither version was used in a reproduction.
- **Read in spec:** 011 C3 includes declared inputs, observed reads and directory listings in closures and reverse indexes. C4 selects and validates by those keys. C12 records supported runtime reads and lists limits; lack of an import alone does not establish that a catalog reader is outside its closure. Related 013 V3/V10 owns Vitest closure and recorder delivery.
- **Inferred:** first distinguish missing observation, policy or declaration from a failure to retain or invalidate observed inputs. Source-text path matching is an issue suggestion, not an accepted design; it cannot prove all computed paths or title dependencies.

## Commands used for intake

```sh
git fetch origin
gh issue view 230 --repo hearsay-tools/squeal --json state,title,body,labels,url
git show origin/main:docs/board.md > /tmp/issue230-board.md
rg -n '#230|run-states|cites tests|catalog|declared.*input|data.*depend' /tmp/issue230-board.md
gh issue list --repo hearsay-tools/squeal --state open --limit 300 --json number,title,labels
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
```

The load command returned `49.67 40.52 45.46`; the CPU command returned `24`. No live reproduction commands ran.

## Fit, ownership and duplicates

**Inferred:** passes the vision filter: selecting data-dependent checks improves useful feedback and the truth of current verdicts. Owner: 011 C3/C4/C12; related 013 V3/V10. No existing #230 row or exact symptom/file match was found on origin/main. Open issues, including those labelled `triaged`, contain no exact duplicate. #169 concerns directory selection arguments; #117 concerns a removed test's own stale regression; #229/#161 concern missing test inventory, not an existing catalog reader's data dependency. Board row 011-116 already covers observed runtime dependents as edit work; 011-150 studied broad declared inputs. These are related evidence, not proof of a shared defect.

## Human decision

Approve a bounded investigation of the real catalog reader under existing declared-input and runtime-observation rules, or defer. If approved, obtain the reader, policy and before/after tree; establish observation and selection for title edits, moves, deletes and renames. Select the affected catalog reader, or explicitly name the known selection gap and the check to run. Preserve narrow selection and never imply that an unrun reader passed. Existing holds stand. No implementation or new selection design is authorized by this triage.
