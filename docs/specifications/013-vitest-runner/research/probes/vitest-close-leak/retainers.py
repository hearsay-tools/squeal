# Throwaway probe (copied from 011-53's retainers.py for research 013-05): shortest strong retainer path from the GC roots to each object
# named <name> in a .heapsnapshot. Usage: python3 -I retainers.py <file> <name>
import json, sys, collections
s = json.load(open(sys.argv[1])); m = s["snapshot"]["meta"]
nf, ef = m["node_fields"], m["edge_fields"]; NF, EF = len(nf), len(ef)
ntypes, etypes = m["node_types"][0], m["edge_types"][0]
nodes, edges, strings = s["nodes"], s["edges"], s["strings"]
N = len(nodes) // NF
first_edge = [0] * (N + 1)
for i in range(N): first_edge[i + 1] = first_edge[i] + nodes[i * NF + nf.index("edge_count")] * EF
name = lambda i: strings[nodes[i * NF + nf.index("name")]]
ntype = lambda i: ntypes[nodes[i * NF + nf.index("type")]]
targets = [i for i in range(N) if name(i) == sys.argv[2] and ntype(i) == "object"]
print("instances", len(targets))
parent = {0: None}; q = collections.deque([0])
while q:
  n = q.popleft()
  for e in range(first_edge[n], first_edge[n + 1], EF):
    et = etypes[edges[e]]
    if et == "weak": continue
    to = edges[e + 2] // NF
    if to in parent: continue
    en = edges[e + 1]; label = strings[en] if et in ("context", "property", "internal", "shortcut") else f"[{en}]"
    parent[to] = (n, f"{et}:{label}"); q.append(to)
for t in targets[:2]:
  path = []; n = t
  while parent.get(n): p, lab = parent[n]; path.append(f"{ntype(p)}:{name(p)[:60]} --{lab}-->"); n = p
  print("\n".join(reversed(path[-40:]))); print("=>", name(t)); print()
