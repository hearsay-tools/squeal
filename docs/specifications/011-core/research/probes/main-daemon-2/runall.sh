#!/bin/sh
# 011-300 probe (throwaway): the four md2.mjs runs, in $TMPDIR/md2 (store copies under stores/, fileruns under out/).
P=$(cd "$(dirname "$0")" && pwd); cd "$TMPDIR/md2" || exit 1
W="2026-11-02T16:50:00Z 2026-11-05T16:50:00Z"
for env in 1 0; do
  tag=$([ $env = 1 ] && echo env || echo noenv)
  MD_ENV=$env nice -n 10 node --max-old-space-size=8192 $P/md2.mjs stores/cezar/store.sqlite out/fr-cezar.jsonl ~/projects/cezar/.git ~/projects/cezar/squeal.config.json $W 70,90,180 out/cezar-$tag > out/cezar-$tag.log 2>&1
  MD_ENV=$env nice -n 10 node --max-old-space-size=8192 $P/md2.mjs stores/squeal/store.sqlite out/fr-squeal.jsonl ~/projects/squeal/.git ~/projects/squeal/squeal.config.json $W 60,90,140 out/squeal-$tag > out/squeal-$tag.log 2>&1
done
echo all done
