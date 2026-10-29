"""Throwaway, bounded research runner. No product suite or daemon starts."""
import datetime
import json
import os
from pathlib import Path
import subprocess

probe = Path(__file__).resolve().parent
root = probe.parents[5]
load = os.getloadavg()[0]
cpus = os.cpu_count()
record = {
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "oneMinuteLoad": load,
    "cpus": cpus,
    "permitted": load <= cpus,
}
(probe / "load.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record), flush=True)
if load > cpus:
    print("SKIPPED: one-minute load exceeds CPU count")
    raise SystemExit(0)
relative = probe.relative_to(root)
command = [
    "pnpm", "exec", "vitest", "run", "--config", str(relative / "vitest.config.ts"),
    str(relative / "selection.probe.ts"), str(relative / "hold.probe.ts"),
    "--maxWorkers=1", "--reporter=verbose",
]
print(" ".join(command), flush=True)
result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=60)
output = result.stdout + result.stderr
(probe / "output.txt").write_text(output.rstrip() + "\n")
print(output)
print("exit:", result.returncode)
raise SystemExit(result.returncode)
