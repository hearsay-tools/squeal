import subprocess
import sys


def test_child_imports_app():
    subprocess.run([sys.executable, "-c", "import app.core"], check=True)
