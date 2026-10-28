import os
import pytest


@pytest.fixture(scope="session")
def db_name():
    # pytest-django's naming: test_<name>, with _gwN under xdist.
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    return "test_app" + (f"_{worker}" if worker else "")
