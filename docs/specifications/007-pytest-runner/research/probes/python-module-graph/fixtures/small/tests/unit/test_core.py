import pathlib
import pytest
from app import core
from tests.unit._support import FACTOR

DATA = pathlib.Path(__file__).parent.parent / "data" / "sample.txt"

@pytest.mark.parametrize("xs,expected", [([1, 2], 6), ([0], 0)])
def test_total(xs, expected):
    assert core.total(xs) == expected

def test_dynamic():
    assert core.dynamic() == 3

def test_computed():
    assert core.computed("alpha") == 3

def test_fixtures(version, one, from_plugin, mocker):
    spy = mocker.spy(core, "total")
    core.total([1])
    assert spy.call_count == 1 and version and one == 1 and from_plugin == 1 and FACTOR == 10

def test_data():
    assert DATA.read_text().strip() == "hello"
