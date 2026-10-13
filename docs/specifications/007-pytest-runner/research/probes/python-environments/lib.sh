# Shared helpers for the throwaway probes. Source, do not run.
P=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
S=$P/scratch
# A git repository with the fixture committed, at $1.
mkrepo() {
  rm -rf "$1"; mkdir -p "$1"; cp -r "$P/fixture/." "$1/"
  printf '.venv/\n__pycache__/\n.pytest_cache/\n' > "$1/.gitignore"
  git -C "$1" init -q -b main && git -C "$1" add -A && git -C "$1" -c user.name=p -c user.email=p@p commit -qm fixture
}
# Wall time of a command in ms, best of N (default 5).
ms() { local n=${N:-5} best=999999 i s e; for i in $(seq $n); do s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N); t=$(( (e-s)/1000000 )); (( t < best )) && best=$t; done; echo "$best ms: $*"; }
