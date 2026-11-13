# Issue 205: silent per-file part refusal

Throwaway research probe. It is not a product test or a benchmark.

From the repository root, with its pnpm dependencies already installed:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-205/probe.mjs /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal
```

The optional argument selects a Squeal executable. The captured run used the session-pinned 0.1.460 launcher, Node 26.13.0 and Vitest 5.0.3.

The script makes a disposable git repository under ignored `.tmp/`, with one source and two one-test files. It links the repository's existing `node_modules`; it installs nothing. It changes the source, records the two tests with `ci record`, and runs the gate with those parts as the accepted control. It then changes only the recorded input hash for `test/refused.test.ts` to forty zeroes, clears only the disposable fixture's stores, and runs the same gate again. The other file remains an accepted control in that second gate. The fixture is removed in `finally`.

The script checks the one-minute load before recording and before each gate. It stops if load exceeds the CPU count. Vitest uses one worker. Each gate has a 30-second budget; each subprocess has a 90-second outer bound. No Squeal daemon or repository test suite is started by the probe.

`evidence/` preserves stdout, stderr, exact command arguments, host samples and the mutation summary. `commands.json` replaces only the random fixture working directory with `<fixture>`. No environment dump or raw CI part is kept. The summary records the original and replacement hashes, both passing file records, and both gates' evidence sources. The assertions require the control to reuse both files and the mutated case to rerun exactly the intended file while keeping the other from parts.

The mismatch is intentional. It establishes the missing diagnostic; it does not establish why the original incident's 148 files were refused. See the [findings](../../issue-205.md).
