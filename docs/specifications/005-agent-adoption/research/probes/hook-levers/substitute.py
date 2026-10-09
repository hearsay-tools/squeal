"""Direct, non-model probes of the shipped checkpoint and Stop semantics."""
from probe import ROOT, CLI, run, setup
import json,time,sqlite3
r=setup('substitute'); counter=ROOT/'executions.jsonl'
(r/'probe.test.js').write_text("import {test,expect} from 'vitest'; import {appendFileSync} from 'node:fs'; test('deliberate failure',()=>{appendFileSync("+json.dumps(str(counter))+",'ran\\n');expect(1).toBe(2)});\n")
records=[]
def record(args):
    before=len(counter.read_text().splitlines()) if counter.exists() else 0
    t=time.monotonic(); x=run(args,r,timeout=60)
    after=len(counter.read_text().splitlines()) if counter.exists() else 0
    records.append({'args':args,'exit':x.returncode,'seconds':round(time.monotonic()-t,3),'executionsAdded':after-before,'stdout':x.stdout,'stderr':x.stderr})
record(CLI+['start'])
record(CLI+['run','--all','--wait'])
record(CLI+['run','--all','--wait'])
record(CLI+['run','--all','--force','--wait'])
record(['npx','vitest','run'])
record(CLI+['run','probe.test.js','--wait'])
record(CLI+['stop'])
record(CLI+['run','--all','--wait'])
(ROOT/'substitute.json').write_text(json.dumps(records,indent=2))
print(json.dumps([{k:v for k,v in x.items() if k not in ('stdout','stderr')} for x in records],indent=2))
