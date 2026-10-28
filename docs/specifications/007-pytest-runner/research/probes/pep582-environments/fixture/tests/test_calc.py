import pytest
import app
from app.calc import add

@pytest.mark.parametrize("a,b,c", [(1, 2, 3), (2, 2, 4)])
def test_add(a, b, c):
    assert add(a, b) == c

def test_mark():
    assert app.MARK == "fixture"

def test_mocker(mocker):
    m = mocker.Mock(return_value=5)
    assert m() == 5

def test_django_settings(settings):
    assert settings.SECRET_KEY == "x"
