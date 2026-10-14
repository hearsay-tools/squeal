import pytest

pytest.skip("the whole module is skipped on purpose", allow_module_level=True)


def test_never_run():
    assert False
