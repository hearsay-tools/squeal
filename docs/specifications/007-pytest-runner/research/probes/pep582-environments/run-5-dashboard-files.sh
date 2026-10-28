#!/usr/bin/env bash
# Q3/Q5: the real case, read only: files are read, nothing in the dashboard is run or written.
# No pdm, pytest, python-from-the-project or docker is started there; only python3 -I scripts from this folder read its files.
set -u; P=$(cd "$(dirname "$0")" && pwd); load() { echo "load(1m) $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs"; }; load
R=$HOME/projects/saas-bp-management-dashboard
echo "dashboard HEAD $(git -C $R log -1 --format='%h %cs')"
for p in backend workers; do
  B=$R/packages/$p; L=$B/__pypackages__/3.11/lib
  echo "== $p"
  echo "-- pdm.toml: $(tr '\n' ' ' < $B/pdm.toml)"
  echo "-- .pdm-python: $(cat $B/.pdm-python) (git: $(git -C $R ls-files --error-unmatch packages/$p/.pdm-python >/dev/null 2>&1 && echo tracked || echo untracked); committed bytes: $(git -C $R show HEAD:packages/$p/.pdm-python 2>/dev/null || echo none))"
  echo "-- interpreter realpath: $(readlink -f $(cat $B/.pdm-python)); inside worktree: $(case $(readlink -f $(cat $B/.pdm-python)) in $R/*) echo yes;; *) echo no;; esac)"
  echo "-- __pypackages__ minors: $(ls $B/__pypackages__ | tr '\n' ' '); lib entries $(ls $L | wc -l); dist-info $(ls -d $L/*.dist-info | wc -l); .py files under lib $(find $L -name '*.py' | wc -l)"
  echo "-- .pth: $(cd $L && ls *.pth | tr '\n' ' ')"
  echo "-- import-line .pth: $(cd $L && grep -l '^import' *.pth | tr '\n' ' ')"
  echo "-- editable direct_url.json: $(grep -l '"editable": *true' $L/*.dist-info/direct_url.json 2>/dev/null | sed "s#$L/##" | tr '\n' ' ')"
  echo "-- pytest11 entry points:"; for f in $L/*.dist-info/entry_points.txt; do awk '/^\[/{f=($0=="[pytest11]");next} f&&NF' $f; done | sort | sed 's/^/     /'
  echo "-- bin shebangs: $(head -qn1 $(grep -Il . $B/__pypackages__/3.11/bin/*) 2>/dev/null | sort | uniq -c | sort -rn | head -3 | tr -s ' ' | tr '\n' ';')"
  echo "-- lock vs installed:"; python3 -I $P/lockcheck.py $B/pdm.lock $L | sed 's/^/     /'
  echo "-- pytest config: $(grep -A3 '^\[tool:pytest\]' $B/setup.cfg | tr '\n' ' ')"
  echo "-- test files (squeal.config include): $(cd $B && find . -path ./__pypackages__ -prune -o -path ./node_modules -prune -o \( -name 'test_*.py' -o -name 'tests.py' -o -name '*_tests.py' \) -print | wc -l)"
done
