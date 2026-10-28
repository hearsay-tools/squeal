"""Probe only: a PDM-free stand-in for PDM's pep582/sitecustomize.py.

Adds the directory named in SQUEAL_PEP582_LIB the way PDM does: site-packages
removed, `site.addsitedir(lib)` (so `.pth` files run), site-packages appended again.
"""
import os
import site
import sys

lib = os.environ.get("SQUEAL_PEP582_LIB")
if lib:
    known = set()
    site.addusersitepackages(known)
    site.addsitepackages(known)
    known = {os.path.normcase(p) for p in known}
    sys.path[:] = [p for p in sys.path if os.path.normcase(p) not in known]
    site.addsitedir(lib)
    known2 = set()
    site.addusersitepackages(known2)
    site.addsitepackages(known2)
