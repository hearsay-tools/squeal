# Throwaway probe for research/issue-105-findings.md. Prints the paths of <list> (one per line)
# that git ignores in <checkout>, read-only (`git check-ignore --no-index`). A batch git refuses
# (a path beyond a symlink) is split until the refused path stands alone, which is dropped.
#   python3 -I ignored.py <checkout> <list>
import subprocess
import sys

root, listing = sys.argv[1], sys.argv[2]


def check(paths):
    if not paths:
        return []
    r = subprocess.run(
        ["git", "-C", root, "check-ignore", "--no-index", "--stdin", "-z"],
        input="\0".join(paths).encode(), capture_output=True,
    )
    if r.returncode in (0, 1):
        return [p for p in r.stdout.decode().split("\0") if p]
    if len(paths) == 1:
        return []
    mid = len(paths) // 2
    return check(paths[:mid]) + check(paths[mid:])


paths = [line.rstrip("\n") for line in open(listing) if line.strip()]
for i in range(0, len(paths), 500):
    for p in check(paths[i : i + 500]):
        print(p)
