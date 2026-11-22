#!/usr/bin/env python3
"""Throwaway test of ./run (row 024-01, Q3). Usage: python3 -I q3-fast-path.py <work-dir>
Builds repos under <work-dir>, feeds Antigravity-shaped payloads to `dash ./run` and `bash ./run`,
and checks: silent exit outside Squeal, byte-exact passthrough inside, and latency over 30 runs."""
import json, os, statistics, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); RUN = os.path.join(HERE, "run")
W = os.path.abspath(sys.argv[1]); os.makedirs(W, exist_ok=True)  # must sit outside any git repo
def sh(*a, cwd=None): subprocess.run(a, cwd=cwd, check=True, capture_output=True)
def repo(path, squeal=None):
    os.makedirs(path, exist_ok=True); sh("git", "init", "-q", path)
    sh("git", "-c", "user.email=p@x", "-c", "user.name=p", "commit", "-q", "--allow-empty", "-m", "i", cwd=path)
    if squeal == "config": open(os.path.join(path, "squeal.config.json"), "w").write("{}\n")
    if squeal == "store": os.makedirs(os.path.join(path, ".git", "squeal"), exist_ok=True)
    return path
plain = repo(f"{W}/plain"); cfg = repo(f"{W}/with config", "config"); store = repo(f"{W}/store", "store")
spaced_plain = repo(f"{W}/sp ace/plain repo"); accent = repo(f"{W}/caf\u00e9 repo", "config")
sh("git", "worktree", "add", "-q", f"{W}/store-wt", cwd=store); os.makedirs(f"{W}/store-wt/sub/dir", exist_ok=True)
sh("git", "worktree", "add", "-q", f"{W}/plain-wt", cwd=plain)
sh("git", "-C", store, "worktree", "list")
os.makedirs(os.path.join(store, ".git", "squeal"), exist_ok=True)
def big_input(n=100_000):
    unit = 'Zażółć "gęślą" jaźń \\ back\\slash C:\\path\n tab\t {"cwd":"/squeal/repo"} \u2603 '
    s = (unit * (n // len(unit.encode()) + 1)); b = s.encode()[:n]
    return b.decode("utf-8", "ignore")
def payload(cwd, last="hi", order="alpha", trailing=b""):
    d = {"artifactDirectoryPath": "/tmp/ag/brain/c0ffee", "conversationId": "00000000-0000-4000-8000-000000000000",
         "cwd": cwd, "hookEventName": "PreInvocation", "initialNumSteps": 1, "invocationNum": 0,
         "lastUserInput": last, "modelName": "m", "transcriptPath": "/tmp/ag/t.jsonl", "workspacePaths": [cwd]}
    if order == "last-first":
        d = {"lastUserInput": last, **{k: v for k, v in d.items() if k != "lastUserInput"}}
    if cwd is None: d.pop("cwd")
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode() + trailing
OUT = f"{W}/passthrough.bin"
def call(shell, data):
    if os.path.exists(OUT): os.remove(OUT)
    p = subprocess.run([shell, RUN, "--if-squeal", "sh", "-c", f'cat > "{OUT}"; echo ran; echo "lc=${{LC_ALL-unset}}" > "{OUT}.lc"'], input=data,
                       capture_output=True, cwd=HERE)
    got = open(OUT, "rb").read() if os.path.exists(OUT) else None
    return p.returncode, p.stdout, got
BIG = big_input()
cases = [  # name, payload, expect passthrough
    ("plain repo, small", payload(plain), False),
    ("plain repo, 100 KB lastUserInput", payload(plain, BIG), False),
    ("plain repo, 100 KB, trailing newline", payload(plain, BIG, trailing=b"\n"), False),
    ("plain repo, fake cwd in input, input first -> Node", payload(plain, BIG, order="last-first"), True),
    ("config repo (space in path), 100 KB", payload(cfg, BIG), True),
    ("config repo, 100 KB, trailing newline", payload(cfg, BIG, trailing=b"\n"), True),
    ("config repo, trailing CRLF+newlines", payload(cfg, BIG, trailing=b"\r\n\n\n"), True),
    ("store repo subdir of linked worktree", payload(f"{W}/store-wt/sub/dir", BIG), True),
    ("plain linked worktree", payload(f"{W}/plain-wt", BIG), False),
    ("spaces in plain cwd", payload(spaced_plain), False),
    ("raw UTF-8 cwd with config", payload(accent), True),
    ("backslash in cwd (escaped) -> Node", payload(f"{W}/no\\such"), True),
    ("quote in cwd (escaped) -> Node", payload(f'{W}/q"x'), True),
    ("empty cwd -> Node", payload(""), True),
    ("no cwd key -> Node", payload(None, BIG), True),
    ("nonexistent cwd", payload(f"{W}/gone/dir"), False),
]
ok = True
for shell in ("dash", "bash"):
    for loc in ("unset", "C.UTF-8"):
        env = dict(os.environ); env.pop("LC_ALL", None)
        if loc != "unset": env["LC_ALL"] = loc
        p = subprocess.run([shell, RUN, "--if-squeal", "sh", "-c", f'cat >/dev/null; echo "${{LC_ALL-unset}}"'],
                           input=payload(cfg), capture_output=True, cwd=HERE, env=env)
        print(f"{shell:4} locale restored for command: caller LC_ALL={loc} -> command saw {p.stdout.decode().strip()}")
for shell in ("dash", "bash"):
    for name, data, want in cases:
        rc, out, got = call(shell, data)
        passed = got is not None
        exact = (got == data) if passed else None
        good = passed == want and (exact is not False) and rc == 0 and (out == b"ran\n" if want else out == b"")
        ok &= good
        print(f"{shell:4} {'ok  ' if good else 'FAIL'} {name}: passthrough={passed} byte_exact={exact} rc={rc} bytes={len(data)}")
# naive $(cat) for contrast: strips trailing newlines
for shell in ("dash", "bash"):
    data = payload(cfg, "x", trailing=b"\n\n")
    p = subprocess.run([shell, "-c", 'p=$(cat); printf %s "$p"'], input=data, capture_output=True)
    print(f"{shell:4} naive $(cat): in={len(data)} out={len(p.stdout)} json_ok={json.loads(p.stdout) is not None}")
def lat(shell, data, n=30):
    xs = []
    for _ in range(n):
        t = time.perf_counter()
        subprocess.run([shell, RUN, "--if-squeal", "false"], input=data, capture_output=True, cwd=HERE)
        xs.append((time.perf_counter() - t) * 1000)
    xs.sort(); return xs[0], statistics.median(xs), xs[int(0.95 * n) - 1]
def lat_node(data, n=30):
    xs = []
    for _ in range(n):
        t = time.perf_counter()
        subprocess.run(["node", "--disable-warning=ExperimentalWarning", "-e", "process.stdin.resume();process.stdin.on('end',()=>{})"], input=data, capture_output=True)
        xs.append((time.perf_counter() - t) * 1000)
    xs.sort(); return xs[0], statistics.median(xs), xs[int(0.95 * n) - 1]
print("load:", open("/proc/loadavg").read().strip(), "cpus:", os.cpu_count())
for label, data in (("~0.4 KB", payload(plain)), ("100 KB", payload(plain, BIG)), ("100 KB +newline", payload(plain, BIG, trailing=b"\n")), ("100 KB cwd last ->cmd", payload(plain, BIG, order="last-first"))):
    for shell in ("dash", "bash"):
        mn, p50, p95 = lat(shell, data); print(f"latency {shell:4} {label:18} min {mn:.1f} p50 {p50:.1f} p95 {p95:.1f} ms (30 runs, non-Squeal repo)")
mn, p50, p95 = lat_node(payload(plain, BIG)); print(f"latency node bare 100 KB          min {mn:.1f} p50 {p50:.1f} p95 {p95:.1f} ms")
print("ALL OK" if ok else "SOME FAILED")
