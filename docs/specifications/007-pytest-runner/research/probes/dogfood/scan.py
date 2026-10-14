"""Throwaway probe for 007-18: no committed file holds a credential or the provider's address.

    python3 -I scan.py <dir> [codex config.toml on stdin]

Reads the values of ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL and CLIPROXY_API_KEY from the
environment by name, the provider's base_url and host from the Codex config given on stdin
(optional), and the base URL's host; prints each file under <dir> that holds any of them, with a
count, never the value. Exit 1 when one does.
"""

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

secrets = set()
for name in ("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLIPROXY_API_KEY"):
    v = os.environ.get(name, "")
    if len(v) >= 12:
        secrets.add(v)
        if len(v) >= 32:
            secrets.add(v[-20:])
if not sys.stdin.isatty():
    for m in re.finditer(r'base_url\s*=\s*"([^"]+)"', sys.stdin.read()):
        secrets.add(m.group(1))
for s in list(secrets):
    if s.startswith("http"):
        host = urlparse(s).hostname or ""
        if len(host) >= 8:
            secrets.add(host)
print(f"{len(secrets)} values checked")
bad = 0
for f in sorted(Path(sys.argv[1]).rglob("*")):
    if not f.is_file():
        continue
    text = f.read_bytes().decode("utf-8", "replace")
    n = sum(text.count(s) for s in secrets)
    if n:
        bad += 1
        print(f"{f}: {n}")
sys.exit(1 if bad else 0)
