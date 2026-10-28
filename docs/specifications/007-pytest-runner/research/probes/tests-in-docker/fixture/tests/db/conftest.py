import os
import pytest
import psycopg


@pytest.fixture(scope="session")
def database(db_name):
    """Creates the test database once and drops it at the end, as pytest-django does without --reuse-db."""
    dsn = os.environ["PROBE_DSN"]
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(f"CREATE DATABASE {db_name}")
    yield db_name
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE {db_name}")
