# 001-410 notes: the no-install note says what an install gains

Wave 14 W2. Commits `40843704`, `a478cbe7`, plus the reinstall test fix.

## Seam map

- `src/core/scheduler/install-command.ts` (new): `installCommand(root, manifest)` reads the root's committed lockfile. Order: `package-lock.json`, `npm-shrinkwrap.json` give `npm ci`; `pnpm-lock.yaml` gives `pnpm install --frozen-lockfile`; `yarn.lock` gives `yarn install --immutable`, or `yarn install --frozen-lockfile` when its head says `# yarn lockfile v1`; `bun.lock` and `bun.lockb` give `bun install --frozen-lockfile`. A `packageManager` field picks among several lockfiles. With no lockfile it names the manager's plain install, else `npm install`. It reads only the first 256 bytes of each file.
- `missingInstall` (`scheduler/install.ts`) now returns `{ workspaces, command }`. `recordWait` writes the command to a new per-worktree meta row, `installCommand` (`install-command.<id>`, `installCommandMetaKey` in `types/scheduler.ts`, listed in `WORKTREE_META_ROWS`), beside `awaitingInstall`.
- `readHeader` sets `StatusHeader.installCommand` (additive) while waiting.
- `src/core/scheduler/awaiting-install.ts` (new) holds `awaitingInstallSentence(missing, command)` for the header and `awaitingInstallNote` for the scheduler's note. The note is the same sentence with its first letter in lower case and no final period, as other notes read. `format.ts` imports it from the scheduler. The module sits in the scheduler, a guarded source, so the key guard needs no new seam. The KEY_FORMAT pin still moves, because `install.ts` is guarded.

## Decisions

- With no stored command, as when a daemon from before 001-410 started the wait, the sentence says "Install them:".
- Yarn 1 does not take `--immutable`, so a v1 lockfile gets `--frozen-lockfile`. The row named only `--immutable`.
- The lockfile is looked up at the worktree root only. Workspaces install from the root.
- `AWAITING_INSTALL_REASON`, the reason an unknown test file shows, is unchanged.
