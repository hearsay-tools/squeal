#!/bin/bash
# prints the failure line and test files of each run at revision >= $1
cd /tmp/issue33.suGY/repo/.git/squeal
python3 -I - "$1" <<'PY'
import sqlite3,sys,json,os
c=sqlite3.connect('file:store.sqlite?mode=ro',uri=True)
for rid,rev,tf in c.execute('select id,revision,test_files from runs where revision>=? order by started_at',(int(sys.argv[1]),)):
    files=[f['path'] for f in json.loads(tf)]
    rep=json.load(open(f'runs/{rid}/report.json'))['report']
    print(rev, files, 'completed:',[f['path'] for f in rep.get('completedFiles',[])], 'withheld:',[f['path'] for f in rep.get('withheld',[])], '\n   failure:',rep.get('failure'))
PY
