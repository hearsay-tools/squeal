import app.not_there  # noqa: F401  absent on purpose: the file fails at collection


def test_never_collected():
    assert True
