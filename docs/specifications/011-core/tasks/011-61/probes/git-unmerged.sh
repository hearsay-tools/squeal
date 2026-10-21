#!/usr/bin/env bash
# Throwaway probe for 011-61; see README.md. Git only: no Squeal, no daemon, no Node.
set -u
S=${1:-/tmp/r61-probe}
rm -rf "$S"; mkdir -p "$S/home" "$S/run" "$S/config" "$S/cache" "$S/data"; chmod 700 "$S/run"
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache XDG_DATA_HOME=$S/data
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=p@x GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=p@x
R=$S/r
ts() { date +%H:%M:%S.%3N; }
idx() { stat -c 'index ino=%i size=%s mtime=%.9Y' "$(git rev-parse --git-path index)"; }
show() {
  echo "-- $1 [$(ts)]"
  echo "porcelain:"; git --no-optional-locks status --porcelain=v1 -z --untracked-files=normal | tr '\0' '\n' | sed 's/^/  /'
  echo "ls-files -u:"; git ls-files -u | sed 's/^/  /'; idx
}
fresh() {
  rm -rf "$R"; mkdir -p "$R"; cd "$R" || exit 1
  git init -q -b main
  printf 'export function value(): number {\n  return 1;\n}\n' > helper.ts
  printf 'keep\n' > gone.ts; printf 'a\n' > readme.md
  git add -A && git commit -qm base
}

echo "== versions"; git --version; cat /proc/loadavg

echo "== 1. merge: UU, then write-then-stage"
fresh
git switch -qc side; sed -i 's/return 1;/return 2;/' helper.ts; git rm -q gone.ts; printf 'side\n' > both.ts; git add -A; git commit -qm side
git switch -q main; sed -i 's/return 1;/return 3;/' helper.ts; printf 'kept\n' > gone.ts; printf 'main\n' > both.ts; git add -A; git commit -qm main
show "before merge"
echo "\$ strace git merge side (file writes and index renames, in order)"
strace -f -tt -e trace=openat,rename,renameat,renameat2 -o "$S/strace.txt" git merge side >/dev/null 2>&1; echo "[exit $?]"
grep -E 'helper\.ts|both\.ts|gone\.ts|index\.lock|"index"' "$S/strace.txt" | grep -v ENOENT | sed 's/^/  /'
show "after conflicted merge"
echo "gone.ts bytes (modify/delete):"; sed 's/^/  /' gone.ts
echo "helper.ts bytes:"; sed 's/^/  /' helper.ts
printf 'export function value(): number {\n  return 3;\n}\n' > helper.ts
show "after writing resolved helper.ts, before git add"
git add helper.ts; show "after git add helper.ts"
git add both.ts gone.ts; show "after git add of the rest"
git --no-optional-locks status >/dev/null; show "after git --no-optional-locks status (index untouched?)"
git status >/dev/null; show "after plain git status (may refresh the index)"
git commit -q --no-edit; show "after commit"

echo "== 2. merge --abort"
fresh
git switch -qc side; sed -i 's/return 1;/return 2;/' helper.ts; git commit -qam side
git switch -q main; sed -i 's/return 1;/return 3;/' helper.ts; git commit -qam main
git merge side >/dev/null 2>&1; show "conflicted"
git merge --abort; show "after merge --abort"; echo "helper.ts:"; sed 's/^/  /' helper.ts

echo "== 3. add with markers still in the bytes"
git merge side >/dev/null 2>&1; git add helper.ts; show "after git add of conflicted bytes"; grep -c '^<<<<<<<' helper.ts
git merge --abort 2>/dev/null || git reset -q --hard

echo "== 4. rebase conflict"
fresh
git switch -qc side; sed -i 's/return 1;/return 2;/' helper.ts; git commit -qam side
git switch -q main; sed -i 's/return 1;/return 3;/' helper.ts; git commit -qam main
git switch -q side; git rebase main >/dev/null 2>&1; echo "[rebase exit $?]"; show "rebase stopped"
git rebase --abort; show "after rebase --abort"

echo "== 5. cherry-pick conflict"
git switch -q main; git cherry-pick side >/dev/null 2>&1; echo "[cherry-pick exit $?]"; show "cherry-pick stopped"
git cherry-pick --abort; show "after cherry-pick --abort"

echo "== 6. stash pop conflict, then git reset"
fresh
sed -i 's/return 1;/return 2;/' helper.ts; git stash -q
sed -i 's/return 1;/return 3;/' helper.ts; git commit -qam three
git stash pop >/dev/null 2>&1; echo "[stash pop exit $?]"; show "stash pop conflicted"
cp helper.ts "$S/before-reset"; git reset -q; show "after git reset"
cmp -s helper.ts "$S/before-reset" && echo "helper.ts bytes unchanged by reset"; grep -c '^<<<<<<<' helper.ts

echo "== 7. diff3 and zdiff3 marker lines"
for style in diff3 zdiff3; do
  fresh
  git config merge.conflictStyle "$style"
  git switch -qc side; sed -i 's/return 1;/return 2;/' helper.ts; git commit -qam side
  git switch -q main; sed -i 's/return 1;/return 3;/' helper.ts; git commit -qam main
  git merge side >/dev/null 2>&1; echo "-- $style"; grep -E '^(<{7}|\|{7}|={7}|>{7})' helper.ts | sed 's/^/  /'
done
cat /proc/loadavg
