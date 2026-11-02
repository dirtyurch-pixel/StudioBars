from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import access
from app.ai import budget
from app.main import app, mount_web


def fresh(monkeypatch, pin="432109"):
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
    assert c.post("/api/auth/login", json={"pin": "000000"}).status_code == 401
    assert c.get("/api/songs").status_code == 401
    ok = c.post("/api/auth/login", json={"pin": "432109"})
    assert ok.status_code == 200 and "432109" not in ok.headers.get("set-cookie", "")
    assert "httponly" in ok.headers["set-cookie"].lower()
    assert c.get("/api/songs").status_code == 200
    assert c.get("/api/auth/status").json()["ok"] is True
    c.post("/api/auth/logout")
    c.cookies.clear()
    assert c.get("/api/songs").status_code == 401


def test_forged_cookie_is_refused(db_file, monkeypatch):
    c = fresh(monkeypatch)
    c.cookies.set(access.COOKIE, "432109")
    assert c.get("/api/songs").status_code == 401


def test_guessing_is_slowed_down(db_file, monkeypatch):
    c = fresh(monkeypatch)
    codes = [c.post("/api/auth/login", json={"pin": str(i)}).status_code for i in range(8)]
    assert codes[:5] == [401] * 5 and codes[5:] == [429] * 3
    assert (
        c.post("/api/auth/login", json={"pin": "432109"}).status_code == 429
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


def login(c, pin="432109"):
    r = c.post("/api/auth/login", json={"pin": pin})
    assert r.status_code == 200, r.text
    return c.cookies.get(access.COOKIE)


def test_each_sign_in_gets_a_new_random_token_that_is_not_derived_from_the_pin(
    db_file, monkeypatch
):
    c = fresh(monkeypatch)
    a = login(c)
    c.cookies.clear()
    b = login(c)
    assert a and b and a != b and len(a) >= 40
    assert a != access._digest("432109") and "432109" not in a


def test_sign_out_cancels_the_token_on_the_server(db_file, monkeypatch):
    c = fresh(monkeypatch)
    tok = login(c)
    c.post("/api/auth/logout")
    thief = TestClient(app)
    thief.cookies.set(access.COOKIE, tok)  # a copied cookie no longer works
    assert thief.get("/api/songs").status_code == 401


def test_changing_the_pin_signs_everyone_out(db_file, monkeypatch):
    c = fresh(monkeypatch)
    login(c)
    assert c.get("/api/songs").status_code == 200
    monkeypatch.setenv("STUDIO_BARS_ACCESS_PIN", "999888")
    assert c.get("/api/songs").status_code == 401


def test_sessions_expire_on_the_server(db_file, monkeypatch):
    c = fresh(monkeypatch)
    login(c)
    real = access.time.time
    monkeypatch.setattr(access.time, "time", lambda: real() + access.SESSION_SECONDS + 5)
    assert c.get("/api/songs").status_code == 401


def test_sign_out_everywhere(db_file, monkeypatch):
    c = fresh(monkeypatch)
    other = TestClient(app)
    login(c)
    login(other)
    assert c.post("/api/auth/logout-everywhere").status_code == 200
    assert other.get("/api/songs").status_code == 401


def test_short_pin_is_refused_by_the_server(db_file, monkeypatch):
    c = fresh(monkeypatch, pin="1234")
    r = c.post("/api/auth/login", json={"pin": "1234"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "PIN_TOO_SHORT"
    assert c.get("/api/songs").status_code == 403


def test_without_a_pin_only_this_computer_may_use_the_api(db_file, monkeypatch):
    monkeypatch.delenv("STUDIO_BARS_ACCESS_PIN", raising=False)
    c = TestClient(app)
    assert c.get("/api/songs").status_code == 200  # loopback
    monkeypatch.setattr(access, "_is_loopback", lambda request: False)
    r = c.get("/api/songs")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "PIN_NOT_SET"


def test_cookie_is_secure_over_https(db_file, monkeypatch):
    c = fresh(monkeypatch)
    plain = c.post("/api/auth/login", json={"pin": "432109"}).headers["set-cookie"].lower()
    assert "secure" not in plain
    c2 = fresh(monkeypatch)
    r = c2.post("/api/auth/login", json={"pin": "432109"}, headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()
