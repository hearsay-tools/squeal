# Wave 5 review: cand/0.1.392

Use /reviewer. Shape: review. Review `cand/0.1.392` at `baa9cb628` exactly, against main `ee85e1270`. Own only `reviews/0.1.392.md`.

**Rows:** 017-15 (oxlint in the daemon: one lint pass per tool, `lint.tools`, oxlint lines name the tool), 017-23 (a lint change is news at Stop by itself; code news rides beside it), 017-24 (ESLint 9 with nested configs uses each file's nearest config; `ESLINT_FLAGS` keyed), 017-27 (relative fs calls in the ESLint worker resolve against the root). Research 017-26 (`research/lint-memory.md`) is docs only.

**Read:** `spec.md` D1, D2, D3 step 4, D5, D7, D8 "At Stop", D11; notes `tasks/017-15/`, `017-23/`, `017-24/` (covers 017-27).

**Check for concrete failure modes:**
- Two tools on one file: neither tool's state, view, transition or told mark overwrites the other's; ESLint-only output is byte-identical to 0.1.391 on every surface.
- oxlint keys: every input `research/oxlint-provider.md` names re-keys, including a config edit with no import plugin and a program file edited during a run. `lint.tools: ["eslint"]` starts no oxlint process.
- An older Squeal (0.1.391) meeting an oxlint row: only lint is unreadable, no daemon or hook ends.
- Stop: a lint change alone is told once and never repeated, in each harness; with `lint.blocking` off Stop holds no further; a Stop with only a code change tells nothing.
- 017-24: the nested-config walk (it includes git-ignored folders) never stores a result the CLI with the flag would not give; ESLint 10 and configs without nesting are unchanged.
- 017-27: every relative path argument of `fs`, sync, callback and promise forms, resolves at the root, with the observer's hashes still on the bytes read.

Use targeted checks and Squeal, real ESLint 9 and 10 and real oxlint 1.90. No full suite, checkpoint or build. CI run 41369888037 is the candidate's full suite. A proven break blocks. Commit the report alone, then reply with the verdict, the head and the evidence.
