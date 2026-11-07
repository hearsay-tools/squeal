"""Q1/Q4: timed-out waits per 100 named 60 s waits, per class and load band, for waits naming test files only and
waits naming a source file. The growth from the low bands shows which class load adds. Throwaway.
Usage: python3 -I class-rates.py CLS.jsonl"""
import json, sys, collections
EDG = ["0-6", "6-12", "12-16", "16-20", "20-24"]
rows = [json.loads(l) for l in open(sys.argv[1])]
for title, f in (("all", lambda r: True), ("tests only", lambda r: r["sources"] == 0), ("named a source file", lambda r: r["sources"] > 0)):
    x = [r for r in rows if f(r)]
    nb = [sum(1 for r in x if r["band"] == b) for b in range(5)]
    cls = collections.Counter(r["primary"] for r in x if r["timedOut"])
    print(f"\n{title}: waits per band {nb}; timed out per 100 waits")
    print("class | " + " | ".join(EDG) + " | 16-24 minus 0-12")
    for k, _ in cls.most_common():
        rate = [100 * sum(1 for r in x if r["band"] == b and r["timedOut"] and r["primary"] == k) / max(1, nb[b]) for b in range(5)]
        lo = 100 * sum(1 for r in x if r["band"] < 2 and r["timedOut"] and r["primary"] == k) / max(1, nb[0] + nb[1])
        hi = 100 * sum(1 for r in x if r["band"] >= 3 and r["timedOut"] and r["primary"] == k) / max(1, nb[3] + nb[4])
        print(k, "|", " | ".join(f"{v:.1f}" for v in rate), f"| {hi - lo:+.1f}")
    lo = 100 * sum(1 for r in x if r["band"] < 2 and r["timedOut"]) / max(1, nb[0] + nb[1])
    hi = 100 * sum(1 for r in x if r["band"] >= 3 and r["timedOut"]) / max(1, nb[3] + nb[4])
    print("total", "|", " | ".join(f"{100 * sum(1 for r in x if r['band'] == b and r['timedOut']) / max(1, nb[b]):.1f}" for b in range(5)), f"| {hi - lo:+.1f}")
