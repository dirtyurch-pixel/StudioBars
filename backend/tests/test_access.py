from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import access
from app.ai import budget
from app.main import app, mount_web


def fresh(monkeypatch, pin="4321"):
    monkeypatch.setenv("STUDIO_BARS_ACCESS_PIN", pin)
    monkeypatch.setattr(access, "_guesses", budget.RateLimiter(5, 0.0))
    return TestClient(app)


def test_no_pin_means_no_lock(client, monkeypatch):
    monkeypatch.delenv("STUDIO_BARS_ACCESS_PIN", raising=False)
    assert client.get("/api/songs").status_code == 200
    assert client.get("/api/auth/status").json() == {"required": False, "ok": True}


def test_pin_blocks_the_api_until_signed_in(db_file, monkeypatch):
    c = fresh(monkeypatch)
    assert c.get("/health").status_code == 200  # health stays open
    r = c.get("/api/songs")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "PIN_REQUIRED"
    assert (
        c.post("/api/songs", json={"title": "x", "genres": [], "template": "blank"}).status_code
        == 401
    )
    assert c.get("/api/auth/status").json() == {"required": True, "ok": False}
    assert c.post("/api/auth/login", json={"pin": "0000"}).status_code == 401
    assert c.get("/api/songs").status_code == 401
    ok = c.post("/api/auth/login", json={"pin": "4321"})
    assert ok.status_code == 200 and "4321" not in ok.headers.get("set-cookie", "")
    assert "httponly" in ok.headers["set-cookie"].lower()
    assert c.get("/api/songs").status_code == 200
    assert c.get("/api/auth/status").json()["ok"] is True
    c.post("/api/auth/logout")
    c.cookies.clear()
    assert c.get("/api/songs").status_code == 401


def test_forged_cookie_is_refused(db_file, monkeypatch):
    c = fresh(monkeypatch)
    c.cookies.set(access.COOKIE, "4321")
    assert c.get("/api/songs").status_code == 401


def test_guessing_is_slowed_down(db_file, monkeypatch):
    c = fresh(monkeypatch)
    codes = [c.post("/api/auth/login", json={"pin": str(i)}).status_code for i in range(8)]
    assert codes[:5] == [401] * 5 and codes[5:] == [429] * 3
    assert (
        c.post("/api/auth/login", json={"pin": "4321"}).status_code == 429
    )  # even the right one waits


def test_web_app_is_served_and_cannot_escape_its_folder(tmp_path):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<h1>home</h1>")
    (web / "assets" / "a.js").write_text("1")
    (web / "manifest.webmanifest").write_text("{}")
    (tmp_path / "secret.txt").write_text("nope")
    a = FastAPI()
    mount_web(a, str(web))
    c = TestClient(a)
    assert "home" in c.get("/").text
    assert "home" in c.get("/some/page").text
    assert c.get("/assets/a.js").text == "1"
    assert c.get("/manifest.webmanifest").text == "{}"
    assert "nope" not in c.get("/../secret.txt").text
    assert "nope" not in c.get("/%2e%2e/secret.txt").text
