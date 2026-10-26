# Issue 105: ignored-file revision and browser queue

Date: 2026-10-26. Issue: https://github.com/hearsay-tools/squeal/issues/105

## Fit and owner

Inferred: passes the decision filter by reducing unnecessary validation and making revision provenance visible. Spec 011 Core owns C2 (watcher and revisions), C3 (keys and closures), C4 (scheduler) and C6 (status). Slow-artifact policy overlaps existing rows 004-28 and 004-47.

## Reproduction

Not reproduced, because the one-minute host load was 27.90, above 24 online CPUs. No researcher was dispatched and no live probe or test was run. No probe directory was needed.

Exact preflight commands and results:

```text
cat /proc/loadavg
27.90 36.97 38.34 20/4090 2819027
getconf _NPROCESSORS_ONLN
24
node -p 'require("./package.json").version'
0.1.349
```

Session plugin version: 0.1.349. Incident version was not recorded; the issue names 0.1.329 to 0.1.331 later in the session and 0.1.345 as current when filed. These are not proof of the incident version.

## Evidence and limits

Read in issue: a cezarion worker based on 9a9f617f wrote scratch files under ignored `.ai/qa/1816/`, after a browser test built under ignored `.ai/qa/build/`. Git status was empty. The next report showed revision 1, `9a9f617f + 1`, 32 pending browser specs and 41 unknown. No changed path or JSON status was captured. The triggering file, its input membership and the reason for queueing remain unknown. A clean git status alone does not prove no keyed input changed.

Read in spec 011 C2: `+ K` counts revisions since HEAD last moved, not changed files. Thus `+ 1` does not establish that exactly one file changed. C2 already permits watched ignored closure and environment inputs, and drops ignored cached paths no longer named by any closure, environment file, lockfile or observed read. A revision records its changed paths. C3 keys inputs rather than the revision itself. The incident does not yet prove either contract was violated.

## Duplicates

Read in origin/main board: no #105 row or exact symptom row. Searches covered `#105`, `gitignor`, `ignored file`, `.ai/qa`, `changed.files` and `revision header`. Done 004-28 deliberately keys declared ignored artifacts; done 004-47 limits ignored files to declared slow artifacts. Done 005-41 warns against declaring runtime `.ai/qa/test-env.json` as a build input. These overlap, but do not settle this report. Done gh-96 / 015-49 names complexity skips only. Dropped 016-25 concerns ignored directory-listing names; its human hold stands and this triage does not reopen it.

Read in GitHub: `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels` included triaged issues. No exact duplicate. Open #60 (browser preparation refresh), #78 (browser environment lifetime) and #87 (blocked waits) overlap only.

## Human decision and done-when

Decide whether to approve a bounded investigation of ignored-input selection plus bounded changed-path context in revision reports. Preserve ignored files that tests or declared inputs legitimately read. Do not treat all ignored files as irrelevant or reinterpret the revision count as a file count.

Done when an ignored scratch file with no keyed reader does not move test keys or queue browser checks because of that write; declared ignored inputs still invalidate their readers. A small changed-path set is named with its ignored/input context, and larger sets have bounded output. Regression evidence distinguishes scratch files, declared build outputs, observed reads, startup reconciliation and revision provenance. Existing holds stand. This row authorizes no implementation.
