import os
import subprocess
import sys

def test_nested(nested_value):
    assert nested_value == 2

def test_child_sys_executable():
    out = subprocess.run([sys.executable, "-c", "import app.calc, lib; print(app.calc.add(1, 1))"],
                         capture_output=True, text=True)
    assert out.stdout.strip() == "2", out.stderr

def test_child_python_on_path():
    out = subprocess.run(["python", "-c", "import sys, app.calc; print(sys.version_info[:2], app.calc.add(1, 1))"],
                         capture_output=True, text=True)
    assert out.stdout.strip().endswith("2"), (out.stdout, out.stderr)
