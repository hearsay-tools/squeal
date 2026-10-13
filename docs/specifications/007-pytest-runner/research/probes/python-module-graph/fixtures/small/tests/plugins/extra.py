import pytest
from app.helpers import helper

@pytest.fixture
def from_plugin():
    return helper()
