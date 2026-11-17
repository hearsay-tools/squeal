# Issue 237: incomplete oxlint evidence in commit summaries

2026-11-17. Documentation-only triage of [#237](https://github.com/hearsay-tools/squeal/issues/237).

## Fit and owner

Inferred: passes the vision decision filter by preserving trustworthy validation, provenance and uncertainty across harnesses. Owner: spec 017 D2, D4, D5, D7, D8 and D11. Related: 019 D5/D6 (commit reports and pull commands), 011 C6 (status).

## Evidence and reproduction verdict

Not reproduced, because the one-minute host load exceeded the CPU count at the reproduction decision. No researcher, live probe or test run was started. Existing holds stand.

Observed commands in this triage:

```sh
cat /proc/loadavg
# 23.41 24.71 22.07 27/3558 1553555 (initial observation)
nproc
# 24
cat /proc/loadavg
# 26.09 25.26 22.27 56/4131 1559905 (before reproduction)
node -p 'require("./package.json").version'
# 0.1.548
git rev-parse origin/main
# 325b21404993741b55091171f0b9786e76bb3de2
```

Reported by the agent, not independently verified: Squeal 0.1.548, Claude Code, commit 21f58b1 at revision 9. The changed file was `packages/web/src/routes/skills.tsx`. The commit summary said `lint 0 findings, 4 files still running`. `npm run prepr` printed `pass: repository lint`. CI found two oxlint `cez(design-guardian)` / `no-amber-text` findings. About 15 minutes later, Squeal reported `lint config changed` and `lint 2 findings`. The reporter says no lint configuration changed; the revision changed only ignored `.ai/qa/cez-home/config/install.json`. A restart was not tried.

Unknown: whether the four running files included this path, whether the gate read the commit report or another surface, the actual lint keys and config inputs, and the cause of the delayed keying notice. The notice alone does not prove a config file changed. No root cause or product defect is proven by this triage.

## Duplicate check

Read origin/main's board with searches for `#237`, `oxlint`, pending lint, `skills.tsx`, `install.json`, `lint config changed`, stale config, `#170` and `#219`. No existing gh-237 row or matching named-file row was found. Checked open issues with `gh issue list --repo hearsay-tools/squeal --state open --limit 300 --json number,title,labels`, including the `triaged` label, and read #170 and #219.

Partial duplicate of proposed gh-170: its done-when already covers pending, stale and missing results and reserves an unqualified zero for complete evidence. #237 adds a report with enabled oxlint, delayed findings and apparent config re-keying without an edited config. Keep this evidence linked for the human to decide whether to fold it into gh-170 or approve a separate validity investigation. #219 concerns a separate ast-grep scope outside the provider, unlike this reported oxlint finding. No exact open duplicate was found.

## Human decision and done-when

Decide whether to fold the report into gh-170 and approve its completeness wording, with a bounded investigation of delayed/config-stale oxlint evidence, or keep that investigation separate. No implementation is authorized.

Changed files with pending, unknown, missing or stale-config lint results must remain explicitly not determined in commit summaries and gate-readable evidence. An unqualified zero requires complete current results for the declared provider scope. Cover delayed oxlint, config re-keying, ignored-only changes, genuine findings and a complete clean control. Preserve provider scope distinctions and separate test-failure counts. Investigate the original gate before asserting its cause.
