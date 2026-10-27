#!/usr/bin/env python3
"""Throwaway: real plugin bytes in a scratch Git release branch; real unpack() only."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile

root = pathlib.Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip())
ref = '181054dd748f2834b423a23b1cababd0d520dd5d'
version = json.loads(subprocess.check_output(['git','show',ref+':package.json']))['version']
def command(*args, cwd=None, **kwargs):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.PIPE, **kwargs)
def hashes(path):
    return {str(p.relative_to(path)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(path.rglob('*')) if p.is_file()}
with tempfile.TemporaryDirectory(prefix='squeal-dist-archive-') as tmp:
    work = pathlib.Path(tmp); repo = work/'repo'; repo.mkdir()
    archive = command('git','archive',ref,'plugins',cwd=root)
    command('tar','-x','-C',str(repo),input=archive)
    held = work/'held'; held.mkdir()
    for harness in ('claude-code','codex','pi','opencode'):
        shutil.move(str(repo/'plugins'/harness/'dist'), str(held/harness))
    def git(*args): return command('git',*args,cwd=repo).decode().strip()
    git('init','-q','-b','main'); git('config','user.name','Distribution probe'); git('config','user.email','probe@example.invalid')
    git('add','plugins'); git('commit','-qm','synthetic source snapshot without dist'); git('tag','squeal--v0.0.1')
    (repo/'source-marker').write_text('reviewed source\n'); git('add','source-marker'); git('commit','-qm','reviewed source')
    source = git('rev-parse','HEAD')
    git('checkout','-qb','release-fixture')
    for harness in ('claude-code','codex','pi','opencode'):
        shutil.copytree(held/harness,repo/'plugins'/harness/'dist')
    (repo/'distribution.json').write_text(json.dumps({'sourceCommit':source,'productBytesFrom':ref}))
    git('add','plugins','distribution.json'); git('commit','-qm','assembled release bytes'); git('tag','squeal--v'+version)
    release = git('rev-parse','HEAD')
    tarball = work/('squeal--v'+version+'.tar.gz')
    tarball.write_bytes(command('git','archive','--format=tar.gz','--prefix=squeal-release/','squeal--v'+version,cwd=repo))
    # The installer is not run. Its original function definitions through unpack() are.
    source_text = command('git','show',ref+':install.sh',cwd=root).decode()
    prefix = source_text[:source_text.index('install_pi() {')]
    script = work/'unpack-only.sh'
    script.write_text(prefix+'\nSOURCE="$1"\nunpack pi "$2/pi" "$2/pi/'+version+'" Pi\nunpack opencode "$2/opencode" "$2/opencode/'+version+'" OpenCode\n')
    output = command('sh',str(script),work.as_uri(),str(work/'installed')).decode()
    checks = {}
    for harness, entry in [('pi','dist/extension.mjs'),('opencode','dist/plugin.mjs')]:
        original = hashes(repo/'plugins'/harness); extracted = hashes(work/'installed'/harness/version)
        assert original == extracted
        assert entry in extracted
        checks[harness] = {'fileCount':len(extracted),'allHashesEqual':True,'entryPresent':entry}
    for harness in ('claude-code','codex'):
        assert git('cat-file','-t',release+':plugins/'+harness+'/dist/session-start.mjs') == 'blob'
    git('checkout','-q','main')
    assert not any((repo/'plugins').glob('*/dist'))
    (repo/'source-marker').write_text('next source\n'); git('add','source-marker');git('commit','-qm','next development source')
    baseline = git('describe','--tags','--abbrev=0','--match','squeal--v*','HEAD')
    assert baseline == 'squeal--v0.0.1'
    print(json.dumps({'inputCommit':ref,'version':version,'archiveBytes':tarball.stat().st_size,'installerUnpack':checks,'gitSubdirTargetsContainHooks':True,'mainHasNoDist':True,'latestReleaseTag':'squeal--v'+version,'currentLastReleaseHelperReturns':baseline,'scope':'scratch Git and exact unpack() only; no harness install, network publishing, or model calls'},indent=2))
