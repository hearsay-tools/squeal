import pytest


@pytest.fixture
def broken_setup():
    raise ValueError("fixture setup")


@pytest.fixture
def broken_teardown():
    yield
    raise ValueError("fixture teardown")


def test_setup_error(broken_setup):
    pass


def test_teardown_error(broken_teardown):
    pass


def test_skip():
    pytest.skip("skipped on purpose")


@pytest.mark.xfail(reason="expected")
def test_xfail():
    assert False


@pytest.mark.xfail(reason="unexpected")
def test_xpass():
    pass


@pytest.mark.xfail(reason="strict unexpected", strict=True)
def test_strict_xpass():
    pass
