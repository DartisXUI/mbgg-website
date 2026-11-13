# Iteration 2 features: cash membership grant, prizes, raffle bonus, session summary, monthly stats, open logs
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from conftest import BASE_URL, mdb, register_user

TZ = ZoneInfo("Australia/Adelaide")


def today():
    return datetime.now(TZ).date()


def log_body(title, placement=1, score=10, players=4, played_at=None, pid="Red"):
    b = {"title": title, "genre": "Strategy", "player_count": players, "player_id": pid,
         "playtime_min": 45, "score": score, "placement": placement}
    if played_at:
        b["played_at"] = played_at
    return b


def make_host(admin_client, prefix="host"):
    s, u, e = register_user(prefix, domain="gmail.com")
    assert admin_client.post(f"{BASE_URL}/api/admin/users/{u['user_id']}/role", json={"role": "host"}).status_code == 200
    return s, u


# ---------- Open game log / leaderboards for every account ----------
class TestOpenLogs:
    def test_nonsub_logs_and_leaderboards(self):
        s, u, _ = register_user("opennon", domain="gmail.com")
        r = s.post(f"{BASE_URL}/api/logs", json=log_body(f"TEST_Open {uuid.uuid4().hex[:6]}"))
        assert r.status_code == 200, r.text
        assert r.json()["user_id"] == u["user_id"]
        lb = s.get(f"{BASE_URL}/api/leaderboards")
        assert lb.status_code == 200
        assert u["user_id"] in {x["user_id"] for x in lb.json()["rows"]}
        assert len(s.get(f"{BASE_URL}/api/logs/me").json()) == 1


# ---------- Cash membership grant ----------
class TestGrantMembership:
    def test_grant_extend_and_history(self, admin_client):
        s, u, _ = register_user("cash", domain="gmail.com")
        uid = u["user_id"]
        r = admin_client.post(f"{BASE_URL}/api/admin/users/{uid}/grant-membership")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_subscriber"] is True
        exp1 = datetime.fromisoformat(d["subscription_expires_at"])
        assert abs((exp1 - datetime.now(timezone.utc)).days - 365) <= 1
        assert s.get(f"{BASE_URL}/api/auth/me").json()["is_subscriber"] is True
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        cash = [p for p in dash["payments"] if p["label"] == "Annual Membership (cash at door)"]
        assert len(cash) == 1 and cash[0]["status"] == "COMPLETED" and cash[0]["amount_cents"] == 12000
        # free check-in now works for the cash member
        assert s.post(f"{BASE_URL}/api/checkin").status_code == 200
        # extend
        r2 = admin_client.post(f"{BASE_URL}/api/admin/users/{uid}/grant-membership")
        exp2 = datetime.fromisoformat(r2.json()["subscription_expires_at"])
        assert (exp2 - exp1).days == 365
        assert r2.json()["subscription_started_at"] == d["subscription_started_at"]
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert len([p for p in dash["payments"] if p["label"].endswith("(cash at door)")]) == 2

    def test_host_and_member_forbidden_404(self, admin_client):
        h, _ = make_host(admin_client, "cashhost")
        m, mu, _ = register_user("cashmem", domain="gmail.com")
        assert h.post(f"{BASE_URL}/api/admin/users/{mu['user_id']}/grant-membership").status_code == 403
        assert m.post(f"{BASE_URL}/api/admin/users/{mu['user_id']}/grant-membership").status_code == 403
        assert admin_client.post(f"{BASE_URL}/api/admin/users/nope_x/grant-membership").status_code == 404
        assert m.get(f"{BASE_URL}/api/auth/me").json()["is_subscriber"] is False


# ---------- Prize pickup tracker ----------
class TestPrizes:
    def test_prize_flow(self, admin_client):
        h, _ = make_host(admin_client, "prizehost")
        w, wu, _ = register_user("winner", domain="gmail.com")
        wid = wu["user_id"]
        r = h.post(f"{BASE_URL}/api/admin/prizes", json={"user_id": wid, "prize": "TEST_Catan box",
                                                          "event": "Xmas raffle", "won_at": "2026-08-31"})
        assert r.status_code == 200, r.text
        p1 = r.json()
        assert p1["collect_by"] == "2026-11-30" and p1["collected"] is False and "_id" not in p1
        p2 = admin_client.post(f"{BASE_URL}/api/admin/prizes", json={"user_id": wid, "prize": "TEST_Old prize",
                                                                    "won_at": "2026-01-15"}).json()
        assert p2["collect_by"] == "2026-04-15"
        p3 = admin_client.post(f"{BASE_URL}/api/admin/prizes", json={"user_id": wid, "prize": "TEST_Today"}).json()
        assert p3["won_at"] == today().isoformat()
        lst = admin_client.get(f"{BASE_URL}/api/admin/prizes").json()
        assert {p1["id"], p2["id"], p3["id"]} <= {p["id"] for p in lst}
        assert h.post(f"{BASE_URL}/api/admin/prizes/{p1['id']}/collected").status_code == 200
        mine = {p["id"]: p for p in w.get(f"{BASE_URL}/api/me/dashboard").json()["prizes"]}
        assert mine[p1["id"]]["collected"] is True and mine[p2["id"]]["collected"] is False
        assert admin_client.post(f"{BASE_URL}/api/admin/prizes/nope/collected").status_code == 404

    def test_prize_validation_and_member_403(self, admin_client):
        m, mu, _ = register_user("prizemem", domain="gmail.com")
        assert m.get(f"{BASE_URL}/api/admin/prizes").status_code == 403
        assert m.post(f"{BASE_URL}/api/admin/prizes", json={"user_id": mu["user_id"], "prize": "x"}).status_code == 403
        assert admin_client.post(f"{BASE_URL}/api/admin/prizes", json={"user_id": "nope", "prize": "x"}).status_code == 404
        assert admin_client.post(f"{BASE_URL}/api/admin/prizes",
                                 json={"user_id": mu["user_id"], "prize": "x", "won_at": "bad"}).status_code == 400
        assert admin_client.post(f"{BASE_URL}/api/admin/prizes",
                                 json={"user_id": mu["user_id"], "prize": ""}).status_code == 422


# ---------- Raffle bonus award ----------
def _seed(uid, dates, logged):
    for d in dates:
        mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "date": d, "via": "subscription",
                                 "created_at": datetime.now(timezone.utc).isoformat()})
    for d in logged:
        mdb.game_logs.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "title": "TEST_Bonus Game",
                                  "title_key": "test_bonus game", "genre": "Strategy", "player_count": 4,
                                  "player_id": "Red", "playtime_min": 30, "score": 5, "placement": 2,
                                  "played_at": d, "created_at": datetime.now(timezone.utc).isoformat()})


class TestRaffleBonus:
    def test_award_once(self):
        s, u, _ = register_user("bonusok", domain="gmail.com")
        _seed(u["user_id"], ["2026-09-05", "2026-10-10"], ["2026-09-05", "2026-10-10"])
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        bonus = [r for r in d["raffle_entries"] if r["source"] == "bonus"]
        assert len(bonus) == 3
        assert len(d["bonus"]["awarded"]) == 1 and d["bonus"]["awarded"][0]["period"] == 4
        assert d["bonus"]["awarded"][0]["raffle_year"] == 2026
        d2 = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert len([r for r in d2["raffle_entries"] if r["source"] == "bonus"]) == 3
        assert mdb.raffle_entries.count_documents({"user_id": u["user_id"], "source": "bonus"}) == 3

    def test_missing_log_no_award(self):
        s, u, _ = register_user("bonusmiss", domain="gmail.com")
        _seed(u["user_id"], ["2026-09-05", "2026-10-10"], ["2026-09-05"])
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert not [r for r in d["raffle_entries"] if r["source"] == "bonus"]
        assert d["bonus"]["awarded"] == []

    def test_no_sessions_no_award_and_current_progress(self):
        s, u, _ = register_user("bonuscur", domain="gmail.com")
        t = today()
        _seed(u["user_id"], [t.isoformat()], [])
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        cur = d["bonus"]["current"]
        assert cur["period"] == (t.month - 1) // 2 and cur["sessions"] == 1 and cur["logged_sessions"] == 0
        assert cur["missing_dates"] == [t.isoformat()] and cur["qualifies"] is False
        assert cur["raffle_year"] == (t.year + 1 if cur["period"] == 5 else t.year)
        assert s.post(f"{BASE_URL}/api/logs", json=log_body("TEST_Cur bonus")).status_code == 200
        cur = s.get(f"{BASE_URL}/api/me/dashboard").json()["bonus"]["current"]
        assert cur["qualifies"] is True and cur["missing_dates"] == []
        assert d["bonus"]["awarded"] == []  # current block not ended -> no award


# ---------- Session summary ----------
class TestSessionSummary:
    def test_summary(self, admin_client):
        a, ua, _ = register_user("sessa", domain="gmail.com")
        b, ub, _ = register_user("sessb", domain="gmail.com")
        day = (today() - timedelta(days=3)).isoformat()
        g = f"TEST_Sess {uuid.uuid4().hex[:6]}"
        _seed(ua["user_id"], [day], [])
        _seed(ub["user_id"], [day], [])
        assert a.post(f"{BASE_URL}/api/logs", json=log_body(g, 2, 30, played_at=day)).status_code == 200
        assert b.post(f"{BASE_URL}/api/logs", json=log_body(g, 1, 50, played_at=day, pid="Blue")).status_code == 200
        r = admin_client.get(f"{BASE_URL}/api/admin/sessions", params={"date": day})
        assert r.status_code == 200
        d = r.json()
        assert d["date"] == day and d["attendees"] >= 2 and d["loggers"] >= 2
        game = next(x for x in d["games"] if x["title"] == g)
        assert game["plays"] == 2 and game["players"] == 2
        assert [e["placement"] for e in game["entries"]] == [1, 2]
        assert game["entries"][0]["name"] == "TEST sessb"
        assert day in d["recent_dates"]
        h, _ = make_host(admin_client, "sesshost")
        assert h.get(f"{BASE_URL}/api/admin/sessions", params={"date": day}).status_code == 200
        assert a.get(f"{BASE_URL}/api/admin/sessions").status_code == 403


# ---------- Monthly top games ----------
class TestMonthly:
    def test_monthly(self):
        s, u, _ = register_user("monthly", domain="gmail.com")
        g = f"TEST_Monthly {uuid.uuid4().hex[:6]}"
        for _ in range(12):
            assert s.post(f"{BASE_URL}/api/logs", json=log_body(g)).status_code == 200
        r = s.get(f"{BASE_URL}/api/stats/monthly")
        assert r.status_code == 200
        months = r.json()
        assert months == sorted(months, key=lambda m: m["month"], reverse=True)
        cur = next(m for m in months if m["month"] == today().strftime("%Y-%m"))
        assert len(cur["top"]) <= 5
        plays = [t["plays"] for t in cur["top"]]
        assert plays == sorted(plays, reverse=True)
        assert cur["total_plays"] >= 12
        assert any(t["title"] == g and t["plays"] == 12 for t in cur["top"])
