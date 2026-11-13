# UI test fixture helper: `python ui_fixtures.py setup` creates TEST_ users; `python ui_fixtures.py cleanup` removes them
import json
import sys
sys.path.insert(0, "/app/backend/tests")
from conftest import register_user, mdb, CREATED_USER_IDS, _delete_square_links  # noqa

F = "/tmp/ui_users.json"
if sys.argv[1] == "setup":
    out = {}
    for name, sub in (("suba", True), ("subb", True), ("nonsub", False), ("hostc", False)):
        s, u, email = register_user(name, subscriber=sub, domain="gmail.com")
        out[name] = {"email": email, "password": "testpass123", "user_id": u["user_id"]}
    json.dump(out, open(F, "w"), indent=1)
    print(json.dumps(out, indent=1))
else:
    ids = [v["user_id"] for v in json.load(open(F)).values()]
    q = {"user_id": {"$in": ids}}
    _delete_square_links([p["square_link_id"] for p in mdb.payments.find(q) if p.get("square_link_id")])
    for c in ("user_sessions", "game_logs", "checkins", "token_uses", "collections", "payments", "raffle_entries", "raffle_bonuses", "prizes"):
        mdb[c].delete_many(q)
    print(mdb.users.delete_many(q).deleted_count, "users removed")
