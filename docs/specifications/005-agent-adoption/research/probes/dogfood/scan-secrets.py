# Throwaway probe for 005-18. Not product code.
# The credential scan before a commit: every value of a key, token, secret or provider variable
# in this environment (ANTHROPIC_*, the Codex provider's env_key, anything named KEY, TOKEN,
# SECRET, PASSWORD or AUTH), the provider base URLs and their hosts from ~/.codex/config.toml,
# searched in the given files. Prints only names and paths, never a value. Exit 1 on a hit.
#   python3 -I scan-secrets.py <file or dir>...
import os
import re
import sys
from urllib.parse import urlparse

secrets = {}
for k, v in os.environ.items():
    if len(v) >= 12 and (re.search(r"KEY|TOKEN|SECRET|PASSWORD|AUTH", k) and not re.search(r"(PATH|FILE|DIR|HOME|SOCK)$", k)
                         or re.search(r"BASE_URL|_ENDPOINT$", k)):
        secrets[f"env {k}"] = v
        if len(v) >= 32:
            secrets[f"env {k} (last 20)"] = v[-20:]
try:
    toml = open(os.path.expanduser("~/.codex/config.toml")).read()
except OSError:
    toml = ""
for i, url in enumerate(re.findall(r'base_url\s*=\s*"([^"]+)"', toml)):
    secrets[f"codex base_url {i}"] = url
    host = urlparse(url).netloc
    if host and not host.startswith(("127.0.0.1", "localhost")):
        secrets[f"codex base_url host {i}"] = host
for name, v in list(secrets.items()):
    if v.startswith("http"):
        host = urlparse(v).netloc
        if host and not host.startswith(("127.0.0.1", "localhost")):
            secrets[f"{name} host"] = host

hits = 0
paths = []
for a in sys.argv[1:]:
    if os.path.isdir(a):
        for d, _, fs in os.walk(a):
            paths += [os.path.join(d, f) for f in fs]
    else:
        paths.append(a)
for p in paths:
    try:
        text = open(p, "rb").read().decode("utf8", "replace")
    except OSError:
        continue
    for name, v in secrets.items():
        if v in text:
            print(f"HIT {name} in {p}")
            hits += 1
print(f"scanned {len(paths)} files for {len(secrets)} values: {hits} hits")
sys.exit(1 if hits else 0)
