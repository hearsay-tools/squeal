# Throwaway child-start hold probe

This is a disposable research probe, not a product test. The 2026-10-28 attempt skipped before creating a fixture because load was 25.0195 on 24 CPUs. See `output.txt`. Only Python syntax was checked. The live branch has not been verified.

Run from the repository root only when authorized to perform the small synthetic reproduction:

```sh
python3 docs/specifications/011-core/research/probes/issue-124/probe.py
```

The script checks load before creating anything. It pins Node v24.22.1 and installed Squeal 0.1.374 by absolute path. It creates a temporary Git repository with two linked worktrees, one harmless `node:test` arithmetic test and a local marker file. No dependency install or existing repository test is needed. It strips inherited Squeal, Cezar and plugin variables and uses a private runtime directory.

It holds the parent before startup, invokes Codex SessionStart directly for an unheld child, then stops that child. It stops the second child explicitly before its first SessionStart. It checks held parent and child again after an edit and commit. Expected: only the unheld child writes `ran.txt`; parent and preheld child stay down with `untilStart: true`. Each subprocess prints its exact argv, working directory, input and output. The test execution wait is bounded to 35 seconds.

Cleanup ends synthetic sessions and stops each synthetic root, then removes linked worktrees and the temporary repository. A failed stop retains the fixture instead of deleting a potentially active root. The script never runs `squeal start`, never targets an existing root and never spawns an agent. The load skip requires no cleanup. It does not test Cezar orchestration, Vitest inheritance or namespace isolation.
