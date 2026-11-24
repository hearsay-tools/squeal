# Issue 279: throwaway attribution probe

Throwaway research fixture, not a regression test or product implementation.
Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-279/probe.ts
```

The probe calls production declared-input selection, closure assembly, attribution
and text functions. An in-memory partial Store supplies registration at revision
0, an edit at revision 1 and a closure containing declared inputs. It offers two
synthetic other-worktree failures through a counted history reader, one clean at
revision 0. It does not create worktrees, start daemons, run tests or use the real
store. The other failures are mock evidence, not observations of live worktrees.
It exits before the calls when one-minute load exceeds CPU count.

`output.txt` preserves the final run against Squeal source 0.1.633 at
`fe0ba088e9607368dc0b76a689c3097673b59690`, on 2026-11-25 Europe/Warsaw
(2026-11-24 UTC). Exit 0; elapsed shell command 0.26 s; load 0.93 on 16 CPUs. The probe first lived at repository-root `research/probes/issue-279/`,
then moved here; its typed run there passed at load 0.56 in 0.23 s. An earlier
run before correcting the mock check identity to the production type also exited 0 with
identical substantive output (load 0.48 instead of 0.56). No dependency install.

See `docs/specifications/011-core/research/issue-279.md` for the source trace,
version comparison and limits. No original host failure is reproduced here.
