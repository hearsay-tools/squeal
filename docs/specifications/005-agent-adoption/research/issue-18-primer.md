# Issue 18: discovering the named wait

Reviewed 2026-10-16 at commit `41718275`. Source: [hearsay-tools/squeal#18](https://github.com/hearsay-tools/squeal/issues/18), labelled `friction` (an agent session report).

## Fit and existing work

Aligned with vision decision filter 1, 2, 3, 4 and 6: expose existing relevant evidence, avoid unnecessary blocking and duplicate runs, preserve selected-file provenance, and use the shared primer across harnesses. Project completion policy still decides whether a broader checkpoint is required.

005-11 already shipped the named wait in 0.1.133; 005-15 shipped D6's instruction texts. Neither is an open row for this omission. D6 explicitly chose not to mention the path form in the primer because the ordinary wait already covered edited files. Issue 18 adds evidence against that assumption: a root typecheck reportedly re-keyed most of cezar's suite while the agent needed only the automations directory. Issue 14 concerns queue priority, not discovering the existing command. No issue-18 row or matching pending primer-discovery row was found in `docs/board.md`.

## Reproduction path and limits

Read in source and reproduced in this session's injected 0.1.199 primer:

1. Start a Codex session with Squeal 0.1.199. Its injected primer names only `status --wait 60000`, without a selected-path example or a distinction between the two wait scopes. This review session received that text.
2. Inspect `src/harness/shared/primer.ts`, function `primer`: its wait sentence has no path argument, including the shortened command-name variants.
3. Inspect installed `/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/skills/squeal/SKILL.md`, step 3: it recommends `status --wait 60000` or `--wait 120000` on a busy host, without the path form. The repository's `plugins/claude-code/skills/squeal/SKILL.md` has the same omission in step 3.
4. Read `plugins/claude-code/skills/squeal/references/commands.md`, “Waiting for pending checks”: it already documents `squeal status --wait 60000 <path>...`, selection and verdicts, and says other files' work does not affect that wait. The Pi reference agrees.

The instruction/discoverability gap is reproduced. The reported 120 s timeout, 72 of 163 pending files, and duplicate `npm test -- packages/cezar/src/automations` run are the reporter's evidence from cezar PR 1184, not independently reproduced here. No timing experiment or product change was made. The pathless wait is not a full-suite checkpoint: it follows the consumer's re-keyed files or news. Any eventual wording must preserve that distinction and the separate `run --all --wait` gate.

## Human decision to surface

Board row 005-67 is planned, awaiting the human's choice whether to revise D6's explicit no-primer-change decision. Proposed scope: name the path-scoped wait, explain its selected-file verdict and when each wait applies, and align the installed skill body. Preserve the primer's 1,500-character cap, coverage caveats and project gates. Do not add queue prioritization from issue 14. No implementation is authorized by this triage.
