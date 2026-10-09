"""Preserve only research evidence, not initialization metadata or unrelated skill bodies."""
import json,pathlib,shutil,hashlib
from probe import ROOT
OUT=pathlib.Path(__file__).parent/'logs';OUT.mkdir(exist_ok=True)
summary=[]
events_out=[];hooks_out=[];warmups_out=[]
for line in (ROOT/'sessions.jsonl').read_text().splitlines():
    x=json.loads(line);name=x['name'];row={k:v for k,v in x.items() if k!='meter'}
    row['usd']=sum(m.get('total_cost_usd',0) for m in x['meter']) if name.startswith(('claude','bench')) else None
    row['usage']=[m.get('usage',{}) for m in x['meter']]
    summary.append(row)
    p=ROOT/'logs'/(name+'.events.jsonl')
    if name.startswith('bench'):
        es=json.loads((ROOT/'logs'/(name+'.json')).read_text())
    elif p.exists(): es=[{'event':json.loads(l)} for l in p.read_text().splitlines() if l.startswith('{')]
    else: continue
    keep=[]
    for w in es:
        e=w['event'];kind=e.get('type')
        if kind=='system' and e.get('subtype') not in ('hook_started','hook_response'):continue
        if kind=='item.started':continue
        if kind=='item.completed' and e.get('item',{}).get('type')=='command_execution':
            i=e['item']
            if 'cat ' in i.get('command','') and ('SKILL.md' in i['command'] or 'references/' in i['command']):i['aggregated_output']='[skill body omitted; command preserved]'
        if kind=='result':e={k:e[k] for k in ['type','result','permission_denials','total_cost_usd','usage','num_turns','duration_ms'] if k in e};w['event']=e
        keep.append(w)
    events_out.extend({'session':name,**w} for w in keep)
    hooks=ROOT/'logs'/(name+'.hooks.jsonl')
    if hooks.exists():hooks_out.extend({'session':name,**json.loads(line)} for line in hooks.read_text().splitlines())
    warm=ROOT/'logs'/(name+'.warm.txt')
    if warm.exists():warmups_out.append({'session':name,'output':warm.read_text()})
for name,records in [('events',events_out),('hooks',hooks_out),('warmups',warmups_out)]:
    (OUT/(name+'.jsonl')).write_text(''.join(json.dumps(x)+'\n' for x in records))
(OUT/'sessions.json').write_text(json.dumps(summary,indent=2)+'\n')
for name in ['substitute.json','cost.json']:
    shutil.copyfile(ROOT/name,OUT/name)
print('sessions',len(summary),'Claude USD',round(sum(s['usd'] or 0 for s in summary),6))
print('Codex usage', {k:sum(u.get(k,0) for s in summary if s['name'].startswith('codex') for u in s['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']})
