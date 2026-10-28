import pytest

@pytest.fixture
def nested_value(root_value):
    return root_value + 1
