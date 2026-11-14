import asyncio
import logging
import os
import random
import re
import uuid
from contextlib import suppress
from datetime import date as Date, datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta

import bcrypt
import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
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
    "checkins": [IndexModel([("user_id", ASCENDING), ("date", ASCENDING), ("session", ASCENDING)],
                             name="user_date_session", unique=True),
                 IndexModel([("date", ASCENDING)], name="date")],
    "game_logs": [IndexModel([("user_id", ASCENDING), ("played_at", DESCENDING)], name="user_played"),
                  IndexModel([("played_at", DESCENDING), ("title_key", ASCENDING)], name="played_title")],
    "token_uses": [IndexModel([("user_id", ASCENDING), ("month", ASCENDING)], name="user_month", unique=True),
                   IndexModel([("acknowledged", ASCENDING), ("created_at", DESCENDING)], name="ack_created")],
    "raffle_entries": [IndexModel([("year", ASCENDING), ("number", ASCENDING)], name="year_number", unique=True),
                       IndexModel([("user_id", ASCENDING), ("year", ASCENDING)], name="user_year")],
    "collections": [IndexModel([("user_id", ASCENDING), ("category", ASCENDING)], name="user_cat")],
    "quarter_awards": [IndexModel([("year", ASCENDING), ("quarter", ASCENDING)], name="year_quarter", unique=True)],
    "raffle_bonuses": [IndexModel([("user_id", ASCENDING), ("year", ASCENDING), ("period", ASCENDING)],
                                   name="user_period", unique=True)],
    "prizes": [IndexModel([("user_id", ASCENDING), ("collect_by", ASCENDING)], name="user_collect"),
               IndexModel([("collected", ASCENDING), ("collect_by", ASCENDING)], name="collected_by")],
}
BONUS_ENTRIES = 3
PERIOD_NAMES = ["Jan–Feb", "Mar–Apr", "May–Jun", "Jul–Aug", "Sep–Oct", "Nov–Dec"]


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def local_now() -> datetime:
    return now().astimezone(TZ)


SESSION_LABELS = {"day": "Day session (10am–2pm)", "evening": "Evening session (4pm–late)"}


def current_slot() -> tuple[str, str]:
    t = local_now()
    if t.hour < 5:
        return (t.date() - timedelta(days=1)).isoformat(), "evening"
    return t.date().isoformat(), ("day" if t.hour < 15 else "evening")


async def paid_earlier(user_id: str, date: str) -> bool:
    return bool(await db.checkins.find_one({"user_id": user_id, "date": date, "via": "paid"}, {"_id": 1}))


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
                             "has_password": bool(u.get("password_hash")), "family": u.get("family", [])}


def free_entry(u: dict) -> bool:
    return is_subscriber(u) or u.get("role") in ("host", "admin")


def eligible_family(u: dict, ids: list[str]) -> list[dict]:
    fam = {f["id"]: f for f in u.get("family", [])}
    out = []
    for i in dict.fromkeys(ids):
        f = fam.get(i)
        if not f:
            raise HTTPException(400, "Unknown family member")
        if f.get("kind", "child") == "child" and local_now().year - f["birth_year"] > 14:
            raise HTTPException(400, f"{f['name']} is 15 or older and needs their own account")
        out.append({"id": f["id"], "name": f["name"], "kind": f.get("kind", "child")})
    return out


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
async def login(body: LoginIn, request: Request, response: Response):
    email = clean_email(body.email)
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    since = iso(now() - timedelta(minutes=15))
    if await db.login_attempts.count_documents({"email": email, "ip": ip, "at": {"$gte": since}}) >= 5:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes")
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if not u or not u.get("password_hash") or not check_pw(body.password, u["password_hash"]):
        await db.login_attempts.insert_one({"email": email, "ip": ip, "at": iso(now())})
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
    family_ids: list[str] = Field(default_factory=list, max_length=10)


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
        if free_entry(user):
            raise HTTPException(400, "You check in free. Use the free check-in button")
        meta["date"], meta["session"] = current_slot()
        meta["family"] = eligible_family(user, body.family_ids)
        if await paid_earlier(user["user_id"], meta["date"]):
            raise HTTPException(400, "You already paid today, so this session is free. Use the free check-in button")
        if await db.checkins.find_one({"user_id": user["user_id"], "date": meta["date"], "session": meta["session"]},
                                      {"_id": 1}):
            raise HTTPException(400, "You're already checked in for this session")
    if body.product == "raffle":
        meta["quantity"] = body.quantity
        meta["year"] = local_now().year
    amount, name = price_for(body)
    base, token, loc = square_cfg()
    recent = await db.payments.find_one(
        {"user_id": user["user_id"], "product": body.product, "amount_cents": amount, "status": "PENDING",
         "checkout_url": {"$exists": True}, "created_at": {"$gte": iso(now() - timedelta(minutes=20))},
         "meta.date": meta.get("date"), "meta.session": meta.get("session"), "meta.family": meta.get("family")}, {"_id": 0}, sort=[("created_at", -1)])
    if recent and recent["product"] != "raffle":
        return {"checkout_id": recent["checkout_id"], "checkout_url": recent["checkout_url"]}
    origin = request.headers.get("origin") or request.headers.get("referer", "").rstrip("/")
    if not origin.startswith("http"):
        raise HTTPException(400, "Missing origin")
    origin = "/".join(origin.split("/")[:3])
    checkout_id = uuid.uuid4().hex
    payload = {"idempotency_key": checkout_id, "description": checkout_id,
               "quick_pay": {"name": name, "price_money": {"amount": amount, "currency": "AUD"},
                             "location_id": loc},
               "payment_note": f"mbgg:{checkout_id}:{user['email']}",
               "checkout_options": {"redirect_url": f"{origin}/checkout/complete?checkout_id={checkout_id}"}}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{base}/v2/online-checkout/payment-links", headers=sq_headers(token), json=payload)
    if r.status_code >= 400:
        logger.error("Square create link failed %s %s", r.status_code, r.text[:500])
        raise HTTPException(400, "Square couldn't start the checkout. Please try again")
    link = r.json()["payment_link"]
    await db.payments.insert_one({"checkout_id": checkout_id, "user_id": user["user_id"], "product": body.product,
                                  "label": name, "amount_cents": amount, "currency": "AUD", "status": "PENDING",
                                  "meta": meta, "square_order_id": link["order_id"],
                                  "square_link_id": link["id"], "checkout_url": link["url"],
                                  "created_at": iso(now())})
    return {"checkout_id": checkout_id, "checkout_url": link["url"]}


async def assign_raffle_numbers(user_id: str, year: int, qty: int, source: str, ref: str) -> list[int]:
    numbers: list[int] = []
    while len(numbers) < qty:
        n = random.randint(1, 9999)
        try:
            await db.raffle_entries.insert_one({"id": uuid.uuid4().hex, "user_id": user_id, "year": year, "number": n,
                                                "source": source, "ref": ref, "created_at": iso(now())})
            numbers.append(n)
        except DuplicateKeyError:
            continue
    return numbers


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
                                          "session": p["meta"].get("session", "day"),
                                          "via": "paid", "family": p["meta"].get("family", []),
                                          "created_at": iso(now())})
    elif p["product"] == "raffle":
        result["raffle_numbers"] = await assign_raffle_numbers(p["user_id"], p["meta"]["year"], p["meta"]["quantity"],
                                                              "purchase", p["checkout_id"])
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


# ---------- Raffle bonus (log every attended session in a 2-month period) ----------
def period_bounds(year: int, idx: int) -> tuple[Date, Date]:
    start = Date(year, idx * 2 + 1, 1)
    return start, start + relativedelta(months=2) - timedelta(days=1)


async def period_progress(user_id: str, year: int, idx: int) -> dict:
    s, e = period_bounds(year, idx)
    rng = {"$gte": s.isoformat(), "$lte": e.isoformat()}
    dates = sorted({c["date"] for c in await db.checkins.find({"user_id": user_id, "date": rng},
                                                              {"_id": 0, "date": 1}).to_list(200)})
    logged = set(await db.game_logs.distinct("played_at", {"user_id": user_id, "played_at": rng, "at_meetup": True}))
    missing = [d for d in dates if d not in logged]
    return {"year": year, "period": idx, "label": f"{PERIOD_NAMES[idx]} {year}", "start": s.isoformat(),
            "end": e.isoformat(), "sessions": len(dates), "logged_sessions": len(dates) - len(missing),
            "missing_dates": missing, "qualifies": bool(dates) and not missing,
            "raffle_year": year if idx < 5 else year + 1}


async def award_bonuses(user_id: str) -> None:
    today = local_now().date()
    periods = [(today.year - 1, i) for i in range(6)] + [(today.year, i) for i in range(6)]
    for year, idx in periods:
        if period_bounds(year, idx)[1] >= today:
            continue
        if await db.raffle_bonuses.find_one({"user_id": user_id, "year": year, "period": idx}, {"_id": 1}):
            continue
        prog = await period_progress(user_id, year, idx)
        if not prog["qualifies"]:
            continue
        raffle_year = max(prog["raffle_year"], today.year)
        try:
            await db.raffle_bonuses.insert_one({"id": uuid.uuid4().hex, "user_id": user_id, "year": year, "period": idx,
                                                "label": prog["label"], "entries": BONUS_ENTRIES,
                                                "raffle_year": raffle_year, "created_at": iso(now())})
        except DuplicateKeyError:
            continue
        await assign_raffle_numbers(user_id, raffle_year, BONUS_ENTRIES, "bonus", f"{year}-{idx}")


# ---------- Dashboard / check-in ----------
@api.get("/me/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    await reconcile_pending(user["user_id"])
    await award_bonuses(user["user_id"])
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    slot_date, slot = current_slot()
    today = local_now().date().isoformat()
    month = local_now().strftime("%Y-%m")
    period_start = (user.get("subscription_started_at") if is_subscriber(user)
                    else iso(now() - timedelta(days=365)))
    start_date = parse_dt(period_start).astimezone(TZ).date().isoformat()
    checkins = await db.checkins.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(400)
    in_period = [c for c in checkins if c["date"] >= start_date and c.get("via") != "guild"]
    token = await db.token_uses.find_one({"user_id": user["user_id"], "month": month}, {"_id": 0})
    raffle = await db.raffle_entries.find({"user_id": user["user_id"], "year": local_now().year},
                                          {"_id": 0}).sort("number", 1).to_list(500)
    payments = await db.payments.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(10)
    ld = local_now().date()
    bonus_now = await period_progress(user["user_id"], ld.year, (ld.month - 1) // 2)
    bonuses = await db.raffle_bonuses.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    prizes = await db.prizes.find({"user_id": user["user_id"]}, {"_id": 0}).sort("won_at", -1).to_list(50)
    today_checkin = next((c for c in checkins if c["date"] == slot_date and c.get("session", "day") == slot), None)
    second_free = not free_entry(user) and await paid_earlier(user["user_id"], slot_date)
    return {"user": me_view(user), "today": slot_date, "checked_in_today": bool(today_checkin),
            "session": {"key": slot, "label": SESSION_LABELS[slot]}, "second_session_free": second_free,
            "today_checkin": today_checkin, "free_entry": free_entry(user),
            "unlogged_dates": await unlogged_checkins(user["user_id"]),
            "attendance": {"sessions": len(in_period), "since": start_date,
                           "door_value_cents": len({c["date"] for c in in_period}) * CHECKIN_CENTS,
                           "membership_cents": ANNUAL_CENTS},
            "recent_checkins": checkins[:8], "token": token, "month": month,
            "raffle_entries": [{"number": r["number"], "source": r.get("source", "purchase")} for r in raffle],
            "raffle_entry_cents": RAFFLE_CENTS, "bonus": {"current": bonus_now, "awarded": bonuses,
                                                      "entries": BONUS_ENTRIES},
            "prizes": prizes, "today_date": ld.isoformat(),
            "guilds": await db.guilds.find({"id": {"$in": user.get("guild_ids", [])}}, {"_id": 0}).sort("name", 1).to_list(50),
            "guild_checkins_today": [c["guild_id"] for c in checkins if c["date"] == slot_date and c.get("via") == "guild"],
            "payments": [payment_view(p) for p in payments]}


async def unlogged_checkins(user_id: str) -> list[str]:
    today = local_now().date()
    rng = {"$gte": (today - timedelta(days=14)).isoformat(), "$lt": current_slot()[0]}
    dates = list({c["date"] for c in await db.checkins.find({"user_id": user_id, "date": rng},
                                                            {"_id": 0, "date": 1}).to_list(50)})
    logged = set(await db.game_logs.distinct("played_at", {"user_id": user_id, "played_at": {"$in": dates},
                                                            "at_meetup": True}))
    return sorted([d for d in dates if d not in logged], reverse=True)


@api.get("/me/reminders")
async def reminders(user: dict = Depends(get_current_user)):
    return {"unlogged_dates": await unlogged_checkins(user["user_id"])}


class FamilyIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["child", "support"] = "child"
    birth_year: Optional[int] = None


@api.post("/me/family")
async def add_family(body: FamilyIn, user: dict = Depends(get_current_user)):
    if not body.name.strip():
        raise HTTPException(400, "Enter a name")
    if body.kind == "child" and (body.birth_year is None or not 0 <= local_now().year - body.birth_year <= 14):
        raise HTTPException(400, "Family members listed here must be under 15")
    if sum(1 for f in user.get("family", []) if f.get("kind", "child") == body.kind) >= 10:
        raise HTTPException(400, "Up to 10 people of each type")
    f = {"id": uuid.uuid4().hex[:12], "name": body.name.strip(), "kind": body.kind,
         "birth_year": body.birth_year if body.kind == "child" else None}
    await db.users.update_one({"user_id": user["user_id"]}, {"$push": {"family": f}})
    return f


@api.delete("/me/family/{fid}")
async def delete_family(fid: str, user: dict = Depends(get_current_user)):
    r = await db.users.update_one({"user_id": user["user_id"]}, {"$pull": {"family": {"id": fid}}})
    if not r.modified_count:
        raise HTTPException(404, "Family member not found")
    return {"ok": True}


class CheckinIn(BaseModel):
    family_ids: list[str] = Field(default_factory=list, max_length=10)


@api.post("/checkin/family")
async def family_checkin(body: CheckinIn, user: dict = Depends(get_current_user)):
    fam = eligible_family(user, body.family_ids)
    if not fam:
        raise HTTPException(400, "Pick who is with you")
    d, s = current_slot()
    q = {"user_id": user["user_id"], "date": d, "session": s}
    row = await db.checkins.find_one(q, {"_id": 0})
    if not row:
        raise HTTPException(400, "Check yourself in first")
    have = {f["id"] for f in row.get("family", [])}
    new = [f for f in fam if f["id"] not in have]
    if new:
        await db.checkins.update_one(q, {"$push": {"family": {"$each": new}}})
    return {"ok": True, "added": len(new)}


@api.post("/checkin")
async def free_checkin(body: Optional[CheckinIn] = None, user: dict = Depends(get_current_user)):
    d, s = current_slot()
    if free_entry(user):
        via = "subscription" if is_subscriber(user) else "staff"
    elif await paid_earlier(user["user_id"], d):
        via = "paid_earlier"
    else:
        raise HTTPException(402, "Admission is $5. Use check in & pay")
    family = eligible_family(user, body.family_ids if body else [])
    doc = {"id": uuid.uuid4().hex, "user_id": user["user_id"], "date": d, "session": s,
           "via": via, "family": family, "created_at": iso(now())}
    try:
        await db.checkins.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(400, "You're already checked in for this session")
    return {"ok": True, "date": d, "session": s}


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
    at_meetup: bool = False


@api.post("/logs")
async def create_log(body: LogIn, user: dict = Depends(get_current_user)):
    if body.genre not in GENRES:
        raise HTTPException(400, "Pick a genre from the list")
    if body.placement > body.player_count:
        raise HTTPException(400, "Placement can't be higher than the player count")
    today = local_now().date()
    played = body.played_at or current_slot()[0]
    try:
        pd = datetime.fromisoformat(played).date()
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if pd > today or pd < today - timedelta(days=365):
        raise HTTPException(400, "Date must be within the last 365 days")
    if body.at_meetup and not await db.checkins.find_one({"user_id": user["user_id"], "date": pd.isoformat()}, {"_id": 1}):
        raise HTTPException(400, "You weren't checked in to a meetup that day. Untick 'Played at an IRL meetup'")
    key = " ".join(body.title.lower().split())
    existing = await db.game_logs.find_one({"title_key": key}, {"_id": 0, "title": 1})
    doc = body.model_dump() | {"id": uuid.uuid4().hex, "user_id": user["user_id"], "played_at": pd.isoformat(),
                               "title": existing["title"] if existing else body.title.strip(), "title_key": key,
                               "created_at": iso(now())}
    await db.game_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/me/checkin-dates")
async def my_checkin_dates(user: dict = Depends(get_current_user)):
    cutoff = (local_now().date() - timedelta(days=366)).isoformat()
    return sorted(set(await db.checkins.distinct("date", {"user_id": user["user_id"], "date": {"$gte": cutoff}})))


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
async def leaderboards(game: Optional[str] = None, user: dict = Depends(get_current_user)):
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


# ---------- Guilds (membership mirrors the group's Discord; managed by hosts/admins) ----------
class GuildIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    tag: str = Field(min_length=1, max_length=12)


class GuildMemberIn(BaseModel):
    user_id: str


class GuildCheckinIn(BaseModel):
    guild_id: str
    family_ids: list[str] = Field(default_factory=list, max_length=10)


@api.get("/guilds")
async def list_guilds():
    guilds = await db.guilds.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    users = await db.users.find({"guild_ids": {"$exists": True, "$ne": []}},
                                {"_id": 0, "user_id": 1, "name": 1, "picture": 1, "guild_ids": 1}).to_list(2000)
    return [g | {"members": [{"user_id": u["user_id"], "name": u["name"], "picture": u.get("picture")}
                             for u in users if g["id"] in u.get("guild_ids", [])]} for g in guilds]


@api.post("/admin/guilds")
async def create_guild(body: GuildIn, staff: dict = Depends(require_staff)):
    if not body.name.strip() or not body.tag.strip():
        raise HTTPException(400, "Enter a guild name and ID")
    tag = body.tag.strip().upper()
    if await db.guilds.find_one({"tag": tag}, {"_id": 1}):
        raise HTTPException(409, "That guild ID is already used")
    g = {"id": uuid.uuid4().hex[:12], "name": body.name.strip(), "tag": tag, "created_at": iso(now())}
    await db.guilds.insert_one(dict(g))
    return g


@api.delete("/admin/guilds/{gid}")
async def delete_guild(gid: str, admin: dict = Depends(require_admin)):
    r = await db.guilds.delete_one({"id": gid})
    if not r.deleted_count:
        raise HTTPException(404, "Guild not found")
    await db.users.update_many({}, {"$pull": {"guild_ids": gid}})
    return {"ok": True}


@api.post("/admin/guilds/{gid}/members")
async def add_guild_member(gid: str, body: GuildMemberIn, staff: dict = Depends(require_staff)):
    if not await db.guilds.find_one({"id": gid}, {"_id": 1}):
        raise HTTPException(404, "Guild not found")
    r = await db.users.update_one({"user_id": body.user_id}, {"$addToSet": {"guild_ids": gid}})
    if not r.matched_count:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api.delete("/admin/guilds/{gid}/members/{user_id}")
async def remove_guild_member(gid: str, user_id: str, staff: dict = Depends(require_staff)):
    await db.users.update_one({"user_id": user_id}, {"$pull": {"guild_ids": gid}})
    return {"ok": True}


@api.post("/checkin/guild")
async def guild_checkin(body: GuildCheckinIn, user: dict = Depends(get_current_user)):
    g = await db.guilds.find_one({"id": body.guild_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Guild not found")
    if body.guild_id not in user.get("guild_ids", []):
        raise HTTPException(403, "Only members of this guild can check in to its meet-ups")
    d, _ = current_slot()
    doc = {"id": uuid.uuid4().hex, "user_id": user["user_id"], "date": d, "session": f"guild:{g['id']}",
           "via": "guild", "guild_id": g["id"], "guild_name": g["name"],
           "family": eligible_family(user, body.family_ids), "created_at": iso(now())}
    try:
        await db.checkins.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(400, f"You're already checked in to today's {g['name']} meet-up")
    return {"ok": True, "date": d, "guild": g["name"]}


@api.get("/leaderboards/guilds")
async def guild_leaderboard(user: dict = Depends(get_current_user)):
    cutoff = (local_now().date() - timedelta(days=365)).isoformat()
    guilds = await list_guilds()
    per_user = {r["_id"]: r for r in await db.game_logs.aggregate([
        {"$match": {"played_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$user_id", "total_score": {"$sum": "$score"}, "games": {"$sum": 1},
                    "wins": {"$sum": {"$cond": [{"$eq": ["$placement", 1]}, 1, 0]}},
                    "playtime_min": {"$sum": "$playtime_min"}}}]).to_list(5000)}
    out = []
    for g in guilds:
        rows = [per_user[m["user_id"]] for m in g["members"] if m["user_id"] in per_user]
        top = max(g["members"], key=lambda m: per_user.get(m["user_id"], {}).get("total_score", float("-inf")), default=None)
        out.append({"id": g["id"], "name": g["name"], "tag": g["tag"], "members": len(g["members"]),
                    "total_score": sum(r["total_score"] for r in rows), "games": sum(r["games"] for r in rows),
                    "wins": sum(r["wins"] for r in rows), "playtime_min": sum(r["playtime_min"] for r in rows),
                    "top_player": top["name"] if top and top["user_id"] in per_user else None})
    return {"since": cutoff, "rows": sorted(out, key=lambda r: -r["total_score"])}


# ---------- Quarterly subscriber top-score prize ----------
def quarter_end(year: int, q: int) -> Date:
    return Date(year, q * 3, 1) + relativedelta(months=1) - timedelta(days=1)


def subscribed_on(u: dict, d: Date) -> bool:
    s, e = u.get("subscription_started_at"), u.get("subscription_expires_at")
    return bool(s and e) and parse_dt(s).astimezone(TZ).date() <= d <= parse_dt(e).astimezone(TZ).date()


async def ytd_standings(year: int, end: Date) -> list[dict]:
    rows = await db.game_logs.aggregate([
        {"$match": {"played_at": {"$gte": f"{year}-01-01", "$lte": end.isoformat()}}},
        {"$group": {"_id": "$user_id", "total_score": {"$sum": "$score"}, "games": {"$sum": 1}}}]).to_list(2000)
    users = {u["user_id"]: u for u in await db.users.find(
        {"user_id": {"$in": [r["_id"] for r in rows]}}, {"_id": 0}).to_list(2000)}
    out = [{"user_id": r["_id"], "name": users[r["_id"]]["name"], "picture": users[r["_id"]].get("picture"),
            "total_score": r["total_score"], "games": r["games"]}
           for r in rows if r["_id"] in users and subscribed_on(users[r["_id"]], end)]
    return sorted(out, key=lambda x: (-x["total_score"], x["games"]))


async def award_quarter_prizes() -> None:
    today = local_now().date()
    for year in (today.year - 1, today.year):
        for q in range(1, 5):
            end = quarter_end(year, q)
            if end + timedelta(days=7) >= today or await db.quarter_awards.find_one({"year": year, "quarter": q}, {"_id": 1}):
                continue
            standings = await ytd_standings(year, end)
            w = standings[0] if standings else None
            if not w:
                continue
            try:
                await db.quarter_awards.insert_one({
                    "id": uuid.uuid4().hex, "year": year, "quarter": q, "label": f"Q{q} {year}", "end": end.isoformat(),
                    "winner_user_id": w and w["user_id"], "winner_name": w and w["name"],
                    "total_score": w and w["total_score"], "created_at": iso(now())})
            except DuplicateKeyError:
                continue
            if w:
                won = end + timedelta(days=1)
                await db.prizes.insert_one({
                    "id": uuid.uuid4().hex, "user_id": w["user_id"], "user_name": w["name"],
                    "prize": f"Top subscriber score prize · Q{q} {year}", "event": "Quarterly leaderboard",
                    "won_at": won.isoformat(), "collect_by": (won + relativedelta(months=3)).isoformat(),
                    "collected": False, "recorded_by": "Leaderboard (automatic)", "created_at": iso(now())})


@api.get("/leaderboards/quarterly")
async def quarterly(user: dict = Depends(get_current_user)):
    await award_quarter_prizes()
    today = local_now().date()
    q = (today.month - 1) // 3 + 1
    standings = [r for r in await ytd_standings(today.year, today)]
    awards = await db.quarter_awards.find({"winner_user_id": {"$ne": None}}, {"_id": 0}).sort(
        [("year", -1), ("quarter", -1)]).to_list(12)
    return {"year": today.year, "quarter": q, "ends": quarter_end(today.year, q).isoformat(),
            "standings": standings[:10], "winners": awards}


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


async def guild_map() -> dict:
    return {g["id"]: g for g in await db.guilds.find({}, {"_id": 0}).to_list(500)}


def user_guilds(u: dict, gmap: dict) -> list[dict]:
    return [{"id": gmap[g]["id"], "name": gmap[g]["name"], "tag": gmap[g]["tag"]} for g in u.get("guild_ids", []) if g in gmap]


@api.get("/members")
async def members():
    users = await db.users.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    counts = {c["_id"]: c["n"] for c in await db.collections.aggregate(
        [{"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]).to_list(1000)}
    gmap = await guild_map()
    return [public_user(u) | {"collection_count": counts.get(u["user_id"], 0), "guilds": user_guilds(u, gmap)}
            for u in users]


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
        "guilds": user_guilds(u, await guild_map()),
        "collection": {c: [i for i in items if i["category"] == c] for c in ("board", "card", "digital")},
        "stats": {"games_logged": sum(s["n"] for s in stats), "wins": sum(s["wins"] for s in stats),
                  "favourite_game": stats[0]["_id"] if stats else None},
        "member_since": u.get("created_at")}


# ---------- Admin / host ----------
@api.get("/admin/summary")
async def admin_summary(since: Optional[str] = None, user: dict = Depends(require_staff)):
    today = local_now().date().isoformat()
    latest = await db.checkins.find_one({}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
    new = []
    if since:
        rows = await db.checkins.find({"created_at": {"$gt": since}, "user_id": {"$ne": user["user_id"]}},
                                      {"_id": 0}).sort("created_at", 1).to_list(50)
        names = {u["user_id"]: u["name"] for u in await db.users.find(
            {"user_id": {"$in": [r["user_id"] for r in rows]}}, {"_id": 0, "user_id": 1, "name": 1}).to_list(50)}
        new = [{"id": r["id"], "name": names.get(r["user_id"], "Someone"), "via": r["via"],
                "session": r.get("session", "day"),
                "family_count": len(r.get("family", [])), "created_at": r["created_at"]} for r in rows]
    return {"unacked_tokens": await db.token_uses.count_documents({"acknowledged": False}),
            "checkins_today": await db.checkins.count_documents({"date": current_slot()[0]}),
            "latest_checkin_at": latest["created_at"] if latest else None, "new_checkins": new}


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
    d = date or current_slot()[0]
    rows = await db.checkins.find({"date": d}, {"_id": 0}).sort("created_at", 1).to_list(500)
    users = {u["user_id"]: u for u in await db.users.find(
        {"user_id": {"$in": [r["user_id"] for r in rows]}}, {"_id": 0}).to_list(500)}
    gmap = await guild_map()
    labels = SESSION_LABELS | {r["session"]: f"Guild meet-up · {gmap.get(r.get('guild_id'), {}).get('name', 'Guild')}"
                               for r in rows if r.get("via") == "guild"}
    heads = {s: sum(1 + len(r.get("family", [])) for r in rows if r.get("session", "day") == s) for s in labels}
    return {"date": d, "headcount": sum(heads.values()), "session_headcount": heads,
            "session_labels": labels,
            "rows": [r | {"name": users.get(r["user_id"], {}).get("name"), "family": r.get("family", []),
                          "session": r.get("session", "day"),
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


@api.post("/admin/users/{user_id}/grant-membership")
async def grant_membership(user_id: str, admin: dict = Depends(require_admin)):
    if not await db.users.find_one({"user_id": user_id}, {"_id": 1}):
        raise HTTPException(404, "User not found")
    p = {"checkout_id": f"cash_{uuid.uuid4().hex}", "user_id": user_id, "product": "annual",
         "label": "Annual Membership (cash at door)", "amount_cents": ANNUAL_CENTS, "currency": "AUD",
         "status": "COMPLETED", "method": "cash", "recorded_by": admin["name"], "meta": {},
         "created_at": iso(now()), "paid_at": iso(now())}
    await db.payments.insert_one(dict(p))
    await fulfil(p)
    return me_view(await db.users.find_one({"user_id": user_id}, {"_id": 0}))


@api.get("/admin/sessions")
async def session_summary(date: Optional[str] = None, staff: dict = Depends(require_staff)):
    d = date or current_slot()[0]
    try:
        Date.fromisoformat(d)
    except ValueError:
        raise HTTPException(400, "Invalid date")
    logs = await db.game_logs.find({"played_at": d, "at_meetup": True}, {"_id": 0}).to_list(2000)
    names = {u["user_id"]: u["name"] for u in await db.users.find(
        {"user_id": {"$in": list({lg["user_id"] for lg in logs})}}, {"_id": 0, "user_id": 1, "name": 1}).to_list(2000)}
    games: dict = {}
    for lg in logs:
        g = games.setdefault(lg["title_key"], {"title": lg["title"], "genre": lg["genre"], "plays": 0,
                                               "minutes": 0, "players": set(), "entries": []})
        g["plays"] += 1
        g["minutes"] += lg["playtime_min"]
        g["players"].add(lg["user_id"])
        g["entries"].append({"id": lg["id"], "name": names.get(lg["user_id"], "Player"), "player_id": lg["player_id"],
                             "score": lg["score"], "placement": lg["placement"],
                             "player_count": lg["player_count"], "playtime_min": lg["playtime_min"]})
    out = []
    for g in sorted(games.values(), key=lambda x: -x["plays"]):
        g["entries"].sort(key=lambda e: (e["placement"], -e["score"]))
        out.append(g | {"players": len(g["players"])})
    recent = sorted(set(await db.checkins.distinct("date")) | set(await db.game_logs.distinct("played_at")),
                    reverse=True)[:30]
    day_rows = await db.checkins.find({"date": d}, {"_id": 0, "family": 1}).to_list(500)
    return {"date": d, "attendees": sum(1 + len(r.get("family", [])) for r in day_rows), "logs": len(logs),
            "loggers": len({lg["user_id"] for lg in logs}), "games": out, "recent_dates": recent}


class PrizeIn(BaseModel):
    user_id: str
    prize: str = Field(min_length=1, max_length=120)
    event: str = Field(default="", max_length=120)
    won_at: Optional[str] = None


@api.post("/admin/prizes")
async def add_prize(body: PrizeIn, staff: dict = Depends(require_staff)):
    u = await db.users.find_one({"user_id": body.user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    try:
        won = Date.fromisoformat(body.won_at) if body.won_at else local_now().date()
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if won > local_now().date() or won < local_now().date() - timedelta(days=365):
        raise HTTPException(400, "Win date must be within the last year and not in the future")
    doc = {"id": uuid.uuid4().hex, "user_id": body.user_id, "user_name": u["name"], "prize": body.prize.strip(),
           "event": body.event.strip(), "won_at": won.isoformat(),
           "collect_by": (won + relativedelta(months=3)).isoformat(), "collected": False,
           "recorded_by": staff["name"], "created_at": iso(now())}
    await db.prizes.insert_one(dict(doc))
    return doc


@api.get("/admin/prizes")
async def list_prizes(staff: dict = Depends(require_staff)):
    return await db.prizes.find({}, {"_id": 0}).sort([("collected", 1), ("collect_by", 1)]).to_list(500)


@api.post("/admin/prizes/{prize_id}/collected")
async def collect_prize(prize_id: str, staff: dict = Depends(require_staff)):
    r = await db.prizes.update_one({"id": prize_id, "collected": False}, {"$set": {"collected": True, "collected_at": iso(now()),
                                                             "handed_over_by": staff["name"]}})
    if not r.matched_count:
        raise HTTPException(404, "Prize not found or already collected")
    return {"ok": True}


@api.get("/stats/monthly")
async def monthly_top_games(user: dict = Depends(get_current_user)):
    ld = local_now().date()
    cutoff = (Date(ld.year, ld.month, 1) - relativedelta(months=11)).isoformat()
    rows = await db.game_logs.aggregate([
        {"$match": {"played_at": {"$gte": cutoff}}},
        {"$group": {"_id": {"m": {"$substrBytes": ["$played_at", 0, 7]}, "t": "$title_key"},
                    "title": {"$first": "$title"}, "plays": {"$sum": 1}, "players": {"$addToSet": "$user_id"},
                    "minutes": {"$sum": "$playtime_min"}}}]).to_list(5000)
    months: dict = {}
    for r in rows:
        months.setdefault(r["_id"]["m"], []).append({"title": r["title"], "plays": r["plays"],
                                                     "players": len(r["players"]), "minutes": r["minutes"]})
    return [{"month": m, "total_plays": sum(g["plays"] for g in gs), "distinct_games": len(gs),
             "top": sorted(gs, key=lambda g: (-g["plays"], -g["players"]))[:5]}
            for m, gs in sorted(months.items(), reverse=True)]


@api.get("/games/details")
async def game_details(q: str = Query(min_length=2, max_length=60)):
    if len(q.strip()) < 2:
        raise HTTPException(422, "Search must be at least 2 characters")
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    cutoff = (local_now().date() - timedelta(days=365)).isoformat()
    items = await db.collections.find({"title": rx}, {"_id": 0}).to_list(500)
    logs = await db.game_logs.find({"title": rx, "played_at": {"$gte": cutoff}}, {"_id": 0}).sort(
        [("played_at", -1), ("created_at", -1)]).to_list(1000)
    ids = list({i["user_id"] for i in items} | {lg["user_id"] for lg in logs})
    users = {u["user_id"]: u for u in await db.users.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(1000)}
    owners: dict = {}
    for i in items:
        u = users.get(i["user_id"])
        if not u:
            continue
        o = owners.setdefault(i["user_id"], {"user_id": i["user_id"], "name": u["name"], "picture": u.get("picture"),
                                             "copies": []})
        o["copies"].append({"title": i["title"], "category": i["category"], "platform": i.get("platform", "")})
    recent = [{"id": lg["id"], "user_id": lg["user_id"], "name": users.get(lg["user_id"], {}).get("name", "Player"),
               "title": lg["title"], "score": lg["score"], "placement": lg["placement"],
               "player_count": lg["player_count"], "played_at": lg["played_at"]} for lg in logs[:10]]
    return {"owners": sorted(owners.values(), key=lambda o: o["name"].lower()), "recent": recent,
            "stats": {"plays": len(logs), "players": len({lg["user_id"] for lg in logs}),
                      "top_score": max((lg["score"] for lg in logs), default=None)}}


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
    with suppress(Exception):
        await db.checkins.drop_index("user_date")
    app.state.index_task = asyncio.create_task(ensure_indexes())
    await seed_admin()


@app.on_event("shutdown")
async def shutdown():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
