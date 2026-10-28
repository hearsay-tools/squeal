import pytest

@pytest.fixture
def root_value():
    return 1


def pytest_configure(config):
    # Probe only: dump the import state pytest runs with when DUMP_TO is set (run-2-paths.sh).
    import os
    out = os.environ.get("DUMP_TO")
    if out:
        import json
        import sys
        import sysconfig
        from importlib import metadata

        def where(name):
            mod = sys.modules.get(name)
            if mod is None:
                try:
                    mod = __import__(name)
                except Exception as e:
                    return "ERROR " + type(e).__name__
            return getattr(mod, "__file__", None)

        state = {
            "executable": sys.executable,
            "path": sys.path,
            "flags": {"no_site": sys.flags.no_site, "isolated": sys.flags.isolated},
            "modules": {n: where(n) for n in ("app", "lib", "pytest", "django", "pytest_django", "xdist", "proj")},
            "dists": sorted({f"{d.metadata['Name']}=={d.version}" for d in metadata.distributions()}),
            "pytest11": sorted(f"{e.name}={e.value}" for e in metadata.entry_points(group="pytest11")),
            "plugins": sorted(n for n, p in config.pluginmanager.list_name_plugin() if not n.startswith(("1", "2", "3", "4", "5", "6", "7", "8", "9")) and "/" not in n),
            "purelib": sysconfig.get_paths()["purelib"],
            "PYTHONPATH": os.environ.get("PYTHONPATH"),
            "PEP582_PACKAGES": os.environ.get("PEP582_PACKAGES"),
        }
        with open(out, "w") as f:
            json.dump(state, f, indent=1)
