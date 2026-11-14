# Throwaway evidence: issue 217

These are read-only probe transcripts, not tests or product code. They capture installed Squeal 0.1.475 on 2026-11-14 in the research worktree at `e9cf07c6b94f59232075f0cba578a74df64d63ae`. No dependencies or executable fixture are needed. Do not expect live history counts to stay fixed. Trailing whitespace in the captured text is trimmed.

- `cli.txt`: full version, help, command help and ranked reach output. Each command records its host load, CPU count, UTC timestamp, exit code and elapsed seconds.
- `named.txt`: named environment-path output with the same metadata.
- `guidance.txt`: installed skills, the commands reference's reach section, tagged shared primer source, fetched issue, filtered help, and comparison with the tagged Claude Code copies. Skill hashes identify the read files.

To repeat, first compare `cat /proc/loadavg` with `getconf _NPROCESSORS_ONLN`. Skip live commands if the first load value exceeds the CPU count. Use the installed launcher the session names; verify its version before comparing results. Each original subprocess had a 30-second timeout.

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --help
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --help | rg -i 'graph|closure|import|select|dep'
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal reach --help
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal reach --limit 3
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal reach test/global-teardown.ts --limit 2
```

Do not execute the run suggestions in the output for this reproduction. No direct database inspection, tests, warm-up, checkpoint or nested agent session is part of this probe.
