# 011-149 probe (throwaway): squeal.config.json `inputs` as regular expressions (globs as squeal matches them:
# `**/`, `**`, `*`, `?`, `{a,b}`, whole path).
import json, re
def glob_re(g):
    i, r = 0, ""
    while i < len(g):
        c = g[i]
        if g.startswith("**/", i): r += "(?:.*/)?"; i += 3; continue
        if g.startswith("**", i): r += ".*"; i += 2; continue
        if c == "*": r += "[^/]*"
        elif c == "?": r += "[^/]"
        elif c == "{":
            j = g.index("}", i); r += "(?:" + "|".join(re.escape(x) for x in g[i + 1:j].split(",")) + ")"; i = j + 1; continue
        else: r += re.escape(c)
        i += 1
    return re.compile("^" + r + "$")
def declared_rules(config):
    inputs = json.load(open(config)).get("inputs", [])
    if isinstance(inputs, list): return [(re.compile(".*"), [glob_re(g) for g in inputs])]
    return [(glob_re(t), [glob_re(g) for g in gs]) for t, gs in inputs.items()]
