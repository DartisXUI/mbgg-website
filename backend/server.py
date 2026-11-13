import asyncio
import logging
import os
import random
import uuid
from contextlib import suppress
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal, Optional
from zoneinfo import ZoneInfo

import bcrypt
import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
logger = logging.getLogger(__name__)

TZ = ZoneInfo("Australia/Adelaide")
SESSION_DAYS = 7
ANNUAL_CENTS = 12000
CHECKIN_CENTS = 500
RAFFLE_CENTS = int(os.environ["RAFFLE_ENTRY_CENTS"])
PRICES = {"annual": ANNUAL_CENTS, "checkin": CHECKIN_CENTS, "donation_5": 500,
          "donation_10": 1000, "donation_20": 2000, "donation_50": 5000}
GENRES = ["Strategy", "Deck-Builder", "Engine Builder", "Worker Placement", "Area Control", "Route Building",
          "Push Your Luck", "Trick-Taking", "Deduction", "Social Deduction", "Party", "Cooperative", "Dice",
          "Puzzle", "Abstract", "Trading", "Racing", "Fighting", "Simulation", "Other"]

INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("user_id", ASCENDING)], name="user_id", unique=True),
              IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "user_sessions": [IndexModel([("session_token", ASCENDING)], name="token", unique=True)],
    "login_attempts": [IndexModel([("email", ASCENDING), ("at", DESCENDING)], name="email_at")],
    "payments": [IndexModel([("checkout_id", ASCENDING)], name="checkout_id", unique=True),
                 IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "checkins": [IndexModel([("user_id", ASCENDING), ("date", ASCENDING)], name="user_date", unique=True),
                 IndexModel([("date", ASCENDING)], name="date")],
    "game_logs": [IndexModel([("user_id", ASCENDING), ("played_at", DESCENDING)], name="user_played"),
                  IndexModel([("played_at", DESCENDING), ("title_key", ASCENDING)], name="played_title")],
    "token_uses": [IndexModel([("user_id", ASCENDING), ("month", ASCENDING)], name="user_month", unique=True),
                   IndexModel([("acknowledged", ASCENDING), ("created_at", DESCENDING)], name="ack_created")],
    "raffle_entries": [IndexModel([("year", ASCENDING), ("number", ASCENDING)], name="year_number", unique=True),
                       IndexModel([("user_id", ASCENDING), ("year", ASCENDING)], name="user_year")],
    "collections": [IndexModel([("user_id", ASCENDING), ("category", ASCENDING)], name="user_cat")],
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def local_now() -> datetime:
    return now().astimezone(TZ)


def is_subscriber(u: dict) -> bool:
    exp = u.get("subscription_expires_at")
    return bool(exp) and parse_dt(exp) > now()


def public_user(u: dict) -> dict:
    return {"user_id": u["user_id"], "name": u.get("name"), "picture": u.get("picture"),
            "role": u.get("role", "member"), "player_tag": u.get("player_tag", ""),
            "bio": u.get("bio", ""), "is_subscriber": is_subscriber(u)}


def me_view(u: dict) -> dict:
    return public_user(u) | {"email": u["email"], "subscription_expires_at": u.get("subscription_expires_at"),
                             "subscription_started_at": u.get("subscription_started_at"),
                             "has_password": bool(u.get("password_hash"))}


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_pw(pw: str, h: str) -> bool:
    return bcrypt.checkpw(pw.encode(), h.encode())


app = FastAPI()
api = APIRouter(prefix="/api")


# ---------- Auth ----------
async def create_session(user_id: str, response: Response, token: Optional[str] = None) -> None:
    token = token or (uuid.uuid4().hex + uuid.uuid4().hex)
    await db.user_sessions.insert_one({"session_token": token, "user_id": user_id,
                                       "expires_at": iso(now() + timedelta(days=SESSION_DAYS)),
                                       "created_at": iso(now())})
    response.set_cookie("session_token", token, httponly=True, secure=True, samesite="none",
                        path="/", max_age=SESSION_DAYS * 86400)


def read_token(request: Request) -> Optional[str]:
    token = request.cookies.get("session_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    return token


async def get_current_user(request: Request) -> dict:
    token = read_token(request)
    if not token:
        raise HTTPException(401, "Not authenticated")
    s = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not s or parse_dt(s["expires_at"]) < now():
        raise HTTPException(401, "Session expired")
    u = await db.users.find_one({"user_id": s["user_id"]}, {"_id": 0})
    if not u:
        raise HTTPException(401, "User not found")
    return u


async def require_staff(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("host", "admin"):
        raise HTTPException(403, "Hosts only")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return user


async def require_subscriber(user: dict = Depends(get_current_user)) -> dict:
    if not is_subscriber(user) and user.get("role") not in ("host", "admin"):
        raise HTTPException(403, "Annual subscribers only")
    return user


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: str
    password: str


class GoogleIn(BaseModel):
    session_id: str


def clean_email(e: str) -> str:
    e = e.strip().lower()
    if "@" not in e or "." not in e.split("@")[-1]:
        raise HTTPException(400, "Enter a valid email")
    return e


def new_user(email: str, name: str, **extra) -> dict:
    return {"user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email, "name": name, "picture": None,
            "role": "member", "player_tag": "", "bio": "", "subscription_expires_at": None,
            "subscription_started_at": None, "created_at": iso(now())} | extra


@api.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    email = clean_email(body.email)
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(409, "An account with this email already exists")
    u = new_user(email, body.name.strip(), password_hash=hash_pw(body.password))
    await db.users.insert_one(u)
    await create_session(u["user_id"], response)
    return me_view(u)


@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = clean_email(body.email)
    since = iso(now() - timedelta(minutes=15))
    if await db.login_attempts.count_documents({"email": email, "at": {"$gte": since}}) >= 5:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes")
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if not u or not u.get("password_hash") or not check_pw(body.password, u["password_hash"]):
        await db.login_attempts.insert_one({"email": email, "at": iso(now())})
        raise HTTPException(401, "Wrong email or password")
    await db.login_attempts.delete_many({"email": email})
    await create_session(u["user_id"], response)
    return me_view(u)


@api.post("/auth/google/session")
async def google_session(body: GoogleIn, response: Response):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                        headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in failed")
    d = r.json()
    email = d["email"].strip().lower()
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if u:
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"picture": d.get("picture")}})
        u["picture"] = d.get("picture")
    else:
        u = new_user(email, d.get("name") or email.split("@")[0], picture=d.get("picture"))
        await db.users.insert_one(u)
        u.pop("_id", None)
    await create_session(u["user_id"], response, d["session_token"])
    return me_view(u)


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return me_view(user)


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = read_token(request)
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"ok": True}


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    player_tag: Optional[str] = Field(default=None, max_length=40)
    bio: Optional[str] = Field(default=None, max_length=300)


@api.patch("/me/profile")
async def update_profile(body: ProfileIn, user: dict = Depends(get_current_user)):
    upd = {k: v.strip() for k, v in body.model_dump().items() if v is not None}
    if upd:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": upd})
    return me_view(user | upd)


# ---------- Square payments ----------
def square_cfg() -> tuple[str, str, str]:
    token = os.environ.get("SQUARE_ACCESS_TOKEN", "")
    loc = os.environ.get("SQUARE_LOCATION_ID", "")
    if not token or not loc:
        raise HTTPException(503, "Online payments aren't switched on yet. Please pay at the door for now.")
    base = ("https://connect.squareup.com" if os.environ.get("SQUARE_ENV") == "production"
            else "https://connect.squareupsandbox.com")
    return base, token, loc


def sq_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Square-Version": "2025-10-16",
            "Content-Type": "application/json"}


class CheckoutIn(BaseModel):
    product: Literal["annual", "checkin", "raffle", "donation_5", "donation_10", "donation_20",
                     "donation_50", "donation_custom"]
    custom_amount: Optional[Decimal] = Field(default=None, max_digits=9, decimal_places=2)
    quantity: int = Field(default=1, ge=1, le=20)


def price_for(body: CheckoutIn) -> tuple[int, str]:
    if body.product == "donation_custom":
        if body.custom_amount is None or body.custom_amount < Decimal("1.00"):
            raise HTTPException(400, "Custom donation minimum is $1.00")
        if body.custom_amount > Decimal("5000"):
            raise HTTPException(400, "Custom donation maximum is $5,000")
        return int((body.custom_amount * 100).quantize(Decimal("1"))), "Donation to Murray Bridge Games Group"
    if body.product == "raffle":
        return RAFFLE_CENTS * body.quantity, f"Lucky Number Raffle Entry x{body.quantity}"
    names = {"annual": "Annual Membership (12 months)", "checkin": "Session Admission"}
    return PRICES[body.product], names.get(body.product, "Donation to Murray Bridge Games Group")


@api.post("/payments/checkout")
async def create_checkout(body: CheckoutIn, request: Request, user: dict = Depends(get_current_user)):
    meta: dict = {}
    if body.product == "checkin":
        if is_subscriber(user):
            raise HTTPException(400, "Subscribers check in free. Use the free check-in button")
        meta["date"] = local_now().date().isoformat()
        if await db.checkins.find_one({"user_id": user["user_id"], "date": meta["date"]}, {"_id": 1}):
            raise HTTPException(400, "You're already checked in today")
    if body.product == "raffle":
        meta["quantity"] = body.quantity
        meta["year"] = local_now().year
    amount, name = price_for(body)
    base, token, loc = square_cfg()
    origin = request.headers.get("origin") or request.headers.get("referer", "").rstrip("/")
    if not origin.startswith("http"):
        raise HTTPException(400, "Missing origin")
    origin = "/".join(origin.split("/")[:3])
    checkout_id = uuid.uuid4().hex
    payload = {"idempotency_key": checkout_id, "description": checkout_id,
               "quick_pay": {"name": name, "price_money": {"amount": amount, "currency": "AUD"},
                             "location_id": loc},
               "payment_note": f"mbgg:{checkout_id}:{user['email']}",
               "checkout_options": {"redirect_url": f"{origin}/checkout/complete?checkout_id={checkout_id}"},
               "pre_populated_data": {"buyer_email": user["email"]}}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{base}/v2/online-checkout/payment-links", headers=sq_headers(token), json=payload)
    if r.status_code >= 400:
        logger.error("Square create link failed %s %s", r.status_code, r.text[:500])
        raise HTTPException(400, "Square couldn't start the checkout. Please try again")
    link = r.json()["payment_link"]
    await db.payments.insert_one({"checkout_id": checkout_id, "user_id": user["user_id"], "product": body.product,
                                  "label": name, "amount_cents": amount, "currency": "AUD", "status": "PENDING",
                                  "meta": meta, "square_order_id": link["order_id"],
                                  "square_link_id": link["id"], "created_at": iso(now())})
    return {"checkout_id": checkout_id, "checkout_url": link["url"]}


async def fulfil(p: dict) -> dict:
    result: dict = {}
    if p["product"] == "annual":
        u = await db.users.find_one({"user_id": p["user_id"]}, {"_id": 0})
        start = parse_dt(u["subscription_expires_at"]) if is_subscriber(u) else now()
        upd = {"subscription_expires_at": iso(start + timedelta(days=365))}
        if not is_subscriber(u):
            upd["subscription_started_at"] = iso(now())
        await db.users.update_one({"user_id": p["user_id"]}, {"$set": upd})
    elif p["product"] == "checkin":
        with suppress(DuplicateKeyError):
            await db.checkins.insert_one({"id": uuid.uuid4().hex, "user_id": p["user_id"], "date": p["meta"]["date"],
                                          "via": "paid", "created_at": iso(now())})
    elif p["product"] == "raffle":
        numbers = []
        while len(numbers) < p["meta"]["quantity"]:
            n = random.randint(1, 9999)
            try:
                await db.raffle_entries.insert_one({"id": uuid.uuid4().hex, "user_id": p["user_id"],
                                                    "year": p["meta"]["year"], "number": n,
                                                    "checkout_id": p["checkout_id"], "created_at": iso(now())})
                numbers.append(n)
            except DuplicateKeyError:
                continue
        result["raffle_numbers"] = numbers
    await db.payments.update_one({"checkout_id": p["checkout_id"]}, {"$set": {"fulfilled": True, "result": result}})
    return p | {"fulfilled": True, "result": result}


async def verify_payment(p: dict) -> dict:
    if p["status"] != "PENDING":
        return p
    base, token, _ = square_cfg()
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{base}/v2/orders/{p['square_order_id']}", headers=sq_headers(token))
        if r.status_code >= 400:
            return p
        order = r.json().get("order", {})
        for t in order.get("tenders") or []:
            pid = t.get("payment_id") or t.get("id")
            pr = await c.get(f"{base}/v2/payments/{pid}", headers=sq_headers(token))
            pay = pr.json().get("payment", {}) if pr.status_code < 400 else {}
            money = pay.get("amount_money", {})
            if (pay.get("status") == "COMPLETED" and money.get("amount") == p["amount_cents"]
                    and money.get("currency") == "AUD"):
                claimed = await db.payments.find_one_and_update(
                    {"checkout_id": p["checkout_id"], "status": "PENDING"},
                    {"$set": {"status": "COMPLETED", "square_payment_id": pid, "paid_at": iso(now())}},
                    projection={"_id": 0}, return_document=ReturnDocument.AFTER)
                if claimed:
                    return await fulfil(claimed)
    if order.get("state") == "CANCELED":
        await db.payments.update_one({"checkout_id": p["checkout_id"]}, {"$set": {"status": "CANCELED"}})
        return p | {"status": "CANCELED"}
    return p


def payment_view(p: dict) -> dict:
    return {k: p.get(k) for k in ("checkout_id", "product", "label", "amount_cents", "currency", "status",
                                  "created_at", "paid_at", "result")}


@api.get("/payments/{checkout_id}")
async def payment_status(checkout_id: str, user: dict = Depends(get_current_user)):
    p = await db.payments.find_one({"checkout_id": checkout_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Payment not found")
    return payment_view(await verify_payment(p))


async def reconcile_pending(user_id: str) -> None:
    if not os.environ.get("SQUARE_ACCESS_TOKEN"):
        return
    since = iso(now() - timedelta(days=2))
    pending = await db.payments.find({"user_id": user_id, "status": "PENDING", "created_at": {"$gte": since}},
                                     {"_id": 0}).to_list(5)
    for p in pending:
        with suppress(Exception):
            await verify_payment(p)


# ---------- Dashboard / check-in ----------
@api.get("/me/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    await reconcile_pending(user["user_id"])
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    today = local_now().date().isoformat()
    month = local_now().strftime("%Y-%m")
    period_start = (user.get("subscription_started_at") if is_subscriber(user)
                    else iso(now() - timedelta(days=365)))
    start_date = parse_dt(period_start).astimezone(TZ).date().isoformat()
    checkins = await db.checkins.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(400)
    in_period = [c for c in checkins if c["date"] >= start_date]
    token = await db.token_uses.find_one({"user_id": user["user_id"], "month": month}, {"_id": 0})
    raffle = await db.raffle_entries.find({"user_id": user["user_id"], "year": local_now().year},
                                          {"_id": 0}).sort("number", 1).to_list(500)
    payments = await db.payments.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {"user": me_view(user), "today": today, "checked_in_today": bool(checkins and checkins[0]["date"] == today),
            "attendance": {"sessions": len(in_period), "since": start_date,
                           "door_value_cents": len(in_period) * CHECKIN_CENTS, "membership_cents": ANNUAL_CENTS},
            "recent_checkins": checkins[:8], "token": token, "month": month,
            "raffle_numbers": [r["number"] for r in raffle], "raffle_entry_cents": RAFFLE_CENTS,
            "payments": [payment_view(p) for p in payments]}


@api.post("/checkin")
async def free_checkin(user: dict = Depends(get_current_user)):
    if not is_subscriber(user):
        raise HTTPException(402, "Admission is $5. Use check in & pay")
    doc = {"id": uuid.uuid4().hex, "user_id": user["user_id"], "date": local_now().date().isoformat(),
           "via": "subscription", "created_at": iso(now())}
    try:
        await db.checkins.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(400, "You're already checked in today")
    return {"ok": True, "date": doc["date"]}


# ---------- Monthly game choice token ----------
class TokenIn(BaseModel):
    game: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=200)


@api.post("/token/use")
async def use_token(body: TokenIn, user: dict = Depends(get_current_user)):
    if not is_subscriber(user):
        raise HTTPException(403, "The monthly game choice is for annual subscribers")
    doc = {"id": uuid.uuid4().hex, "user_id": user["user_id"], "user_name": user.get("name"),
           "month": local_now().strftime("%Y-%m"), "game": body.game.strip(), "note": body.note.strip(),
           "acknowledged": False, "created_at": iso(now())}
    try:
        await db.token_uses.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(400, "You've already used this month's game choice")
    doc.pop("_id", None)
    return doc


# ---------- Game logs & leaderboards ----------
class LogIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    genre: str
    player_count: int = Field(ge=1, le=30)
    player_id: str = Field(min_length=1, max_length=40)
    playtime_min: int = Field(ge=1, le=1440)
    score: int = Field(ge=-100000, le=10000000)
    placement: int = Field(ge=1, le=30)
    played_at: Optional[str] = None


@api.post("/logs")
async def create_log(body: LogIn, user: dict = Depends(require_subscriber)):
    if body.genre not in GENRES:
        raise HTTPException(400, "Pick a genre from the list")
    if body.placement > body.player_count:
        raise HTTPException(400, "Placement can't be higher than the player count")
    today = local_now().date()
    played = body.played_at or today.isoformat()
    try:
        pd = datetime.fromisoformat(played).date()
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if pd > today or pd < today - timedelta(days=365):
        raise HTTPException(400, "Date must be within the last 365 days")
    key = " ".join(body.title.lower().split())
    existing = await db.game_logs.find_one({"title_key": key}, {"_id": 0, "title": 1})
    doc = body.model_dump() | {"id": uuid.uuid4().hex, "user_id": user["user_id"], "played_at": pd.isoformat(),
                               "title": existing["title"] if existing else body.title.strip(), "title_key": key,
                               "created_at": iso(now())}
    await db.game_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/logs/me")
async def my_logs(user: dict = Depends(get_current_user)):
    return await db.game_logs.find({"user_id": user["user_id"]}, {"_id": 0}).sort("played_at", -1).to_list(2000)


@api.delete("/logs/{log_id}")
async def delete_log(log_id: str, user: dict = Depends(get_current_user)):
    r = await db.game_logs.delete_one({"id": log_id, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Log not found")
    return {"ok": True}


@api.get("/meta/genres")
async def genres():
    return GENRES


@api.get("/leaderboards")
async def leaderboards(game: Optional[str] = None, user: dict = Depends(require_subscriber)):
    cutoff = (local_now().date() - timedelta(days=365)).isoformat()
    base_match = {"played_at": {"$gte": cutoff}}
    titles = await db.game_logs.aggregate([{"$match": base_match},
                                           {"$group": {"_id": "$title_key", "title": {"$first": "$title"},
                                                       "plays": {"$sum": 1}}},
                                           {"$sort": {"plays": -1}}]).to_list(200)
    match = base_match | ({"title_key": game} if game else {})
    rows = await db.game_logs.aggregate([
        {"$match": match},
        {"$group": {"_id": "$user_id", "total_score": {"$sum": "$score"}, "games": {"$sum": 1},
                    "wins": {"$sum": {"$cond": [{"$eq": ["$placement", 1]}, 1, 0]}},
                    "podiums": {"$sum": {"$cond": [{"$lte": ["$placement", 3]}, 1, 0]}},
                    "avg_placement": {"$avg": "$placement"}, "playtime_min": {"$sum": "$playtime_min"},
                    "best_score": {"$max": "$score"}}}]).to_list(1000)
    users = await db.users.find({"user_id": {"$in": [r["_id"] for r in rows]}},
                                {"_id": 0, "user_id": 1, "name": 1, "picture": 1}).to_list(1000)
    names = {u["user_id"]: u for u in users}
    out = []
    for r in rows:
        u = names.get(r["_id"], {})
        out.append({"user_id": r["_id"], "name": u.get("name", "Player"), "picture": u.get("picture"),
                    "total_score": r["total_score"], "games": r["games"], "wins": r["wins"], "podiums": r["podiums"],
                    "avg_placement": round(r["avg_placement"], 2), "win_rate": round(100 * r["wins"] / r["games"], 1),
                    "playtime_min": r["playtime_min"], "best_score": r["best_score"]})
    return {"since": cutoff, "games": [{"key": t["_id"], "title": t["title"], "plays": t["plays"]} for t in titles],
            "rows": out}


# ---------- Collections & members ----------
class CollectionIn(BaseModel):
    category: Literal["board", "card", "digital"]
    title: str = Field(min_length=1, max_length=80)
    platform: str = Field(default="", max_length=40)


@api.get("/me/collection")
async def my_collection(user: dict = Depends(get_current_user)):
    return await db.collections.find({"user_id": user["user_id"]}, {"_id": 0}).sort("title", 1).to_list(1000)


@api.post("/me/collection")
async def add_collection(body: CollectionIn, user: dict = Depends(get_current_user)):
    if body.category == "digital" and not body.platform.strip():
        raise HTTPException(400, "Pick a platform for digital games")
    doc = {"id": uuid.uuid4().hex, "user_id": user["user_id"], "category": body.category,
           "title": body.title.strip(), "platform": body.platform.strip() if body.category == "digital" else "",
           "created_at": iso(now())}
    await db.collections.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/me/collection/{item_id}")
async def delete_collection(item_id: str, user: dict = Depends(get_current_user)):
    r = await db.collections.delete_one({"id": item_id, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@api.get("/members")
async def members():
    users = await db.users.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    counts = {c["_id"]: c["n"] for c in await db.collections.aggregate(
        [{"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]).to_list(1000)}
    return [public_user(u) | {"collection_count": counts.get(u["user_id"], 0)} for u in users]


@api.get("/members/{user_id}")
async def member_profile(user_id: str):
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "Member not found")
    items = await db.collections.find({"user_id": user_id}, {"_id": 0, "user_id": 0}).sort("title", 1).to_list(1000)
    cutoff = (local_now().date() - timedelta(days=365)).isoformat()
    stats = await db.game_logs.aggregate([
        {"$match": {"user_id": user_id, "played_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$title", "n": {"$sum": 1},
                    "wins": {"$sum": {"$cond": [{"$eq": ["$placement", 1]}, 1, 0]}}}},
        {"$sort": {"n": -1}}]).to_list(200)
    return public_user(u) | {
        "collection": {c: [i for i in items if i["category"] == c] for c in ("board", "card", "digital")},
        "stats": {"games_logged": sum(s["n"] for s in stats), "wins": sum(s["wins"] for s in stats),
                  "favourite_game": stats[0]["_id"] if stats else None},
        "member_since": u.get("created_at")}


# ---------- Admin / host ----------
@api.get("/admin/summary")
async def admin_summary(user: dict = Depends(require_staff)):
    today = local_now().date().isoformat()
    return {"unacked_tokens": await db.token_uses.count_documents({"acknowledged": False}),
            "checkins_today": await db.checkins.count_documents({"date": today})}


@api.get("/admin/token-alerts")
async def token_alerts(user: dict = Depends(require_staff)):
    return await db.token_uses.find({}, {"_id": 0}).sort([("acknowledged", 1), ("created_at", -1)]).to_list(200)


@api.post("/admin/token-alerts/{alert_id}/ack")
async def ack_alert(alert_id: str, user: dict = Depends(require_staff)):
    r = await db.token_uses.update_one({"id": alert_id}, {"$set": {"acknowledged": True, "acknowledged_by": user["name"],
                                                                    "acknowledged_at": iso(now())}})
    if not r.matched_count:
        raise HTTPException(404, "Alert not found")
    return {"ok": True}


@api.get("/admin/checkins")
async def admin_checkins(date: Optional[str] = None, user: dict = Depends(require_staff)):
    d = date or local_now().date().isoformat()
    rows = await db.checkins.find({"date": d}, {"_id": 0}).sort("created_at", 1).to_list(500)
    users = {u["user_id"]: u for u in await db.users.find(
        {"user_id": {"$in": [r["user_id"] for r in rows]}}, {"_id": 0}).to_list(500)}
    return {"date": d, "rows": [r | {"name": users.get(r["user_id"], {}).get("name"),
                                     "is_subscriber": is_subscriber(users.get(r["user_id"], {}))} for r in rows]}


@api.get("/admin/users")
async def admin_users(user: dict = Depends(require_staff)):
    users = await db.users.find({}, {"_id": 0}).sort("name", 1).to_list(2000)
    return [me_view(u) for u in users]


class RoleIn(BaseModel):
    role: Literal["member", "host"]


@api.post("/admin/users/{user_id}/role")
async def set_role(user_id: str, body: RoleIn, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("role") == "admin":
        raise HTTPException(400, "Admin role can't be changed here")
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": body.role}})
    return {"ok": True, "role": body.role}


@api.get("/")
async def root():
    return {"message": "Murray Bridge Games Group API"}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True,
                   allow_origins=os.environ["CORS_ORIGINS"].split(","), allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


async def seed_admin() -> None:
    email = os.environ["ADMIN_EMAIL"].lower()
    pw = os.environ["ADMIN_PASSWORD"]
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if not u:
        await db.users.insert_one(new_user(email, os.environ["ADMIN_NAME"], role="admin", password_hash=hash_pw(pw)))
        return
    upd: dict = {"role": "admin"}
    if not u.get("password_hash") or not check_pw(pw, u["password_hash"]):
        upd["password_hash"] = hash_pw(pw)
    await db.users.update_one({"email": email}, {"$set": upd})


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    await seed_admin()


@app.on_event("shutdown")
async def shutdown():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
