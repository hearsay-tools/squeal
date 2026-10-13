"""Throwaway: generate a 1,000-module pytest project (src layout, uv workspace, conftest chain).

python gen_big.py <out_dir> [modules=1000] [tests=200] [seed=7]

Every import form of the brief appears: `import a.b`, `from a import b` (module),
`from a import name`, relative `from . import x` / `from ..p import x`, TYPE_CHECKING,
try/except ImportError, function-local, importlib.import_module / __import__ with
literals, a computed import_module, barrels in some __init__.py, and a second
workspace package (setuptools, editable) imported from the first.
"""
import os
import random
import sys
import textwrap

out = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
T = int(sys.argv[3]) if len(sys.argv) > 3 else 200
rnd = random.Random(int(sys.argv[4]) if len(sys.argv) > 4 else 7)
PER_PKG = 20
LIBB = 40  # modules in the second package, counted in N


def w(path, text):
    path = os.path.join(out, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(textwrap.dedent(text).lstrip())


w("pyproject.toml", """
    [project]
    name = "big"
    version = "0.1.0"
    requires-python = ">=3.10"
    dependencies = ["libb"]

    [dependency-groups]
    dev = ["pytest>=8", "pytest-mock"]

    [build-system]
    requires = ["hatchling"]
    build-backend = "hatchling.build"

    [tool.hatch.build.targets.wheel]
    packages = ["src/big"]

    [tool.uv.workspace]
    members = ["packages/*"]

    [tool.uv.sources]
    libb = { workspace = true }

    [tool.pytest.ini_options]
    testpaths = ["tests"]
    addopts = "-q -p no:cacheprovider"
""")
w("packages/libb/pyproject.toml", """
    [project]
    name = "libb"
    version = "0.1.0"
    requires-python = ">=3.10"

    [build-system]
    requires = ["setuptools>=64"]
    build-backend = "setuptools.build_meta"

    [tool.setuptools.packages.find]
    where = ["src"]
""")

# libb: flat package of LIBB modules
w("packages/libb/src/libb/__init__.py", "from libb.m0 import f as f0\n")
for i in range(LIBB):
    deps = rnd.sample(range(i), min(i, 2))
    body = "".join(f"from libb import m{d}\n" for d in deps)
    body += f"def f():\n    return {i}\n"
    w(f"packages/libb/src/libb/m{i}.py", body)

# big: modules spread over packages big/a{g}/b{p}/m{i}.py, 10 packages per group
mods = []  # (dotted, pkg_dotted, path)
n_big = N - LIBB
for i in range(n_big):
    p = i // PER_PKG
    g = p // 10
    pkg = f"big.a{g}.b{p}"
    mods.append((f"{pkg}.m{i}", pkg, f"src/big/a{g}/b{p}/m{i}.py"))

w("src/big/__init__.py", "")
groups = sorted({m[1].rsplit(".", 1)[0] for m in mods})
for g in groups:
    w("src/" + g.replace(".", "/") + "/__init__.py", "")
pkgs = sorted({m[1] for m in mods})
for k, pkg in enumerate(pkgs):
    first = [m for m in mods if m[1] == pkg][0][0].rsplit(".", 1)[1]
    # every third package is a barrel that re-exports its first module
    text = f"from .{first} import f as {first}_f\n" if k % 3 == 0 else ""
    w("src/" + pkg.replace(".", "/") + "/__init__.py", text)

w("src/big/dyn_target.py", "X = 1\n")
w("src/big/computed_target.py", "X = 2\n")
w("src/big/typing_target.py", "T = int\n")

for i, (name, pkg, path) in enumerate(mods):
    lines = ["from __future__ import annotations", "import importlib", "from typing import TYPE_CHECKING"]
    tail = []
    # mostly local deps (same or previous package) plus an occasional far one
    cands = list(range(max(0, i - 30), i))
    deps = rnd.sample(cands, min(len(cands), rnd.choice([1, 2, 2, 3])))
    if i > 100 and rnd.random() < 0.3:
        deps.append(rnd.randrange(0, i - 50))
    for d in deps:
        dn, dpkg, _ = mods[d]
        short = dn.rsplit(".", 1)[1]
        form = rnd.choice(["import", "from_mod", "from_name", "rel", "local", "type", "try"])
        if form == "rel" and dpkg != pkg:
            form = "from_mod"
        if form == "import":
            lines.append(f"import {dn}")
        elif form == "from_mod":
            lines.append(f"from {dpkg} import {short}")
        elif form == "from_name":
            lines.append(f"from {dn} import f as f_{short}")
        elif form == "rel":
            lines.append(f"from . import {short}")
        elif form == "local":
            tail.append(f"def use_{short}():\n    from {dpkg} import {short}\n    return {short}.f()\n")
        elif form == "type":
            lines.append(f"if TYPE_CHECKING:\n    from {dn} import f as t_{short}")
            lines.append(f"from {dn} import f as f2_{short}")  # also a real edge, so closures agree
        elif form == "try":
            lines.append(f"try:\n    from {dpkg} import {short}_fast as {short}\nexcept ImportError:\n    from {dpkg} import {short}")
    if i % 50 == 7:
        lines.append(f"from libb import m{i % LIBB}")
    if i % 97 == 3:
        lines.append("DYN = importlib.import_module('big.dyn_target')")
        lines.append("DUN = __import__('big.computed_target', fromlist=['X'])")
    if i % 199 == 11:
        lines.append("if TYPE_CHECKING:\n    from big.typing_target import T")
    if i % 211 == 5:
        lines.append("_name = 'computed' + '_target'\nCOMP = importlib.import_module('big.' + _name)")
    if i > 0 and rnd.random() < 0.05:
        # parent-relative import from a sibling package
        d = rnd.randrange(0, i)
        dn, dpkg, _ = mods[d]
        if dpkg.rsplit(".", 1)[0] == pkg.rsplit(".", 1)[0] and dpkg != pkg:
            lines.append(f"from ..{dpkg.rsplit('.', 1)[1]} import {dn.rsplit('.', 1)[1]}")
    lines.append(f"def f():\n    return {i}\n")
    w(path, "\n".join(lines) + "\n" + "\n".join(tail))

# tests: tests/t{g}/test_{k}.py, root conftest + one conftest per group
w("tests/__init__.py", "")
w("tests/conftest.py", f"""
    import pytest
    from {mods[0][0]} import f as root_f

    pytest_plugins = ["tests.plugin_extra"]

    @pytest.fixture
    def root_value():
        return root_f()
""")
w("tests/plugin_extra.py", f"""
    import pytest
    from {mods[1][0]} import f as plugin_f

    @pytest.fixture
    def plugin_value():
        return plugin_f()
""")
tg = 10
for g in range(tg):
    w(f"tests/t{g}/__init__.py", "")
    m = mods[rnd.randrange(0, n_big)]
    w(f"tests/t{g}/conftest.py", f"""
        import pytest
        from {m[0]} import f as group_f

        @pytest.fixture
        def group_value():
            return group_f()
    """)
for k in range(T):
    g = k % tg
    picks = rnd.sample(range(n_big), rnd.choice([1, 1, 2, 3]))
    lines = ["import pytest"]
    calls = []
    for j, d in enumerate(picks):
        dn = mods[d][0]
        lines.append(f"from {dn} import f as f{j}")
        calls.append(f"f{j}()")
    if k % 25 == 0:
        lines.append(f"from libb import m{k % LIBB}")
    body = "\n".join(lines) + "\n\n"
    body += "@pytest.mark.parametrize('n', [1, 2])\n"
    body += f"def test_a(n, root_value, group_value, plugin_value, mocker):\n    assert n and ({' + '.join(calls)}) >= 0\n\n"
    body += "def test_b():\n    from big import dyn_target\n    assert dyn_target.X == 1\n"
    w(f"tests/t{g}/test_{k}.py", body)
print(f"{n_big} big modules, {LIBB} libb modules, {T} test files -> {out}")
