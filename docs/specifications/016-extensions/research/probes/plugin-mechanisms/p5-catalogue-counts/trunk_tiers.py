import sys, glob, yaml, collections
root = sys.argv[1]
generic = {"sarif", "regex", "pass_fail", "rewrite", "sarif_uri", "lsp_json", "arcanist"}
c = collections.Counter(); per_linter = {}
for f in sorted(glob.glob(root + "/linters/*/plugin.yaml")):
    d = yaml.safe_load(open(f))
    for lint in (d.get("lint") or {}).get("definitions") or []:
        kinds = []
        for cmd in lint.get("commands") or []:
            out = cmd.get("output")
            if cmd.get("parser"): k = "script parser (code)"
            elif out in generic: k = "generic: " + out
            elif out is None: k = "no output key"
            else: k = "built-in named parser (vendor code)"
            c[k] += 1; kinds.append(k)
        per_linter[lint["name"]] = kinds
print("commands:", sum(c.values()), "linters:", len(per_linter))
for k, v in c.most_common(): print(f"{v:4d}  {k}")
lin = collections.Counter()
for n, ks in per_linter.items():
    if not ks: lin["no commands"] += 1
    elif all(k.startswith("generic") for k in ks): lin["all commands generic"] += 1
    else: lin["needs code for a command"] += 1
print(dict(lin))
