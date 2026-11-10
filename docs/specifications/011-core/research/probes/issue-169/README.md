# Issue 169 selection probe

Throwaway research probe. It queries the installed Squeal CLI and uses Vitest's
`list --filesOnly`; it executes no tests. Run from the repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-169/probe.py --output repeat-results.json
```

Requires the existing repository dependencies and a registered Squeal worktree.
Do not install dependencies or start a daemon merely to run it. `node_modules`
is not part of this probe or its commit. It stops before a command when the
one-minute load exceeds CPU count. Each subprocess is bounded to 30 seconds.

`results.json` is the first capture; that version saved after every command.
`repeat-results.json` is the repeat, with the current script saving only once at
the end to avoid changing the worktree during queries. Both are retained because
snapshot sync was incomplete in both. Do not interpret the exact-path exit 3 as
a selection failure: its two selected files are visible in the output.

`issue.json` is the issue fetched with:

```sh
gh issue view 169 --repo hearsay-tools/squeal --json title,body,comments,url
```

The report is [../../issue-169.md](../../issue-169.md). The repository itself
provides the existing test files used as controls. No fixture or product files
were modified.
