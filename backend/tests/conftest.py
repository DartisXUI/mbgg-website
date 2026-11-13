import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path("/app/frontend/.env"))
load_dotenv(Path("/app/backend/.env"))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "alcock.jacob@gmail.com"
ADMIN_PASSWORD = "MBGG-Host-Admin-2026"

_mongo = MongoClient(os.environ["MONGO_URL"])
mdb = _mongo[os.environ["DB_NAME"]]
CREATED_USER_IDS: list = []


def make_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
    return s


def register_user(prefix="user", subscriber=False, domain="example.com"):
    s = make_session()
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@{domain}"
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": f"TEST {prefix}", "email": email,
                                                       "password": "testpass123"})
    assert r.status_code == 200, r.text
    u = r.json()
    CREATED_USER_IDS.append(u["user_id"])
    if subscriber:
        exp = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        start = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        mdb.users.update_one({"user_id": u["user_id"]}, {"$set": {"subscription_expires_at": exp,
                                                                   "subscription_started_at": start}})
    return s, u, email


@pytest.fixture(scope="session")
def admin_client():
    s = make_session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Admin login failed {r.status_code}")
    return s


def _delete_square_links(link_ids):
    tok = os.environ.get("SQUARE_ACCESS_TOKEN")
    if not tok:
        return
    base = ("https://connect.squareup.com" if os.environ.get("SQUARE_ENV") == "production"
            else "https://connect.squareupsandbox.com")
    for lid in link_ids:
        try:
            requests.delete(f"{base}/v2/online-checkout/payment-links/{lid}",
                            headers={"Authorization": f"Bearer {tok}", "Square-Version": "2025-10-16"}, timeout=15)
        except Exception:
            pass


@pytest.fixture(scope="session", autouse=True)
def cleanup_all():
    yield
    ids = list(CREATED_USER_IDS)
    if not ids:
        return
    q = {"user_id": {"$in": ids}}
    links = [p["square_link_id"] for p in mdb.payments.find(q | {"status": "PENDING"}, {"square_link_id": 1})
             if p.get("square_link_id")]
    _delete_square_links(links)
    for coll in ("user_sessions", "game_logs", "checkins", "token_uses", "collections", "payments",
                 "raffle_entries", "raffle_bonuses", "prizes"):
        mdb[coll].delete_many(q)
    mdb.users.delete_many(q)
