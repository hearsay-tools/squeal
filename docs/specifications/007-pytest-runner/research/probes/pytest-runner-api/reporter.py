"""Throwaway public-hook reporter, not a proposed production implementation."""
import json
import os
import time
import pytest


def emit(kind, **data):
    # xdist forwards test reports to its controller. Do not double-write them.
    if os.environ.get("PYTEST_XDIST_WORKER"):
        return
    path = os.environ.get("PROBE_EVENTS")
    if path:
        with open(path, "a", encoding="utf-8") as out:
            out.write(json.dumps(dict(kind=kind, pid=os.getpid(), time=time.monotonic(), **data)) + "\n")


def pytest_configure(config):
    emit("config", root=str(config.rootpath), ini=str(config.inipath),
         args=config.args, addopts=config.getini("addopts"),
         testpaths=config.getini("testpaths"), python_files=config.getini("python_files"),
         pythonpath=[str(p) for p in config.getini("pythonpath")],
         maxfail=config.option.maxfail, capture=config.option.capture,
         importmode=config.option.importmode,
         plugins=sorted(name for name, plugin in config.pluginmanager.list_name_plugin() if plugin))


def pytest_collection_finish(session):
    emit("collection", items=[dict(nodeid=i.nodeid, location=i.location) for i in session.items])
    if os.environ.get("PROBE_INTERNAL"):
        raise RuntimeError("probe internal hook failure")


def pytest_collectreport(report):
    emit("collectreport", nodeid=report.nodeid, outcome=report.outcome,
         longrepr=str(report.longrepr) if report.longrepr else None)


def pytest_runtest_logstart(nodeid, location):
    emit("start", nodeid=nodeid, location=location)


def pytest_runtest_logreport(report):
    crash = getattr(report.longrepr, "reprcrash", None)
    emit("report", nodeid=report.nodeid, when=report.when, outcome=report.outcome,
         duration=report.duration, location=report.location,
         wasxfail=getattr(report, "wasxfail", None),
         crash=None if crash is None else dict(path=crash.path, lineno=crash.lineno, message=crash.message),
         longrepr=str(report.longrepr) if report.longrepr else None,
         sections=report.sections)


def pytest_runtest_logfinish(nodeid, location):
    emit("finish", nodeid=nodeid)


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session, exitstatus):
    emit("sessionfinish", exitstatus=int(exitstatus), collected=session.testscollected)


def pytest_internalerror(excrepr, excinfo):
    emit("internalerror", message=str(excrepr))


def pytest_keyboard_interrupt(excinfo):
    emit("interrupt", message=str(excinfo.value))


@pytest.hookimpl(optionalhook=True)
def pytest_xdist_node_collection_finished(node, ids):
    emit("worker_collection", worker=node.gateway.id, ids=ids)
