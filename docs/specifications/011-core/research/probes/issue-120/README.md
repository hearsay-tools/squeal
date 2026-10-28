# Issue 120 probe

Throwaway research fixture. No product test or build runs here.

Run from the repository root:

```sh
node docs/specifications/011-core/research/probes/issue-120/probe.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.368 /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.370
```

Arguments are retained runtime directories, read only. The probe checks each CLI against its runtime manifest, creates a disposable Git repository beside the script, and runs `status --json` and `status` directly with each CLI. It removes the fixture in `finally`. No daemon starts. No installed runtime or session pin changes. Each CLI invocation checks the one-minute host load and skips when it exceeds the CPU count.

The rule matches Cezarion's configuration at `0ca0abddbb4365bf0413634b9547484a1ba78f88`. Other configuration is reduced. Both versions exit 1 because the fixture has no Squeal store. Compare `configProblems`, not the exit code, to establish parser acceptance. This does not prove applied reader exclusions or live session upgrade behavior.

The findings and observed output are in `docs/specifications/011-core/research/issue-120.md`. This standalone probe has no automated test coverage; it is not part of a suite.
