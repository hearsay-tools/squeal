"""Throwaway: snapshot committed sources and installed artifacts into ONE private /tmp root.
Run npm ci in Squeal first. Usage: python3 setup.py SQUEAL_ROOT CEZAR_ROOT
The returned root belongs to this probe. Remove it after collecting results.
"""
import pathlib, subprocess, sys, tempfile
root=pathlib.Path(tempfile.mkdtemp(prefix='sqr-',dir='/tmp'))
for name,source in [('sq-a',sys.argv[1]),('cz-a',sys.argv[2])]:
    source=pathlib.Path(source).resolve();dest=root/name;dest.mkdir()
    archive=subprocess.check_output(['git','archive','HEAD'],cwd=source)
    subprocess.run(['tar','-x','-C',str(dest)],input=archive,check=True)
    subprocess.run(['cp','-a',str(source/'node_modules'),str(dest/'node_modules')],check=True)
    if name=='cz-a':
        for package in (source/'packages').iterdir():
            for rel in ['dist','web/dist']:
                if (package/rel).exists():
                    target=dest/'packages'/package.name/rel;target.parent.mkdir(parents=True,exist_ok=True)
                    subprocess.run(['cp','-a',str(package/rel),str(target)],check=True)
        p=dest/'scripts/test-git-env.mjs';p.write_text(p.read_text().replace("'/tmp'",repr(str(root))))
    else:
        # Includes committed bundles because e2e archives HEAD. No real Squeal store is copied.
        for p in [*(dest/'src').rglob('*.ts'),*(dest/'test').rglob('*.ts'),*(dest/'plugins').rglob('*.mjs')]:
            if p.name == 'codex-hash.test.ts': continue  # Hashes a literal command; never executes it.
            s=p.read_text().replace('/tmp/',str(root)+'/').replace('"/tmp"','"'+str(root)+'"')
            if p.name == 'scratch.test.ts': s=s.replace(r'^\/tmp\/squeal-', '^'+str(root).replace('/',r'\/')+r'\/squeal-')
            p.write_text(s)
    subprocess.run(['git','init','-q'],cwd=dest,check=True)
    subprocess.run(['git','add','.'],cwd=dest,check=True)
    subprocess.run(['git','-c','user.name=Probe','-c','user.email=probe@invalid','commit','-qm','isolated snapshot'],cwd=dest,check=True)
    if name == 'cz-a':
        # The first copied install/build was stale. Final measurements use a fresh install and server build.
        subprocess.run(['npm','ci','--cache',str(root/'npm-cache')],cwd=dest,check=True)
        subprocess.run(['npm','run','build:server'],cwd=dest,check=True)
    subprocess.run(['cp','-a',str(dest),str(root/name.replace('-a','-b'))],check=True)
print(root)
