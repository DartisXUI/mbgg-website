# UI seed for iteration 8: `setup` creates a TEST_ subscriber + logs in admin (tokens to /tmp/ui_iter8.json); `cleanup` removes TEST_ user, its data, guilds created during test, and admin sessions created by the test
import json
import sys
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend/tests")
from conftest import register_user, mdb, make_session, BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD  # noqa

F = "/tmp/ui_iter8.json"
if sys.argv[1] == "setup":
    s, u, email = register_user("uisupp", subscriber=True)
    a = make_session()
    a.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    json.dump({"user_id": u["user_id"], "email": email, "token": s.cookies.get("session_token"),
               "admin_token": a.cookies.get("session_token"), "started": datetime.now(timezone.utc).isoformat(),
               "guilds_before": mdb.guilds.distinct("id")}, open(F, "w"))
    print(json.load(open(F)))
else:
    cfg = json.load(open(F))
    uid = cfg["user_id"]
    q = {"user_id": uid}
    for c in ("user_sessions", "game_logs", "checkins", "collections", "payments", "raffle_entries",
              "raffle_bonuses"):
        mdb[c].delete_many(q)
    mdb.login_attempts.delete_many({"email": cfg["email"].lower()})
    new_g = [g for g in mdb.guilds.distinct("id") if g not in cfg["guilds_before"]]
    mdb.guilds.delete_many({"id": {"$in": new_g}})
    mdb.users.update_many({"guild_ids": {"$in": new_g}}, {"$pull": {"guild_ids": {"$in": new_g}}})
    mdb.user_sessions.delete_many({"session_token": cfg["admin_token"]})
    print(mdb.users.delete_many(q).deleted_count, "users removed;", len(new_g), "guilds removed")
