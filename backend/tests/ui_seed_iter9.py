# UI seed for iteration 9: `setup` creates a TEST_ non-subscriber with kid+support worker in a TEST_ guild, logs in admin; `cleanup` removes all of it
import json
import sys
import uuid
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend/tests")
from conftest import register_user, mdb, make_session, BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD  # noqa

F = "/tmp/ui_iter9.json"
if sys.argv[1] == "setup":
    s, u, email = register_user("uicas")
    yr = datetime.now().year
    k = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Kiddo", "birth_year": yr - 6}).json()
    w = s.post(f"{BASE_URL}/api/me/family", json={"name": "TEST_Helper", "kind": "support"}).json()
    gid = uuid.uuid4().hex[:12]
    mdb.guilds.insert_one({"id": gid, "name": "TEST_UIGuild", "tag": f"U{gid[:4].upper()}",
                           "created_at": datetime.now(timezone.utc).isoformat()})
    mdb.users.update_one({"user_id": u["user_id"]}, {"$addToSet": {"guild_ids": gid}})
    a = make_session()
    a.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    json.dump({"user_id": u["user_id"], "email": email, "token": s.cookies.get("session_token"), "gid": gid,
               "kid": k["id"], "worker": w["id"], "admin_token": a.cookies.get("session_token")}, open(F, "w"))
    print(json.load(open(F)))
else:
    cfg = json.load(open(F))
    q = {"user_id": cfg["user_id"]}
    for c in ("user_sessions", "game_logs", "checkins", "collections", "payments", "raffle_entries",
              "raffle_bonuses"):
        mdb[c].delete_many(q)
    mdb.login_attempts.delete_many({"email": cfg["email"].lower()})
    mdb.guilds.delete_many({"id": cfg["gid"]})
    mdb.user_sessions.delete_many({"session_token": cfg["admin_token"]})
    print(mdb.users.delete_many(q).deleted_count, "users removed")
