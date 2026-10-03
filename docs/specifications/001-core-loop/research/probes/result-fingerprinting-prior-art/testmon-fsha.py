# Throwaway probe. Does testmon 2.2.0's fallback file hash (used for files git
# reports as modified or untracked) equal the git blob id it is stored next to?
# Usage: python testmon-fsha.py   (needs pytest-testmon==2.2.0 and git)
import subprocess, tempfile, os
from testmon.process_code import bytes_to_string_and_fsha

cases = {
    "ascii_lf.py": b"x = 1\n",
    "utf8_lf.py": "s = 'zażółć'\n".encode(),
    "ascii_crlf.py": b"x = 1\r\ny = 2\r\n",
    "formfeed.py": b"x = 1\n\f\ny = 2\n",
}
with tempfile.TemporaryDirectory() as d:
    for name, data in cases.items():
        p = os.path.join(d, name)
        open(p, "wb").write(data)
        git = subprocess.run(["git", "hash-object", "--no-filters", p], capture_output=True, text=True).stdout.strip()
        tm = bytes_to_string_and_fsha(data)[1]
        print(f"{name:14} git={git[:10]} testmon={tm[:10]} equal={git == tm}")
