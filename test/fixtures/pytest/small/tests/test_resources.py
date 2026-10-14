from app.resources import values

def test_values():
    assert values() == {"a": 1}
