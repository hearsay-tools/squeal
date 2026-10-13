"""Fetch only official sources named by the brief; preserve short excerpts."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import urllib.request

BASE = Path(__file__).resolve().parent
CACHE = BASE / '.cache/docs'
CACHE.mkdir(parents=True, exist_ok=True)
SOURCES = [
    ('pytest-invoke', 'https://raw.githubusercontent.com/pytest-dev/pytest/8.4.2/doc/en/how-to/usage.rst', ['Calling pytest from Python code', 'import caching', 'pytest.main']),
    ('pytest-config', 'https://raw.githubusercontent.com/pytest-dev/pytest/8.4.2/doc/en/reference/customize.rst', ['rootdir', 'pytest.ini', 'pyproject.toml', 'never merged']),
    ('pytest-hooks', 'https://raw.githubusercontent.com/pytest-dev/pytest/8.4.2/src/_pytest/hookspec.py', ['pytest_runtest_logreport', 'pytest_collectreport', 'wasxfail', 'pytest_sessionfinish', 'pytest_internalerror']),
    ('python-fork', 'https://docs.python.org/3.13/library/os.html', ['fork()', 'multiple threads', 'DeprecationWarning']),
    ('python-reload', 'https://docs.python.org/3.13/library/importlib.html', ['reload(', 'Other references', 'retained', 'thread-safe']),
    ('xdist', 'https://raw.githubusercontent.com/pytest-dev/pytest-xdist/v3.8.0/docs/how-it-works.rst', ['collection', 'same order', 'every worker']),
    ('timeout', 'https://raw.githubusercontent.com/pytest-dev/pytest-timeout/2.4.0/README.rst', ['os._exit', 'thread', 'SIGALRM', 'teardown']),
    ('json-report', 'https://raw.githubusercontent.com/numirias/pytest-json-report/1.5.0/README.rst', ['pytest_sessionfinish', 'setup', 'teardown', 'lineno']),
    ('asyncio', 'https://raw.githubusercontent.com/pytest-dev/pytest-asyncio/v1.2.0/docs/concepts.rst', ['strict', 'auto', 'asyncio']),
    ('django', 'https://raw.githubusercontent.com/pytest-dev/pytest-django/v4.11.1/docs/configuring_django.rst', ['DJANGO_SETTINGS_MODULE', '--ds', 'order']),
    ('syrupy', 'https://raw.githubusercontent.com/syrupy-project/syrupy/v4.9.1/README.md', ['snapshot-update', 'snapshot', 'fail']),
]


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        if data.strip(): self.parts.append(data.strip())


out = []
for name, url, terms in SOURCES:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read()
            final_url = response.url
        (CACHE/(name+'.txt')).write_bytes(raw)
        text = raw.decode()
        if '<html' in text[:1000].lower():
            parser = Text()
            parser.feed(text)
            text = '\n'.join(parser.parts)
        excerpts = []
        for term in terms:
            start = 0
            for count in range(3):
                pos = text.lower().find(term.lower(), start)
                if pos < 0: break
                excerpts.append(dict(term=term, text=text[max(0,pos-120):pos+800]))
                start = pos+len(term)
        out.append(dict(name=name, url=url, final_url=final_url, sha256=hashlib.sha256(raw).hexdigest(), excerpts=excerpts))
        print(name, 'fetched', len(raw))
    except Exception as error:
        out.append(dict(name=name, url=url, error=str(error)))
        print(name, error)
(BASE/'sources.json').write_text(json.dumps(out, indent=2)+'\n')
