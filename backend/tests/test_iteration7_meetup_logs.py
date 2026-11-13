# Iteration 7: game logs played anywhere vs at IRL meetup; bonus/reminders/session summary use only meetup logs
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from conftest import BASE_URL, mdb, register_user

TZ = ZoneInfo("Australia/Adelaide")


def slot_date():
    t = datetime.now(TZ)
    return (t.date() - timedelta(days=1)) if t.hour < 5 else t.date()


def add_checkin(uid, d, session="day"):
    mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "date": d, "session": session,
                             "via": "staff", "family": [], "created_at": datetime.now(timezone.utc).isoformat()})


def log(s, title, d, at_meetup=None, score=10):
    body = {"title": title, "genre": "Strategy", "player_count": 4, "player_id": "P1", "playtime_min": 30,
            "score": score, "placement": 1, "played_at": d}
    if at_meetup is not None:
        body["at_meetup"] = at_meetup
    return s.post(f"{BASE_URL}/api/logs", json=body)


@pytest.fixture(scope="module")
def user():
    s, u, _ = register_user("meet")
    return s, u


@pytest.fixture(scope="module")
def title():
    return f"TEST_Game_{uuid.uuid4().hex[:6]}"


# --- POST /api/logs at_meetup validation
class TestCreateLog:
    def test_anywhere_default_no_checkin(self, user, title):
        s, _ = user
        d = (slot_date() - timedelta(days=100)).isoformat()
        r = log(s, title, d)
        assert r.status_code == 200, r.text
        assert r.json()["at_meetup"] is False and r.json()["played_at"] == d
        mine = s.get(f"{BASE_URL}/api/logs/me").json()
        assert any(x["id"] == r.json()["id"] and x["at_meetup"] is False for x in mine)

    def test_anywhere_explicit_false_old_date(self, user, title):
        r = log(user[0], title, (slot_date() - timedelta(days=360)).isoformat(), at_meetup=False)
        assert r.status_code == 200, r.text

    def test_meetup_without_checkin_400(self, user, title):
        r = log(user[0], title, (slot_date() - timedelta(days=3)).isoformat(), at_meetup=True)
        assert r.status_code == 400
        assert "checked in" in r.json()["detail"].lower()

    def test_meetup_with_checkin_ok(self, user, title):
        s, u = user
        d = (slot_date() - timedelta(days=20)).isoformat()
        add_checkin(u["user_id"], d)
        r = log(s, title, d, at_meetup=True)
        assert r.status_code == 200, r.text
        assert r.json()["at_meetup"] is True

    def test_out_of_range_dates(self, user, title):
        assert log(user[0], title, (slot_date() - timedelta(days=400)).isoformat()).status_code == 400
        assert log(user[0], title, (datetime.now(TZ).date() + timedelta(days=2)).isoformat()).status_code == 400

    def test_bad_type_422(self, user, title):
        r = log(user[0], title, slot_date().isoformat(), at_meetup="maybe")
        assert r.status_code == 422


# --- GET /api/me/checkin-dates
class TestCheckinDates:
    def test_distinct_dates(self):
        s, u, _ = register_user("cdates")
        uid = u["user_id"]
        d1 = (slot_date() - timedelta(days=5)).isoformat()
        d2 = (slot_date() - timedelta(days=40)).isoformat()
        old = (slot_date() - timedelta(days=400)).isoformat()
        add_checkin(uid, d1, "day")
        add_checkin(uid, d1, "evening")
        add_checkin(uid, d2)
        add_checkin(uid, old)
        r = s.get(f"{BASE_URL}/api/me/checkin-dates")
        assert r.status_code == 200
        assert r.json() == sorted([d1, d2])

    def test_requires_auth(self):
        import requests
        assert requests.get(f"{BASE_URL}/api/me/checkin-dates").status_code == 401


# --- Bonus (past block Sep-Oct 2026), reminders, session summary, leaderboards/monthly stats
class TestBonusAndReminders:
    def test_past_block_bonus_only_meetup_logs(self):
        today = datetime.now(TZ).date()
        if not (today.year == 2026 and today.month in (11, 12)):
            pytest.skip("Fixed-date test assumes Nov-Dec 2026")
        s, u, _ = register_user("bonus")
        uid = u["user_id"]
        t = f"TEST_Bonus_{uuid.uuid4().hex[:6]}"
        for d in ("2026-09-05", "2026-10-10"):
            add_checkin(uid, d)
            assert log(s, t, d, at_meetup=False).status_code == 200
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["bonus"]["awarded"] == []
        assert mdb.raffle_bonuses.count_documents({"user_id": uid}) == 0
        # one meetup log -> still missing 10-10
        assert log(s, t, "2026-09-05", at_meetup=True).status_code == 200
        s.get(f"{BASE_URL}/api/me/dashboard")
        assert mdb.raffle_bonuses.count_documents({"user_id": uid}) == 0
        assert log(s, t, "2026-10-10", at_meetup=True).status_code == 200
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert len(dash["bonus"]["awarded"]) == 1
        b = dash["bonus"]["awarded"][0]
        assert b["year"] == 2026 and b["period"] == 4 and b["entries"] == 3
        assert mdb.raffle_entries.count_documents({"user_id": uid, "source": "bonus"}) == 3

    def test_current_block_progress_and_reminders(self):
        s, u, _ = register_user("remind")
        uid = u["user_id"]
        t = f"TEST_Rem_{uuid.uuid4().hex[:6]}"
        sd = slot_date()
        d = (sd - timedelta(days=2)).isoformat()
        add_checkin(uid, d)
        assert log(s, t, d, at_meetup=False).status_code == 200
        assert d in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d in dash["unlogged_dates"]
        same_block = (sd.month - 1) // 2 == (datetime.fromisoformat(d).month - 1) // 2
        if same_block:
            assert d in dash["bonus"]["current"]["missing_dates"]
            assert dash["bonus"]["current"]["qualifies"] is False
        assert log(s, t, d, at_meetup=True).status_code == 200
        assert d not in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d not in dash["unlogged_dates"]
        if same_block:
            assert dash["bonus"]["current"]["missing_dates"] == []
            assert dash["bonus"]["current"]["qualifies"] is True

    def test_session_summary_only_meetup(self, admin_client):
        s, u, _ = register_user("sess")
        uid = u["user_id"]
        t = f"TEST_Sess_{uuid.uuid4().hex[:6]}"
        d = (slot_date() - timedelta(days=9)).isoformat()
        add_checkin(uid, d)
        a = log(s, t, d, at_meetup=False).json()["id"]
        m = log(s, t, d, at_meetup=True).json()["id"]
        r = admin_client.get(f"{BASE_URL}/api/admin/sessions", params={"date": d})
        assert r.status_code == 200, r.text
        ids = [e["id"] for g in r.json()["games"] for e in g["entries"]] if "games" in r.json() else \
              [e["id"] for g in r.json().get("top", r.json().get("rows", [])) for e in g.get("entries", [])]
        assert m in ids and a not in ids, r.json().keys()

    def test_leaderboard_and_monthly_include_both(self):
        s, u, _ = register_user("lb")
        uid = u["user_id"]
        t = f"TEST_Lb_{uuid.uuid4().hex[:6]}"
        sd = slot_date()
        d = (sd - timedelta(days=1)).isoformat()
        add_checkin(uid, d)
        assert log(s, t, d, at_meetup=True, score=7).status_code == 200
        assert log(s, t, d, at_meetup=False, score=5).status_code == 200
        key = " ".join(t.lower().split())
        lb = s.get(f"{BASE_URL}/api/leaderboards", params={"game": key}).json()
        row = next(r for r in lb["rows"] if r["user_id"] == uid)
        assert row["games"] == 2 and row["total_score"] == 12
        assert any(g["key"] == key and g["plays"] == 2 for g in lb["games"])
        monthly = s.get(f"{BASE_URL}/api/stats/monthly").json()
        m = next(x for x in monthly if x["month"] == d[:7])
        assert m["total_plays"] >= 2
