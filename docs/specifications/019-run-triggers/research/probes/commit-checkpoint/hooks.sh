#!/usr/bin/env bash
# Throwaway probe for 019 commit-checkpoint (see README.md). Builds a fixture
# repository under $1 (a fresh directory), installs logging git hooks, runs
# each git operation and prints which hook fired and whether HEAD moved.
set -euo pipefail
dir=$1
mkdir -p "$dir"
cd "$dir"
log=$dir/hook.log
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@example.invalid
export GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@example.invalid
export GIT_CONFIG_NOSYSTEM=1 HOME=$dir/home
mkdir -p "$HOME"

git init -q -b main repo
cd repo
git config commit.gpgsign false

install_hooks() {
  local hooks=$1
  mkdir -p "$hooks"
  for name in pre-commit post-commit post-rewrite reference-transaction post-checkout post-merge pre-merge-commit; do
    cat >"$hooks/$name" <<EOF
#!/usr/bin/env bash
in=""
[ "$name" = post-rewrite ] || [ "$name" = reference-transaction ] && in=\$(cat | tr '\n' ';')
extra=""
if [ "$name" = pre-commit ]; then
  # Index tree vs working tree: a partial staging shows as "index!=worktree".
  if git diff --quiet; then extra="index==worktree"; else extra="index!=worktree"; fi
  extra="\$extra GIT_INDEX_FILE=\${GIT_INDEX_FILE:-unset}"
fi
if [ "$name" = reference-transaction ]; then
  # Only the committed phase, only lines touching HEAD or a branch.
  [ "\$1" = committed ] || exit 0
  in=\$(printf '%s' "\$in" | tr ';' '\n' | grep -E ' (HEAD|refs/heads/)' | awk '{print \$3}' | tr '\n' ' ')
  [ -n "\$in" ] || exit 0
fi
echo "\$OP $name args=[\$*] \$extra \$in" >>"$log"
exit 0
EOF
    chmod +x "$hooks/$name"
  done
}
install_hooks .git/hooks

op() {
  export OP=$1
  shift
  local before after
  before=$(git rev-parse HEAD 2>/dev/null || echo none)
  "$@" >/dev/null 2>&1 || echo "$OP: command failed: $*" >>"$log"
  after=$(git rev-parse HEAD 2>/dev/null || echo none)
  if [ "$before" = "$after" ]; then echo "$OP HEAD unchanged" >>"$log"; else echo "$OP HEAD moved" >>"$log"; fi
  export OP=setup
}

echo one >a.txt; echo one >b.txt
git add a.txt b.txt
op initial git commit -q -m initial

# 1. Plain commit with partial staging: a.txt staged, b.txt edited but not staged.
echo two >a.txt; echo two >b.txt
git add a.txt
op plain git commit -q -m plain

# 2. Amend.
op amend git commit -q --amend -m plain-amended

# 3. --no-verify.
git add b.txt
op no-verify git commit -q --no-verify -m no-verify

# 4. Rebase of two commits onto a moved main.
git switch -q -c topic
echo t1 >t1.txt; git add t1.txt; OP=setup git commit -q -m t1
echo t2 >t2.txt; git add t2.txt; OP=setup git commit -q -m t2
git switch -q main
echo m1 >m1.txt; git add m1.txt; OP=setup git commit -q -m m1
git switch -q topic
op rebase git rebase -q main

# 5. Cherry-pick.
git switch -q main
op cherry-pick git cherry-pick topic

# 6. Non-fast-forward merge.
git switch -q -c side main~1
echo s >s.txt; git add s.txt; OP=setup git commit -q -m side
git switch -q main
op merge git merge -q --no-ff --no-edit side

# 7. Reset (a HEAD move that is no commit).
op reset git reset -q --hard HEAD~1

# 8. Commit in a linked worktree: hooks of the common .git/hooks run there.
git worktree add -q ../linked -b linked
(cd ../linked && echo w >w.txt && git add w.txt && op linked-worktree git commit -q -m linked)

# 9. core.hooksPath set, as husky does: .git/hooks stops running.
mkdir -p .husky
git config core.hooksPath .husky
echo h >h.txt; git add h.txt
op hookspath-set git commit -q -m hookspath
git config --unset core.hooksPath

# 10. A commit with a git-level override of hooks: -c core.hooksPath=/dev/null.
echo n >n.txt; git add n.txt
op hookspath-override git -c core.hooksPath=/dev/null commit -q -m override

grep -v '^setup ' "$log"
