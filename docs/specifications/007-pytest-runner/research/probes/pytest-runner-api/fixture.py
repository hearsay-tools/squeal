"""Generate disposable common-project and edge-case fixtures."""


def write(root, path, text):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def create(root):
    files = {
        "pyproject.toml": '''[build-system]
requires = ["setuptools==80.9.0"]
build-backend = "setuptools.build_meta"
[project]
name = "squeal-api-probe"
version = "0.0.0"
[tool.setuptools.packages.find]
where = ["src"]
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py", "check_*.py"]
pythonpath = ["support"]
addopts = "-ra"
asyncio_mode = "strict"
asyncio_default_fixture_loop_scope = "function"
''',
        "src/probe_pkg/__init__.py": "VALUE = 1\n",
        "support/support_module.py": "VALUE = 42\n",
        "tests/conftest.py": '''import pytest
@pytest.fixture(scope="session")
def root_value():
    return 10
''',
        "tests/nested/conftest.py": '''import pytest
@pytest.fixture
def nested_value(root_value):
    return root_value + 1
''',
        "tests/nested/test_smoke.py": '''import probe_pkg
import support_module
def test_smoke(nested_value, snapshot):
    assert nested_value == 11
    assert probe_pkg.VALUE == 1
    assert support_module.VALUE == 42
    assert snapshot is not None
''',
        "tests/test_ids.py": '''import pytest
@pytest.mark.parametrize("value", [object(), object()])
def test_object(value): pass
@pytest.mark.parametrize("value", [1, 2], ids=["same", "same"])
def test_duplicate(value): pass
@pytest.mark.parametrize("value", [object(), object()], ids=repr)
def test_repr(value): pass
class TestOuter:
    class TestInner:
        def test_nested(self): pass
''',
        "cases/test_outcomes.py": '''import pytest
@pytest.fixture
def setup_error(): raise ValueError("fixture setup")
@pytest.fixture
def teardown_error():
    yield 1
    raise ValueError("fixture teardown")
def helper():
    assert False, "helper failure"
def test_pass(): pass
def test_fail(): helper()
@pytest.mark.skip(reason="skip reason")
def test_skip(): pass
@pytest.mark.xfail(reason="expected")
def test_xfail(): assert False
@pytest.mark.xfail(reason="unexpected")
def test_xpass(): pass
@pytest.mark.xfail(reason="strict unexpected", strict=True)
def test_strict_xpass(): pass
def test_setup(setup_error): pass
def test_teardown(teardown_error): pass
''',
        "cases/test_broken.py": "raise ImportError('collection broken')\n",
        "cases/test_keyboard.py": "def test_keyboard():\n    raise KeyboardInterrupt()\n",
        "cases/test_hang.py": '''import os, pathlib, subprocess, sys, time
def test_hang():
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pathlib.Path(os.environ["PROBE_CHILD"]).write_text(str(child.pid))
    time.sleep(120)
''',
        "cases/test_empty.py": "# no tests\n",
        "cases/test_async.py": '''import asyncio, pytest, unittest
@pytest.mark.asyncio
async def test_asyncio(): await asyncio.sleep(0)
@pytest.fixture
def anyio_backend(): return "asyncio"
@pytest.mark.anyio
async def test_anyio(): await asyncio.sleep(0)
class TestUnit(unittest.TestCase):
    def test_ok(self): self.assertEqual(1, 1)
''',
        "cases/test_django.py": '''def test_django(settings):
    assert settings.SECRET_KEY == "probe-only"
''',
        "support/django_settings.py": 'SECRET_KEY = "probe-only"\nINSTALLED_APPS = []\nDATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}\n',
        "cases/test_snapshot.py": 'def test_snapshot(snapshot):\n    assert {"value": 1} == snapshot\n',
        "cases/test_write.py": 'from pathlib import Path\ndef test_write():\n    Path("written-by-test.txt").write_text("side effect")\n',
        "cases/example.txt": ">>> 1 + 1\n2\n",
        "packages/second/pyproject.toml": '[build-system]\nrequires = ["setuptools==80.9.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "squeal-api-second"\nversion = "0.0.0"\n[tool.setuptools.packages.find]\nwhere = ["src"]\n[tool.pytest.ini_options]\naddopts = "-q"\ntestpaths = ["tests"]\n',
        "packages/second/src/probe_second/__init__.py": "VALUE = 2\n",
        "packages/second/tests/test_second.py": "import probe_second\ndef test_second(): assert probe_second.VALUE == 2\n",
    }
    for path, text in files.items():
        write(root, path, text)
    for i in range(20):
        write(root, f"bench/test_{i:02}.py", "import time\ndef test_one(root_value, snapshot):\n    time.sleep(0.05)\n    assert root_value == 10\n")
    write(root, "bench/conftest.py", files["tests/conftest.py"])
