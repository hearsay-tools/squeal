# Issue 48: session paths after a plugin upgrade

Date: 2026-10-20. Issue: https://github.com/hearsay-tools/squeal/issues/48

## Fit and ownership

Inferred: passes the vision decision filter by keeping validation guidance and commands reachable without manual discovery. Owner: 005 agent adoption, D3 (installed CLI, launcher, update and skill lookup) and D6 (primer and skill texts). Related: 002 D1 (Codex plugin packaging and absolute CLI paths). No design or implementation is authorized by this triage.

## Evidence and reproduction verdict

Not reproduced, because the one-minute host load was 76.61 above 24 online CPUs. No researcher was dispatched and no live upgrade, cache deletion, test suite or probe was run. Existing holds stand.

Verified by experiment (load measurement only): `uptime` printed `load average: 76.61, 63.06, 54.68` at 12:46:58 host time; `getconf _NPROCESSORS_ONLN` printed `24`.

Read in source code: checkout `package.json` names Squeal 0.1.226. The current session catalog and SQUEAL primer also name installed plugin 0.1.226. The issue reports an earlier session catalog and initial primer naming 0.1.225, a failed read of that version's `skills/squeal/SKILL.md`, discovery of only 0.1.226, and a later primer switching to 0.1.226. This is reporter evidence, not an independently reproduced upgrade. Cache cleanup ownership and whether a stable entry point can cover skill discovery remain unverified.

Exact intake commands: `git fetch origin`; `gh issue view 48 --repo hearsay-tools/squeal --json state,title,body,url,comments`; `uptime`; `getconf _NPROCESSORS_ONLN`; `git show origin/main:docs/board.md`; `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels`; `gh issue list --repo hearsay-tools/squeal --state open --label triaged --search 'skill primer plugin path' --json number,title`; `gh issue list --repo hearsay-tools/squeal --state open --search '"plugin"' --json number,title`. Board searches covered `#48`, `gh-48`, stale paths, primer, skill, `SKILL.md`, plugin cache and version directories. No reproduction command was attempted.

## Duplicates and decision

Read in source code and GitHub intake: no existing gh-48 row or exact duplicate among open issues, including triaged issues. Done row 009-18 addresses the analogous deletion of a loaded Pi version, not Codex session catalog paths. Open #47 and 011-30 through 011-34 address daemon handoff after upgrade, not missing skill or CLI files. Existing 002 plugin packaging rows are related shipped work, not this symptom.

Human decision needed: approve an investigation and fix for session-lifetime path availability, choosing retained versioned assets or stable skill/CLI entry points after confirming which layer owns cache cleanup. Done when a Codex session spanning an upgrade can read its advertised skill and run its advertised CLI without manual cache discovery, with regression evidence covering initial and later primers and the skill catalog. Preserve version provenance and existing holds.
