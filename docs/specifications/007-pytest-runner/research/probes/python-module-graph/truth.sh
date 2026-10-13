#!/usr/bin/env bash
# Throwaway: ground truth, one pytest process per test file, sys.modules snapshot.
# truth.sh <fixture dir> <venv dir name> <out dir>
set -euo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
FIX="$(cd "$1" && pwd)"; VENV="$2"; OUT="$(mkdir -p "$3" && cd "$3" && pwd)"
cd "$FIX"
find tests -name 'test_*.py' | sort | xargs -P 8 -I{} sh -c '
  f="{}"; o="'"$OUT"'/$(echo "$f" | tr / _).json"
  OBSERVE_MODE=modules OBSERVE_OUT="$o" OBSERVE_ROOT="'"$FIX"'" PYTHONPATH="'"$P"'" '"$VENV"'/bin/python -m pytest -p observe_plugin -q "$f" >/dev/null || echo "FAIL $f"'
ls "$OUT" | wc -l
