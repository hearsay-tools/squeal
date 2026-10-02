# Squeal styleguide

Conventions for code, specs and agent work in this repo. Humans own this file and `vision.md`. Agents maintain everything else and propose edits here through PRs.

## Code

- TypeScript, strict mode, ESM, Node 22+. No `any` without a comment saying why.
- Small modules with one purpose. A file over ~300 lines is a signal to split.
- Public interfaces between core, runner adapters and harness adapters are typed and documented in `docs/specifications/`. Internals can change freely; interfaces change through a spec update.
- Errors carry context (check id, revision, path). Never swallow an error silently; either handle it or let it surface.
- Every emitted event and status payload is a versioned, machine-readable shape. Human-readable rendering is a separate layer on top.
- Tests with Vitest. Test behaviour through public interfaces. TDD for new behaviour: failing test first.
- No new runtime dependency without a one-line justification in the PR.

## Naming

- Package and CLI: `squeal`.
- Check states: `pass`, `fail`, `unknown`, `stale`, `running`, `queued`.
- Transitions are written `PASS -> FAIL`, uppercase, in docs and human output.
- A "revision" is Squeal's monotonic workspace generation, not a git SHA. Say "commit" when you mean git.

## Specifications and decisions

- `docs/vision.md`: why Squeal exists. Changes rarely.
- `docs/specifications/`: one folder per feature, see its README. Specs reference commits and PRs by hash or number instead of copying code.
- `docs/decisions/`: numbered ADRs, `NNNN-short-title.md`. Record the decision, the alternatives rejected, and the consequences. Supersede, never edit history.
- Attach preserved snapshots (logs, screenshots, sample payloads) inside the spec folder instead of linking to external tools.

## Agent work

- Tasks are narrowly scoped and short-lived. One issue, one branch, one draft PR.
- A worker reads `vision.md`, this file, and the relevant spec before touching code.
- Research, implementation and review are separate tasks, ideally separate workers.
- Status claims need evidence: paste the command and its output, not "tests pass".
- Scheduled maintenance tasks keep specs, docs and dead code honest. They open PRs; they do not merge.

## Writing

- Short sentences. Data over adjectives. No em-dashes.
- Say what is unknown. "No known failures" is not "everything passes".
