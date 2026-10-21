# Probes for 011-81 (throwaway)

Throwaway probes for `research/key-split.md`. Nothing here is product code or a test.

- `parts.ts`: prints each input of a worktree's environment hash and its
  installed-dependency key, for one or more roots, using the key code of a
  named checkout. It starts Vitest's Node API in-process to read the project
  environment, as the daemon does; it runs no test.
  Run from a clone with its own `node_modules`, with HOME, XDG and TMPDIR under `/tmp`:
  `node_modules/.bin/tsx <probe>/parts.ts <code-root> <root>...`
- `lockfile-parts.ts`: per root, the hash of the installed lockfile whole and
  without the root and workspace packages' own versions (the candidate of
  question 5). Reads files only; no Vitest.
- `stores.ts`: read-only queries of a Squeal store (`node:sqlite`, `readOnly: true`).

Outputs, as run on 2026-10-21 between 21:04 and 21:17 CEST (one-minute load 31.9 to 36.6 on 24 CPUs):

- `parts-output.jsonl`: `parts.ts` on squeal clones `a` (0.1.240, `94607f2e3`), `b` (0.1.242, `423953305`) and `c` (`423953305` over an install of 0.1.237, `76d961d54`).
- `cezar-parts-output.txt`: `parts.ts` on cezar clones `cz-f1` (`a7ee35b90`, the head of `f1ca49e6`) and `cz-7c` (`5fc6dd862`, the head of `7c144ff7`).
- `lockfile-parts-output.jsonl`: `lockfile-parts.ts` on the clones and every live squeal worktree with an install, read-only.
- `squeal-events.json`, `cezar-events.json`: `stores.ts` over 2026-10-14 21:10 to 2026-10-21 21:10 CEST, with `*-runner-files.json` as the runner files.
