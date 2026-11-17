# Throwaway. From daemon logs (~/projects/<repo>/.git/squeal/logs/*.log), the store.sqlite
# write-lock holds that daemons logged as "long write" (only holds over the log's threshold),
# in a window: their count, distribution, sum, and the share of wall time they cover (a lower
# bound of the time a hook's write could find the lock held). Read-only.
# Usage: python3 -I lock-share.py <repo> <from-iso> <to-iso>
import re, sys, glob, os, datetime as dt, collections
repo, a, b = sys.argv[1:4]
rx = re.compile(r"^(\S+) \[\d+\] squeal daemon: long write: store\.sqlite write lock held (\d+) ms by ([^;]*);")
holds = []; ops = collections.Counter(); opms = collections.Counter()
for f in glob.glob(os.path.expanduser(f"~/projects/{repo}/.git/squeal/logs/*.log*")):
    for line in open(f, errors="replace"):
        m = rx.match(line)
        if not m or not (a <= m[1] < b): continue
        ms = int(m[2]); holds.append((m[1], ms)); op = m[3].split(" < ")[-1] if "commitFirst" not in m[3] else "commitFirst"; ops[op] += 1; opms[op] += ms
xs = sorted(ms for _, ms in holds)
span = (dt.datetime.fromisoformat(b.replace("Z","+00:00")) - dt.datetime.fromisoformat(a.replace("Z","+00:00"))).total_seconds() * 1000
p = lambda q: xs[min(len(xs)-1, int(q*len(xs)))] if xs else None
print(f"{repo}: {len(xs)} logged holds, min {xs[0] if xs else None} median {p(.5)} p90 {p(.9)} max {xs[-1] if xs else None} ms; sum {sum(xs)/1000:.0f} s = {100*sum(xs)/span:.1f}% of the window (holds can overlap only across stores, not here)")
for op, n in opms.most_common(6): print(f"  {op}: {ops[op]} holds, {n/1000:.0f} s")
# A write that starts at a random instant: its expected wait for the logged holds alone, and the
# share of instants whose wait passes the hooks' 1,000 ms busy timeout (STATUS_BUSY_TIMEOUT_MS).
wait = sum(x * x for x in xs) / 2 / span
over = sum(max(0, x - 1000) for x in xs) / span
print(f"  random write: expected wait {wait:.0f} ms; waits past 1000 ms busy timeout: {100*over:.2f}% of instants; any wait: {100*sum(xs)/span:.1f}%")
