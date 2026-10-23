from pkg.mathx import clamp


def test_clamp_high():
    assert clamp(99, 0, 10) == 10
