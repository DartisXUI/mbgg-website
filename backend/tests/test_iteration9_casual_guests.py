# Iteration 9: casual meetup check-in (free for anyone), guild check-in with guests (family_ids), exclusion from main counts
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests

from conftest import BASE_URL, mdb, register_user

TZ = ZoneInfo("Australia/Adelaide")
CREATED_GUILDS: list = []
YEAR = datetime.now(TZ).year


def slot():
    t = datetime.now(TZ)
    if t.hour < 5:
        return (t.date() - timedelta(days=1)).isoformat(), "evening"
    return t.date().isoformat(), ("day" if t.hour < 15 else "evening")


@pytest.fixture(scope="module", autouse=True)
def guild_cleanup():
    yield
    if CREATED_GUILDS:
        mdb.guilds.delete_many({"id": {"$in": CREATED_GUILDS}})
        mdb.users.update_many({"guild_ids": {"$in": CREATED_GUILDS}}, {"$pull": {"guild_ids": {"$in": CREATED_GUILDS}}})


def add_guests(s):
    k = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Kid", "birth_year": YEAR - 7}).json()
    w = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Worker", "kind": "support"}).json()
    return k, w


def log(s, d, at_meetup=True):
    return s.post(f"{BASE_URL}/api/logs", json={"title": "TEST_CasualGame", "genre": "Strategy", "player_count": 3,
                                                "player_id": "P1", "playtime_min": 20, "score": 7,
                                                "placement": 1, "played_at": d, "at_meetup": at_meetup})


# --- Casual check-in
class TestCasual:
    def test_auth_required(self):
        assert requests.post(f"{BASE_URL}/api/checkin/casual", json={}).status_code == 401

    def test_non_subscriber_free_with_guests(self, admin_client):
        before = datetime.now(timezone.utc).isoformat()
        s, u, _ = register_user("cas")
        uid = u["user_id"]
        k, w = add_guests(s)
        r = s.post(f"{BASE_URL}/api/checkin/casual", json={"family_ids": [k["id"], w["id"]]})
        assert r.status_code == 200, r.text
        d, sess = slot()
        assert r.json()["date"] == d
        row = mdb.checkins.find_one({"user_id": uid, "via": "casual"})
        assert row["session"] == "casual" and row["date"] == d
        assert {f["name"]: f["kind"] for f in row["family"]} == {"TEST_Kid": "child", "TEST_Worker": "support"}
        # duplicate
        dup = s.post(f"{BASE_URL}/api/checkin/casual", json={})
        assert dup.status_code == 400 and "casual" in dup.json()["detail"].lower()
        # dashboard
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["casual_checkin_today"]["via"] == "casual"
        assert len(dash["casual_checkin_today"]["family"]) == 2
        assert dash["checked_in_today"] is False
        assert dash["attendance"]["sessions"] == 0 and dash["attendance"]["door_value_cents"] == 0
        assert dash["second_session_free"] is False
        assert any(c["via"] == "casual" for c in dash["recent_checkins"])
        # main session still requires pay
        assert s.post(f"{BASE_URL}/api/checkin").status_code == 402
        # admin roster
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        assert ac["session_labels"]["casual"] == "Casual meetup (unofficial)"
        assert ac["session_headcount"]["casual"] >= 3
        mine = [x for x in ac["rows"] if x["user_id"] == uid]
        assert len(mine) == 1 and mine[0]["session"] == "casual" and len(mine[0]["family"]) == 2
        assert ac["headcount"] == ac["session_headcount"]["day"] + ac["session_headcount"]["evening"]
        # summary toast feed
        sm = admin_client.get(f"{BASE_URL}/api/admin/summary", params={"since": before}).json()
        feed = [x for x in sm["new_checkins"] if x["name"] == "TEST cas"]
        assert feed and feed[0]["via"] == "casual" and feed[0]["family_count"] == 2
        main_today = mdb.checkins.count_documents({"date": d, "via": {"$nin": ["guild", "casual"]}})
        assert sm["checkins_today"] == main_today

    def test_subscriber_casual_and_main(self):
        s, u, _ = register_user("cassub", subscriber=True)
        assert s.post(f"{BASE_URL}/api/checkin/casual").status_code == 200  # no body
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 200, r.text
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["checked_in_today"] is True and dash["attendance"]["sessions"] == 1
        assert dash["attendance"]["door_value_cents"] == 500
        assert dash["casual_checkin_today"] is not None

    def test_casual_does_not_count_as_paid_earlier(self):
        s, u, _ = register_user("caspe")
        uid = u["user_id"]
        assert s.post(f"{BASE_URL}/api/checkin/casual", json={}).status_code == 200
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["second_session_free"] is False
        # simulate a paid main check-in for the other session today -> paid_earlier should still work
        d, sess = slot()
        other = "day" if sess == "evening" else "evening"
        mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "date": d, "session": other, "via": "paid",
                                 "family": [], "created_at": datetime.now(timezone.utc).isoformat()})
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["second_session_free"] is True
        r = s.post(f"{BASE_URL}/api/checkin", json={})
        assert r.status_code == 200, r.text
        assert mdb.checkins.find_one({"user_id": uid, "date": d, "session": sess})["via"] == "paid_earlier"

    def test_invalid_family(self):
        s, u, _ = register_user("casbad")
        r = s.post(f"{BASE_URL}/api/checkin/casual", json={"family_ids": ["nope"]})
        assert r.status_code == 400
        assert not mdb.checkins.find_one({"user_id": u["user_id"]})
        # aged-out child rejected
        mdb.users.update_one({"user_id": u["user_id"]}, {"$push": {"family": {"id": "oldkid", "name": "Old",
                                                                               "kind": "child", "birth_year": YEAR - 16}}})
        assert s.post(f"{BASE_URL}/api/checkin/casual", json={"family_ids": ["oldkid"]}).status_code == 400

    def test_casual_meetup_log_and_bonus(self):
        s, u, _ = register_user("caslog")
        uid = u["user_id"]
        d = slot()[0]
        assert log(s, d).status_code == 400  # no check-in yet
        assert s.post(f"{BASE_URL}/api/checkin/casual", json={}).status_code == 200
        assert d in s.get(f"{BASE_URL}/api/me/checkin-dates").json()
        assert log(s, d).status_code == 200
        # past casual date -> reminders + bonus missing_dates
        d0 = datetime.fromisoformat(d).date()
        past = (d0 - timedelta(days=2)).isoformat()
        mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "date": past, "session": "casual",
                                 "via": "casual", "family": [], "created_at": datetime.now(timezone.utc).isoformat()})
        assert past in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        if (d0.month - 1) // 2 == (datetime.fromisoformat(past).month - 1) // 2:
            assert past in dash["bonus"]["current"]["missing_dates"]
        assert log(s, past).status_code == 200
        assert past not in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]


# --- Guild check-in with guests
class TestGuildGuests:
    def test_guild_with_family(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/admin/guilds", json={"name": "TEST_GuestGuild",
                                                                     "tag": f"G{uuid.uuid4().hex[:5]}"})
        assert r.status_code == 200, r.text
        g = r.json()
        CREATED_GUILDS.append(g["id"])
        s, u, _ = register_user("gguest")
        uid = u["user_id"]
        k, w = add_guests(s)
        # non-member 403
        assert s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": g["id"], "family_ids": [k["id"]]}).status_code == 403
        admin_client.post(f"{BASE_URL}/api/admin/guilds/{g['id']}/members", json={"user_id": uid})
        assert s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": g["id"], "family_ids": ["bad"]}).status_code == 400
        r = s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": g["id"], "family_ids": [k["id"], w["id"], k["id"]]})
        assert r.status_code == 200, r.text
        row = mdb.checkins.find_one({"user_id": uid, "via": "guild"})
        assert [f["id"] for f in row["family"]] == [k["id"], w["id"]]
        # casual also allowed same day
        assert s.post(f"{BASE_URL}/api/checkin/casual", json={"family_ids": [k["id"]]}).status_code == 200
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        assert ac["session_headcount"][f"guild:{g['id']}"] == 3
        assert any(x["user_id"] == uid and x["session"] == "casual" for x in ac["rows"])
        # deleted guild label fallback uses stored guild_name
        assert admin_client.delete(f"{BASE_URL}/api/admin/guilds/{g['id']}").status_code == 200
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        assert ac["session_labels"][f"guild:{g['id']}"] == "Guild meet-up · TEST_GuestGuild"
