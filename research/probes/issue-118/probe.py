"""Throwaway, read-only CLI/formatter probe for issue 118; no test execution."""
import datetime
import json
import os
import subprocess

CLI = "/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal"
TEST = "test/cli/status-paths.test.ts"


def run(argv, project_status=False):
    load = os.getloadavg()
    cpus = os.cpu_count()
    record = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "cwd": os.getcwd(),
        "argv": argv,
        "load": load,
        "cpus": cpus,
    }
    if load[0] > cpus:
        return {**record, "skipped": "one-minute load exceeds CPU count"}
    result = subprocess.run(argv, capture_output=True, text=True, timeout=20)
    record.update(exit=result.returncode, stderr=result.stderr)
    if project_status:
        payload = json.loads(result.stdout)
        record["stdoutProjection"] = {
            key: payload.get(key)
            for key in ("schemaVersion", "revision", "daemon", "runsOpen", "selection")
        }
        record["missingFields"] = [
            [key for key in ("key", "resultRevision", "runsSince") if key not in entry]
            for entry in payload.get("selection", {}).get("testFiles", [])
        ]
    else:
        record["stdout"] = result.stdout
    return record


commands = [
    run([CLI, "--version"]),
    run([CLI, "status", "--json", TEST], project_status=True),
    run([CLI, "status", "--json", "--since-revision", "0", TEST]),
    run([
        "pnpm", "exec", "tsx", "-e",
        'import { fileEntry } from "./src/cli/named-file-lines.ts"; '
        'console.log(JSON.stringify(fileEntry({testFile:{project:"e2e",'
        'path:"packages/web/e2e/smoke.e2e.ts"},state:"current",verdict:"pass"},'
        '"squeal")))',
    ]),
]
print(json.dumps(commands, indent=2))
