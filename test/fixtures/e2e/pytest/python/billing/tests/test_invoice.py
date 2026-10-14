from billing.rates import tax


def test_invoice_total():
    assert 100 + tax(100) == 120
