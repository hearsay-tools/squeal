from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

from . import helpers                      # relative, module
from .util import helper_fn               # name defined in util/__init__.py
from app.util import strings              # module through from-import
import app.util.numbers                   # dotted absolute
from other import add                      # workspace package, setuptools editable
from acme.ns import mod as ns_mod          # namespace package

if TYPE_CHECKING:
    from app.typing_only import Alias      # never loaded at run time
    from app.stub_only import StubThing    # .pyi only

try:
    from app import fast_impl as impl      # missing on purpose
except ImportError:
    from app import slow_impl as impl


def total(xs):
    from app import lazy                   # function-local
    return lazy.double(sum(xs)) + add(0, 0)


def dynamic():
    a = importlib.import_module("app.dyn_literal")
    b = __import__("app.dunder_literal", fromlist=["X"])
    return a.X + b.X


def computed(name):
    return importlib.import_module("app.plugins." + name).X
