"""Line coverage of Squeal's pytest runtime for the key-format alarm (row 011-48).

A `.pth` line in the `adapter:pytest` kind's environments imports this module
at every interpreter start, pytest's and its children's. With
`SQUEAL_VALIDITY_COVERAGE` (a side's `NODE_V8_COVERAGE` directory) and
`SQUEAL_VALIDITY_TRACED` (the side's copy of the runtime) set, it traces the
code under the copy and writes, at exit, one report in V8's shape there, so
`coverage.ts` reads a Python line as it reads a bundle line: a range of count
1 per line that ran inside one of count 0 over the file. A line ran when its
statement ran: a hit on any line of a simple statement covers all of it, a
compound statement's header is covered when it or its body ran, a docstring
when its body ran. Without both variables it does nothing.
"""

import ast
import atexit
import json
import os
import pathlib
import sys
import threading

_OUT = os.environ.get("SQUEAL_VALIDITY_COVERAGE")
_TRACED = os.environ.get("SQUEAL_VALIDITY_TRACED")
_hits = {}
_traced = {}


def _local(frame, event, arg):
    if event == "line":
        _hits[frame.f_code.co_filename].add(frame.f_lineno)
    return _local


def _global(frame, event, arg):
    name = frame.f_code.co_filename
    inside = _traced.get(name)
    if inside is None:
        inside = os.path.realpath(name).startswith(_PREFIX)
        _traced[name] = inside
    if not inside:
        return None
    _hits.setdefault(name, set()).add(frame.f_lineno)
    return _local


def _keyword_line(lines, first):
    """The `else:` or `finally:` line above a clause's first statement, 1-based, or None."""
    at = first - 1
    while at > 0:
        text = lines[at - 1].strip()
        if text.startswith(("else", "finally")):
            return at
        if text and not text.startswith("#"):
            return None
        at -= 1
    return None


def _covered(text, hit):
    """Every line of `text` whose statement ran, given the lines that reported a hit."""
    lines = text.split("\n")
    covered = set()

    def ran(start, end):
        return any(start <= n <= end for n in hit)

    def cover(start, end):
        covered.update(range(start, end + 1))

    def body(statements):
        """A block: its docstring ran when any of it did."""
        if not statements:
            return
        first = statements[0]
        value = getattr(first, "value", None)
        doc = isinstance(first, ast.Expr) and isinstance(value, ast.Constant)
        if doc and isinstance(value.value, str) and ran(first.lineno, statements[-1].end_lineno):
            cover(first.lineno, first.end_lineno)
        for node in statements:
            visit(node)

    def clause(statements):
        """An `else:` or `finally:` block, its keyword line covered when it ran."""
        if not statements:
            return
        line = _keyword_line(lines, statements[0].lineno)
        if line is not None and ran(statements[0].lineno, statements[-1].end_lineno):
            covered.add(line)
        body(statements)

    def visit(node):
        for decorator in getattr(node, "decorator_list", ()):
            if ran(decorator.lineno, decorator.end_lineno):
                cover(decorator.lineno, decorator.end_lineno)
        inner = getattr(node, "body", None)
        if not isinstance(inner, list) or not inner:
            if ran(node.lineno, node.end_lineno):
                cover(node.lineno, node.end_lineno)
            return
        # A header ran when its body did; a function's `def` runs at definition, its header only when called.
        header = max(node.lineno, inner[0].lineno - 1)
        called = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        if ran(inner[0].lineno, node.end_lineno) or (not called and ran(node.lineno, header)):
            cover(node.lineno, header)
        body(inner)
        for handler in getattr(node, "handlers", ()):
            first = handler.body[0].lineno
            if ran(handler.lineno, handler.end_lineno):
                cover(handler.lineno, max(handler.lineno, first - 1))
            body(handler.body)
        clause(getattr(node, "orelse", []))
        clause(getattr(node, "finalbody", []))

    body(ast.parse(text).body)
    return covered


def _width(text):
    """`text`'s length in UTF-16 units, as `coverage.ts` counts offsets."""
    return len(text.encode("utf-16-le")) // 2


def _ranges(text, covered):
    """V8's ranges over `text`: count 0 over the file, count 1 over each covered line."""
    out = [{"startOffset": 0, "endOffset": _width(text), "count": 0}]
    at = 0
    for number, line in enumerate(text.split("\n"), start=1):
        if number in covered:
            out.append({"startOffset": at, "endOffset": at + _width(line) + 1, "count": 1})
        at += _width(line) + 1
    return out


def _write():
    sys.settrace(None)
    threading.settrace(None)
    result = []
    for name, hit in _hits.items():
        real = os.path.realpath(name)
        try:
            with open(real, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        ranges = _ranges(text, _covered(text, hit))
        result.append({"url": pathlib.Path(real).as_uri(), "functions": [{"ranges": ranges}]})
    if result:
        # Node makes the directory only as the driver exits.
        os.makedirs(_OUT, exist_ok=True)
        path = os.path.join(_OUT, "python-%d-%s.json" % (os.getpid(), os.urandom(4).hex()))
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"result": result}, f)


if _OUT and _TRACED:
    _PREFIX = os.path.join(os.path.realpath(_TRACED), "")
    atexit.register(_write)
    threading.settrace(_global)
    sys.settrace(_global)
