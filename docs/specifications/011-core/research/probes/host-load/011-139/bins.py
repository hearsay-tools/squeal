"""Throwaway probe for row 011-139. Usage: python3 -I bins.py SAMPLES.jsonl [EXCLUDE_WID...]

Groups sample-pool.py's samples whose host busy cores are at least 18 into
5-minute bins and prints one Markdown row per bin: the samples, load and busy
cores (mean), the pool's permits held (mean and max), the widest holder
(permits max, its tree's cores mean while it held them), and per project the
edit tiers' test processes and cores (mean and max; an edit tier holds no
permit, see analyze-pool.py)."""
import collections, json, statistics, sys

exclude = set(sys.argv[2:])
bins = collections.OrderedDict()
for line in open(sys.argv[1]):
    s = json.loads(line)
    if s["busy"] < 18:
        continue
    t = s["t"]
    key = f"{t[11:14]}{int(t[14:16]) // 5 * 5:02d}"
    b = bins.setdefault(key, {"n": 0, "load": [], "busy": [], "nice": [], "held": [], "top": [], "topCores": [],
                              "edit": collections.defaultdict(lambda: ([], []))})
    b["n"] += 1
    b["load"].append(float(s["load"][0]))
    b["busy"].append(s["busy"])
    b["nice"].append(s["nice"])
    b["held"].append(sum(len(v) for v in s["holders"].values()))
    top, per = None, collections.defaultdict(lambda: [0, 0.0])
    for d in s["daemons"]:
        if d["wid"] in exclude:
            continue
        n = sum(v for k, v in (d.get("children") or {}).items() if k != "other")
        if d["permits"]:
            if top is None or len(d["permits"]) > len(top["permits"]):
                top = d
        elif n:
            p = "tmp" if d["root"].startswith("/tmp/") else d["root"].split("/")[4]
            per[p][0] += n
            per[p][1] += max(0.0, d["cores"])
    b["top"].append((len(top["permits"]), top["root"].split("/")[-1][:8]) if top else (0, "-"))
    if top:
        b["topCores"].append(top["cores"])
    for p in ("squeal", "cezar", "tmp"):
        b["edit"][p][0].append(per[p][0])
        b["edit"][p][1].append(per[p][1])

m = lambda xs: f"{statistics.mean(xs):.1f}" if xs else "-"
print("| UTC | samples | load | busy cores | %nice cores | permits held mean / max | widest holder: permits max, cores mean | squeal edits: processes, cores mean (max) | cezar edits | fixture edits |")
print("|---|---|---|---|---|---|---|---|---|---|")
for k, b in bins.items():
    tp, who = max(b["top"])
    edits = []
    for p in ("squeal", "cezar", "tmp"):
        procs, cores = b["edit"][p]
        edits.append(f"{m(procs)} ({max(procs)}), {m(cores)} ({max(cores):.1f})")
    print(f"| {k} | {b['n']} | {m(b['load'])} | {m(b['busy'])} | {m(b['nice'])} | {m(b['held'])} / {max(b['held'])} | "
          f"{tp} `{who}`, {m(b['topCores'])} | " + " | ".join(edits) + " |")
