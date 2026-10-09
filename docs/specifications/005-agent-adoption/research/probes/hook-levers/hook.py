#!/usr/bin/env python3
"""Experimental intervention; deliberately not production command matching."""
import json,pathlib,subprocess,sys,time,shlex
x=json.load(sys.stdin); cfg=json.loads((pathlib.Path(x['cwd'])/'probe-mode.json').read_text()); mode=cfg['mode']
with open(cfg['log'],'a') as f:f.write(json.dumps({'time':time.time(),'input':x})+'\n')
command=x.get('tool_input',{}).get('command','')
if 'npx vitest' not in command: sys.exit(0)
if mode in ('baseline','if'): sys.exit(0)
cli=shlex.join(cfg['cli'])
status=subprocess.run(cfg['cli']+['status'],cwd=x['cwd'],text=True,capture_output=True,timeout=1.5).stdout
out={'hookEventName':x['hook_event_name']}
if mode in ('rewrite','allow','ask','allow-unlisted','deny-original','deny-rewritten'):
    out['updatedInput']={**x['tool_input'],'command':"printf '%s\\n' 'SQUEAL substitution: npx vitest run did not execute; checking all configured test files using current cached results where available.'; "+cli+' run --all --wait'}
    if mode!='rewrite': out['permissionDecision']='ask' if mode=='ask' else 'allow'
elif mode=='deny':
    out.update(permissionDecision='deny',permissionDecisionReason='The requested Vitest command did not run. Squeal currently holds:\n'+status+'\nUse the current evidence if sufficient, or run an explicit fresh test command if required.')
elif mode in ('prectx','post'):
    out['additionalContext']=('Before this command Squeal already held:\n' if mode=='prectx' else 'Your Vitest command ran; the warm Squeal evidence was already current before it:\n')+status
print(json.dumps({'hookSpecificOutput':out}))
