"""Probe only: pdm.lock packages (name==version) against <lib>/*.dist-info. Usage: lockcheck.py <pdm.lock> <lib>."""
import os, re, sys, tomllib
lock = tomllib.load(open(sys.argv[1], "rb"))
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
locked = {}
for p in lock.get("package", []):
    locked.setdefault(norm(p["name"]), set()).add(p.get("version", "?"))
inst = {}
for e in os.listdir(sys.argv[2]):
    if e.endswith(".dist-info"):
        name, ver = e[:-10].rsplit("-", 1)
        inst[norm(name)] = ver
print(f"lock_version {lock['metadata'].get('lock_version')}, groups {lock['metadata'].get('groups')}, strategy {lock['metadata'].get('strategy')}")
print(f"locked {len(locked)} names, installed {len(inst)} dist-info")
miss = sorted(n for n in locked if n not in inst)
extra = sorted(n for n in inst if n not in locked)
diff = sorted(f"{n} lock {sorted(locked[n])} installed {inst[n]}" for n in locked if n in inst and inst[n] not in locked[n])
print(f"in lock, not installed ({len(miss)}): {miss[:30]}")
print(f"installed, not in lock ({len(extra)}): {extra[:30]}")
print(f"version differs ({len(diff)}): {diff[:10]}")
