from billing.fmt import money


def test_money():
    assert money(1234) == "12.34"
