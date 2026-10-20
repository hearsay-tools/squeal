# Issue 49: hold validation off across edits during a manual gate

Date: 2026-10-20. Issue: https://github.com/hearsay-tools/squeal/issues/49

## Verdict and environment

Not reproduced, because the one-minute host load was 28.97, above 24 online CPUs. The triage instruction requires skipping live reproduction in this condition. No researcher, fixture, test command or daemon-control command was dispatched. Checkout Squeal: 0.1.227 (`package.json`); session CLI: 0.1.226 (the supplied SQUEAL command path). The issue does not name its incident's Squeal version. Neither version is a reproduced incident version.

Exact environment commands and output:

```text
cat /proc/loadavg
28.97 40.62 48.82 28/2695 3753562
getconf _NPROCESSORS_ONLN
24
cat package.json | head -12
  "version": "0.1.227",
```

## Evidence and fit

- **Read in official docs:** 011 C9 explicitly makes the stopped mark last until the next edit or explicit start. While it holds, C8 hook boundaries do not ensure a daemon. This is the human-approved #22 / 011-08 behavior, not proof of a regression.
- **Inferred:** an optional bounded hold across edits fits the vision's resource policy, reduced blocking and harness-independent lifecycle. It must preserve stale/unknown provenance rather than imply validation continued. Owning spec: 011 Core, C9; related C8 (hooks), C10 (policy/capacity), C6 (truthful status).
- **Reporter evidence, unverified:** the cezarion worker's roughly 70-minute gate at load 40–80, repeated restarts at revisions 30–43, exit 137 and timeout false reds come from the issue. No causal claim that Squeal caused the killed run is established.

## Duplicates and decision

Searched origin/main's board for `#49`, `gh-49`, pause, manual runs, stop across edits and `src/cli/stop.ts`; no existing issue-49 row or exact feature duplicate. `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` included the open `triaged` issues; none requests a bounded hold across edits. Related #22 / done 011-08 defines today's stop; #27 concerns session-end cleanup, #47 upgrade handoff, #50 restart recovery, #46 shared browser environment ownership. These are distinct symptoms. The issue names `system-prompt.test.ts` as a timeout example, not as the hold's implementation seam.

Human decision: approve an opt-in bounded hold across edits or retain stop-until-edit; if approved, choose command/process lifetime versus a time window and define expiry, explicit resume and status behavior before implementation. Existing holds stand. This triage authorizes no implementation.
