# Probe 010-13: required checks without pull requests (THROWAWAY)

Throwaway sources for `../../required-checks-probe.md`. Nothing here is product code, nothing here runs in CI, and none of it should be reused as is.

- `probe-010-13.yml`: the seconds-long workflow, committed only on `probe/010-13-*` branches as `.github/workflows/probe-010-13.yml`, never on main. Its job `probe-check` passes, fails (`[probe-fail]` in the commit message), sleeps 180 s (`[probe-sleep]`) or is skipped by its `if` (`[probe-skip]`); a change only under `probe-docs/` skips the whole workflow by `paths-ignore`.
- `ruleset.json`: the ruleset 25193915 as first created, `required_status_checks` on `refs/heads/probe/010-13-target` only, no bypass actors. The transcript logs each later edit of its parameters.
- `probe.sh`: pushes a SHA to a probe branch and logs the output, lists a SHA's check runs, waits for one, lists the probe workflow's runs.
- `sample.sh`: the timing sampler for question 3; `samples.tsv` is its output.
- `transcript.txt`: every push with its output and exit code, check-run states and ruleset edits, in order.

Ruleset 25193915 and the branches `probe/010-13-src`, `-target` and `-side` were deleted when the probe finished (listings in the findings).
