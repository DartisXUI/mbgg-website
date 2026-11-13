# Iteration 3: family under-15, free staff check-in, family check-in, staff alerts, quarterly prize, reminders
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from conftest import BASE_URL, mdb, register_user, CREATED_USER_IDS, make_session

TZ = ZoneInfo("Australia/Adelaide")
TODAY = datetime.now(TZ).date()
YEAR = TODAY.year


def log_payload(played_at, score=10, title="TEST_Catan"):
    return {"title": title, "genre": "Strategy", "player_count": 4, "player_id": "Red", "playtime_min": 60,
            "score": score, "placement": 1, "played_at": played_at}


# ---------- Family members (under 15) ----------
class TestFamily:
    def test_add_list_validate_delete(self):
        s, u, _ = register_user("fam", domain="gmail.com")
        r = s.post(f"{BASE_URL}/api/me/family", json={"name": "Kid A", "birth_year": YEAR - 5})
        assert r.status_code == 200, r.text
        f = r.json()
        assert f["name"] == "Kid A" and f["birth_year"] == YEAR - 5 and isinstance(f["id"], str)
        me = s.get(f"{BASE_URL}/api/auth/me").json()
        assert [x["id"] for x in me["family"]] == [f["id"]]
        # boundary: 14 ok, 15 rejected, future rejected
        assert s.post(f"{BASE_URL}/api/me/family", json={"name": "Kid14", "birth_year": YEAR - 14}).status_code == 200
        r15 = s.post(f"{BASE_URL}/api/me/family", json={"name": "Kid15", "birth_year": YEAR - 15})
        assert r15.status_code == 400 and "under 15" in r15.json()["detail"]
        assert s.post(f"{BASE_URL}/api/me/family", json={"name": "Future", "birth_year": YEAR + 1}).status_code == 400
        # delete
        assert s.delete(f"{BASE_URL}/api/me/family/{f['id']}").status_code == 200
        assert s.delete(f"{BASE_URL}/api/me/family/{f['id']}").status_code == 404
        me = s.get(f"{BASE_URL}/api/auth/me").json()
        assert f["id"] not in [x["id"] for x in me["family"]]

    def test_max_ten(self):
        s, u, _ = register_user("fammax", domain="gmail.com")
        for i in range(10):
            assert s.post(f"{BASE_URL}/api/me/family", json={"name": f"K{i}", "birth_year": YEAR - 3}).status_code == 200
        r = s.post(f"{BASE_URL}/api/me/family", json={"name": "K11", "birth_year": YEAR - 3})
        assert r.status_code == 400

    def test_unauth(self):
        assert make_session().post(f"{BASE_URL}/api/me/family", json={"name": "x", "birth_year": YEAR - 3}).status_code == 401


# ---------- Check-in with family ----------
class TestCheckinFamily:
    def test_subscriber_checkin_with_family_and_add_later(self, admin_client):
        since = datetime.now(timezone.utc).isoformat()
        s, u, _ = register_user("subfam", subscriber=True, domain="gmail.com")
        k1 = s.post(f"{BASE_URL}/api/me/family", json={"name": "Alice", "birth_year": YEAR - 6}).json()
        k2 = s.post(f"{BASE_URL}/api/me/family", json={"name": "Bob", "birth_year": YEAR - 9}).json()
        # family-only before self check-in -> 400
        r = s.post(f"{BASE_URL}/api/checkin/family", json={"family_ids": [k1["id"]]})
        assert r.status_code == 400 and "first" in r.json()["detail"].lower()
        r = s.post(f"{BASE_URL}/api/checkin", json={"family_ids": [k1["id"]]})
        assert r.status_code == 200, r.text
        row = mdb.checkins.find_one({"user_id": u["user_id"], "date": TODAY.isoformat()})
        assert row["via"] == "subscription" and [f["name"] for f in row["family"]] == ["Alice"]
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["checked_in_today"] and dash["free_entry"] and len(dash["today_checkin"]["family"]) == 1
        # add remaining kid (and duplicate is ignored)
        r = s.post(f"{BASE_URL}/api/checkin/family", json={"family_ids": [k1["id"], k2["id"]]})
        assert r.status_code == 200 and r.json()["added"] == 1
        assert s.post(f"{BASE_URL}/api/checkin/family", json={"family_ids": []}).status_code == 400
        assert s.post(f"{BASE_URL}/api/checkin/family", json={"family_ids": ["nope"]}).status_code == 400
        # duplicate self check-in
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 400
        # admin roster counts kids
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        mine = [x for x in ac["rows"] if x["user_id"] == u["user_id"]][0]
        assert sorted(f["name"] for f in mine["family"]) == ["Alice", "Bob"]
        assert ac["headcount"] == sum(1 + len(x["family"]) for x in ac["rows"])
        # staff alert feed
        summ = admin_client.get(f"{BASE_URL}/api/admin/summary", params={"since": since}).json()
        n = [c for c in summ["new_checkins"] if c["name"] == "TEST subfam"]
        assert n and n[0]["family_count"] == 2 and n[0]["via"] == "subscription"  # current family count
        assert summ["checkins_today"] >= 1 and summ["latest_checkin_at"]
        # session summary attendees includes kids
        sess = admin_client.get(f"{BASE_URL}/api/admin/sessions").json()
        assert sess["attendees"] == ac["headcount"]

    def test_15plus_family_rejected_on_checkin(self):
        s, u, _ = register_user("old", subscriber=True, domain="gmail.com")
        mdb.users.update_one({"user_id": u["user_id"]},
                             {"$push": {"family": {"id": "oldkid", "name": "Teen", "birth_year": YEAR - 16}}})
        r = s.post(f"{BASE_URL}/api/checkin", json={"family_ids": ["oldkid"]})
        assert r.status_code == 400 and "15 or older" in r.json()["detail"]

    def test_host_free_checkin_and_checkout_blocked(self, admin_client):
        s, u, _ = register_user("host", domain="gmail.com")
        r = admin_client.post(f"{BASE_URL}/api/admin/users/{u['user_id']}/role", json={"role": "host"})
        assert r.status_code == 200
        r = s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin"})
        assert r.status_code == 400 and "free" in r.json()["detail"].lower()
        kid = s.post(f"{BASE_URL}/api/me/family", json={"name": "HostKid", "birth_year": YEAR - 2}).json()
        r = s.post(f"{BASE_URL}/api/checkin", json={"family_ids": [kid["id"]]})
        assert r.status_code == 200, r.text
        row = mdb.checkins.find_one({"user_id": u["user_id"], "date": TODAY.isoformat()})
        assert row["via"] == "staff" and len(row["family"]) == 1
        assert s.get(f"{BASE_URL}/api/me/dashboard").json()["free_entry"] is True

    def test_admin_checkout_checkin_blocked(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin"})
        assert r.status_code == 400

    def test_nonsub_checkin_requires_payment_with_family_meta(self):
        s, u, _ = register_user("nonsubfam", domain="gmail.com")
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 402
        kid = s.post(f"{BASE_URL}/api/me/family", json={"name": "PayKid", "birth_year": YEAR - 4}).json()
        r = s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin", "family_ids": [kid["id"]]})
        assert r.status_code == 200, r.text
        assert r.json()["checkout_url"].startswith("https://")
        p = mdb.payments.find_one({"checkout_id": r.json()["checkout_id"]})
        assert p["amount_cents"] == 500 and p["meta"]["family"] == [{"id": kid["id"], "name": "PayKid"}]
        # same request reuses pending link
        r2 = s.post(f"{BASE_URL}/api/payments/checkout", json={"product": "checkin", "family_ids": [kid["id"]]})
        assert r2.json()["checkout_id"] == r.json()["checkout_id"]

    def test_summary_requires_staff(self):
        s, u, _ = register_user("nostaff", domain="gmail.com")
        assert s.get(f"{BASE_URL}/api/admin/summary").status_code == 403


# ---------- Quarterly subscriber prize ----------
class TestQuarterly:
    def test_auto_award_and_no_duplicates(self, admin_client):
        mdb.quarter_awards.delete_many({})  # test-only collection per main agent
        s, u, _ = register_user("qsub", domain="gmail.com")
        mdb.users.update_one({"user_id": u["user_id"]}, {"$set": {
            "subscription_started_at": "2026-01-01T00:00:00+00:00",
            "subscription_expires_at": "2027-06-01T00:00:00+00:00"}})
        n, nu, _ = register_user("qnon", domain="gmail.com")
        for d, sc in (("2026-02-10", 50000), ("2026-08-01", 25000), (TODAY.isoformat(), 5)):
            assert s.post(f"{BASE_URL}/api/logs", json=log_payload(d, sc)).status_code == 200
        assert n.post(f"{BASE_URL}/api/logs", json=log_payload("2026-08-01", 9000000)).status_code == 200
        r = s.get(f"{BASE_URL}/api/leaderboards/quarterly")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["year"] == YEAR and d["quarter"] == (TODAY.month - 1) // 3 + 1
        ids = [x["user_id"] for x in d["standings"]]
        assert u["user_id"] in ids and nu["user_id"] not in ids
        me = [x for x in d["standings"] if x["user_id"] == u["user_id"]][0]
        assert me["total_score"] == 75005 and me["games"] == 3
        labels = {w["label"]: w for w in d["winners"]}
        assert labels["Q1 2026"]["total_score"] == 50000 and labels["Q1 2026"]["winner_user_id"] == u["user_id"]
        assert labels["Q2 2026"]["total_score"] == 50000
        assert labels["Q3 2026"]["total_score"] == 75000
        prize = list(mdb.prizes.find({"user_id": u["user_id"], "prize": "Top subscriber score prize · Q3 2026"}))
        assert len(prize) == 1 and prize[0]["won_at"] == "2026-10-01" and prize[0]["collect_by"] == "2027-01-01"
        assert not mdb.prizes.find_one({"user_id": nu["user_id"]})
        # idempotent
        s.get(f"{BASE_URL}/api/leaderboards/quarterly")
        assert mdb.quarter_awards.count_documents({"year": 2026, "quarter": 3}) == 1
        assert mdb.prizes.count_documents({"user_id": u["user_id"]}) == 3
        # winner sees prize on dashboard
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert any("Q3 2026" in p["prize"] for p in dash["prizes"])
        # admin prizes list includes it
        assert any(p["user_id"] == u["user_id"] for p in admin_client.get(f"{BASE_URL}/api/admin/prizes").json())


# ---------- Bonus reminder nudge ----------
class TestReminders:
    def test_unlogged_checkin_reminder(self):
        s, u, _ = register_user("remind", domain="gmail.com")
        d3 = (TODAY - timedelta(days=3)).isoformat()
        d20 = (TODAY - timedelta(days=20)).isoformat()
        for d in (d3, d20, TODAY.isoformat()):
            mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": u["user_id"], "date": d, "via": "paid",
                                     "family": [], "created_at": "2000-01-01T00:00:00+00:00"})
        r = s.get(f"{BASE_URL}/api/me/reminders")
        assert r.status_code == 200 and r.json()["unlogged_dates"] == [d3]
        assert s.get(f"{BASE_URL}/api/me/dashboard").json()["unlogged_dates"] == [d3]
        assert s.post(f"{BASE_URL}/api/logs", json=log_payload(d3)).status_code == 200
        assert s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"] == []

    def test_reminders_unauth(self):
        assert make_session().get(f"{BASE_URL}/api/me/reminders").status_code == 401


# ---------- Regression ----------
class TestRegression:
    def test_token_leaderboard_grant(self, admin_client):
        s, u, _ = register_user("reg", domain="gmail.com")
        assert s.post(f"{BASE_URL}/api/token/use", json={"game": "X"}).status_code == 403
        r = admin_client.post(f"{BASE_URL}/api/admin/users/{u['user_id']}/grant-membership")
        assert r.status_code == 200 and r.json()["is_subscriber"]
        assert s.post(f"{BASE_URL}/api/checkin", json={}).status_code == 200
        assert s.post(f"{BASE_URL}/api/token/use", json={"game": "TEST_Game"}).status_code == 200
        assert s.post(f"{BASE_URL}/api/logs", json=log_payload(TODAY.isoformat(), 7)).status_code == 200
        lb = s.get(f"{BASE_URL}/api/leaderboards").json()
        assert any(r["user_id"] == u["user_id"] for r in lb["rows"])
        alerts = admin_client.get(f"{BASE_URL}/api/admin/token-alerts").json()
        a = [x for x in alerts if x["user_id"] == u["user_id"]][0]
        assert admin_client.post(f"{BASE_URL}/api/admin/token-alerts/{a['id']}/ack").status_code == 200
