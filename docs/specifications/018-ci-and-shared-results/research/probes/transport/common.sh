# Throwaway (018-14). Shared setup: a clean git identity and no user or system git config.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@example.invalid GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@example.invalid
ms() { date +%s%N | cut -c1-13; }
# fresh <dir>: bare origin.git with 3 commits on main, plus clone "ci".
fresh() {
  rm -rf "$1"; mkdir -p "$1"; cd "$1"
  git init -q --bare -b main origin.git
  git clone -q origin.git ci 2>/dev/null
  (cd ci && for i in 1 2 3; do echo "$i" > f.txt; git add f.txt; git commit -qm "c$i"; done && git push -q origin main)
}
