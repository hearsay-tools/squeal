# 011-150 probe (throwaway): policy `inputs` glob, copied from squeal src/core/keys/glob.ts at
# 4e1ba068a (same semantics: *, ?, ** across segments, {a,b}, [abc]; no negation).
import re
def _brace(g, i):
    d = 0
    for j in range(i, len(g)):
        if g[j] == "{": d += 1
        elif g[j] == "}":
            d -= 1
            if d == 0: return j
    raise ValueError(g)
def _split(s):
    out, d, cur = [], 0, ""
    for c in s:
        if c == "{": d += 1
        if c == "}": d -= 1
        if c == "," and d == 0: out.append(cur); cur = ""
        else: cur += c
    out.append(cur); return out
def _compile(g):
    o, i = "", 0
    while i < len(g):
        c = g[i]
        if c == "*":
            if i + 1 < len(g) and g[i + 1] == "*":
                at_start = i == 0 or g[i - 1] == "/"
                at_end = i + 2 == len(g) or g[i + 2] == "/"
                if at_start and at_end:
                    o += ".+" if i + 2 == len(g) else "(?:.+/)?"
                    i += 3; continue
            o += "[^/]*"; i += 2 if i + 1 < len(g) and g[i + 1] == "*" else 1
        elif c == "?": o += "[^/]"; i += 1
        elif c == "[":
            e = g.index("]", i + 2); body = g[i + 1:e]; neg = body.startswith("!")
            if neg: body = body[1:]
            o += "[" + ("^/" if neg else "") + body.replace("\\", "\\\\").replace("]", "\\]") + "]"; i = e + 1
        elif c == "{":
            e = _brace(g, i); o += "(?:" + "|".join(_compile(a) for a in _split(g[i + 1:e])) + ")"; i = e + 1
        else: o += re.escape(c); i += 1
    return o
def glob_re(g):
    return re.compile("^" + _compile(g[2:] if g.startswith("./") else g) + "$", re.S)

