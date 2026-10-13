import os

import pytest

import app


@pytest.mark.parametrize("x,expected", [(1, 4), (2, 8)])
def test_quadruple(x, expected):
    assert app.quadruple(x) == expected


def test_fixtures(base, factor, mocker):
    spy = mocker.spy(app, "quadruple")
    assert app.quadruple(base) == base * factor
    assert spy.call_count == 1


def test_which_code():
    # Prints where `app` was imported from, so a probe can tell worktrees apart.
    print("APP_FILE", app.__file__, "MARK", app.MARK)
    assert app.MARK == os.environ.get("EXPECT_MARK", app.MARK)
