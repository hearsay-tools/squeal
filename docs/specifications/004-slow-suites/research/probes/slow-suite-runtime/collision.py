"""Throwaway deterministic overlap of the real Cezar IPv6 default-port test.
Only first copy is instrumented: hold its successful listener while the second
runs the unchanged test. Restores the copied file and kills only owned children.
"""
import json,os,pathlib,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);node=subprocess.check_output(['which','node'],text=True).strip()
p=root/'cz-a/packages/cezar/test/e2e/serve-port.test.ts';original=p.read_text()
ready=root/'collision-ready';release=root/'collision-release'
for path in [ready,release]:path.unlink(missing_ok=True)
needle="    assert.equal(started.url, 'http://[::1]:4321');"
instrument=needle+f"\n    await import('node:fs/promises').then(fs => fs.writeFile({json.dumps(str(ready))}, 'ready'));\n    for (let i = 0; i < 300 && !existsSync({json.dumps(str(release))}); i++) await new Promise(r => setTimeout(r, 100));"
assert needle in original;p.write_text(original.replace(needle,instrument))
children=[]
def start(copy):
    env={k:os.environ[k] for k in ['PATH','HOME','USER','LANG'] if k in os.environ}
    env.update(TMPDIR=str(root/(copy+'-tmp')),npm_config_cache=str(root/'npm-cache'))
    log=(root/(copy+'-collision.log')).open('w')
    child=subprocess.Popen([node,'--import','../../scripts/test-git-env.mjs','--import','tsx','--test','--test-name-pattern=free default port starts','test/e2e/serve-port.test.ts'],cwd=root/copy/'packages/cezar',env=env,stdout=log,stderr=log,start_new_session=True)
    children.append(child);return child
try:
    a=start('cz-a');deadline=time.monotonic()+35
    while not ready.exists() and a.poll() is None and time.monotonic()<deadline:time.sleep(.1)
    if not ready.exists():raise RuntimeError('First owned listener not ready; inspect log, no foreign process touched')
    b=start('cz-b');b.wait(timeout=35)
    release.write_text('release');a.wait(timeout=10)
    result={'first_copy_exit':a.returncode,'second_copy_exit':b.returncode,'first_copy_instrumentation':'hold the successfully bound ::1:4321 listener until second test exits'}
    assert a.returncode==0 and b.returncode==1,result
    result['second_copy_failure']=(root/'cz-b-collision.log').read_text()
    (pathlib.Path(__file__).parent/'collision.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='second_copy_failure'}))
finally:
    release.write_text('release');p.write_text(original)
    for child in children:
        if child.poll() is None:child.terminate();child.wait(timeout=5)
