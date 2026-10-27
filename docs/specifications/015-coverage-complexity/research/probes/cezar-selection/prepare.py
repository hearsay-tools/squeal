"""Throwaway: tracked-source copies, no installs or writes to the source checkout."""
import argparse, gzip, hashlib, json, os, pathlib, shutil, subprocess, tarfile, time
HERE = pathlib.Path(__file__).resolve().parent
p = argparse.ArgumentParser(); p.add_argument('scratch'); p.add_argument('--repo', default='/home/agent/projects/cezar'); a = p.parse_args()
root = pathlib.Path(a.scratch).resolve(); root.mkdir(parents=True, exist_ok=False)
def git(*args): return subprocess.check_output(['git','-C',a.repo,*args])
d = json.loads((HERE/'declaration.json').read_text())
assert git('rev-parse',d['pin']).decode().strip() == d['pin']
start = time.monotonic()
# Copies, not links to a live tree. pnpm relative package links stay within each copy.
for arm in ['structural','file','exhaustive']:
    dest = root/arm; dest.mkdir()
    with subprocess.Popen(['git','-C',a.repo,'archive',d['pin']], stdout=subprocess.PIPE) as proc:
        with tarfile.open(fileobj=proc.stdout, mode='r|') as arc: arc.extractall(dest, filter='data')
        assert proc.wait() == 0
    subprocess.run(['cp','-a','--reflink=auto',a.repo+'/node_modules',str(dest/'node_modules')],check=True)
    shutil.rmtree(dest/'node_modules/.vite', ignore_errors=True)
    shutil.rmtree(dest/'node_modules/.cache', ignore_errors=True)
    # Only the tested workspace needs a local importer link. Other workspace source is tracked.
    subprocess.run(['cp','-a','--reflink=auto',a.repo+'/packages/contract/node_modules',str(dest/'packages/contract/node_modules')],check=True)
    for folder in ['home','tmp','cache','data','config','coverage','observed']: (root/(arm+'-'+folder)).mkdir()
    # No symlink in dependencies may resolve back into the live source checkout.
    for base, dirs, files in os.walk(dest/'node_modules', followlinks=False):
        for name in dirs+files:
            path=pathlib.Path(base)/name
            if path.is_symlink() and str(path.resolve()).startswith(a.repo+'/'):
                raise RuntimeError('live dependency link: '+str(path))
rows=[]
for c in d['candidates']:
    if c['eligibility']!='selected': continue
    row={**c,'parentTree':git('rev-parse',c['parent']+'^{tree}').decode().strip(),'nextTree':git('rev-parse',c['commit']+'^{tree}').decode().strip()}
    for label,rev in [('previous',c['parent']),('next',c['commit'])]:
        # Retain exact runtime source and configs; the full tree is reconstructible from the pin.
        paths=git('ls-tree','-r','--name-only',rev,'packages/contract').decode().splitlines()
        paths+=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vitest.config.ts']
        row[label]={path:git('show',rev+':'+path).decode() for path in paths}
        row[label+'Manifest']=git('ls-tree','-r',rev).decode()
    rows.append(row)
with gzip.open(HERE/'inputs.json.gz','wt') as f: json.dump(rows,f)
(root/'setup.json').write_text(json.dumps({'scratch':str(root),'pin':d['pin'],'seconds':time.monotonic()-start,'dependencySource':'local copies of pinned checkout node_modules; no installer or upgrade','liveHeadAtCopy':git('rev-parse','HEAD').decode().strip()},indent=2)+'\n')
print((root/'setup.json').read_text())
