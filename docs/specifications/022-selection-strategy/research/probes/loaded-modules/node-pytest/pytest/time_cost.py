"""Throwaway: generate a 300-module Python package tree (module i imports 2i+1, 2i+2)
with one test file importing m0, then time `pytest -q` per variant, interleaved;
skips a round while the 1-min load > 24.
Usage: python time_cost.py <scratch dir> <python with pytest> <squeal runtime dir> <probe dir> [reps]"""
import os, subprocess, sys, time, json
d, py, squeal_rt, probes, *rest = sys.argv[1:]
reps = int(rest[0]) if rest else 10
N = 300
os.makedirs(f"{d}/tree", exist_ok=True)
open(f"{d}/pytest.ini", "w").write("[pytest]\npythonpath = .\naddopts = -p no:cacheprovider\n")
open(f"{d}/tree/__init__.py", "w").close()
for i in range(N):
    kids = [k for k in (2 * i + 1, 2 * i + 2) if k < N]
    src = "".join(f"from tree import m{k}\n" for k in kids)
    src += f"x = {i}\nfor j in range(50):\n    x = (x * 31 + j) % 1000003\nV = x" + "".join(f" + m{k}.V" for k in kids) + "\n"
    open(f"{d}/tree/m{i}.py", "w").write(src)
open(f"{d}/test_tree.py", "w").write("from tree import m0\n\ndef test_tree():\n    assert isinstance(m0.V, int)\n")
base_env = {**os.environ, "PYTHONPYCACHEPREFIX": f"{d}/.pycache", "SQUEAL_PYTEST_ROOT": d, "LM_ROOT": d}
variants = {
    "base": ([], {}),
    "squeal_pytest plugin (__import__ wrapper, edges)": (["-p", "squeal_pytest"], {"PYTHONPATH": squeal_rt, "SQUEAL_PYTEST_EVENTS": f"{d}/ev.jsonl"}),
    "lm_attrib (sys.modules diff + meta_path + edges)": (["-p", "lm_attrib"], {"PYTHONPATH": probes, "LM_OUT": f"{d}/lm.json"}),
}
times = {k: [] for k in variants}
loads = []
subprocess.run([py, "-m", "pytest", "-q"], cwd=d, env=base_env, capture_output=True)  # warm pyc
for r in range(reps):
    load = os.getloadavg()[0]
    if load > 24:
        print(f"round {r}: load {load:.1f} > 24, skipped", file=sys.stderr); continue
    loads.append(load)
    for k, (args, env) in variants.items():
        t0 = time.perf_counter()
        p = subprocess.run([py, "-m", "pytest", "-q", *args], cwd=d, env={**base_env, **env}, capture_output=True, text=True)
        times[k].append((time.perf_counter() - t0) * 1000)
        if p.returncode != 0:
            sys.exit(f"{k}: {p.stdout}{p.stderr}")
med = lambda a: sorted(a)[len(a) // 2]
b = med(times["base"])
v = subprocess.run([py, "-m", "pytest", "--version"], capture_output=True, text=True).stdout.strip()
print(f"{v}; Python {sys.version.split()[0]}; rounds {len(loads)}; 1-min load per round: {' '.join(f'{l:.1f}' for l in loads)}")
print("| variant | median ms | min ms | max ms | vs base |\n|---|---|---|---|---|")
for k, a in times.items():
    print(f"| {k} | {med(a):.0f} | {min(a):.0f} | {max(a):.0f} | {(med(a) / b - 1) * 100:.0f}% |")
lm = json.load(open(f"{d}/lm.json"))
print("lm_attrib modules attributed to test_tree.py (sysmodules/metapath/edges):", *(len(lm["test_tree.py"][m]) for m in ("sysmodules", "metapath", "edges")))
