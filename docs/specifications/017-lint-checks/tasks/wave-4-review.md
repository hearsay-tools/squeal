# Wave 4 review: cand/0.1.391

Use /reviewer. Shape: review. Review `cand/0.1.391` at `a165b36b4` exactly, against main `927669e7c`. Own only `reviews/0.1.391.md`.

**Rows:** 017-17 to 017-20 (the ESLint worker: process directory, a cold typed start, pnpm's shim, an install after a failed config load), 017-22 (a line number inside a message), and 017-14 (the oxlint provider; the pass does not call it yet).

**Read:** `spec.md` D3 to D5, D9 and D11; `lessons.md` Round 1, rows L1 to L5; the notes `tasks/017-17/notes.md`, `tasks/017-22/notes.md` and `tasks/017-14/notes.md`; `research/oxlint-provider.md`.

**Check for concrete failure modes:**
- 017-17: every path ESLint, a plugin or a resolver resolves against the process directory now resolves against the root, including the reads the observer hashes. `PROVIDER_VERSION` 5 keeps old stored results from being reused.
- 017-18: the start budget covers only the program build. A lint that blocks after the build still times out at 5 s. A config that hangs is not hidden for 60 s without a reason.
- 017-19 and 017-20: a stale result is never stored under a new key. A lockfile change starts a new worker and changes no key without cause.
- 017-22: an upgraded file with unchanged findings gets no transition. Normalizing `line N` never merges two different findings.
- 017-14: the key misses no input that `research/oxlint-provider.md` names. Every fault kills the process group. An off or `unknown` case never reads `pass`.
- The bundles match a fresh build. No lint behavior changes while `lint.enabled` is off.

Use targeted checks and Squeal. Do not run a full suite, request a checkpoint or run a build. CI run 41360409542 is the candidate's full suite. A proven break blocks. Commit the report, then reply with the verdict, the head and the evidence.
