# Throwaway (015-01): what a Squeal pytest plugin could do for per-test-file
# coverage: one coverage.py session per pytest process, a dynamic context per
# test file switched at collection and at each item's run.
import os

import coverage
import pytest

_cov = None


def pytest_configure(config):
    global _cov
    _cov = coverage.Coverage(data_file=os.environ["PROBE_DATA"], branch=True, source=[os.getcwd()])
    _cov.start()


@pytest.hookimpl(hookwrapper=True)
def pytest_collect_file(file_path, parent):
    if os.environ.get("PROBE_COLLECT_CONTEXT") == "1":
        _cov.switch_context(os.path.relpath(str(file_path)))
    yield


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    _cov.switch_context(os.path.relpath(str(item.path)))
    yield


def pytest_unconfigure(config):
    _cov.stop()
    _cov.save()
