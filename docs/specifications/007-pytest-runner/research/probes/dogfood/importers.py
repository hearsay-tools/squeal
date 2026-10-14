"""Throwaway probe for 007-18: which test files reach each briefcase module, directly and
transitively, by a plain `ast` walk of static imports (no project code imported).

    python -I importers.py <repo> [module ...]

With no module: the modules imported directly by exactly two test files, with their transitive
holder count. With modules: their direct and transitive test holders. A rough stand-in for
Squeal's reverse index, used only to pick the refactor target; Squeal's own `affected` is the
measurement.
"""

import ast
import sys
from pathlib import Path

repo = Path(sys.argv[1])
src = repo / "src"


def module_of(path: Path) -> str:
    rel = path.relative_to(src).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


modules = {module_of(p): p for p in src.rglob("*.py")}


def imports(path: Path, package: str) -> set[str]:
    out: set[str] = set()
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                pkg = package.split(".")
                pkg = pkg[: len(pkg) - node.level + 1]
                base = ".".join(pkg + ([base] if base else []))
            out.add(base)
            for a in node.names:
                out.add(f"{base}.{a.name}")
    found = set()
    for name in out:
        parts = name.split(".")
        # every package on the way is run on import
        for i in range(1, len(parts) + 1):
            m = ".".join(parts[:i])
            if m in modules:
                found.add(m)
    return found


def package_of(mod: str, path: Path) -> str:
    return mod if path.name == "__init__.py" else mod.rpartition(".")[0]


edges = {m: imports(p, package_of(m, p)) for m, p in modules.items()}
tests = sorted((repo / "tests").rglob("test_*.py"))
conftests = sorted((repo / "tests").rglob("conftest.py")) + [repo / "tests" / "utils.py"]


def closure(start: set[str]) -> set[str]:
    seen: set[str] = set()
    todo = list(start)
    while todo:
        m = todo.pop()
        if m in seen:
            continue
        seen.add(m)
        todo.extend(edges.get(m, ()))
    return seen


def direct(path: Path) -> set[str]:
    return imports(path, "tests")


holders_direct: dict[str, set[str]] = {}
holders_trans: dict[str, set[str]] = {}
for t in tests:
    rel = str(t.relative_to(repo))
    d = direct(t)
    for c in conftests:
        if t.parent.is_relative_to(c.parent):
            d |= direct(c)
    for m in direct(t):
        holders_direct.setdefault(m, set()).add(rel)
    for m in closure(d):
        holders_trans.setdefault(m, set()).add(rel)

wanted = sys.argv[2:]
if wanted == ["--all"]:
    counts = {m: len(holders_trans.get(m, ())) for m in modules}
    print(f"{len(modules)} modules, {len(tests)} test files")
    for m, n in sorted(counts.items(), key=lambda kv: kv[1]):
        if n < len(tests):
            print(f"{n:4d} transitive  {len(holders_direct.get(m, ())):3d} direct  {m}")
elif not wanted:
    for m in sorted(holders_direct):
        if len(holders_direct[m]) == 2:
            print(f"{len(holders_trans.get(m, ())):4d} transitive  {m}")
else:
    for m in wanted:
        print(m, "direct:", sorted(holders_direct.get(m, ())))
        print(m, "transitive:", len(holders_trans.get(m, ())))
