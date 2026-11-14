# Iteration 8: support workers (family kind=support), guilds admin, guild check-in, guild leaderboard, member guild chips
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests

from conftest import BASE_URL, mdb, register_user

TZ = ZoneInfo("Australia/Adelaide")
CREATED_GUILDS: list = []


def slot():
    t = datetime.now(TZ)
    if t.hour < 5:
        return (t.date() - timedelta(days=1)).isoformat(), "evening"
    return t.date().isoformat(), ("day" if t.hour < 15 else "evening")


def staff_user(role="host", subscriber=False):
    s, u, e = register_user(role, subscriber=subscriber)
    mdb.users.update_one({"user_id": u["user_id"]}, {"$set": {"role": role}})
    return s, u


@pytest.fixture(scope="module", autouse=True)
def guild_cleanup():
    yield
    if CREATED_GUILDS:
        mdb.guilds.delete_many({"id": {"$in": CREATED_GUILDS}})
        mdb.users.update_many({"guild_ids": {"$in": CREATED_GUILDS}}, {"$pull": {"guild_ids": {"$in": CREATED_GUILDS}}})


def mk_guild(s, name=None, tag=None):
    tag = tag or f"T{uuid.uuid4().hex[:6]}"
    r = s.post(f"{BASE_URL}/api/admin/guilds", json={"name": name or f"TEST_Guild_{tag}", "tag": tag})
    if r.status_code == 200:
        CREATED_GUILDS.append(r.json()["id"])
    return r


def log(s, d, score, at_meetup=False, title="TEST_GuildGame"):
    return s.post(f"{BASE_URL}/api/logs", json={"title": title, "genre": "Strategy", "player_count": 4,
                                                "player_id": "P1", "playtime_min": 30, "score": score,
                                                "placement": 1, "played_at": d, "at_meetup": at_meetup})


# --- Support workers
class TestSupportWorkers:
    def test_support_no_birth_year_and_child_rules(self):
        s, u, _ = register_user("supp", subscriber=True)
        r = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Worker A", "kind": "support"})
        assert r.status_code == 200, r.text
        assert r.json()["kind"] == "support" and r.json()["birth_year"] is None
        assert s.post(f"{BASE_URL}/api/me/family", json={"name": "Kid", "kind": "child"}).status_code == 400
        assert s.post(f"{BASE_URL}/api/me/family", json={"name": "Kid"}).status_code == 400
        old = datetime.now(TZ).year - 20
        assert s.post(f"{BASE_URL}/api/me/family", json={"name": "Old", "birth_year": old}).status_code == 400
        k = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Kid", "birth_year": datetime.now(TZ).year - 5})
        assert k.status_code == 200 and k.json()["kind"] == "child"
        assert s.post(f"{BASE_URL}/api/me/family", json={"name": "x", "kind": "pet"}).status_code == 422
        fam = s.get(f"{BASE_URL}/api/me/dashboard").json()["user"]["family"]
        assert {f["kind"] for f in fam} == {"support", "child"}

    def test_max_10_per_kind(self):
        s, u, _ = register_user("supmax")
        for i in range(10):
            assert s.post(f"{BASE_URL}/api/me/family", json={"name": f"W{i}", "kind": "support"}).status_code == 200
        r = s.post(f"{BASE_URL}/api/me/family", json={"name": "W11", "kind": "support"})
        assert r.status_code == 400
        # child slots unaffected
        r = s.post(f"{BASE_URL}/api/me/family", json={"name": "K", "birth_year": datetime.now(TZ).year - 3})
        assert r.status_code == 200

    def test_checkin_with_support_and_roster(self, admin_client):
        s, u, _ = register_user("supci", subscriber=True)
        w = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Sam Support", "kind": "support"}).json()
        k = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Kiddo", "birth_year": datetime.now(TZ).year - 6}).json()
        r = s.post(f"{BASE_URL}/api/checkin", json={"family_ids": [w["id"], k["id"]]})
        assert r.status_code == 200, r.text
        d, sess = slot()
        row = mdb.checkins.find_one({"user_id": u["user_id"], "date": d, "session": sess})
        kinds = {f["name"]: f["kind"] for f in row["family"]}
        assert kinds == {"TEST_Sam Support": "support", "TEST_Kiddo": "child"}
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        mine = [x for x in ac["rows"] if x["user_id"] == u["user_id"]]
        assert len(mine) == 1 and len(mine[0]["family"]) == 2
        assert ac["session_headcount"][sess] >= 3

    def test_delete_support_worker(self):
        s, u, _ = register_user("supdel")
        w = s.post(f"{BASE_URL}/api/me/family", json={"name": "W", "kind": "support"}).json()
        assert s.delete(f"{BASE_URL}/api/me/family/{w['id']}").status_code == 200
        assert s.delete(f"{BASE_URL}/api/me/family/{w['id']}").status_code == 404


# --- Guild admin CRUD + permissions
class TestGuildAdmin:
    def test_create_tag_upper_and_dup(self):
        hs, _ = staff_user("host")
        tag = f"dup{uuid.uuid4().hex[:4]}"
        r = mk_guild(hs, tag=tag)
        assert r.status_code == 200, r.text
        assert r.json()["tag"] == tag.upper()
        assert mk_guild(hs, tag=tag.upper()).status_code == 409
        assert mk_guild(hs, tag=f"  {tag} ").status_code == 409
        assert hs.post(f"{BASE_URL}/api/admin/guilds", json={"name": "  ", "tag": "X"}).status_code == 400
        lst = requests.get(f"{BASE_URL}/api/guilds").json()
        assert any(g["id"] == r.json()["id"] and g["members"] == [] for g in lst)

    def test_member_cannot_create(self):
        s, _, _ = register_user("nostaff")
        assert mk_guild(s).status_code == 403
        assert requests.post(f"{BASE_URL}/api/admin/guilds", json={"name": "a", "tag": "b"}).status_code == 401

    def test_members_add_remove_delete(self, admin_client):
        hs, _ = staff_user("host")
        _, m, _ = register_user("gmem")
        gid = mk_guild(hs).json()["id"]
        assert hs.post(f"{BASE_URL}/api/admin/guilds/{gid}/members", json={"user_id": m["user_id"]}).status_code == 200
        assert hs.post(f"{BASE_URL}/api/admin/guilds/{gid}/members", json={"user_id": m["user_id"]}).status_code == 200
        assert hs.post(f"{BASE_URL}/api/admin/guilds/{gid}/members", json={"user_id": "nope"}).status_code == 404
        assert hs.post(f"{BASE_URL}/api/admin/guilds/badgid/members", json={"user_id": m["user_id"]}).status_code == 404
        g = next(x for x in requests.get(f"{BASE_URL}/api/guilds").json() if x["id"] == gid)
        assert [x["user_id"] for x in g["members"]] == [m["user_id"]]
        assert hs.delete(f"{BASE_URL}/api/admin/guilds/{gid}/members/{m['user_id']}").status_code == 200
        g = next(x for x in requests.get(f"{BASE_URL}/api/guilds").json() if x["id"] == gid)
        assert g["members"] == []
        hs.post(f"{BASE_URL}/api/admin/guilds/{gid}/members", json={"user_id": m["user_id"]})
        assert hs.delete(f"{BASE_URL}/api/admin/guilds/{gid}").status_code == 403
        assert admin_client.delete(f"{BASE_URL}/api/admin/guilds/{gid}").status_code == 200
        assert admin_client.delete(f"{BASE_URL}/api/admin/guilds/{gid}").status_code == 404
        assert gid not in mdb.users.find_one({"user_id": m["user_id"]}).get("guild_ids", [])
        assert all(x["id"] != gid for x in requests.get(f"{BASE_URL}/api/guilds").json())


# --- Guild check-in
class TestGuildCheckin:
    def test_guild_checkin_flow(self, admin_client):
        hs, _ = staff_user("host")
        s, u, _ = register_user("gci")  # non-subscriber member
        uid = u["user_id"]
        g = mk_guild(hs, name="TEST_Dragons").json()
        other = mk_guild(hs).json()
        hs.post(f"{BASE_URL}/api/admin/guilds/{g['id']}/members", json={"user_id": uid})
        # non-member of `other`
        r = s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": other["id"]})
        assert r.status_code == 403
        assert s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": "nope"}).status_code == 404
        r = s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": g["id"]})
        assert r.status_code == 200, r.text
        d, sess = slot()
        assert r.json()["date"] == d
        assert s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": g["id"]}).status_code == 400
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["checked_in_today"] is False
        assert dash["guild_checkins_today"] == [g["id"]]
        assert [x["id"] for x in dash["guilds"]] == [g["id"]]
        assert dash["attendance"]["sessions"] == 0 and dash["attendance"]["door_value_cents"] == 0
        assert dash["second_session_free"] is False
        # main check-in still requires payment for non-subscriber
        assert s.post(f"{BASE_URL}/api/checkin").status_code == 402
        # admin roster group
        ac = admin_client.get(f"{BASE_URL}/api/admin/checkins").json()
        key = f"guild:{g['id']}"
        assert ac["session_labels"][key] == "Guild meet-up · TEST_Dragons"
        assert ac["session_headcount"][key] == 1
        assert any(x["user_id"] == uid and x["session"] == key and x["via"] == "guild" for x in ac["rows"])
        # meetup log enabled for that date
        assert d in s.get(f"{BASE_URL}/api/me/checkin-dates").json()
        lr = log(s, d, 5, at_meetup=True)
        assert lr.status_code == 200, lr.text

    def test_guild_checkin_with_main_subscriber(self):
        hs, _ = staff_user("host")
        s, u, _ = register_user("gcisub", subscriber=True)
        g = mk_guild(hs).json()
        hs.post(f"{BASE_URL}/api/admin/guilds/{g['id']}/members", json={"user_id": u["user_id"]})
        assert s.post(f"{BASE_URL}/api/checkin").status_code == 200
        assert s.post(f"{BASE_URL}/api/checkin/guild", json={"guild_id": g["id"]}).status_code == 200
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        assert dash["checked_in_today"] is True and dash["attendance"]["sessions"] == 1

    def test_guild_checkin_counts_for_bonus_and_reminders(self):
        hs, _ = staff_user("host")
        s, u, _ = register_user("gbonus")
        uid = u["user_id"]
        g = mk_guild(hs).json()
        hs.post(f"{BASE_URL}/api/admin/guilds/{g['id']}/members", json={"user_id": uid})
        d0 = datetime.fromisoformat(slot()[0]).date()
        d = (d0 - timedelta(days=2)).isoformat()
        mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "date": d, "session": f"guild:{g['id']}",
                                 "via": "guild", "guild_id": g["id"], "guild_name": g["name"], "family": [],
                                 "created_at": datetime.now(timezone.utc).isoformat()})
        assert d in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]
        dash = s.get(f"{BASE_URL}/api/me/dashboard").json()
        same_block = (d0.month - 1) // 2 == (datetime.fromisoformat(d).month - 1) // 2
        if same_block:
            assert d in dash["bonus"]["current"]["missing_dates"]
        assert log(s, d, 3, at_meetup=True).status_code == 200
        assert d not in s.get(f"{BASE_URL}/api/me/reminders").json()["unlogged_dates"]
        if same_block:
            assert s.get(f"{BASE_URL}/api/me/dashboard").json()["bonus"]["current"]["qualifies"] is True


# --- Guild leaderboard + member chips
class TestGuildLeaderboard:
    def test_leaderboard_totals(self):
        hs, _ = staff_user("host")
        s1, u1, _ = register_user("glb1")
        s2, u2, _ = register_user("glb2")
        ga = mk_guild(hs, name="TEST_A").json()
        gb = mk_guild(hs, name="TEST_B").json()
        for gid, uid in ((ga["id"], u1["user_id"]), (ga["id"], u2["user_id"]), (gb["id"], u2["user_id"])):
            hs.post(f"{BASE_URL}/api/admin/guilds/{gid}/members", json={"user_id": uid})
        d = slot()[0]
        assert log(s1, d, 1000000).status_code == 200
        assert log(s2, d, 2000000).status_code == 200
        old = (datetime.fromisoformat(d).date() - timedelta(days=364)).isoformat()
        assert log(s2, old, 1).status_code == 200
        r = s1.get(f"{BASE_URL}/api/leaderboards/guilds")
        assert r.status_code == 200
        rows = {x["id"]: x for x in r.json()["rows"]}
        assert rows[ga["id"]]["total_score"] == 3000001 and rows[ga["id"]]["members"] == 2
        assert rows[ga["id"]]["games"] == 3
        assert rows[gb["id"]]["total_score"] == 2000001
        assert rows[ga["id"]]["top_player"] == "TEST glb2"
        order = [x["id"] for x in r.json()["rows"]]
        assert order.index(ga["id"]) < order.index(gb["id"])
        assert requests.get(f"{BASE_URL}/api/leaderboards/guilds").status_code == 401
        # members + profile
        mem = {m["user_id"]: m for m in requests.get(f"{BASE_URL}/api/members").json()}
        assert {g["tag"] for g in mem[u2["user_id"]]["guilds"]} == {ga["tag"], gb["tag"]}
        assert "guild_ids" not in mem[u2["user_id"]] and "email" not in mem[u2["user_id"]]
        p = requests.get(f"{BASE_URL}/api/members/{u1['user_id']}").json()
        assert [g["id"] for g in p["guilds"]] == [ga["id"]]
