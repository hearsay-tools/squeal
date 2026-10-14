import pytest

from billing import rates


@pytest.mark.parametrize("net,expected", [(100, 20), (50, 10)])
def test_tax(net, expected):
    assert rates.tax(net) == expected
