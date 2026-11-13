# MBGG backend regression tests: auth, roles, subscriber gating, check-in, tokens, logs, leaderboards,
# collections, members, payments (Square links only - never pay)
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from conftest import BASE_URL, make_session, register_user, mdb

TZ = ZoneInfo("Australia/Adelaide")


def today():
    return datetime.now(TZ).date()


# ---------- Auth ----------
class TestAuth:
    def test_register_me_logout(self):
        s, u, email = register_user("auth")
        assert u["email"] == email.lower()
        assert u["role"] == "member" and u["is_subscriber"] is False
        assert "password_hash" not in u
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200 and me.json()["user_id"] == u["user_id"]
        assert s.post(f"{BASE_URL}/api/auth/logout").status_code == 200
        s.cookies.clear()
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 401

    def test_duplicate_register_and_login(self):
        s, u, email = register_user("dup")
        r = make_session().post(f"{BASE_URL}/api/auth/register",
                                json={"name": "x", "email": email, "password": "testpass123"})
        assert r.status_code == 409
        s2 = make_session()
        r = s2.post(f"{BASE_URL}/api/auth/login", json={"email": email.upper(), "password": "testpass123"})
        assert r.status_code == 200 and r.json()["user_id"] == u["user_id"]
        assert s2.get(f"{BASE_URL}/api/auth/me").status_code == 200
        r = make_session().post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "wrongpass1"})
        assert r.status_code == 401

    def test_bearer_token_auth(self):
        s, u, _ = register_user("bearer")
        tok = s.cookies.get("session_token")
        r = make_session().get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200 and r.json()["user_id"] == u["user_id"]

    def test_register_validation(self):
        r = make_session().post(f"{BASE_URL}/api/auth/register",
                                json={"name": "x", "email": "TEST_bad@example.com", "password": "short"})
        assert r.status_code == 422
        r = make_session().post(f"{BASE_URL}/api/auth/register",
                                json={"name": "x", "email": "notanemail", "password": "testpass123"})
        assert r.status_code == 400


# ---------- Admin roles ----------
class TestAdminRoles:
    def test_admin_me(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200 and r.json()["role"] == "admin"

    def test_promote_demote_and_host_403(self, admin_client):
        hs, hu, _ = register_user("host")
        _, mu, _ = register_user("member")
        r = admin_client.post(f"{BASE_URL}/api/admin/users/{hu['user_id']}/role", json={"role": "host"})
        assert r.status_code == 200 and r.json()["role"] == "host"
        assert hs.get(f"{BASE_URL}/api/auth/me").json()["role"] == "host"
        # host can access staff endpoints but not change roles
        assert hs.get(f"{BASE_URL}/api/admin/summary").status_code == 200
        assert hs.get(f"{BASE_URL}/api/admin/users").status_code == 200
        r = hs.post(f"{BASE_URL}/api/admin/users/{mu['user_id']}/role", json={"role": "host"})
        assert r.status_code == 403
        r = admin_client.post(f"{BASE_URL}/api/admin/users/{hu['user_id']}/role", json={"role": "member"})
        assert r.status_code == 200
        assert hs.get(f"{BASE_URL}/api/admin/summary").status_code == 403

    def test_member_cannot_access_admin(self):
        s, _, _ = register_user("nonstaff")
        for path in ("/api/admin/summary", "/api/admin/token-alerts", "/api/admin/checkins", "/api/admin/users"):
            assert s.get(f"{BASE_URL}{path}").status_code == 403

    def test_role_validation(self, admin_client):
        _, u, _ = register_user("rolev")
        r = admin_client.post(f"{BASE_URL}/api/admin/users/{u['user_id']}/role", json={"role": "admin"})
        assert r.status_code == 422
        r = admin_client.post(f"{BASE_URL}/api/admin/users/user_doesnotexist/role", json={"role": "host"})
        assert r.status_code == 404


# ---------- Non-subscriber gating ----------
class TestNonSubscriber:
    def test_gates(self):
        s, _, _ = register_user("nonsub")
        r = s.post(f"{BASE_URL}/api/logs", json={"title": "TEST_Game", "genre": "Strategy", "player_count": 4,
                                                 "player_id": "p1", "playtime_min": 30, "score": 10,
                                                 "placement": 1})
        # iteration 2: game logs + leaderboards are open to every account
        assert r.status_code == 200
        assert s.get(f"{BASE_URL}/api/leaderboards").status_code == 200
        assert s.post(f"{BASE_URL}/api/token/use", json={"game": "Catan"}).status_code == 403
        assert s.post(f"{BASE_URL}/api/checkin").status_code == 402
        d = s.get(f"{BASE_URL}/api/me/dashboard")
        assert d.status_code == 200 and d.json()["checked_in_today"] is False


# ---------- Subscriber check-in + token ----------
class TestSubscriberCheckinToken:
    def test_free_checkin(self, admin_client):
        s, u, _ = register_user("subci", subscriber=True, domain="gmail.com")
        assert s.get(f"{BASE_URL}/api/auth/me").json()["is_subscriber"] is True
        r = s.post(f"{BASE_URL}/api/checkin")
        assert r.status_code == 200 and r.json()["date"] == __import__("test_iteration4_sessions").SLOT_DATE
        assert s.post(f"{BASE_URL}/api/checkin").status_code == 400
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d["checked_in_today"] is True
        assert d["attendance"]["sessions"] == 1
        assert d["attendance"]["door_value_cents"] == 500
        rows = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()["rows"]
        assert any(x["user_id"] == u["user_id"] and x["is_subscriber"] for x in rows)
        # subscriber cannot buy a check-in
        r = s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin"})
        assert r.status_code == 400

    def test_token_use_and_ack(self, admin_client):
        s, u, _ = register_user("subtok", subscriber=True)
        before = admin_client.get(f"{BASE_URL}/api/admin/summary").json()["unacked_tokens"]
        r = s.post(f"{BASE_URL}/api/token/use", json={"game": "TEST_Twilight Imperium", "note": "please"})
        assert r.status_code == 200
        tok = r.json()
        assert tok["game"] == "TEST_Twilight Imperium" and tok["month"] == datetime.now(TZ).strftime("%Y-%m")
        assert s.post(f"{BASE_URL}/api/token/use", json={"game": "Other"}).status_code == 400
        assert s.get(f"{BASE_URL}/api/me/dashboard").json()["token"]["game"] == "TEST_Twilight Imperium"
        after = admin_client.get(f"{BASE_URL}/api/admin/summary").json()["unacked_tokens"]
        assert after == before + 1
        alerts = admin_client.get(f"{BASE_URL}/api/admin/token-alerts").json()
        assert any(a["id"] == tok["id"] and a["acknowledged"] is False for a in alerts)
        assert admin_client.post(f"{BASE_URL}/api/admin/token-alerts/{tok['id']}/ack").status_code == 200
        alerts = admin_client.get(f"{BASE_URL}/api/admin/token-alerts").json()
        assert any(a["id"] == tok["id"] and a["acknowledged"] is True for a in alerts)
        assert admin_client.post(f"{BASE_URL}/api/admin/token-alerts/nope/ack").status_code == 404


# ---------- Game logs + leaderboards ----------
class TestLogsLeaderboards:
    def _log(self, s, title, placement, score, players=4, playtime=60, played_at=None):
        body = {"title": title, "genre": "Strategy", "player_count": players, "player_id": "Red",
                "playtime_min": playtime, "score": score, "placement": placement}
        if played_at:
            body["played_at"] = played_at
        return s.post(f"{BASE_URL}/api/logs", json=body)

    def test_logs_validation_grouping_delete(self):
        s, u, _ = register_user("logger", subscriber=True)
        tag = uuid.uuid4().hex[:6]
        title = f"TEST_Catan {tag}"
        r = self._log(s, title, 1, 10)
        assert r.status_code == 200
        lid = r.json()["id"]
        r2 = self._log(s, f"  test_catan   {tag.upper()} ", 2, 8)
        assert r2.status_code == 200
        assert r2.json()["title"] == title and r2.json()["title_key"] == r.json()["title_key"]
        assert self._log(s, title, 5, 1, players=4).status_code == 400
        fut = (today() + timedelta(days=1)).isoformat()
        assert self._log(s, title, 1, 1, played_at=fut).status_code == 400
        old = (today() - timedelta(days=400)).isoformat()
        assert self._log(s, title, 1, 1, played_at=old).status_code == 400
        r = s.post(f"{BASE_URL}/api/logs", json={"title": title, "genre": "NotAGenre", "player_count": 4,
                                                 "player_id": "Red", "playtime_min": 10, "score": 1, "placement": 1})
        assert r.status_code == 400
        mine = s.get(f"{BASE_URL}/api/logs/me").json()
        assert len(mine) == 2
        assert s.delete(f"{BASE_URL}/api/logs/{lid}").status_code == 200
        assert s.delete(f"{BASE_URL}/api/logs/{lid}").status_code == 404
        assert len(s.get(f"{BASE_URL}/api/logs/me").json()) == 1

    def test_cannot_delete_others_log(self):
        a, _, _ = register_user("owner", subscriber=True)
        b, _, _ = register_user("intruder", subscriber=True)
        lid = self._log(a, f"TEST_Own {uuid.uuid4().hex[:6]}", 1, 1).json()["id"]
        assert b.delete(f"{BASE_URL}/api/logs/{lid}").status_code == 404

    def test_leaderboards(self):
        a, ua, _ = register_user("lba", subscriber=True)
        b, ub, _ = register_user("lbb", subscriber=True)
        tag = uuid.uuid4().hex[:6]
        g = f"TEST_Azul {tag}"
        # A: 3 plays, 2 wins; B: 2 plays, 2 wins
        for p, sc in ((1, 50), (1, 40), (3, 10)):
            assert self._log(a, g, p, sc).status_code == 200
        for p, sc in ((1, 70), (1, 60)):
            assert self._log(b, g, p, sc).status_code == 200
        key = " ".join(g.lower().split())
        d = a.get(f"{BASE_URL}/api/leaderboards", params={"game": key}).json()
        assert any(x["key"] == key and x["plays"] == 5 for x in d["games"])
        rows = {r["user_id"]: r for r in d["rows"]}
        assert set(rows) == {ua["user_id"], ub["user_id"]}
        ra, rb = rows[ua["user_id"]], rows[ub["user_id"]]
        assert ra["total_score"] == 100 and ra["wins"] == 2 and ra["podiums"] == 3 and ra["games"] == 3
        assert ra["avg_placement"] == pytest.approx(1.67, abs=0.01) and ra["win_rate"] == pytest.approx(66.7)
        assert rb["total_score"] == 130 and rb["win_rate"] == 100.0 and rb["playtime_min"] == 120
        assert "email" not in ra
        # overall
        overall = a.get(f"{BASE_URL}/api/leaderboards").json()
        assert ua["user_id"] in {r["user_id"] for r in overall["rows"]}


# ---------- Collections & members ----------
class TestCollectionsMembers:
    def test_collection_crud_and_public(self):
        s, u, _ = register_user("coll")
        r = s.post(f"{BASE_URL}/api/me/collection", json={"category": "board", "title": "TEST_Wingspan"})
        assert r.status_code == 200
        bid = r.json()["id"]
        assert s.post(f"{BASE_URL}/api/me/collection", json={"category": "card", "title": "TEST_MTG"}).status_code == 200
        assert s.post(f"{BASE_URL}/api/me/collection",
                      json={"category": "digital", "title": "TEST_Hades"}).status_code == 400
        r = s.post(f"{BASE_URL}/api/me/collection",
                   json={"category": "digital", "title": "TEST_Hades", "platform": "PC"})
        assert r.status_code == 200 and r.json()["platform"] == "PC"
        assert len(s.get(f"{BASE_URL}/api/me/collection").json()) == 3
        pub = make_session().get(f"{BASE_URL}/api/members/{u['user_id']}")
        assert pub.status_code == 200
        c = pub.json()["collection"]
        assert len(c["board"]) == 1 and len(c["card"]) == 1 and len(c["digital"]) == 1
        assert "email" not in pub.json()
        assert s.delete(f"{BASE_URL}/api/me/collection/{bid}").status_code == 200
        assert s.delete(f"{BASE_URL}/api/me/collection/{bid}").status_code == 404
        assert make_session().get(f"{BASE_URL}/api/members/{u['user_id']}").json()["collection"]["board"] == []
        members = make_session().get(f"{BASE_URL}/api/members").json()
        m = next(x for x in members if x["user_id"] == u["user_id"])
        assert m["collection_count"] == 2 and "email" not in m
        assert make_session().get(f"{BASE_URL}/api/members/user_nope").status_code == 404

    def test_profile_update(self):
        s, u, _ = register_user("prof")
        r = s.patch(f"{BASE_URL}/api/me/profile", json={"name": "TEST Renamed", "player_tag": "Meeple", "bio": "hi"})
        assert r.status_code == 200 and r.json()["name"] == "TEST Renamed"
        assert make_session().get(f"{BASE_URL}/api/members/{u['user_id']}").json()["player_tag"] == "Meeple"


# ---------- Payments (create Square link only) ----------
class TestPayments:
    @pytest.mark.parametrize("body", [
        {"product": "annual"}, {"product": "checkin"}, {"product": "donation_5"}, {"product": "donation_10"},
        {"product": "donation_20"}, {"product": "donation_50"},
        {"product": "donation_custom", "custom_amount": "7.50"}, {"product": "raffle", "quantity": 3}])
    def test_checkout_links(self, body):
        s, u, _ = register_user("pay", domain="gmail.com")
        r = s.post(f"{BASE_URL}/api/payments/checkout", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "square.link" in d["checkout_url"]
        p = mdb.payments.find_one({"checkout_id": d["checkout_id"]})
        exp = {"annual": 12000, "checkin": 500, "donation_5": 500, "donation_10": 1000, "donation_20": 2000,
               "donation_50": 5000, "donation_custom": 750, "raffle": 1500}[body["product"]]
        assert p["amount_cents"] == exp and p["currency"] == "AUD"
        st = s.get(f"{BASE_URL}/api/payments/{d['checkout_id']}")
        assert st.status_code == 200 and st.json()["status"] == "PENDING"
        # other user can't see it
        o, _, _ = register_user("payother")
        assert o.get(f"{BASE_URL}/api/payments/{d['checkout_id']}").status_code == 404

    def test_checkout_validation(self):
        s, _, _ = register_user("payval")
        assert s.post(f"{BASE_URL}/api/payments/checkout",
                      json={"product": "donation_custom", "custom_amount": "0.50"}).status_code == 400
        assert s.post(f"{BASE_URL}/api/payments/checkout",
                      json={"product": "donation_custom"}).status_code == 400
        assert s.post(f"{BASE_URL}/api/payments/checkout",
                      json={"product": "raffle", "quantity": 0}).status_code == 422
        assert s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "bogus"}).status_code == 422
        assert make_session().post(f"{BASE_URL}/api/payments/checkout",
                                   json={"product": "annual"}).status_code == 401


# ---------- PWA assets ----------
class TestPWA:
    def test_manifest_and_sw(self):
        r = make_session().get(f"{BASE_URL}/manifest.json")
        assert r.status_code == 200 and "name" in r.json()
        r = make_session().get(f"{BASE_URL}/service-worker.js")
        assert r.status_code == 200 and "html" not in r.headers.get("content-type", "")
