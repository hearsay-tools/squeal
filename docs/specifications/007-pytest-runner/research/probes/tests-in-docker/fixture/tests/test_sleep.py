import os
import time


def test_sleeps():
    time.sleep(float(os.environ.get("PROBE_SLEEP", "0")))
