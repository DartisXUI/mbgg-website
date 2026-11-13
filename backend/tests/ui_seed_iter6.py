# UI seed for iteration 6 game details: `setup` creates a TEST_ user owning Catan + Catan logs; `cleanup` removes it
import json
import sys
from datetime import date, timedelta
sys.path.insert(0, "/app/backend/tests")
from conftest import register_user, mdb, BASE_URL  # noqa

F = "/tmp/ui_iter6.json"
if sys.argv[1] == "setup":
    s, u, email = register_user("gdui")
    assert s.post(f"{BASE_URL}/api/me/collection", json={"category": "board", "title": "Catan"}).status_code == 200
    ids = []
    for i, (sc, pl) in enumerate(((42, 1), (30, 2), (55, 1))):
        r = s.post(f"{BASE_URL}/api/logs", json={"title": "Catan", "genre": "Strategy", "player_count": 4,
                                                 "player_id": "p", "playtime_min": 60, "score": sc, "placement": pl,
                                                 "played_at": (date.today() - timedelta(days=i * 3)).isoformat()})
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    json.dump({"user_id": u["user_id"], "email": email, "logs": ids}, open(F, "w"))
    print(json.load(open(F)))
else:
    uid = json.load(open(F))["user_id"]
    q = {"user_id": uid}
    for c in ("user_sessions", "game_logs", "checkins", "collections", "payments"):
        mdb[c].delete_many(q)
    print(mdb.users.delete_many(q).deleted_count, "users removed")
