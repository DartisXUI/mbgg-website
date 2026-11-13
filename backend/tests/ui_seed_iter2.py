# UI seed helper for iteration 2: run after ui_fixtures.py setup; seeds prize + current-block checkin for nonsub
import json
import uuid
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
sys.path.insert(0, "/app/backend/tests")
from conftest import mdb  # noqa

u = json.load(open("/tmp/ui_users.json"))
nid = u["nonsub"]["user_id"]
today = datetime.now(ZoneInfo("Australia/Adelaide")).date().isoformat()
now = datetime.now(timezone.utc).isoformat()
mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": nid, "date": today, "via": "paid", "created_at": now})
mdb.prizes.insert_one({"id": "TEST_expired_" + uuid.uuid4().hex[:6], "user_id": nid, "user_name": "TEST nonsub",
                       "prize": "TEST_Expired Prize", "event": "Old raffle", "won_at": "2026-01-10",
                       "collect_by": "2026-04-10", "collected": False, "recorded_by": "x", "created_at": now})
print("seeded", nid, today)
