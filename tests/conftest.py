import pytest


@pytest.fixture(autouse=True, scope="session")
def prefect_test_server():
    """Flows tested against a temporary Prefect API (no interaction with a real server)."""
    try:
        from prefect.testing.utilities import prefect_test_harness
    except ImportError:  # prefect not installed: pipeline tests are skipped by importorskip
        yield
        return
    with prefect_test_harness():
        yield
