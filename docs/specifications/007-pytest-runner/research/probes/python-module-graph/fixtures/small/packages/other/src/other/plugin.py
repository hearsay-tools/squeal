import pytest
from other.calc import add


@pytest.fixture
def other_fixture():
    return add(1, 1)
