"""Three subject sessions measuring launch counts; timed hook events, no daemon."""
from probe import ROOT, PLUGIN, ENV, setup
import json,subprocess,time
prompt='Use Bash to run `pwd` in eight separate tool calls, then `npx vitest --version` once. No loops or chaining. Do not read files or edit anything. Report those outputs briefly.'
for mode in ('none','if','sh'):
    d=setup('bench-'+mode); (d/'squeal.config.json').unlink()
    h={'type':'command','command':'true','timeout':2}
    if mode=='if':h['if']='Bash(npx vitest *)'
    if mode=='sh':
        old=json.loads((PLUGIN/'codex/hooks/hooks.json').read_text())['hooks']['PreToolUse'][0]['hooks'][0]['command']
        h['command']=old.split('; exec node')[0]+'; true'
    settings={'permissions':{'allow':['Bash(pwd)','Bash(npx vitest *)']},'hooks':{} if mode=='none' else {'PreToolUse':[{'matcher':'Bash','hooks':[h]}]}}
    (d/'settings.json').write_text(json.dumps(settings))
    args=[str(ROOT/'claude'),'-p',prompt,'--model','claude-sonnet-5-5','--output-format','stream-json','--verbose','--include-hook-events','--setting-sources','project','--strict-mcp-config','--settings',str(d/'settings.json'),'--plugin-dir',str(PLUGIN/'claude-code'),'--tools','Bash','--max-budget-usd','0.5']
    t=time.monotonic(); p=subprocess.Popen(args,cwd=d,env=ENV,text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    events=[]
    for line in p.stdout:
        try:events.append({'ms':round((time.monotonic()-t)*1000,3),'event':json.loads(line)})
        except ValueError:pass
    p.wait(timeout=120)
    (ROOT/'logs'/f'bench-{mode}.json').write_text(json.dumps(events,indent=2))
    result=[x['event'] for x in events if x['event'].get('type')=='result']
    with (ROOT/'sessions.jsonl').open('a') as f:f.write(json.dumps({'name':'bench-'+mode,'seconds':round(time.monotonic()-t,3),'exit':p.returncode,'meter':result})+'\n')
    print(mode,round(time.monotonic()-t,3),flush=True)
