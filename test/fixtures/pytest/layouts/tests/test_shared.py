# Two editable roots both hold shared.py; .pth files load in sorted name order, so hauto wins.
from shared import WHO


def test_shared():
    assert WHO == "hauto"
