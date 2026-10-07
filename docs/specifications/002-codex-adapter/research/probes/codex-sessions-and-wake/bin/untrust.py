# Throwaway: remove only the [projects."/tmp/csw/..."] trust blocks Codex persisted during the probes.
import re, sys, shutil, time
f = '/home/agent/.codex/config.toml'
shutil.copy2(f, f'/tmp/csw/config.toml.backup-{int(time.time())}')
s = open(f).read()
n = re.sub(r'\[projects\."/tmp/csw/[^"]+"\]\ntrust_level = "trusted"\n\n?', '', s)
open(f, 'w').write(n)
print('removed blocks:', s.count('/tmp/csw/') - n.count('/tmp/csw/'))
