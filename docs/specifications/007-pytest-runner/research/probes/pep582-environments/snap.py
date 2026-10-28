"""Probe only: snapshot (path -> sha1, inode) of a project tree without .git, or diff two snapshots by area."""
import hashlib, json, os, sys
if sys.argv[1] == "snap":
    root, out = sys.argv[2], sys.argv[3]
    snap = {}
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".git", "__pycache__")]
        for f in files:
            p = os.path.join(d, f)
            if os.path.islink(p):
                snap[os.path.relpath(p, root)] = ["link", os.readlink(p)]; continue
            st = os.stat(p)
            snap[os.path.relpath(p, root)] = [hashlib.sha1(open(p, "rb").read()).hexdigest()[:12], st.st_ino]
    json.dump(snap, open(out, "w"))
else:
    a, b = (json.load(open(x)) for x in sys.argv[2:4])
    def area(p):
        parts = p.split("/")
        if parts[0] == "__pypackages__" and len(parts) > 3:
            sub = parts[3].split(".dist-info")[0] + (".dist-info" if ".dist-info" in parts[3] else "")
            return "/".join(parts[:3]) + "/" + ("*.dist-info" if sub.endswith(".dist-info") else ("*.pth" if sub.endswith(".pth") else "<module files>"))
        return p
    from collections import Counter
    c = Counter()
    for p in set(a) | set(b):
        if p not in a: c[(area(p), "added")] += 1
        elif p not in b: c[(area(p), "removed")] += 1
        elif a[p][0] != b[p][0]: c[(area(p), "content changed")] += 1
        elif a[p][1] != b[p][1]: c[(area(p), "rewritten, same bytes")] += 1
    for (ar, kind), n in sorted(c.items()):
        print(f"   {ar}: {n} {kind}")
    if not c: print("   (no file changed)")
