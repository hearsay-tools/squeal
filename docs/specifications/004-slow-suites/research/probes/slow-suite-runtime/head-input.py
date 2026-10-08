"""Throwaway reproduction of archive HEAD changing without worktree-file changes."""
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])/'head-input';root.mkdir()
def git(*args):return subprocess.check_output(['git',*args],cwd=root)
def commit():git('-c','user.name=Probe','-c','user.email=probe@invalid','commit','-qm','fixture')
git('init','-q');p=root/'plugins/demo/cli.mjs';p.parent.mkdir(parents=True);p.write_text('console.log("v1");\n')
git('add','.');commit();p.write_text('console.log("v2");\n')
def snapshot():return {'worktree_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'archive_sha256':hashlib.sha256(git('archive','HEAD','plugins/demo')).hexdigest(),'archived_output':subprocess.check_output(['node','--input-type=module','-e',git('show','HEAD:plugins/demo/cli.mjs').decode()],text=True).strip()}
before=snapshot();git('add','.');commit();after=snapshot()
assert before['worktree_sha256']==after['worktree_sha256'] and before['archived_output']=='v1' and after['archived_output']=='v2'
result={'before_commit':before,'after_commit':after};(pathlib.Path(__file__).parent/'head-input.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
