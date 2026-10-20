# Issue 56: a Vitest result stays current after the script its child process loads appears

Researcher, 2026-10-20, branch `cez/04b7163c` at `4763f3612`. Squeal 0.1.231 (the installed plugin
`~/.claude/plugins/cache/hearsay/squeal/0.1.231`; its `dist/observe/recorder.cjs` and `spawn.cjs` are
byte-identical to `src/runners/observe/*` at `4763f3612`). Node v24.21.0, Vitest 4.1.10, 24 CPUs.
Load before each live run: 14.13 (recorder probe), 10.47 (daemon probe), both under 24.
Issue: hearsay-tools/squeal#56 (incident: cezarion worktree, Squeal 0.1.231, hearsay-tools/cezarion#1305).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a FAIL stay current after the missing script a child imports is created? | Yes, reproduced: `observed at revision 0, current` at revision 1, nothing queued | verified by experiment |
| 2 | Why? | The child's failed resolve records nothing, and the `--eval` argument names no existing file, so the closure carries no path for the script | verified by experiment; read in source code |
| 3 | Does an edit to an existing script re-run its test? | Yes: the observed set holds the script once a run loaded it; the edit re-ran `b.test.ts` | verified by experiment |
| 4 | Does Vitest or Squeal warn about the untraced child input? | No. Vitest prints no warning; Squeal's status shows no note for the file | verified by experiment |
| 5 | Does a declared `inputs` entry fix it? | Yes: the absent path hashes as absent and the create re-keys the file; Squeal prints `inputs glob "scripts/c.mjs" matches no file` meanwhile | verified by experiment |
| 6 | Synthetic versus incident | Synthetic reproduction matches the incident's missing-then-create case; the incident's claim about edits to existing scripts is not reproduced | verified by experiment (synthetic); inferred (incident) |

## Findings

**F1, the recorder seam (verified by experiment, 0.1.231).** `node recorder-probe.mjs <plugin 0.1.231>`
(`probes/issue-56/output-recorder-probe.txt`) loads the shipped recorder as `--require` into a process
that runs `execFileSync(node, ["--input-type=module", "--eval", "import register from '<file URL>'; …"])`:

    --- 1-missing   child failed: Command failed: …  f: (none) l: (none) r: (none) w: (none)
    --- 2-created   child ok: function               f: <root>/scripts/pi-default-tools.mjs
    --- 3-edited    child ok: function               f: <root>/scripts/pi-default-tools.mjs

The child inherits the recorder through `NODE_OPTIONS` (`spawn.cjs`), and its `module.registerHooks`
resolve hook records the script, but only from the result of `nextResolve`
(`src/runners/observe/recorder.cjs:191-205`): a missing module throws `ERR_MODULE_NOT_FOUND` inside
`nextResolve` before `record` runs (read in source code). `recordArguments` (`spawn.cjs:136-147`) records
existing files a spawn's arguments name; the `--eval` string is code holding a `file:` URL, not a path,
and the file does not exist anyway. Node's ESM loader does not go through the wrapped `fs`. So a failing
run whose subject is missing leaves no trace of it.

**F2, live daemon (verified by experiment, 0.1.231, load 10.47 / 24).** `sh probes/issue-56/run.sh`
(`output-run1.txt`): three files whose test imports `../scripts/<n>.mjs` through the child, as above.
`a` has its script missing and no inputs; `b` has its script from the start; `c` has its script missing
and `squeal.config.json` `{"inputs": {"test/c.test.ts": ["scripts/c.mjs"]}}`.

- Phase A, `run --all --wait` at revision 0: `a` and `c` FAIL (`Command failed: … --input-type=module --eval …`), `b` passes.
- Phase B, create `scripts/a.mjs` and `scripts/c.mjs`, then `status --wait 60000` at revision 1:
  `Known failures: 1`; `FAIL test/a.test.ts … observed at revision 0, current`; `c` re-ran and passed;
  `Returned on quiet: nothing the edits since revision 1 re-keyed is pending (0 test files)`.
- Phase C, edit `scripts/b.mjs` to answer 2, revision 2: `FAIL test/b.test.ts … expected '2' to be '1' … observed at revision 2, current`. The edit re-ran `b`.
- Control, `npx vitest run` in the same tree: `Tests 1 failed | 2 passed (3)`: `a` passes there, so
  Squeal's `a` FAIL is a wrong `current` verdict, as in the incident.
- Store `meta` `observed.`: `{"test/b.test.ts":["scripts/b.mjs"]}`: nothing for `a`, whose only run failed to resolve.

**F3, no warning (verified by experiment).** Vitest 4.1.10 prints nothing about the child's import, and
Squeal's status and notes carry no hint for `a`. The one note is for the declared input:
`squeal.config.json: inputs glob "scripts/c.mjs" matches no file`, printed while that input was absent,
though the declared absent path was exactly what keyed `c` correctly. The issue's node:test hint ("what
they reach through a spawned process … declare it in inputs", #37) has no Vitest counterpart here.

**F4, edits to existing scripts (verified by experiment, synthetic).** The issue says an edit to the
scripts of `pi-project-skills.test.ts` and `pi-retry-degraded-service.test.ts` does not re-run them.
Phase C contradicts that for this pattern while `observe.runtimeInputs` holds and a run has loaded the
script: the observed set keys it (011 C3 Closure: "the project paths the file's runs were observed to …
load", merged, never pruned). Not determined for cezarion's own files, because I did not run cezarion;
a cause there would have to differ from this fixture (policy off, a child env that drops `NODE_OPTIONS`
past the recorder's re-insertion, or no passing run yet).

**F5, the failure text (verified by experiment).** Status prints the command as
`import register from 'scripts/a.mjs'`: the `file:` URL in the message is shortened to a worktree path,
which reads like a relative specifier the child could never resolve. Side observation, not the defect.

## Spec ownership

- 011 C12 (recorder, core code `src/runners/observe/*`): what a child records, including a failed resolve. The defect sits here.
- 011 C3 (Closure): "for every unresolved import the target path and its resolution candidates" already
  holds for Vitest's static graph and for setup files (task 001-424); observed runtime inputs have no
  equivalent for a resolve that fails at run time. "Absent paths hash as absent" is what makes F2's `c` work.
- 011 C6 (Status): where a "reaches files through a spawned process" note or the inputs-note wording would live.
- 011 C5 (state and retry reasons): the issue's third ask, a retry reason for "an input changed".
- 013 V3 and V10: the adapter's closure and the recorder's delivery to workers; delivery works (F1, F2 `b`), so no V10 change is indicated.

## Recommendation for Squeal

Treat this as a 011 C12 gap: a run-time resolve that fails records nothing, so the absent target never
enters the closure. The narrowest candidate is for the recorder's resolve hook to record the
target of a `file:` specifier (or a relative one, resolved against the parent URL) when `nextResolve`
throws, as the static closure already records unresolved targets. The absent path then hashes as absent
and the create re-keys the file, which F2's `c` showed works end to end. Tradeoff: a failed bare or
extensionless specifier has candidates the hook would have to guess; recording only the exact `file:`
target covers the incident's shape and guesses nothing. Separately, the "matches no file" note should
not fire for an exact path in `inputs` that keys correctly while absent. No implementation is authorized by this brief.

## Open questions

- Why the incident's existing-script tests would not re-run on edit (F4): needs the cezarion policy and a run there.
- Whether a failed resolve inside Vitest's own worker (not a child) has the same gap: not probed.
- Whether the issue's retry-reason ask is still needed once F1 is closed: a coordinator decision.

## Limitations

One live run, one Node (24.21.0), one Vitest (4.1.10), synthetic fixture only; the store read in F2
assumes the `meta` key is `observed.<project>` with an empty project name. The cezarion incident was not re-run.

## Sources

- hearsay-tools/squeal#56, `gh issue view 56 -R hearsay-tools/squeal`, read 2026-10-20.
- `src/runners/observe/recorder.cjs:1-40, 186-205`; `src/runners/observe/spawn.cjs:136-197` at `4763f3612` (read in source code).
- `docs/specifications/011-core/spec.md` C3 (Closure, Environment hash), C12; `docs/specifications/013-vitest-runner/spec.md` V3, V10.
- `src/core/daemon/policy.ts:30-44` (the `inputs` shape).
- Probes: `docs/specifications/011-core/research/probes/issue-56/` (`recorder-probe.mjs`, `run.sh`, `fixture/`, outputs).
