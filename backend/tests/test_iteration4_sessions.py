# Iteration 4: per-session check-ins (day 10am-2pm / evening 4pm-late), second session free after paying
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from conftest import BASE_URL, mdb, register_user

TZ = ZoneInfo("Australia/Adelaide")


def slot():
    t = datetime.now(TZ)
    if t.hour < 5:
        return (t.date() - timedelta(days=1)).isoformat(), "evening"
    return t.date().isoformat(), ("day" if t.hour < 15 else "evening")


SLOT_DATE, SLOT = slot()
OTHER = "day" if SLOT == "evening" else "evening"


def insert_checkin(uid, date, session, via, family=None):
    mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "date": date, "session": session, "via": via,
                             "family": family or [], "created_at": datetime.now(timezone.utc).isoformat()})


# ---------- current slot ----------
class TestSlot:
    def test_dashboard_session(self):
        s, u, _ = register_user("slot", domain="gmail.com")
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d["today"] == SLOT_DATE
        assert d["session"]["key"] == SLOT
        assert ("4pm" in d["session"]["label"]) == (SLOT == "evening")
        assert d["second_session_free"] is False and d["checked_in_today"] is False


# ---------- non-subscriber ----------
class TestNonSubscriber:
    def test_no_paid_checkin_402_and_checkout_meta_session(self):
        s, u, _ = register_user("nonsub4", domain="gmail.com")
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 402
        r = s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin"})
        assert r.status_code == 200, r.text
        p = mdb.payments.find_one({"checkout_id": r.json()["checkout_id"]})
        assert p["meta"]["session"] == SLOT and p["meta"]["date"] == SLOT_DATE and p["amount_cents"] == 500

    def test_paid_other_session_makes_current_free(self):
        s, u, _ = register_user("paidday", domain="gmail.com")
        insert_checkin(u["user_id"], SLOT_DATE, OTHER, "paid")
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d["second_session_free"] is True and d["checked_in_today"] is False
        r = s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin"})
        assert r.status_code == 400 and "free" in r.json()["detail"].lower()
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 200, r.text
        assert r.json()["session"] == SLOT
        row = mdb.checkins.find_one({"user_id": u["user_id"], "date": SLOT_DATE, "session": SLOT})
        assert row["via"] == "paid_earlier"
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 400 and "this session" in r.json()["detail"]
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d["checked_in_today"] and d["today_checkin"]["via"] == "paid_earlier"
        # 2 check-ins on one date -> door value counts the date once
        assert d["attendance"]["door_value_cents"] == 500

    def test_paid_other_date_not_free(self):
        s, u, _ = register_user("paidyday", domain="gmail.com")
        prev = (datetime.fromisoformat(SLOT_DATE) - timedelta(days=1)).date().isoformat()
        insert_checkin(u["user_id"], prev, OTHER, "paid")
        assert s.get(f"{BASE_URL}/api/me/dashboard").json()["second_session_free"] is False
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 402

    def test_paid_earlier_doc_does_not_chain(self):
        # a 'paid_earlier' check-in must not itself make another session free
        s, u, _ = register_user("chain", domain="gmail.com")
        insert_checkin(u["user_id"], SLOT_DATE, OTHER, "paid_earlier")
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 402


# ---------- subscriber / host / admin ----------
class TestFreeEntry:
    def test_subscriber_session_unique(self):
        s, u, _ = register_user("sub4", subscriber=True, domain="gmail.com")
        mdb.users.update_one({"user_id": u["user_id"]}, {"$set": {
            "subscription_started_at": (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()}})
        insert_checkin(u["user_id"], SLOT_DATE, OTHER, "subscription")
        prev = (datetime.fromisoformat(SLOT_DATE) - timedelta(days=3)).date().isoformat()
        insert_checkin(u["user_id"], prev, "day", "subscription")
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 200, r.text
        row = mdb.checkins.find_one({"user_id": u["user_id"], "date": SLOT_DATE, "session": SLOT})
        assert row["via"] == "subscription"
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 400 and "already checked in for this session" in r.json()["detail"]
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert d["second_session_free"] is False and d["free_entry"] is True
        assert d["attendance"]["sessions"] == 3
        assert d["attendance"]["door_value_cents"] == 1000
        assert {c.get("session") for c in d["recent_checkins"] if c["date"] == SLOT_DATE} == {"day", "evening"}

    def test_host_staff_session(self, admin_client):
        s, u, _ = register_user("host4", domain="gmail.com")
        admin_client.post(f"{BASE_URL}/api/admin/users/{u['user_id']}/role", json={"role": "host"})
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 200
        row = mdb.checkins.find_one({"user_id": u["user_id"], "date": SLOT_DATE, "session": SLOT})
        assert row["via"] == "staff"
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 400


# ---------- family check-in ----------
class TestFamilySession:
    def test_family_attaches_to_current_session(self):
        s, u, _ = register_user("fam4", subscriber=True, domain="gmail.com")
        year = datetime.now(TZ).year
        kid = s.post(f"{BASE_URL}/api/me/family", json={"name": "Kiddo", "birth_year": year - 5}).json()
        insert_checkin(u["user_id"], SLOT_DATE, OTHER, "subscription")
        r = s.post(f"{BASE_URL}/api/checkin/family", json={"family_ids": [kid["id"]]})
        assert r.status_code == 400  # other session check-in does not count
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 200
        r = s.post(f"{BASE_URL}/api/checkin/family", json={"family_ids": [kid["id"]]})
        assert r.status_code == 200 and r.json()["added"] == 1
        cur = mdb.checkins.find_one({"user_id": u["user_id"], "date": SLOT_DATE, "session": SLOT})
        oth = mdb.checkins.find_one({"user_id": u["user_id"], "date": SLOT_DATE, "session": OTHER})
        assert len(cur["family"]) == 1 and oth["family"] == []


# ---------- admin roster / summary ----------
class TestAdmin:
    def test_roster_grouped(self, admin_client):
        since = datetime.now(timezone.utc).isoformat()
        s, u, _ = register_user("roster4", domain="gmail.com")
        insert_checkin(u["user_id"], SLOT_DATE, OTHER, "paid", family=[{"id": "k1", "name": "K1"}])
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 200
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        assert ac["date"] == SLOT_DATE
        assert set(ac["session_labels"]) == {"day", "evening"}
        mine = {r["session"]: r for r in ac["rows"] if r["user_id"] == u["user_id"]}
        assert mine[OTHER]["via"] == "paid" and mine[SLOT]["via"] == "paid_earlier"
        assert ac["headcount"] == sum(ac["session_headcount"].values())
        for k in ("day", "evening"):
            assert ac["session_headcount"][k] == sum(1 + len(r["family"]) for r in ac["rows"] if r["session"] == k)
        summ = admin_client.get(f"{BASE_URL}/api/admin/summary", params={"since": since}).json()
        n = [c for c in summ["new_checkins"] if c["name"] == "TEST roster4"]
        assert {c["session"] for c in n} >= {SLOT}

    def test_summary_checkins_today_matches_session_date(self, admin_client):
        # checkins_today should count the current session's date (after midnight that's yesterday's evening)
        summ = admin_client.get(f"{BASE_URL}/api/admin/summary").json()
        assert summ["checkins_today"] == mdb.checkins.count_documents({"date": SLOT_DATE})

    def test_session_summary_default_date_matches_session(self, admin_client):
        sess = admin_client.get(f"{BASE_URL}/api/admin/sessions").json()
        assert sess["date"] == SLOT_DATE


# ---------- regression: bonus / reminders de-dupe dates ----------
class TestDedupe:
    def test_bonus_and_reminders_dedupe(self):
        s, u, _ = register_user("dedupe4", subscriber=True, domain="gmail.com")
        today = datetime.now(TZ).date()
        start = datetime(today.year, ((today.month - 1) // 2) * 2 + 1, 1).date()
        past = max(start, today - timedelta(days=3))
        if past >= today:
            past = today - timedelta(days=1)
        insert_checkin(u["user_id"], past.isoformat(), "day", "subscription")
        insert_checkin(u["user_id"], past.isoformat(), "evening", "subscription")
        r = s.get(f"{BASE_URL}/api/me/reminders").json()
        assert r["unlogged_dates"].count(past.isoformat()) == 1
        d = s.get(f"{BASE_URL}/api/me/dashboard").json()
        if past >= start:
            assert d["bonus"]["current"]["sessions"] == 1
        log = {"title": "TEST_Catan", "genre": "Strategy", "player_count": 4, "player_id": "Red",
               "playtime_min": 60, "score": 10, "placement": 1, "played_at": past.isoformat()}
        assert s.post(f"{BASE_URL}/api/logs", json=log).status_code == 200
        r = s.get(f"{BASE_URL}/api/me/reminders").json()
        assert past.isoformat() not in r["unlogged_dates"]

    def test_log_during_late_evening_counts_for_session(self):
        # A game logged now (no played_at) should count for the current session's date
        s, u, _ = register_user("late4", subscriber=True, domain="gmail.com")
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 200
        log = {"title": "TEST_Catan", "genre": "Strategy", "player_count": 4, "player_id": "Red",
               "playtime_min": 60, "score": 10, "placement": 1}
        r = s.post(f"{BASE_URL}/api/logs", json=log)
        assert r.status_code == 200
        assert r.json()["played_at"] == SLOT_DATE
        assert SLOT_DATE not in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]
