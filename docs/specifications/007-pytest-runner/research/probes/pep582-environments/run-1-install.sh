#!/usr/bin/env bash
# Q1/Q3/Q4: lock and install the fixture in PEP 582 mode on 3.13 and 3.10; record what PDM writes and where.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; rm -rf $S/w; mkdir -p $S/w; cp -a $P/fixture $W; cd $W
git init -q -b main; git add -A; git -c user.name=p -c user.email=p@p commit -qm fixture
touch $S/marker
PY13=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13
PY10=$S/pythons/cpython-3.10.20-linux-x86_64-gnu/bin/python3.10
echo "== pdm use 3.13"; $T/pdm use -f $PY13 2>&1 | show
echo "== pdm install (3.13)"; s=$(date +%s%N); $T/pdm install 2>&1 | tail -4 | show; echo "$(( ($(date +%s%N)-s)/1000000 )) ms"
echo "== pdm use 3.10 + install"; $T/pdm use -f $PY10 2>&1 | show; $T/pdm install 2>&1 | tail -2 | show
echo "== files in the project after both installs (git status --ignored)"; git status --short --ignored | show
echo "-- .pdm-python: $(cat .pdm-python | show)"; echo "-- .python-version: $(cat .python-version 2>/dev/null)"
echo "-- __pypackages__ tree (depth 2)"; find __pypackages__ -maxdepth 2 | sort | show; cat __pypackages__/.gitignore
for v in 3.13 3.10; do L=__pypackages__/$v/lib
  echo "== $v: lib entries $(ls $L | wc -l), dist-info $(ls -d $L/*.dist-info | wc -l)"; echo "-- .pth files:"; for f in $L/*.pth; do echo "$(basename $f): $(head -c 200 $f | show)"; done
  echo "-- direct_url.json files:"; for f in $L/*.dist-info/direct_url.json; do echo "$(basename $(dirname $f)): $(tr -d '\n ' < $f | show)"; done
  echo "-- INSTALLER: $(cat $L/*.dist-info/INSTALLER | sort | uniq -c | tr '\n' ' ')"
  echo "-- bin/pytest shebang: $(head -1 __pypackages__/$v/bin/pytest | show)"
done
echo "== written outside the project since the start (scratch-relative)"
find $S -newer $S/marker -type f -not -path "$W/*" -not -path "$S/uv-cache/*" | sed "s#$S/##" | cut -d/ -f1-3 | sort | uniq -c | sort -rn | head -20
echo "== under the real HOME, PDM-named paths newer than the marker (should be none)"
find /home/agent -maxdepth 5 -newer $S/marker -ipath '*pdm*' -not -path "$P/*" -not -path '/home/agent/projects/*' 2>/dev/null | head
echo "-- pdm.lock head"; sed -n 1,12p pdm.lock
