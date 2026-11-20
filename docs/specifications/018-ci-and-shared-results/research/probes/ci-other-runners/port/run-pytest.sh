#!/usr/bin/env bash
# Throwaway (spec 018 research ci-other-runners): does a CI-shaped clone key pytest files as a developer
# clone does? Fixture: Squeal's test/fixtures/pytest/small plus a squeal.config.json pytest entry.
# A: developer path, `uv sync --locked` on uv's Python 3.13. Then one B per $VARIANT at a GitHub runner
# path with its own HOME:
#   same    - `uv sync --locked` on the same interpreter
#   copy    - `uv sync --locked` on a copy of that interpreter at a tool-cache path (setup-python layout)
#   venv    - stdlib `python -m venv` (pip inside) on the same interpreter, then the locked set installed by `uv pip`
# Each side runs the fixture's tests and exports; the exports' keys and descriptors are compared.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
BASE=${BASE:?}; SQ_CLI=${SQ_CLI:?}
NODE_SRC=$(dirname "$(readlink -f "$HOME/.nvm/versions/node/v26.13.0/bin/node")")
PY=$(readlink -f "$HOME/.local/share/uv/python/cpython-3.13-linux-x86_64-gnu")
rm -rf "$BASE"; mkdir -p "$BASE/origin" "$BASE/home/runner/tmp"
cp -r "$ROOT/test/fixtures/pytest/small/." "$BASE/origin/"
printf '%s\n' '{ "pytest": [{ "name": "py", "include": ["tests/**/test_*.py"] }] }' > "$BASE/origin/squeal.config.json"
printf '.venv/\n__pycache__/\n.pytest_cache/\n' > "$BASE/origin/.gitignore"
git -C "$BASE/origin" init -q -b main && git -C "$BASE/origin" add -A && git -C "$BASE/origin" -c user.name=p -c user.email=p@p commit -qm fixture
uvenv=(env -u VIRTUAL_ENV -u PYTHONPATH -u PYTHONHOME UV_NO_CONFIG=1 UV_PYTHON_DOWNLOADS=never)
sync() { (cd "$1" && "${uvenv[@]}" uv sync -q --locked --python "$2"); }
side() { # dir out env...
  local dir=$1 out=$2; shift 2
  (cd "$dir" && nice "$@" node --disable-warning=ExperimentalWarning "$SQ_CLI" start >/dev/null
   nice "$@" node --disable-warning=ExperimentalWarning "$SQ_CLI" run --all --wait >/dev/null
   "$@" node --disable-warning=ExperimentalWarning "$SQ_CLI" status | sed -n 2,3p
   [ -n "${IMPORT:-}" ] && "$@" node --disable-warning=ExperimentalWarning "$SQ_CLI" import --dry-run "$IMPORT" | grep -v '^Dry run'
   "$@" node --disable-warning=ExperimentalWarning "$SQ_CLI" export --out "$out"
   "$@" node --disable-warning=ExperimentalWarning "$SQ_CLI" stop >/dev/null)
}
A=$BASE/dev/small; git clone -q "$BASE/origin" "$A"; sync "$A" "$PY/bin/python3.13"
echo "== A (developer)"; side "$A" "$BASE/a.json.gz" env -i HOME="$HOME" PATH="$NODE_SRC:/usr/bin:/bin" TMPDIR="$TMPDIR" LANG=C.UTF-8
for VARIANT in ${VARIANTS:-same copy venv}; do
  B=$BASE/$VARIANT/home/runner/work/small/small; git clone -q "$BASE/origin" "$B"
  case $VARIANT in
    same) sync "$B" "$PY/bin/python3.13" ;;
    copy) TCP=$BASE/$VARIANT/opt/hostedtoolcache/Python/3.13.14/x64; mkdir -p "$(dirname "$TCP")"; cp -a "$PY" "$TCP"; sync "$B" "$TCP/bin/python3.13" ;;
    venv) (cd "$B" && "$PY/bin/python3.13" -m venv .venv && "${uvenv[@]}" uv export -q --locked --no-hashes --format requirements-txt > "$BASE/req-$VARIANT.txt" && "${uvenv[@]}" uv pip install -q --python .venv/bin/python -r "$BASE/req-$VARIANT.txt") ;;
  esac
  mkdir -p "$BASE/$VARIANT/home/runner/tmp"
  echo "== B $VARIANT"
  IMPORT="$BASE/a.json.gz" side "$B" "$BASE/b-$VARIANT.json.gz" env -i HOME="$BASE/$VARIANT/home/runner" PATH="$NODE_SRC:/usr/bin:/bin" TMPDIR="$BASE/$VARIANT/home/runner/tmp" LANG=C.UTF-8
  python3 "$HERE/compare.py" "$BASE/a.json.gz" "$BASE/b-$VARIANT.json.gz"
done
