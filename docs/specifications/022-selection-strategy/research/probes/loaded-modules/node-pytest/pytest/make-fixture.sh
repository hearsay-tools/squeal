#!/bin/sh
# Throwaway: writes the pytest mixing fixture. Two test files share pkg.shared
# (which imports pkg.deep); test_b also imports pkg.only_b; pkg.shared.lazy()
# imports pkg.lazy_dep inside a function, called by test_a only; the root
# conftest imports helpers; test_a reads data.txt.
set -e
D=${1:?target dir}
mkdir -p "$D/pkg" "$D/tests" && cd "$D"
printf '[pytest]\npythonpath = .\naddopts = -p no:cacheprovider\n' > pytest.ini
echo 'import helpers' > conftest.py
echo 'H = 1' > helpers.py
: > pkg/__init__.py
printf 'from pkg import deep\n\ndef f():\n    return deep.D\n\ndef lazy():\n    import pkg.lazy_dep\n    return pkg.lazy_dep.L\n' > pkg/shared.py
echo 'D = 2' > pkg/deep.py
echo 'L = 3' > pkg/lazy_dep.py
echo 'B = 4' > pkg/only_b.py
echo 'data' > data.txt
printf 'import pathlib\nfrom pkg import shared\n\ndef test_a():\n    assert shared.f() == 2\n    assert shared.lazy() == 3\n    assert pathlib.Path(__file__).parent.parent.joinpath("data.txt").read_text()\n' > tests/test_a.py
printf 'from pkg import shared\nimport pkg.only_b\n\ndef test_b():\n    assert shared.f() == 2 and pkg.only_b.B == 4\n' > tests/test_b.py
