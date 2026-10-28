import pytest
from app.core import add


@pytest.mark.parametrize("a,b,c", [(1, 2, 3), (2, 2, 4)])
def test_add(a, b, c):
    assert add(a, b) == c


def test_fails():
    assert add(1, 1) == 3
