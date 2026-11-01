import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def db_file(tmp_path, monkeypatch):
    path = str(tmp_path / "test.db")
    monkeypatch.setenv("STUDIO_BARS_DB", path)
    monkeypatch.setenv("STUDIO_BARS_AUTO_SNAPSHOT_SECONDS", "300")
    return path


@pytest.fixture
def client(db_file):
    return TestClient(app)


def make_song(client, **kw):
    body = {"title": "Rain on Glass", "genres": ["r&b"], **kw}
    r = client.post("/api/songs", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def to_content(song):
    """Turn a loaded song into the payload the editor sends."""
    return {
        "base_version": song["version"],
        "sections": [
            {
                "id": s["id"],
                "label": s["label"],
                "section_type": s["section_type"],
                "lines": [{"id": ln["id"], "text": ln["text"]} for ln in s["lines"]],
            }
            for s in song["sections"]
        ],
    }


def save(client, song, mutate=None):
    payload = to_content(song)
    if mutate:
        mutate(payload)
    return client.put(f"/api/songs/{song['id']}/content", json=payload)
