# UI seed for iteration 3 (run after ui_fixtures.py setup): host role, kids, past unlogged check-in, game logs
import json
import sys
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, "/app/backend/tests")
from conftest import mdb  # noqa

U = json.load(open("/tmp/ui_users.json"))
today = datetime.now(ZoneInfo("Australia/Adelaide")).date()
Y = today.year
mdb.users.update_one({"user_id": U["hostc"]["user_id"]}, {"$set": {"role": "host"}})
mdb.users.update_one({"user_id": U["suba"]["user_id"]}, {"$set": {"family": [
    {"id": "kidmia00001", "name": "Mia", "birth_year": Y - 7},
    {"id": "kidleo00002", "name": "Leo", "birth_year": Y - 10}]}})
mdb.users.update_one({"user_id": U["nonsub"]["user_id"]}, {"$set": {"family": [
    {"id": "kidzoe00003", "name": "Zoe", "birth_year": Y - 5}]}})
past = (today - timedelta(days=2)).isoformat()
mdb.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": U["subb"]["user_id"], "date": past, "via": "subscription",
                         "family": [], "created_at": "2000-01-01T00:00:00+00:00"})
mdb.game_logs.insert_one({"id": uuid.uuid4().hex, "user_id": U["suba"]["user_id"], "title": "TEST_Wingspan",
                          "title_key": "test_wingspan", "genre": "Strategy", "player_count": 3, "player_id": "A",
                          "playtime_min": 60, "score": 88, "placement": 1, "played_at": (today - timedelta(days=5)).isoformat(),
                          "created_at": "2000-01-01T00:00:00+00:00"})
json.dump({"past": past}, open("/tmp/ui_iter3.json", "w"))
print("seeded", past)
