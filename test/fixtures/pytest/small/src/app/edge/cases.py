"""Docstring mentioning
import app.edge.zz_not_real
"""
from app.edge import (a,
    b as bee)
import app.edge.c as cee, app.edge.d
if True: import app.edge.e
x = 1; import app.edge.f
from app.edge \
    import g
s = "import app.edge.nope"
t = f"{'import app.edge.nope2'}"
class K:
    from app.edge import h
match x:
    case 1:
        from app.edge import i
    case _:
        pass
q = f"{"nested"} {x!r}"
import app.edge.j  # comment with import app.edge.nope3
y = __import__("app.edge.k")
