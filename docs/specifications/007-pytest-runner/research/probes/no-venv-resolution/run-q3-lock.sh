#!/usr/bin/env bash
# Throwaway (007-04) Q3: one uv.lock, several installed sets. For each sync variant: the installed
# distribution names (D2's site-packages listing) and whether `uv sync --check` (default selection) passes.
set -uo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
W=$P/work/q3lock; rm -rf $W; mkdir -p $W
cp -r $P/work/fix/small $W/base; rm -rf $W/base/.venv* $W/base/uv.lock
cd $W/base
# an extra, a non-default group, two marker-guarded dependencies
sed -i 's/^dependencies = \["other"\]/dependencies = ["other", "tomli; python_version < \\"3.11\\"", "colorama; sys_platform == \\"win32\\""]\n\n[project.optional-dependencies]\nyaml = ["pyyaml"]/' pyproject.toml
sed -i 's/^dev = \["pytest>=8", "pytest-mock"\]/dev = ["pytest>=8", "pytest-mock"]\nlint = ["six"]/' pyproject.toml
uv lock -q -p 3.13; LOCK=$(sha256sum uv.lock | cut -c1-12)
dists() { ls $1/lib/python*/site-packages | sed -n 's/-[^-]*\.dist-info$//p' | tr '\n' ' '; }
run() { # name, python, sync flags
  local n=$1 py=$2; shift 2; rm -rf $W/$n; cp -r $W/base $W/$n; cd $W/$n
  uv sync -q -p $py --locked "$@" 2>&1 | tail -1
  [ "$n" = "by-hand" ] && uv pip install -q -p .venv/bin/python six
  uv sync --check -q -p $py >/dev/null 2>&1; local ck=$?
  echo "$n: lock $(sha256sum uv.lock | cut -c1-12) | py $py | flags '$*' | sync --check exit $ck | $(dists .venv)"
}
run default 3.13
run py310 3.10
run no-dev 3.13 --no-dev
run extra 3.13 --extra yaml
run all-groups 3.13 --all-groups
run by-hand 3.13
echo "-- lock records markers and the extra without choosing:"; grep -n -E '^name = "(tomli|colorama|pyyaml|six)"|marker|optional-dependencies|dev-dependencies' $W/base/uv.lock | head -12
