# UI seed for iteration 7 meetup/anywhere logs: `setup` creates a TEST_ user with a check-in 3 days ago; `cleanup` removes it
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
sys.path.insert(0, "/app/backend/tests")
from conftest import register_user, mdb  # noqa

F = "/tmp/ui_iter7.json"
if sys.argv[1] == "setup":
    s, u, email = register_user("meetui")
    t = datetime.now(ZoneInfo("Australia/Adelaide"))
    sd = (t.date() - timedelta(days=1)) if t.hour < 5 else t.date()
    d = (sd - timedelta(days=3)).isoformat()
    mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": u["user_id"], "date": d, "session": "day",
                             "via": "staff", "family": [], "created_at": datetime.now(timezone.utc).isoformat()})
    json.dump({"user_id": u["user_id"], "email": email, "token": s.cookies.get("session_token"),
               "checkin": d, "slot": sd.isoformat()}, open(F, "w"))
    print(json.load(open(F)))
else:
    uid = json.load(open(F))["user_id"]
    q = {"user_id": uid}
    for c in ("user_sessions", "game_logs", "checkins", "collections", "payments", "raffle_entries",
              "raffle_bonuses", "login_attempts"):
        mdb[c].delete_many(q)
    print(mdb.users.delete_many(q).deleted_count, "users removed")
