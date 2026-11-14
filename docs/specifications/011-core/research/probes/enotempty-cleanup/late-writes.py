"""Throwaway probe (row 011-333). Reads an `strace -f -tt` log and, per run folder whose name
matches the given pattern, prints what any process created in it after its removal began: the
first unlink/rmdir below the folder starts the removal. Usage: python3 -I late-writes.py <log> <regex>"""
import re, sys
from collections import defaultdict

log, pattern = sys.argv[1], re.compile(sys.argv[2])
line_re = re.compile(r'^(\d+)\s+(\d\d:\d\d:\d\d\.\d+) (\w+)\((.*)\) = (-?\d+|\?)(.*)$')
CREATE = {"mkdir", "mkdirat", "creat", "symlink", "symlinkat", "link", "linkat"}
REMOVE = {"unlink", "unlinkat", "rmdir"}
start, creates, cmd = {}, defaultdict(list), {}
for raw in open(log, errors="replace"):
    m = line_re.match(raw)
    if not m:
        continue
    pid, at, call, args, ret, rest = m.groups()
    paths = re.findall(r'"([^"]*)"', args)
    root = next((p for p in paths for r in [pattern.search(p)] if r), None)
    if root is None:
        continue
    folder = pattern.search(root).group(0)
    if call in REMOVE and not ret.startswith("-") and folder not in start:
        start[folder] = (at, pid)
    made = call in CREATE or (call in ("openat", "open") and "O_CREAT" in args) or call.startswith("rename")
    if made and not ret.startswith("-") and folder in start:
        target = paths[-1]
        creates[folder].append(f"{at} pid {pid} {call} {target[target.find(folder):]}")
for folder, (at, pid) in start.items():
    print(f"{folder}: removal began {at} by pid {pid}; {len(creates[folder])} creates after it")
    for line in creates[folder][:40]:
        print("   ", line)
