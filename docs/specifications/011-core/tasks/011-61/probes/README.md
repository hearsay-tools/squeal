# 011-61 probes (throwaway)

Throwaway. Not product code, not a test. Delete when 011-61's code rows land.

`git-unmerged.sh [<scratch-dir>]` runs git only (no Squeal, no daemon, no Node) in a
repository it builds under the scratch directory (default `/tmp/r61-probe`), with its
own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_DATA_HOME`,
and `GIT_CONFIG_NOSYSTEM=1`, so no user or system git configuration applies. It records:

1. a conflicted `git merge` (content, modify/delete and add/add conflicts): the
   `git status --porcelain=v1` codes, `git ls-files -u`, the index file's inode,
   size and mtime, and, through `strace`, the order in which git writes the
   conflicted files and renames `index.lock` to `index`;
2. the write-then-stage order: the resolved bytes written first, then `git add`;
   whether `git --no-optional-locks status` and a plain `git status` change the
   index file;
3. `git merge --abort`, and `git add` of bytes that still hold markers;
4. rebase, cherry-pick and `stash pop` conflicts, and `git reset` after the last;
5. the marker lines under `merge.conflictStyle` `diff3` and `zdiff3`.

Run from the Squeal worktree root, only while the one-minute load is below the CPU count:

    docs/specifications/011-core/tasks/011-61/probes/git-unmerged.sh /tmp/r61-probe > docs/specifications/011-core/tasks/011-61/probes/output-run1.txt 2>&1
    rm -rf /tmp/r61-probe
