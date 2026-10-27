"""Measure a probe child and its waited-for descendants, not the Python wrapper."""
import json
import resource
import subprocess
import sys
import time
before = resource.getrusage(resource.RUSAGE_CHILDREN)
start = time.perf_counter()
p = subprocess.run(sys.argv[1:], text=True, capture_output=True, timeout=20)
elapsed = (time.perf_counter() - start) * 1000
after = resource.getrusage(resource.RUSAGE_CHILDREN)
if p.returncode:
    sys.stderr.write(p.stderr)
    sys.exit(p.returncode)
value = json.loads(p.stdout)
value['processTreeCpuMs'] = ((after.ru_utime + after.ru_stime) - (before.ru_utime + before.ru_stime)) * 1000
value['childWallMs'] = elapsed
print(json.dumps(value))
