# UI seed iteration 4: nonsub gets a 'paid' check-in for the OTHER session of the current session date; hostc -> host
import json
import sys
import uuid
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend/tests")
from conftest import mdb  # noqa
from test_iteration4_sessions import SLOT_DATE, OTHER  # noqa

u = json.load(open("/tmp/ui_users.json"))
mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": u["nonsub"]["user_id"], "date": SLOT_DATE, "session": OTHER,
                         "via": "paid", "family": [], "created_at": datetime.now(timezone.utc).isoformat()})
mdb.users.update_one({"user_id": u["hostc"]["user_id"]}, {"$set": {"role": "host"}})
print("seeded", SLOT_DATE, OTHER)
