# issue-9-git-identity probe (throwaway)

Throwaway evidence for `../../issue-9-git-identity.md`. Not product code, not a test; nothing here runs in CI. Delete freely.

The fixture lived in `mktemp -d /tmp/issue9-fixture-XXXX` (the path is rewritten to `/tmp/issue9-fixture` in the logs) and is gone: `squeal stop`, `squeal remove --config`, `rm -rf`.

Fixture: `git init -b main`; `node_modules` a symlink to this worktree's `npm ci --ignore-scripts` install (Vitest 5.0.3), ignored by `.gitignore`; `package.json` (`"type": "module"`), `vitest.config.js` (`include: ["test/**/*.test.js"]`), `src/sum.js` exporting `sum`, `test/sum.test.js` with one test; `squeal init`; everything committed. Squeal 0.1.199 through `~/.local/bin/squeal`.

Steps and logs:

0. `0-clean-start.log`: commit, `squeal start`, `squeal run --all --wait`.
1. `1-edit-commit.log`: add `double` to `src/sum.js` and a test for it, `squeal status --wait 60000`, `git add -A`, `git commit`, then at once `git rev-parse HEAD`, `git status --porcelain`, `squeal status`, `squeal status --json`.
2. `2-poll-after-commit.log`: the `Revision:` and `Worktree:` lines every ~5 s for a minute.
3. `3-after-pass.log`: Git, text and JSON status after the idle reconciliation pass, then `squeal status --wait 60000`.
4. `4-why-stop.log`: `squeal why double`, `squeal stop`, status with no daemon.
