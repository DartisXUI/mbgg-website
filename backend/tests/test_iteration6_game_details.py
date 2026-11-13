# Iteration 6: public GET /api/games/details (tap-for-details on the game strip)
import uuid
from datetime import date, timedelta

import requests

from conftest import BASE_URL, register_user, mdb

TOKEN = f"TESTGD{uuid.uuid4().hex[:6]}"
URL = f"{BASE_URL}/api/games/details"


def _log(s, title, score, placement, played_at, pc=4):
    r = s.post(f"{BASE_URL}/api/logs", json={"title": title, "genre": "Strategy", "player_count": pc,
                                             "player_id": "p1", "playtime_min": 30, "score": score,
                                             "placement": placement, "played_at": played_at})
    assert r.status_code == 200, r.text
    return r.json()


class TestGameDetails:
    @classmethod
    def setup_class(cls):
        cls.sa, cls.ua, _ = register_user("gda")
        cls.sb, cls.ub, _ = register_user("gdb")
        t = date.today()
        # user A owns two copies (board + digital) -> dedup into one owner w/ 2 copies
        for body in ({"category": "board", "title": f"{TOKEN} King Big Box"},
                     {"category": "digital", "title": f"{TOKEN} King Digital", "platform": "Nintendo Switch"}):
            r = cls.sa.post(f"{BASE_URL}/api/me/collection", json=body)
            assert r.status_code == 200, r.text
        r = cls.sb.post(f"{BASE_URL}/api/me/collection", json={"category": "card", "title": f"{TOKEN} King Cards"})
        assert r.status_code == 200
        cls.logs = []
        for i in range(12):
            s = cls.sa if i % 2 else cls.sb
            cls.logs.append(_log(s, f"{TOKEN} King Big Box", 10 + i, (i % 4) + 1, (t - timedelta(days=i)).isoformat()))
        # old log (>365 days) inserted directly; must be excluded
        mdb.game_logs.insert_one({"id": uuid.uuid4().hex, "user_id": cls.ua["user_id"], "title": f"{TOKEN} King Big Box",
                                  "title_key": f"{TOKEN} king big box".lower(), "score": 99999, "placement": 1,
                                  "player_count": 2, "playtime_min": 10, "genre": "Strategy", "player_id": "x",
                                  "played_at": (t - timedelta(days=400)).isoformat(), "created_at": "2024-01-01"})

    def test_public_no_auth_and_shape(self):
        r = requests.get(URL, params={"q": TOKEN.lower()})
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d) == {"owners", "recent", "stats"}
        assert d["stats"]["plays"] == 12
        assert d["stats"]["players"] == 2
        assert d["stats"]["top_score"] == 21  # old 99999 excluded

    def test_owners_dedup_with_copies(self):
        d = requests.get(URL, params={"q": TOKEN}).json()
        assert len(d["owners"]) == 2
        a = next(o for o in d["owners"] if o["user_id"] == self.ua["user_id"])
        assert len(a["copies"]) == 2
        assert {c["category"] for c in a["copies"]} == {"board", "digital"}
        assert any(c["platform"] == "Nintendo Switch" for c in a["copies"])
        assert "email" not in a and "password_hash" not in a
        names = [o["name"].lower() for o in d["owners"]]
        assert names == sorted(names)

    def test_recent_max10_newest_first(self):
        d = requests.get(URL, params={"q": TOKEN}).json()
        rec = d["recent"]
        assert len(rec) == 10
        dates = [x["played_at"] for x in rec]
        assert dates == sorted(dates, reverse=True)
        assert rec[0]["played_at"] == date.today().isoformat()
        for k in ("id", "user_id", "name", "title", "score", "placement", "player_count", "played_at"):
            assert k in rec[0]
        assert all(x["score"] != 99999 for x in rec)

    def test_case_insensitive_substring(self):
        d = requests.get(URL, params={"q": f"{TOKEN.upper()} KING DIG"}).json()
        assert len(d["owners"]) == 1 and d["owners"][0]["user_id"] == self.ua["user_id"]
        assert d["stats"]["plays"] == 0

    def test_short_q_422(self):
        assert requests.get(URL, params={"q": "a"}).status_code == 422
        assert requests.get(URL).status_code == 422

    def test_regex_escape(self):
        for q in ("a+b(", ".*", "[x", "\\d+"):
            r = requests.get(URL, params={"q": q})
            assert r.status_code == 200, (q, r.text)
        d = requests.get(URL, params={"q": ".*"}).json()
        # literal ".*" shouldn't match everything
        assert all(".*" in c["title"] for o in d["owners"] for c in o["copies"])

    def test_empty_result(self):
        d = requests.get(URL, params={"q": f"zz{uuid.uuid4().hex}"}).json()
        assert d == {"owners": [], "recent": [], "stats": {"plays": 0, "players": 0, "top_score": None}}

    def test_real_tile_keys(self):
        for q in ("king of", "splendor", "smash", "jackbox", "flip 7", "Soloverse", "Catan"):
            r = requests.get(URL, params={"q": q})
            assert r.status_code == 200
            d = r.json()
            for o in d["owners"]:
                assert all(q.lower() in c["title"].lower() for c in o["copies"])
            for x in d["recent"]:
                assert q.lower() in x["title"].lower()
