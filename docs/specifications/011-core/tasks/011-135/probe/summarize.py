# Row 011-135 probe: one line per run of results/cli-*.txt with the one-minute load during it,
# from results/load-samples.txt (every 10 s). A run's line is printed when it ends, so it ran
# from (end - wall) to end. Usage: python3 -I summarize.py <results dir>
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

results = Path(sys.argv[1])
day = "2026-10-23"


def when(clock):
    return datetime.fromisoformat(f"{day}T{clock.rstrip('Z')}")


samples = []
for line in (results / "load-samples.txt").read_text().splitlines():
    clock, one, *_ = line.split()
    samples.append((when(clock), float(one)))

print("phase\trun\twall s\tvitest tests s\tload start\tload during: min / mean / max (n)")
for name in ("cli-red.txt", "cli-green.txt"):
    path = results / name
    if not path.exists():
        continue
    for line in path.read_text().splitlines():
        if line.startswith("#"):
            continue
        cols = line.split("\t")
        end = when(cols[0])
        wall = float(re.search(r"wall ([\d.]+)", cols[4]).group(1))
        tests = re.search(r"tests ([\d.]+)s", cols[6])
        start = end - timedelta(seconds=wall)
        during = [load for at, load in samples if start <= at <= end]
        span = (
            f"{min(during):.1f} / {sum(during) / len(during):.1f} / {max(during):.1f} ({len(during)})"
            if during
            else "no sample"
        )
        print(
            f"{cols[1]}\t{cols[2]}\t{wall:.1f}\t{tests.group(1) if tests else '?'}\t"
            f"{cols[3].split()[1]}\t{span}"
        )
