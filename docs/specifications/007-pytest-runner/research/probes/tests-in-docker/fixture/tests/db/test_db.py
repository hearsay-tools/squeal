import os
import time


def test_database(database):
    time.sleep(float(os.environ.get("PROBE_DB_HOLD", "0")))
    assert database.startswith("test_app")
