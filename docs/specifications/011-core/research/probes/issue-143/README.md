# Probe: issue 143 (throwaway)

Throwaway recipe for `../../issue-143.md`. Not product code, not a test. Delete it when the issue closes.

- `fixture/`: two Vitest test files, `helper.ts`, a `vitest.config.ts` whose `testTimeout` line the scripts make conflict, `squeal.config.json`, `package.json`. `gitignore` becomes `.gitignore`.
- `run.sh <claude-code-dist> [scratch]`: rebase conflict in `vitest.config.ts`, a hook at each step, then resolution in three steps (write, `git add`, `git rebase --continue`) and one later edit.
- `run-quiet.sh <claude-code-dist> [scratch]`: the same conflict, resolved with no hook between the conflict and the resolution.

Each script makes a scratch tree (`/tmp/issue143-probe` or `/tmp/issue143-quiet`) with its own `HOME` and `XDG_RUNTIME_DIR`, installs `vitest@5.0.3` there with npm before `HOME` moves, and stops its own daemon at the end. Output is not committed: it holds local paths. `node_modules` is never committed.

Run it only when the one-minute load is below the CPU count. Example:

```
bash run.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.390/dist > out.txt 2>&1
```
