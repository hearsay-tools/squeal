#!/usr/bin/env python3
"""Throwaway hook research. All executable fixtures/settings live in ROOT."""
import json, os, pathlib, shutil, subprocess, sys, time, tomllib
ROOT = pathlib.Path('/tmp/squeal-hook-levers-4f3e9ac9')
PLUGIN = ROOT / 'plugins'
ENV = {k:v for k,v in os.environ.items() if not k.startswith(('CLAUDE','CEZ_'))}
for key in ('CODEX_SESSION_ID','CODEX_THREAD_ID'):
    ENV.pop(key,None)
ENV.update(DISABLE_AUTOUPDATER='1', TMPDIR=str(ROOT / 'tmp'))
(ROOT / 'tmp').mkdir(exist_ok=True)
CLI = ['node','--disable-warning=ExperimentalWarning',str(PLUGIN/'claude-code/dist/cli/squeal.mjs')]
PROMPT = 'Run exactly `npx vitest run` (no pipes, redirects, or chained commands) to check this fixture, then report the result and exactly what actually ran. Do not edit any file. If a hook intervenes, decide how to finish honestly.'
def run(args,cwd,**kw):
    return subprocess.run(args,cwd=cwd,env=ENV,text=True,capture_output=True,**kw)
def setup(name):
    d=ROOT/name; d.mkdir(exist_ok=True)
    (d/'package.json').write_text(json.dumps({'name':'hook-probe','type':'module','devDependencies':{'vitest':'5.0.3'}}))
    (d/'node_modules').symlink_to(ROOT/'repo/node_modules',target_is_directory=True) if not (d/'node_modules').exists() else None
    # An installed lockfile must be local to the fixture; symlinked node_modules includes it.
    (d/'.gitignore').write_text('node_modules\n')
    (d/'probe.test.js').write_text("import {test,expect} from 'vitest'; test('one',()=>expect(1).toBe(1));\n")
    (d/'squeal.config.json').write_text(json.dumps({'daemon':{'idleExitMinutes':5}}))
    run(['git','init','-q'],d)
    run(['git','add','.'],d)
    run(['git','-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture'],d)
    return d

def session(harness,mode,index):
    name=f'{harness}-{mode}-{index}'; d=setup(name)
    (ROOT/'logs').mkdir(exist_ok=True)
    config={'mode':mode,'log':str(ROOT/'logs'/f'{name}.hooks.jsonl'),'cli':CLI}
    (d/'probe-mode.json').write_text(json.dumps(config))
    if mode=='stop':
        (d/'squeal.config.json').write_text(json.dumps({'baseline':{'onStart':'lookup-only'},'stop':{'requireFullSuite':True},'daemon':{'idleExitMinutes':5}}))
    # Warm current evidence before the same prompt in each condition.
    warm=run(CLI+['start'],d); checkpoint=run(CLI+(['status'] if mode=='stop' else ['run','--all','--wait']),d,timeout=60)
    (ROOT/'logs'/f'{name}.warm.txt').write_text(warm.stdout+warm.stderr+checkpoint.stdout+checkpoint.stderr)
    event='PostToolUse' if mode=='post' else 'PreToolUse'
    handler={'type':'command','command':f'python3 {ROOT}/hook.py','timeout':2}
    if mode=='if': handler['if']='Bash(npx vitest *)'
    group={'matcher':'Bash','hooks':[handler]}
    if harness=='claude':
        permissions={'allow':['Bash(npx vitest *)','Bash(node *)','Bash(printf *)','Bash(pwd)','Bash(true)']}
        if mode=='allow-unlisted': permissions={'allow':[]}
        if mode=='deny-original': permissions['deny']=['Bash(npx vitest *)']
        if mode=='deny-rewritten': permissions['deny']=['Bash(printf *)']
        settings={'permissions':permissions,'hooks':{event:[group]}}
        (d/'settings.json').write_text(json.dumps(settings))
        args=[str(ROOT/'claude'),'-p',PROMPT,'--model','claude-sonnet-5-5','--output-format','stream-json','--verbose','--include-hook-events','--setting-sources','project','--strict-mcp-config','--settings',str(d/'settings.json'),'--plugin-dir',str(PLUGIN/'claude-code'),'--tools','Bash,Read','--max-budget-usd','0.5']
    else:
        cfg=tomllib.loads((pathlib.Path.home()/'.codex/config.toml').read_text())
        args=[str(ROOT/'codex'),'exec','--json','--skip-git-repo-check','--dangerously-bypass-approvals-and-sandbox','--dangerously-bypass-hook-trust']
        for key in cfg.get('plugins',{}): args+=['-c',f'plugins.{json.dumps(key)}.enabled=false']
        hooks=json.loads((PLUGIN/'codex/hooks/hooks.json').read_text())['hooks']
        hooks.setdefault(event,[]).append(group)
        # TOML inline values, preserving literal shell text via JSON strings.
        def toml(x):
            if isinstance(x,dict): return '{'+','.join(json.dumps(k)+'='+toml(v) for k,v in x.items())+'}'
            if isinstance(x,list): return '['+','.join(toml(v) for v in x)+']'
            return json.dumps(x)
        for ev,groups in hooks.items():
            groups=json.loads(json.dumps(groups).replace('${PLUGIN_ROOT}',str(PLUGIN/'codex')))
            args+=['-c',f'hooks.{ev}='+toml(groups)]
        if index.startswith('clean'):
            args+=['-c','skills.config=[{name="squeal",enabled=false}]']
        args += [PROMPT]
    (ROOT/'logs'/f'{name}.args.json').write_text(json.dumps(args))
    t=time.monotonic()
    try:
        result=run(args,d,timeout=120); out=result.stdout; err=result.stderr; code=result.returncode
    except subprocess.TimeoutExpired as e:
        out=(e.stdout or b'').decode() if isinstance(e.stdout,bytes) else e.stdout or ''; err='120s timeout'; code=124
    elapsed=round(time.monotonic()-t,3)
    (ROOT/'logs'/f'{name}.events.jsonl').write_text(out)
    (ROOT/'logs'/f'{name}.stderr.txt').write_text(err)
    parsed=[]
    for line in out.splitlines():
        try: parsed.append(json.loads(line))
        except ValueError: pass
    cost=[x for x in parsed if x.get('type') in ('result','turn.completed')]
    record={'name':name,'seconds':elapsed,'exit':code,'meter':cost}
    with (ROOT/'sessions.jsonl').open('a') as f: f.write(json.dumps(record)+'\n')
    run(CLI+['stop'],d,timeout=20)
    print(json.dumps(record),flush=True)
if __name__=='__main__':
    session(*sys.argv[1:])
