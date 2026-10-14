import pytest
from app.version import VERSION

pytest_plugins = ["tests.plugins.extra"]

@pytest.fixture
def version():
    return VERSION
