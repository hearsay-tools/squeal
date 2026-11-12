# Issue 202 probe (throwaway)

This is research scaffolding, not a product test. It adapts issue 201's tiny
node:test fixture to a real installed CLI child. No dependencies are installed
and no `node_modules` belongs in this directory.

The intended cases measure complete JSON arrival and child `close`: unlocked,
then a scratch SQLite writer released two seconds after complete JSON. Each
has a second gate to check stored reuse. The script gives children a temporary
HOME/TMPDIR, creates one temporary git repository, and removes it afterward.
Only that repository's store is opened for a lock. No daemon is started.
Each CLI invocation has a 45-second termination timer.

The command used was:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-202/return-delay.mjs \
  /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.457/dist/cli/squeal.mjs \
  > docs/specifications/020-quality-gate/research/probes/issue-202/evidence-2026-11-12.txt
```

**Outcome: SKIP, not PASS.** Load was 31.92 on 24 CPUs. The script returned
before creating a fixture or taking a lock. Only the version/admission path
ran. The live assertions are untested; `node --check` passed. Do not cite this
script as a reproduction. A future run must also obey the load limit.

The verified timings in [the report](../../issue-202.md)
come from the committed issue-201 evidence, whose offline verifier passed.
