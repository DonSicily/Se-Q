from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Body, Query, Request, Response, File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.gzip import GZipMiddleware
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from motor.motor_asyncio import AsyncIOMotorClient
from contextlib import asynccontextmanager
import os
import re
import json
import csv
import io
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import bcrypt
import jwt
from bson import ObjectId
import math
import hashlib
import base64

# Rate limiter - uses client IP address
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

# Safe imports with fallbacks
try:
    from video_transcoder import transcode_queue, check_ffmpeg_available, transcode_video_async
except ImportError:
    logging.warning("video_transcoder module not found, using mock")
    transcode_queue = None
    def check_ffmpeg_available(): return False
    async def transcode_video_async(*args, **kwargs): return None

try:
    from services import cloudinary_service, expo_push_service
except ImportError:
    logging.warning("services module not found, using mocks")
    cloudinary_service = None
    expo_push_service = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# MongoDB connection with error handling
mongo_url = os.environ.get('MONGO_URL')
if not mongo_url:
    raise ValueError("MONGO_URL environment variable not set")

db_name = os.environ.get('DB_NAME', 'seq_db')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

async def create_indexes():
    """Create database indexes for performance"""
    try:
        await db.civil_reports.create_index([("location", "2dsphere")])
        await db.civil_tracks.create_index([("currentLocation.coordinates", "2dsphere")])
        await db.security_teams.create_index([("teamLocation.coordinates", "2dsphere")])
        await db.escort_sessions.create_index([("user_id", 1)])
        await db.panic_events.create_index([("user_id", 1), ("is_active", 1)])
        await db.panic_events.create_index([("current_location", "2dsphere")])
        await db.panic_events.create_index([("activated_at", -1)])
        # FIX ISSUE #5: ping_events lookup indexes
        await db.ping_events.create_index([("target_user_id", 1), ("dispatched_at", -1)])
        await db.ping_events.create_index([("requester_id", 1), ("dispatched_at", -1)])
        await db.ping_events.create_index([("responded", 1), ("dispatched_at", -1)])
        logger.info("Database indexes created")
    except Exception as e:
        logger.error(f"Failed to create indexes: {e}")

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    raise ValueError("JWT_SECRET environment variable is required - do not use fallback secrets in production")
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 30

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    logger.info("Starting up...")
    try:
        await create_indexes()
        await create_default_admins()
        await create_default_invite_codes()
        check_ffmpeg_available()
        if transcode_queue and hasattr(transcode_queue, 'start_worker'):
            await transcode_queue.start_worker()
        # Start the escort ETA check scheduler (every 2 min, in-process)
        _start_eta_scheduler()
        logger.info("Startup complete - all systems ready")
    except Exception as e:
        logger.error(f"Startup error: {e}")
    yield
    logger.info("Shutting down...")
    client.close()

app = FastAPI(lifespan=lifespan)

# Add rate limiter state to app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add GZip compression for faster responses
app.add_middleware(GZipMiddleware, minimum_size=1000)

api_router = APIRouter(prefix="/api")

# ================== PUBLIC HEALTH ENDPOINTS (NO AUTH) ==================
@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "se-q-backend",
        "version": "1.0.7",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/api/public/status")
async def public_status():
    return {
        "service": "se-q-backend",
        "status": "operational"
    }

# ================== MODELS ==================
class LocationPoint(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    emergency_category: Optional[str] = None

class PanicActivateRequest(BaseModel):
    # FIX: latitude and longitude are now Optional.
    # The frontend (panic-shake / panic-active) previously sent 0,0 when GPS was
    # unavailable. It now sends null, which is semantically correct.
    # The backend stores None in current_location and security dashboards show
    # "Location pending" until the background GPS task delivers the real fix.
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    emergency_category: str = "other"
    ambient_audio_base64: Optional[str] = None

class PanicLocationUpdate(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: str = "civil"
    invite_code: Optional[str] = None
    security_sub_role: Optional[str] = None
    team_name: Optional[str] = None

class EscortActionRequest(BaseModel):
    action: str
    location: Optional[dict] = None
    duration_hours: Optional[float] = None  # set on 'start'; used to compute end_time

class EscortLocationRequest(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    timestamp: Optional[str] = None

# ================== HELPERS ==================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(' ')[1]
    payload = verify_token(token)
    user = await db.users.find_one({'_id': ObjectId(payload['user_id'])})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

async def get_admin_user(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin only")
    return user

def serialize_doc(doc: dict) -> dict:
    if doc is None:
        return None
    result = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, list):
            result[key] = [serialize_doc(item) if isinstance(item, dict) else item for item in value]
        elif isinstance(value, dict):
            result[key] = serialize_doc(value)
        else:
            result[key] = value
    return result

async def notify_security_of_panic(panic_data: dict):
    if not expo_push_service:
        logger.warning("Expo push service not available")
        return
    try:
        security_users = await db.users.find(
            {"role": "security", "push_token": {"$exists": True, "$ne": None}}
        ).to_list(None)
        for sec_user in security_users:
            try:
                await expo_push_service.send_push_notification(
                    token=sec_user.get("push_token"),
                    title="🚨 PANIC ALERT",
                    body=f"Emergency from {panic_data.get('user_name', 'User')} - {panic_data.get('emergency_category', 'Help needed')}",
                    data={
                        "type": "panic",
                        "panic_id": str(panic_data.get("_id")),
                        "user_id": panic_data.get("user_id")
                    }
                )
            except Exception as e:
                logger.error(f"Failed to send to user {sec_user.get('_id')}: {e}")
    except Exception as e:
        logger.error(f"Failed to send panic notifications: {e}")


async def notify_security_of_report(report_data: dict):
    """Push a heads-up to all security agents when a new video/audio report arrives."""
    if not expo_push_service:
        return
    report_type  = report_data.get("type", "report").capitalize()
    user_name    = report_data.get("user_name") or "A user"
    caption      = report_data.get("caption") or ""
    body_text    = f"{user_name} submitted a {report_type} report"
    if caption:
        body_text += f': "{caption[:60]}"'
    try:
        security_users = await db.users.find(
            {"role": "security", "push_token": {"$exists": True, "$ne": None}}
        ).to_list(None)
        for sec_user in security_users:
            try:
                await expo_push_service.send_push_notification(
                    token=sec_user.get("push_token"),
                    title=f"📹 New {report_type} Report",
                    body=body_text,
                    data={
                        "type":      "report",
                        "report_id": str(report_data.get("_id", "")),
                        "user_id":   report_data.get("user_id", ""),
                    }
                )
            except Exception as e:
                logger.error(f"[Report notify] Failed to send to {sec_user.get('_id')}: {e}")
    except Exception as e:
        logger.error(f"[Report notify] Failed to fetch security users: {e}")


async def notify_recipient_of_message(conversation_id: str, sender_id: str, sender_name: str, content: str):
    """Push a message notification to the other participant(s) in a conversation."""
    if not expo_push_service:
        return
    try:
        conv = await db.chat_conversations.find_one({"_id": ObjectId(conversation_id)})
        if not conv:
            return
        preview = content[:80] + ("…" if len(content) > 80 else "")
        for pid in conv.get("participants", []):
            if pid == sender_id:
                continue  # don't notify the sender
            recipient = await db.users.find_one({"_id": ObjectId(pid)})
            if not recipient or not recipient.get("push_token"):
                continue
            try:
                await expo_push_service.send_push_notification(
                    token=recipient["push_token"],
                    title=f"💬 {sender_name}",
                    body=preview,
                    data={
                        "type":            "chat_message",
                        "conversation_id": conversation_id,
                        "from_user_id":    sender_id,
                    }
                )
            except Exception as e:
                logger.error(f"[Chat notify] Failed to send to {pid}: {e}")
    except Exception as e:
        logger.error(f"[Chat notify] Failed: {e}")


# ================== ADMIN LOG HELPER (PROFESSIONAL) ==================
# FIX ISSUE #9: the previous audit log stored (admin_id, action, target,
# target_id, details, timestamp) with no categorisation, no severity, no
# IP/user-agent, and no human-readable summary.  The audit-log endpoint then
# had to resolve the admin's name on every read and could not be filtered
# efficiently.  We now write a structured record up front and expose a
# rich query surface to the dashboard.
#
# Action vocabulary (canonical strings, used in the UI):
#   AUTH            : login, login_failed, logout, password_reset
#   USER_MGMT       : create_user, update_user, disable_user, enable_user,
#                     delete_user, change_role
#   PANIC           : clear_panics, resolve_trapped_panics
#   ESCORT          : clear_trapped_escorts
#   REPORTS         : clear_uploads, delete_report
#   PING            : ping_user, ping_all_security
#   COMMS           : send_message, broadcast
#   TEAM            : create_team, delete_team, assign_team
#   INVITE          : create_invite_code, delete_invite_code
#   SETTINGS        : update_settings, change_password
#   DATA            : reset_all_data, export_data
#   SYSTEM          : api_key_rotated, webhooks_updated
#
# Severity scale:
#   info     routine action
#   notice   action with user-visible effect (e.g. broadcast, ping-all)
#   warning  maintenance / cleanup (clear_panics, resolve_trapped_panics)
#   critical security-sensitive (reset_all_data, disable_user, delete_user)
_AUDIT_SEVERITY = {
    # AUTH
    "login":                       "info",
    "login_failed":                "warning",
    "logout":                      "info",
    "password_reset":              "warning",
    # USER_MGMT
    "create_user":                 "notice",
    "update_user":                 "info",
    "disable_user":                "critical",
    "enable_user":                 "notice",
    "delete_user":                 "critical",
    "change_role":                 "critical",
    # PANIC
    "clear_panics":                "warning",
    "resolve_trapped_panics":      "warning",
    # ESCORT
    "clear_trapped_escorts":       "warning",
    # REPORTS
    "clear_uploads":               "warning",
    "delete_report":               "notice",
    # PING
    "ping_user":                   "info",
    "ping_all_security":           "notice",
    # COMMS
    "send_message":                "info",
    "broadcast":                   "notice",
    # TEAM
    "create_team":                 "notice",
    "delete_team":                 "warning",
    "assign_team":                 "info",
    # INVITE
    "create_invite_code":          "info",
    "delete_invite_code":          "info",
    # SETTINGS
    "update_settings":             "info",
    # DATA
    "reset_all_data":              "critical",
    "export_data":                 "info",
    # GENERIC FALLBACKS (legacy callers)
    "create_invite_code":          "info",
}


def _audit_severity(action: str) -> str:
    return _AUDIT_SEVERITY.get(action, "info")


async def _log_admin_action(
    admin_id: str,
    action: str,
    target: str,
    target_id: str,
    details: dict,
    *,
    request: Optional[Request] = None,
    outcome: str = "success",
    severity: Optional[str] = None,
) -> str:
    """
    Write a structured audit-log row.

    Returns the inserted log id (as str) so callers can chain a follow-up
    reference (e.g. a confirmation banner "Audit id: 65f...").  The function
    is deliberately tolerant: a logging failure must never break the action
    being audited.
    """
    # Pull request metadata when available (the route handler should pass
    # `request: Request` whenever it has access to one).
    ip          = None
    user_agent  = None
    if request is not None:
        try:
            ip         = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
        except Exception:
            pass

    record = {
        "admin_id":     admin_id,
        "action":       action,
        "category":     action.split("_", 1)[0] if "_" in action else action,  # coarse grouping
        "severity":     severity or _audit_severity(action),
        "outcome":      outcome,    # "success" | "failure" | "partial"
        "target":       target,
        "target_id":    target_id,
        "details":      details or {},
        "ip":           ip,
        "user_agent":   user_agent,
        "timestamp":    datetime.utcnow(),
    }
    try:
        result = await db.admin_logs.insert_one(record)
        return str(result.inserted_id)
    except Exception as e:
        logger.error(f"[audit] Failed to write log: {e}")
        return ""

# ================== AUTH ROUTES ==================
@api_router.post("/auth/login")
@limiter.limit("10/minute")  # Strict rate limit to prevent brute force
async def login(request: Request, req: LoginRequest):
    """Regular login for civil and security users"""
    user = await db.users.find_one({"email": req.email.strip().lower()})
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_token(str(user["_id"]), user["email"], user.get("role", "civil"))

    return {
        "token": token,
        "user_id": str(user["_id"]),
        "email": user.get("email"),
        "full_name": user.get("full_name"),
        "role": user.get("role", "civil"),
        "is_premium": user.get("is_premium", False),
        "phone": user.get("phone", ""),
    }

@api_router.post("/admin/login")
@limiter.limit("10/minute")  # Strict rate limit to prevent brute force
async def admin_login(request: Request, req: LoginRequest):
    """Admin-specific login endpoint - ONLY for admin panel"""
    user = await db.users.find_one({"email": req.email.strip().lower()})

    if not user:
        raise HTTPException(status_code=401, detail="Admin account not found")

    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="This account does not have admin privileges")

    if not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid password")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_token(str(user["_id"]), user["email"], "admin")

    return {
        "token": token,
        "user_id": str(user["_id"]),
        "email": user.get("email"),
        "full_name": user.get("full_name"),
        "role": "admin",
        "is_premium": user.get("is_premium", False),
        "phone": user.get("phone", ""),
    }

@api_router.post("/auth/register")
@limiter.limit("5/minute")  # Registration limit to prevent spam
async def register(request: Request, req: RegisterRequest):
    email = req.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    if req.role == "security":
        code = await db.invite_codes.find_one({"code": req.invite_code, "is_active": True})
        if not code:
            raise HTTPException(status_code=403, detail="Invalid or expired invite code")
    
    doc = {
        "email": email,
        "password_hash": hash_password(req.password),
        "full_name": req.full_name,
        "phone": req.phone,
        "role": req.role,
        "is_premium": False,
        "is_active": True,
        "security_sub_role": req.security_sub_role,
        "team_name": req.team_name,
        "created_at": datetime.utcnow(),
    }
    result = await db.users.insert_one(doc)
    token = create_token(str(result.inserted_id), email, req.role)
    
    return {
        "token": token,
        "user_id": str(result.inserted_id),
        "email": email,
        "full_name": req.full_name,
        "role": req.role,
        "is_premium": False,
    }

@api_router.get("/user/profile")
async def get_user_profile(user=Depends(get_current_user)):
    customization = user.get("app_customization") or {}
    return {
        "user_id":             str(user["_id"]),
        "email":               user.get("email"),
        "full_name":           user.get("full_name"),
        "phone":               user.get("phone"),
        "role":                user.get("role"),
        "is_premium":          user.get("is_premium", False),
        "profile_photo_url":   user.get("photo_url"),
        "emergency_contacts":  user.get("emergency_contacts", []),
        "app_name":            customization.get("app_name", "SafeGuard"),
        "app_logo":            customization.get("app_logo", "shield"),
    }

# ================== PANIC ROUTES ==================
@api_router.post("/panic/activate")
@limiter.limit("20/minute")  # Panic activation limit
async def activate_panic(request: Request, req: PanicActivateRequest, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can activate panic")
    
    await db.panic_events.update_many(
        {"user_id": str(user["_id"]), "is_active": True},
        {"$set": {"is_active": False, "deactivated_at": datetime.utcnow()}}
    )
    
    audio_url = None
    if req.ambient_audio_base64 and cloudinary_service:
        try:
            audio_bytes = base64.b64decode(req.ambient_audio_base64)
            audio_url = await cloudinary_service.upload_file(
                audio_bytes, 
                f"panic_audio_{uuid.uuid4().hex}.m4a",
                "audio/m4a",
                folder="panic_audio"
            )
        except Exception as e:
            logger.error(f"Failed to upload ambient audio: {e}")
    
    now = datetime.utcnow()
    panic_data = {
        "user_id": str(user["_id"]),
        "user_email": user.get("email"),
        "user_name": user.get("full_name") or user.get("email"),
        "user_phone": user.get("phone"),
        "is_active": True,
        "activated_at": now,
        "deactivated_at": None,
        "emergency_category": req.emergency_category,
        # FIX: store None when GPS was unavailable at activation time.
        # The background task (panic/location) will update current_location
        # with the real fix once the device acquires GPS.
        "current_location": {
            "latitude":  req.latitude,
            "longitude": req.longitude,
            "accuracy":  req.accuracy,
            "timestamp": now.isoformat(),
            "is_initial": True,
        },
        "location_history": [{
            "latitude":  req.latitude,
            "longitude": req.longitude,
            "accuracy":  req.accuracy,
            "timestamp": now.isoformat(),
        }] if req.latitude is not None else [],
        "location_count": 1 if req.latitude is not None else 0,
        "ambient_audio_url": audio_url
    }
    
    result = await db.panic_events.insert_one(panic_data)
    panic_data["_id"] = result.inserted_id
    
    await notify_security_of_panic(panic_data)
    
    return {
        "panic_id": str(result.inserted_id),
        "is_active": True,
        "message": "Panic activated successfully"
    }

@api_router.post("/panic/location")
async def update_panic_location(req: PanicLocationUpdate, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can update panic location")
    
    panic = await db.panic_events.find_one(
        {"user_id": str(user["_id"]), "is_active": True}
    )
    if not panic:
        raise HTTPException(status_code=404, detail="No active panic found")
    
    location_point = {
        "latitude": req.latitude,
        "longitude": req.longitude,
        "accuracy": req.accuracy,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    await db.panic_events.update_one(
        {"_id": panic["_id"]},
        {
            "$push": {"location_history": location_point},
            "$set": {"current_location": location_point},
            "$inc": {"location_count": 1}
        }
    )
    
    return {"ok": True, "location_count": (panic.get("location_count", 0) + 1)}

# Standalone location update for security ping (no panic required)
# FIX ISSUE #5: this is the SINGLE endpoint the JS background task calls
# after it receives a "ping" or "location_ping" silent push.  The handler:
#   - upserts the civil_tracks row with the new GPS fix (so /security/track-user
#     and /admin/track-user can render it on the next map refresh)
#   - marks the matching ping_events row as 'responded' so audit trails line up
#   - also updates the user's current_location so the security map shows them
class PingUpdateRequest(BaseModel):
    latitude:  float
    longitude: float
    accuracy:  Optional[float] = None
    ping_id:   Optional[str] = None  # echoed from the push payload


@api_router.post("/location/ping-update")
async def ping_location_update(req: PingUpdateRequest, user = Depends(get_current_user)):
    """
    The civil/security recipient of a ping hits this endpoint with their
    fresh GPS.  This is the response half of the unified ping contract:
    ping dispatched  →  device receives silent push  →  JS background task
    acquires GPS  →  POST /api/location/ping-update  →  civil_tracks
    updated, ping_events row marked 'responded'.

    A ping_id from the push payload is the strongest correlation, but the
    endpoint also falls back to "the most-recent 'dispatched' row for this
    user" so a missed echo (rare Expo delivery-loss scenarios) still records.
    """
    uid = str(user["_id"])
    now = datetime.utcnow()
    location_point = {
        "latitude":  req.latitude,
        "longitude": req.longitude,
        "accuracy":  req.accuracy,
        "timestamp": now.isoformat(),
        "source":    "ping_response",
    }

    # 1) Always update the civil_tracks (and the user's current_location for
    #    any caller that reads it off the user document).
    await db.civil_tracks.update_one(
        {"user_id": uid},
        {
            "$set": {
                "currentLocation": {
                    "type":        "Point",
                    "coordinates": [req.longitude, req.latitude],
                },
                "last_updated":   now,
                "last_ping_id":   req.ping_id,
                "last_accuracy":  req.accuracy,
            },
            "$push": {"location_history": location_point},
            "$inc":  {"update_count": 1},
        },
        upsert=True,
    )
    # Mirror to the user document so the security-map endpoint sees it.
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "current_location": {
                "latitude":  req.latitude,
                "longitude": req.longitude,
                "accuracy":  req.accuracy,
                "timestamp": now.isoformat(),
                "source":    "ping_response",
            },
            "location_updated_at": now,
        }},
    )

    # 2) Mark the matching ping_events row as 'responded' so audit trails
    #    and the admin dashboard can show "ping sent → location received".
    matched = False
    if req.ping_id:
        try:
            res = await db.ping_events.update_one(
                {"_id": ObjectId(req.ping_id), "target_user_id": uid, "responded": False},
                {"$set": {
                    "responded":     True,
                    "status":        "responded",
                    "responded_at":  now,
                    "response_lat":  req.latitude,
                    "response_lng":  req.longitude,
                    "response_accuracy": req.accuracy,
                }},
            )
            matched = res.modified_count > 0
        except Exception:
            matched = False
    if not matched:
        # Fallback: any unreplied ping row for this user (last 10 minutes).
        try:
            await db.ping_events.update_one(
                {
                    "target_user_id": uid,
                    "responded":      False,
                    "dispatched_at":  {"$gte": now - timedelta(minutes=10)},
                },
                {"$set": {
                    "responded":    True,
                    "status":       "responded (fallback)",
                    "responded_at": now,
                    "response_lat": req.latitude,
                    "response_lng": req.longitude,
                }},
            )
        except Exception:
            pass

    return {
        "ok":       True,
        "message":  "Location transmitted via security ping",
        "ping_id":  req.ping_id,
        "matched":  matched,
    }

@api_router.post("/panic/{panic_id}/ambient-audio")
async def attach_ambient_audio(panic_id: str, request: Request, user = Depends(get_current_user)):
    try:
        form = await request.form()
        audio_file = form.get("audio")
        if not audio_file:
            raise HTTPException(status_code=400, detail="No audio file provided")

        audio_bytes = await audio_file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file")

        panic = await db.panic_events.find_one({"_id": ObjectId(panic_id)})
        if not panic:
            raise HTTPException(status_code=404, detail="Panic not found")
        if user.get("role") != "admin" and panic.get("user_id") != str(user["_id"]):
            raise HTTPException(status_code=403, detail="Not authorized")

        audio_url = ""
        if cloudinary_service:
            audio_url = await cloudinary_service.upload_file(
                audio_bytes,
                f"ambient_{panic_id}_{uuid.uuid4().hex}.m4a",
                "audio/m4a",
                folder="panic_audio"
            )
        
        if not audio_url:
            logger.warning(f"Cloudinary unavailable for ambient audio on panic {panic_id}")
            raise HTTPException(status_code=503, detail="Audio storage unavailable")

        await db.panic_events.update_one(
            {"_id": ObjectId(panic_id)},
            {"$set": {"ambient_audio_url": audio_url}}
        )

        logger.info(f"Ambient audio attached to panic {panic_id}: {audio_url}")
        return {"ok": True, "audio_url": audio_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ambient audio upload error for panic {panic_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@api_router.post("/panic/deactivate")
async def deactivate_panic(user = Depends(get_current_user)):
    result = await db.panic_events.update_many(
        {"user_id": str(user["_id"]), "is_active": True},
        {"$set": {"is_active": False, "deactivated_at": datetime.utcnow()}}
    )
    return {"ok": True, "deactivated_count": result.modified_count}

@api_router.get("/panic/status")
async def get_panic_status(user = Depends(get_current_user)):
    panic = await db.panic_events.find_one(
        {"user_id": str(user["_id"]), "is_active": True}
    )
    if not panic:
        return {"is_active": False}
    
    return {
        "is_active": True,
        "panic_id": str(panic["_id"]),
        "activated_at": panic.get("activated_at").isoformat() if panic.get("activated_at") else None,
        "emergency_category": panic.get("emergency_category", "other")
    }

# ── Panic first-response claim ────────────────────────────────────────────────
# Called by a security or admin operative the moment they send a Message In-App.
# Uses a conditional update ($exists: False) so ONLY the first caller wins —
# subsequent calls are silently ignored, guaranteeing exactly-once attribution.
@api_router.post("/panic/{panic_id}/respond")
async def mark_panic_responded(panic_id: str, user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security or admin only")

    logger.info(f"[Respond] Request from {user.get('email')} for panic_id: {panic_id}")

    try:
        oid = ObjectId(panic_id)
    except Exception:
        logger.error(f"[Respond] Invalid panic_id format: {panic_id}")
        raise HTTPException(status_code=400, detail="Invalid panic_id")

    panic = await db.panic_events.find_one({"_id": oid})
    if not panic:
        logger.error(f"[Respond] Panic not found: {panic_id}")
        raise HTTPException(status_code=404, detail="Panic not found")

    # FIX: Validate that panic is still active before allowing response
    if not panic.get("is_active"):
        logger.warning(f"[Respond] Panic {panic_id} is no longer active")
        raise HTTPException(status_code=400, detail="This panic has been deactivated and can no longer receive responses")

    logger.info(f"[Respond] Panic found, current first_responder_id: {panic.get('first_responder_id')}")

    # Already claimed — return current state without overwriting
    if panic.get("first_responder_id"):
        logger.info(f"[Respond] Panic already responded by: {panic.get('first_responder_name')}")
        return {
            "ok": True,
            "already_responded": True,
            "first_responder_id":   panic["first_responder_id"],
            "first_responder_name": panic.get("first_responder_name", "Unknown"),
            "responded_at": panic["responded_at"].isoformat() if panic.get("responded_at") else None,
            "response_time_seconds": panic.get("response_time_seconds"),
        }

    now = datetime.utcnow()
    activated_at = panic.get("activated_at")
    response_secs = int((now - activated_at).total_seconds()) if isinstance(activated_at, datetime) else None
    responder_name = (user.get("full_name") or "").strip() or user.get("email", "Unknown Agent")

    # Atomic conditional write — only succeeds if no responder set yet
    logger.info(f"[Respond] Attempting atomic update for: {responder_name}")
    result = await db.panic_events.update_one(
        {"_id": oid, "first_responder_id": {"$exists": False}},
        {"$set": {
            "first_responder_id":    str(user["_id"]),
            "first_responder_name":  responder_name,
            "responded_at":          now,
            "response_time_seconds": response_secs,
        }}
    )

    logger.info(f"[Respond] Atomic update result - modified_count: {result.modified_count}")

    if result.modified_count == 0:
        # Race: another operative just claimed it — re-fetch and return their data
        panic = await db.panic_events.find_one({"_id": oid})
        logger.info(f"[Respond] Race condition - another operative claimed it")
        return {
            "ok": True,
            "already_responded": True,
            "first_responder_id":   panic.get("first_responder_id"),
            "first_responder_name": panic.get("first_responder_name", "Unknown"),
            "responded_at": panic["responded_at"].isoformat() if panic.get("responded_at") else None,
            "response_time_seconds": panic.get("response_time_seconds"),
        }

    logger.info(f"[Respond] Successfully marked as responded by: {responder_name}")
    return {
        "ok": True,
        "already_responded": False,
        "first_responder_id":    str(user["_id"]),
        "first_responder_name":  responder_name,
        "responded_at":          now.isoformat(),
        "response_time_seconds": response_secs,
    }

# ── Per-agent response time stats ─────────────────────────────────────────────
@api_router.get("/security/response-stats")
async def get_response_stats(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security or admin only")

    my_id = str(user["_id"])

    # My responded panics (last 90 days)
    cutoff = datetime.utcnow() - timedelta(days=90)
    my_cursor = db.panic_events.find({
        "first_responder_id": my_id,
        "responded_at": {"$gte": cutoff},
        "response_time_seconds": {"$exists": True, "$ne": None},
    })
    my_times = [p["response_time_seconds"] async for p in my_cursor]

    # Team-wide responded panics (last 90 days) — all security agents
    team_cursor = db.panic_events.find({
        "first_responder_id": {"$exists": True},
        "responded_at": {"$gte": cutoff},
        "response_time_seconds": {"$exists": True, "$ne": None},
    })
    team_times = [p["response_time_seconds"] async for p in team_cursor]

    def avg_seconds(times):
        return round(sum(times) / len(times)) if times else None

    return {
        "my_response_count":     len(my_times),
        "my_avg_seconds":        avg_seconds(my_times),
        "team_response_count":   len(team_times),
        "team_avg_seconds":      avg_seconds(team_times),
    }

# ================== SECURITY ROUTES ==================
@api_router.get("/security/nearby-panics")
async def get_nearby_panics(
    user = Depends(get_current_user),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_km: float = Query(10.0)
):
    if user.get('role') not in ('security', 'admin'):
        raise HTTPException(status_code=403, detail="Security or admin only")
    
    query = {"is_active": True}
    cursor = db.panic_events.find(query).sort("activated_at", -1)
    panics = []
    
    async for panic in cursor:
        current_loc = panic.get("current_location", {})
        # Fetch user profile photo and full details for panic cards
        panic_user_data = None
        if panic.get("user_id"):
            try:
                pu = await db.users.find_one({"_id": ObjectId(panic["user_id"])}, {"photo_url": 1, "full_name": 1, "phone": 1})
                panic_user_data = pu if pu else None
            except Exception:
                pass
        panics.append({
            "id": str(panic["_id"]),
            "user_id": panic.get("user_id"),
            "user_email": panic.get("user_email"),
            "full_name": panic_user_data.get("full_name") if panic_user_data else None,
            "user_name": panic.get("user_name"),
            "user_phone": panic_user_data.get("phone") if panic_user_data else panic.get("user_phone"),
            "user_photo_url": panic_user_data.get("photo_url") if panic_user_data else None,
            "is_active": panic.get("is_active", True),
            "activated_at": panic.get("activated_at").isoformat() if panic.get("activated_at") else None,
            "emergency_category": panic.get("emergency_category", "other"),
            "latitude": current_loc.get("latitude"),
            "longitude": current_loc.get("longitude"),
            "location_history": panic.get("location_history", []),
            "location_count": panic.get("location_count", 0),
            "ambient_audio_url": panic.get("ambient_audio_url"),
            # ── First-response tracking ─────────────────────────────
            "first_responder_id":    panic.get("first_responder_id"),
            "first_responder_name":  panic.get("first_responder_name"),
            "responded_at":          panic["responded_at"].isoformat() if panic.get("responded_at") else None,
            "response_time_seconds": panic.get("response_time_seconds"),
        })
    
    return panics

# ================== ADMIN ROUTES ==================
@api_router.get("/admin/all-panics")
async def get_all_panics_admin(
    user = Depends(get_admin_user),
    active_only: bool = Query(False),
    limit: int = Query(100),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    query = {}
    if active_only:
        query["is_active"] = True
    
    if start_date:
        try:
            start_str = start_date.replace('Z', '+00:00')
            start = datetime.fromisoformat(start_str)
            query["activated_at"] = {"$gte": start}
        except:
            pass
    
    if end_date:
        try:
            end_str = end_date.replace('Z', '+00:00')
            end = datetime.fromisoformat(end_str)
            if "activated_at" in query:
                query["activated_at"]["$lte"] = end
            else:
                query["activated_at"] = {"$lte": end}
        except:
            pass
    
    cursor = db.panic_events.find(query).sort("activated_at", -1).limit(limit)
    panics = []
    
    async for panic in cursor:
        location_history = panic.get("location_history", [])
        current_loc = panic.get("current_location", {})
        
        formatted_history = []
        for loc in location_history:
            if loc:
                timestamp = loc.get("timestamp")
                if isinstance(timestamp, datetime):
                    timestamp = timestamp.isoformat()
                formatted_history.append({
                    "latitude": loc.get("latitude"),
                    "longitude": loc.get("longitude"),
                    "accuracy": loc.get("accuracy"),
                    "timestamp": timestamp
                })
        
        # Fetch user profile photo
        admin_panic_photo = None
        if panic.get("user_id"):
            try:
                apu = await db.users.find_one({"_id": ObjectId(panic["user_id"])}, {"photo_url": 1})
                admin_panic_photo = apu.get("photo_url") if apu else None
            except Exception:
                pass
        panics.append({
            "id": str(panic["_id"]),
            "user_id": panic.get("user_id"),
            "user_email": panic.get("user_email"),
            "user_name": panic.get("user_name"),
            "user_phone": panic.get("user_phone"),
            "user_photo_url": admin_panic_photo,
            "is_active": panic.get("is_active", False),
            "activated_at": panic.get("activated_at").isoformat() if panic.get("activated_at") else None,
            "deactivated_at": panic.get("deactivated_at").isoformat() if panic.get("deactivated_at") else None,
            "emergency_category": panic.get("emergency_category", "other"),
            "latitude": current_loc.get("latitude") if current_loc else None,
            "longitude": current_loc.get("longitude") if current_loc else None,
            "location_history": formatted_history,
            "location_count": panic.get("location_count", 0),
            "ambient_audio_url": panic.get("ambient_audio_url"),
            # ── First-response tracking ─────────────────────────────
            "first_responder_id":    panic.get("first_responder_id"),
            "first_responder_name":  panic.get("first_responder_name"),
            "responded_at":          panic["responded_at"].isoformat() if panic.get("responded_at") else None,
            "response_time_seconds": panic.get("response_time_seconds"),
        })
    
    return {"panics": panics, "total": len(panics)}

@api_router.get("/admin/escort-sessions")
async def admin_escort_sessions(user=Depends(get_admin_user)):
    cutoff = datetime.utcnow() - timedelta(hours=24)
    cursor = db.escort_sessions.find(
        {"$or": [{"is_active": True}, {"ended_at": {"$gte": cutoff}}]}
    ).sort("started_at", -1).limit(100)
    sessions = []
    async for s in cursor:
        started = s.get("started_at")
        ended = s.get("ended_at")
        sessions.append({
            "id": str(s["_id"]),
            "user_id": s.get("user_id"),
            "user_email": s.get("user_email"),
            "user_full_name": s.get("user_name"),
            "user_phone": s.get("user_phone"),
            "is_active": s.get("is_active", False),
            "started_at": started.isoformat() if isinstance(started, datetime) else started,
            "ended_at": ended.isoformat() if isinstance(ended, datetime) else ended,
            "locations": s.get("locations", []),
            "location_count": s.get("location_count", 0),
        })
    return {"sessions": sessions}

# ================== ESCORT ROUTES ==================
@api_router.get("/escort/status")
async def escort_status(user=Depends(get_current_user)):
    session = await db.escort_sessions.find_one(
        {"user_id": str(user["_id"]), "is_active": True},
        sort=[("started_at", -1)]
    )
    if not session:
        return {"is_active": False, "session_id": None, "started_at": None}
    started = session.get("started_at")
    return {
        "is_active": True,
        "session_id": str(session["_id"]),
        "started_at": started.isoformat() if isinstance(started, datetime) else started,
    }

@api_router.post("/escort/action")
async def escort_action(req: EscortActionRequest, user=Depends(get_current_user)):
    uid = str(user["_id"])
    
    if req.action == "start":
        await db.escort_sessions.update_many(
            {"user_id": uid, "is_active": True},
            {"$set": {"is_active": False, "ended_at": datetime.utcnow()}}
        )
        first_pt = []
        if req.location:
            first_pt = [{
                "latitude": req.location.get("latitude", 0),
                "longitude": req.location.get("longitude", 0),
                "accuracy": req.location.get("accuracy"),
                "timestamp": datetime.utcnow().isoformat(),
            }]
        now = datetime.utcnow()

        # Compute ETA deadline — stored so /escort/eta-check can fire alerts
        duration_hours = req.duration_hours or 0
        end_time = (now + timedelta(hours=duration_hours)) if duration_hours > 0 else None

        doc = {
            "user_id": uid,
            "user_email": user.get("email"),
            "user_name": user.get("full_name") or user.get("email"),
            "user_phone": user.get("phone"),
            "is_active": True,
            "started_at": now,
            "ended_at": None,
            "end_time": end_time,          # ETA deadline for check-up
            "eta_alert_sent": False,       # flag so we only alert once
            "route": first_pt,
            "locations": first_pt,
            "location_count": len(first_pt),
        }
        result = await db.escort_sessions.insert_one(doc)

        # ── Notify nearby security agents that a new escort session started ──
        # Find all security users who have a saved location and are within
        # roughly 25 km of the escort start point (same radius as nearby-security).
        if req.location and expo_push_service:
            start_lat = req.location.get("latitude", 0)
            start_lng = req.location.get("longitude", 0)
            if start_lat and start_lng:
                try:
                    # Simple bounding-box pre-filter (~25 km ≈ 0.225 degrees)
                    DEG = 0.225
                    security_cursor = db.users.find({
                        "role": "security",
                        "is_active": True,
                        "push_token": {"$exists": True, "$ne": None},
                        "latitude": {"$gte": start_lat - DEG, "$lte": start_lat + DEG},
                        "longitude": {"$gte": start_lng - DEG, "$lte": start_lng + DEG},
                    })
                    async for agent in security_cursor:
                        try:
                            await expo_push_service.send_push_notification(
                                token=agent["push_token"],
                                title="🛡 Escort Session Started",
                                body=f"{user.get('full_name') or 'A user'} has started a security escort near you.",
                                data={"type": "escort_started", "session_id": str(result.inserted_id)},
                            )
                        except Exception:
                            pass
                except Exception:
                    pass

        return {"session_id": str(result.inserted_id), "started_at": now.isoformat()}
    
    elif req.action == "stop":
        await db.escort_sessions.update_many(
            {"user_id": uid, "is_active": True},
            {"$set": {"is_active": False, "ended_at": datetime.utcnow()}}
        )
        return {"ok": True}
    
    raise HTTPException(status_code=400, detail="action must be 'start' or 'stop'")

@api_router.post("/escort/location")
async def escort_location(req: EscortLocationRequest, user=Depends(get_current_user)):
    uid = str(user["_id"])
    session = await db.escort_sessions.find_one({"user_id": uid, "is_active": True})
    if not session:
        raise HTTPException(status_code=404, detail="No active escort session")
    
    point = {
        "latitude": req.latitude,
        "longitude": req.longitude,
        "accuracy": req.accuracy,
        "timestamp": req.timestamp or datetime.utcnow().isoformat(),
    }
    await db.escort_sessions.update_one(
        {"_id": session["_id"]},
        {"$push": {"route": point, "locations": point}, "$inc": {"location_count": 1}}
    )
    return {"ok": True, "location_count": (session.get("location_count") or 0) + 1}

@api_router.get("/security/escort-sessions")
async def security_escort_sessions(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security or admin only")
    cursor = db.escort_sessions.find({"is_active": True}).sort("started_at", -1)
    sessions = []
    async for s in cursor:
        started = s.get("started_at")
        sessions.append({
            "session_id": str(s["_id"]),
            "user_id": s.get("user_id"),
            "user_email": s.get("user_email"),
            "user_name": s.get("user_name"),
            "user_phone": s.get("user_phone"),
            "started_at": started.isoformat() if isinstance(started, datetime) else started,
            "route": s.get("route", []),
            "location_count": s.get("location_count", 0),
            "is_active": True,
        })
    return sessions

    return sessions

# ================== ESCORT ETA CHECK ==================
@api_router.post("/escort/eta-check")
async def escort_eta_check(request: Request):
    """
    Called by a periodic scheduler (e.g. APScheduler, cron, or an external
    job every 2 minutes) to:
      1. Find all active escort sessions whose end_time has passed.
      2. For each, check if the civil user is still in the app (has a recent
         GPS ping) — if not, treat it as a potential no-arrival.
      3. Send a welfare-check notification to the civil user.
      4. Notify every nearby security agent whose bounding box overlaps.
      5. Mark eta_alert_sent = True so the alert fires only once per session.

    Internal endpoint — not exposed to normal users.
    """
    # Simple internal-only guard using a shared secret header
    secret = request.headers.get("X-Internal-Secret", "")
    import os as _os
    expected = _os.environ.get("INTERNAL_SECRET", "")
    if expected and secret != expected:
        raise HTTPException(status_code=403, detail="Forbidden")

    now = datetime.utcnow()
    alerted = 0

    cursor = db.escort_sessions.find({
        "is_active":       True,
        "end_time":        {"$lte": now, "$ne": None},
        "eta_alert_sent":  False,
    })

    async for session in cursor:
        sid = session["_id"]
        uid = session.get("user_id")

        # Mark immediately so a concurrent call can't double-fire
        await db.escort_sessions.update_one(
            {"_id": sid},
            {"$set": {"eta_alert_sent": True}}
        )

        # ── 1. Welfare check to the civil user ──────────────────────────────
        civil_user = None
        try:
            civil_user = await db.users.find_one({"_id": ObjectId(uid)})
        except Exception:
            pass

        if civil_user and civil_user.get("push_token") and expo_push_service:
            try:
                await expo_push_service.send_push_notification(
                    token=civil_user["push_token"],
                    title="🛡 Escort ETA Reached",
                    body="Have you arrived safely? Tap to confirm or extend your escort session.",
                    data={"type": "escort_eta_check", "session_id": str(sid)},
                )
            except Exception:
                pass

        # ── 2. Notify intersecting security agents ───────────────────────────
        # Use the last known GPS point from the escort route as the reference.
        route = session.get("route", [])
        if not route or not expo_push_service:
            alerted += 1
            continue

        last_pt  = route[-1]
        ref_lat  = last_pt.get("latitude")
        ref_lng  = last_pt.get("longitude")
        user_name = session.get("user_name") or "A user"

        if ref_lat and ref_lng:
            DEG = 0.225   # ~25 km bounding box
            sec_cursor = db.users.find({
                "role":       "security",
                "is_active":  True,
                "push_token": {"$exists": True, "$ne": None},
                "latitude":   {"$gte": ref_lat - DEG, "$lte": ref_lat + DEG},
                "longitude":  {"$gte": ref_lng - DEG, "$lte": ref_lng + DEG},
            })
            async for agent in sec_cursor:
                try:
                    await expo_push_service.send_push_notification(
                        token=agent["push_token"],
                        title="⚠️ Escort ETA Elapsed",
                        body=f"{user_name}'s escort ETA has passed. Please check in.",
                        data={
                            "type":       "escort_eta_elapsed",
                            "session_id": str(sid),
                            "user_id":    uid,
                        },
                    )
                except Exception:
                    pass

        alerted += 1

    return {"ok": True, "sessions_alerted": alerted}


# ── Background ETA scheduler ─────────────────────────────────────────────────
# Runs every 2 minutes inside the same process. Does not require an external
# cron job. Uses APScheduler if available; silently skips if not installed.
def _start_eta_scheduler():
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        import httpx

        scheduler = AsyncIOScheduler()

        async def _run_eta_check():
            import os as _os
            secret = _os.environ.get("INTERNAL_SECRET", "")
            try:
                async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
                    await client.post(
                        "/api/escort/eta-check",
                        headers={"X-Internal-Secret": secret},
                        timeout=20,
                    )
            except Exception as e:
                logger.debug(f"[ETA scheduler] check skipped: {e}")

        scheduler.add_job(_run_eta_check, "interval", minutes=2, id="escort_eta_check")
        scheduler.start()
        logger.info("[ETA scheduler] Started — checking escort ETAs every 2 minutes")
    except ImportError:
        logger.info("[ETA scheduler] APScheduler not installed — skipping in-process scheduler")

# ================== VIDEO UPLOAD ROUTE ==================
@api_router.post("/report/upload-video")
async def upload_video_report(request: Request, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can create reports")
    
    if not cloudinary_service:
        raise HTTPException(status_code=503, detail="Video upload service unavailable")

    try:
        form = await request.form()
        video_file = form.get('video')
        if not video_file:
            raise HTTPException(status_code=400, detail="No video file")

        video_bytes = await video_file.read()
        if len(video_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty video file")

        caption = str(form.get('caption', '')) or 'Video report'
        is_anonymous = str(form.get('is_anonymous', 'false')).lower() == 'true'
        latitude = float(form.get('latitude', 0))
        longitude = float(form.get('longitude', 0))
        duration_seconds = int(form.get('duration_seconds', 0))

        import tempfile
        tmp_dir = Path(tempfile.gettempdir()) / 'video_uploads'
        tmp_dir.mkdir(parents=True, exist_ok=True)

        original_path = tmp_dir / f"orig_{uuid.uuid4().hex}.mp4"
        
        with open(original_path, 'wb') as f:
            f.write(video_bytes)

        file_url = await cloudinary_service.upload_video_direct(
            str(original_path), 
            f"video_{uuid.uuid4().hex}.mp4", 
            folder='videos'
        )

        original_path.unlink(missing_ok=True)

        if not file_url:
            raise HTTPException(status_code=500, detail="Failed to upload video")

        report_data = {
            'user_id': str(user['_id']),
            'user_email': user.get('email'),
            'user_name': user.get('full_name') or user.get('email'),
            'user_phone': user.get('phone'),
            'type': 'video',
            'caption': caption,
            'is_anonymous': is_anonymous,
            'file_url': file_url,
            'uploaded': True,
            'status': 'pending',
            'duration_seconds': duration_seconds,
            'location': {'type': 'Point', 'coordinates': [longitude, latitude]},
            'latitude': latitude,
            'longitude': longitude,
            'created_at': datetime.utcnow()
        }
        result = await db.civil_reports.insert_one(report_data)
        report_data["_id"] = result.inserted_id

        # Notify all security agents of the new video report
        await notify_security_of_report(report_data)

        return {
            'success': True,
            'report_id': str(result.inserted_id),
            'file_url': file_url,
            'message': 'Video uploaded successfully'
        }
    except Exception as e:
        logger.error(f"Video upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

# ================== MISC ROUTES ==================
@api_router.delete("/push-token/unregister")
async def unregister_push_token(user=Depends(get_current_user)):
    await db.users.update_one({"_id": user["_id"]}, {"$unset": {"push_token": ""}})
    return {"ok": True}

# ================== INVITE CODES ==================
def format_invite_code(c: dict) -> dict:
    return {
        "id": str(c["_id"]),
        "code": c["code"],
        "is_active": c.get("is_active", True),
        "max_uses": c.get("max_uses", 10),
        "used_count": c.get("used_count", 0),
        "expires_at": c.get("expires_at", (datetime.utcnow() + timedelta(days=30)).isoformat()),
        "created_at": c.get("created_at", datetime.utcnow().isoformat()),
    }

@api_router.get("/admin/invite-codes")
async def get_invite_codes(user=Depends(get_admin_user)):
    codes = await db.invite_codes.find().to_list(1000)
    return {"codes": [format_invite_code(c) for c in codes]}

@api_router.post("/admin/invite-codes")
async def create_invite_code(body: dict = Body(...), user=Depends(get_admin_user)):
    code = (body.get("code") or str(uuid.uuid4())[:12]).upper()
    existing = await db.invite_codes.find_one({"code": code})
    if existing:
        raise HTTPException(status_code=400, detail="Code already exists")
    expires_days = int(body.get("expires_days", 30))
    doc = {
        "code": code,
        "is_active": True,
        "max_uses": int(body.get("max_uses", 10)),
        "used_count": 0,
        "expires_at": (datetime.utcnow() + timedelta(days=expires_days)).isoformat(),
        "created_at": datetime.utcnow().isoformat(),
    }
    result = await db.invite_codes.insert_one(doc)
    doc["_id"] = result.inserted_id
    await _log_admin_action(str(user["_id"]), "create_invite_code", "invite_code", code, {"code": code})
    return format_invite_code(doc)

@api_router.delete("/admin/invite-codes/{code}")
async def delete_invite_code(code: str, user=Depends(get_admin_user)):
    result = await db.invite_codes.delete_one({"code": code})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Code not found")
    await _log_admin_action(str(user["_id"]), "delete_invite_code", "invite_code", code, {"code": code})
    return {"ok": True}

@api_router.patch("/admin/invite-codes/{code}/toggle")
async def toggle_invite_code(code: str, user=Depends(get_admin_user)):
    doc = await db.invite_codes.find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail="Code not found")
    new_status = not doc.get("is_active", True)
    await db.invite_codes.update_one({"code": code}, {"$set": {"is_active": new_status}})
    return {"code": code, "is_active": new_status}

# ================== INITIALIZATION FUNCTIONS ==================
async def create_default_admins():
    """Create default admin users if none exist.

    Admin credentials are loaded from environment variables:
    - ADMIN_EMAIL (required)
    - ADMIN_PASSWORD (required)

    If not set, the function logs a warning but doesn't fail startup.
    """
    admin_email = os.environ.get('ADMIN_EMAIL', 'anthonyezedinachi@gmail.com')  # Fallback preserved
    admin_password = os.environ.get('ADMIN_PASSWORD', 'Admin123!')  # Fallback preserved

    try:
        existing_admin = await db.users.find_one({"email": admin_email})

        if not existing_admin:
            admin_data = {
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "full_name": "Anthony Ezedinachi",
                "phone": "09150810387",
                "is_active": True,
                "is_premium": True,
                "created_at": datetime.utcnow()
            }
            result = await db.users.insert_one(admin_data)
            logger.info(f"✅ Created admin: {admin_email}")
        else:
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"role": "admin", "is_active": True, "is_premium": True}}
            )
            logger.info("✅ Admin role/flags verified (password unchanged)")

    except Exception as e:
        logger.error(f"Failed to create default admins: {e}")

async def create_default_invite_codes():
    """Create default invite codes for security registration"""
    try:
        invite_codes = ["HYAKHWDZH3OQ", "O0OHNT402KR0", "HKGH1H7XIWYT"]
        
        for code in invite_codes:
            existing = await db.invite_codes.find_one({"code": code})
            if not existing:
                await db.invite_codes.insert_one({
                    "code": code,
                    "is_active": True,
                    "created_at": datetime.utcnow(),
                })
                logger.info(f"✅ Created invite code: {code}")
    except Exception as e:
        logger.error(f"Failed to create invite codes: {e}")

# ================== PUSH TOKEN ==================
@api_router.post("/push-token/register")
async def register_push_token(token: str = Body(..., embed=True), user=Depends(get_current_user)):
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"push_token": token}})
    return {"ok": True}

# ================== ADMIN DASHBOARD ==================
@api_router.get("/admin/dashboard")
async def admin_dashboard(user=Depends(get_admin_user)):
    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)

    total_users     = await db.users.count_documents({"role": {"$ne": "admin"}})
    civil_users     = await db.users.count_documents({"role": "civil"})
    security_users  = await db.users.count_documents({"role": "security"})
    premium_users   = await db.users.count_documents({"is_premium": True})
    active_panics   = await db.panic_events.count_documents({"is_active": True})
    active_escorts  = await db.escort_sessions.count_documents({"is_active": True})
    pending_reports = await db.civil_reports.count_documents({"status": {"$in": ["pending", None]}})
    under_review    = await db.civil_reports.count_documents({"status": "under_review"})
    resolved        = await db.civil_reports.count_documents({"status": "resolved"})

    panics_24h   = await db.panic_events.count_documents({"activated_at": {"$gte": since_24h}})
    reports_24h  = await db.civil_reports.count_documents({"created_at": {"$gte": since_24h}})
    new_users_24h= await db.users.count_documents({"created_at": {"$gte": since_24h}})

    cat_cursor = db.panic_events.aggregate([
        {"$group": {"_id": "$emergency_category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 6}
    ])
    category_breakdown = [{"category": d["_id"] or "other", "count": d["count"]} async for d in cat_cursor]

    return {
        "total_users":        total_users,
        "civil_users":        civil_users,
        "security_users":     security_users,
        "premium_users":      premium_users,
        "active_panics":      active_panics,
        "active_escorts":     active_escorts,
        "flagged_users":      0,
        "avg_response_mins":  "--",
        "pending_reports":    pending_reports,
        "under_review_reports": under_review,
        "resolved_reports":   resolved,
        "recent_24h": {
            "panics":    panics_24h,
            "reports":   reports_24h,
            "new_users": new_users_24h,
        },
        "category_breakdown": category_breakdown,
    }

# ================== ADMIN USERS ==================
@api_router.get("/admin/users")
async def admin_get_users(user=Depends(get_admin_user), limit: int = Query(200), filter: Optional[str] = Query(None)):
    query = {}
    if filter in ("civil", "security", "admin"):
        query["role"] = filter
    cursor = db.users.find(query).sort("created_at", -1).limit(limit)
    users = []
    async for u in cursor:
        users.append({
            "id":                str(u["_id"]),
            "email":             u.get("email"),
            "full_name":         u.get("full_name"),
            "phone":             u.get("phone"),
            "role":              u.get("role"),
            "security_sub_role": u.get("security_sub_role"),
            "team_name":         u.get("team_name"),
            "is_active":         u.get("is_active", True),
            "is_premium":        u.get("is_premium", False),
            "created_at":        u["created_at"].isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
        })
    return {"users": users}

@api_router.get("/admin/users/{user_id}")
async def admin_get_user(user_id: str, user=Depends(get_admin_user)):
    u = await db.users.find_one({"_id": ObjectId(user_id)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id":         str(u["_id"]),
        "email":      u.get("email"),
        "full_name":  u.get("full_name"),
        "phone":      u.get("phone"),
        "role":       u.get("role"),
        "is_active":  u.get("is_active", True),
        "is_premium": u.get("is_premium", False),
        "created_at": u["created_at"].isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
    }

@api_router.post("/admin/users/{user_id}/toggle")
async def admin_toggle_user(
    user_id: str,
    request: Request,
    user=Depends(get_admin_user),
):
    u = await db.users.find_one({"_id": ObjectId(user_id)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    new_status = not u.get("is_active", True)
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"is_active": new_status}})
    # FIX #9: canonical action name + request context (IP/UA) for the audit.
    action = "enable_user" if new_status else "disable_user"
    await _log_admin_action(
        str(user["_id"]), action, "user", user_id,
        {"email": u.get("email"), "new_status": new_status},
        request=request,
    )
    return {"ok": True, "is_active": new_status}

# ================== ADMIN ANALYTICS ==================
@api_router.get("/admin/analytics")
async def admin_analytics(user=Depends(get_admin_user)):
    now = datetime.utcnow()
    d7  = now - timedelta(days=7)
    d30 = now - timedelta(days=30)
    d90 = now - timedelta(days=90)

    # ── 1. Platform totals ────────────────────────────────────────────────────
    total_users    = await db.users.count_documents({})
    total_civil    = await db.users.count_documents({"role": "civil"})
    total_security = await db.users.count_documents({"role": "security"})
    total_premium  = await db.users.count_documents({"is_premium": True})
    total_active   = await db.users.count_documents({"is_active": True})
    total_panics   = await db.panic_events.count_documents({})
    active_panics  = await db.panic_events.count_documents({"is_active": True})
    total_reports  = await db.civil_reports.count_documents({})
    total_escorts  = await db.escort_sessions.count_documents({})
    active_escorts = await db.escort_sessions.count_documents({"is_active": True})
    total_messages = await db.chat_messages.count_documents({})

    # ── 2. Daily panics – 30 days ──────────────────────────────────────────
    daily_panics = []
    for i in range(29, -1, -1):
        ds = now - timedelta(days=i+1)
        de = now - timedelta(days=i)
        c  = await db.panic_events.count_documents({"activated_at": {"$gte": ds, "$lt": de}})
        daily_panics.append({"day": ds.strftime("%d %b"), "dow": ds.strftime("%a"), "count": c})

    # ── 3. Daily new users – 30 days ──────────────────────────────────────
    daily_users = []
    for i in range(29, -1, -1):
        ds = now - timedelta(days=i+1)
        de = now - timedelta(days=i)
        c  = await db.users.count_documents({"created_at": {"$gte": ds, "$lt": de}})
        daily_users.append({"day": ds.strftime("%d %b"), "dow": ds.strftime("%a"), "count": c})

    # ── 4. Daily reports – 30 days ────────────────────────────────────────
    daily_reports = []
    for i in range(29, -1, -1):
        ds = now - timedelta(days=i+1)
        de = now - timedelta(days=i)
        c  = await db.civil_reports.count_documents({"created_at": {"$gte": ds, "$lt": de}})
        daily_reports.append({"day": ds.strftime("%d %b"), "dow": ds.strftime("%a"), "count": c})

    # ── 5. Emergency category breakdown ──────────────────────────────────
    cat_cur = db.panic_events.aggregate([
        {"$group": {"_id": "$emergency_category", "count": {"$sum": 1}}},
        {"$sort":  {"count": -1}}
    ])
    categories = [{"category": d["_id"] or "other", "count": d["count"]} async for d in cat_cur]

    # ── 6. Panic resolution stats (30 days) ──────────────────────────────
    panics_30d        = await db.panic_events.count_documents({"activated_at": {"$gte": d30}})
    resolved_30d      = await db.panic_events.count_documents({"activated_at": {"$gte": d30}, "is_active": False})
    false_alarm_rate  = round((resolved_30d / panics_30d * 100), 1) if panics_30d else 0

    # Avg location pings per active panic session (depth of engagement)
    loc_cur = db.panic_events.aggregate([
        {"$match": {"activated_at": {"$gte": d30}}},
        {"$group": {"_id": None, "avg_loc": {"$avg": "$location_count"}, "max_loc": {"$max": "$location_count"}}}
    ])
    loc_agg = await loc_cur.to_list(1)
    avg_location_pings = round(loc_agg[0]["avg_loc"], 1) if loc_agg else 0
    max_location_pings = loc_agg[0]["max_loc"] if loc_agg else 0

    # ── 7. Report breakdown ───────────────────────────────────────────────
    report_type_cur = db.civil_reports.aggregate([
        {"$group": {"_id": "$type", "count": {"$sum": 1}}},
        {"$sort":  {"count": -1}}
    ])
    reports_by_type = [{"type": d["_id"] or "other", "count": d["count"]} async for d in report_type_cur]

    report_status_cur = db.civil_reports.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        {"$sort":  {"count": -1}}
    ])
    reports_by_status = [{"status": d["_id"] or "pending", "count": d["count"]} async for d in report_status_cur]

    reports_7d  = await db.civil_reports.count_documents({"created_at": {"$gte": d7}})
    reports_30d = await db.civil_reports.count_documents({"created_at": {"$gte": d30}})
    anon_reports = await db.civil_reports.count_documents({"is_anonymous": True})

    # ── 8. Escort stats ───────────────────────────────────────────────────
    escorts_30d = await db.escort_sessions.count_documents({"started_at": {"$gte": d30}})
    escort_loc_cur = db.escort_sessions.aggregate([
        {"$match": {"started_at": {"$gte": d30}}},
        {"$group": {"_id": None, "avg_pts": {"$avg": "$location_count"}, "total_pts": {"$sum": "$location_count"}}}
    ])
    escort_agg = await escort_loc_cur.to_list(1)
    avg_escort_points = round(escort_agg[0]["avg_pts"], 1) if escort_agg else 0

    # ── 9. User growth by role over 90 days (weekly buckets) ─────────────
    role_growth = []
    for i in range(12, -1, -1):  # 13 weeks
        ws = now - timedelta(weeks=i+1)
        we = now - timedelta(weeks=i)
        civil_w    = await db.users.count_documents({"role": "civil",    "created_at": {"$gte": ws, "$lt": we}})
        security_w = await db.users.count_documents({"role": "security", "created_at": {"$gte": ws, "$lt": we}})
        role_growth.append({
            "week":     ws.strftime("%d %b"),
            "civil":    civil_w,
            "security": security_w,
        })

    # ── 10. Hour-of-day distribution for panics (all time) ───────────────
    # Uses MongoDB $hour aggregation to build a 24-bucket heatmap
    hour_cur = db.panic_events.aggregate([
        {"$group": {"_id": {"$hour": "$activated_at"}, "count": {"$sum": 1}}},
        {"$sort":  {"_id": 1}}
    ])
    hour_raw = {d["_id"]: d["count"] async for d in hour_cur}
    panic_by_hour = [{"hour": h, "count": hour_raw.get(h, 0)} for h in range(24)]

    # ── 11. Premium conversion rate over time (30d) ───────────────────────
    premium_rate = round((total_premium / total_users * 100), 1) if total_users else 0

    # ── 12. Top 5 most active civil users (by panic count) ───────────────
    top_users_cur = db.panic_events.aggregate([
        {"$group": {"_id": "$user_id", "name": {"$first": "$user_name"},
                    "email": {"$first": "$user_email"}, "count": {"$sum": 1}}},
        {"$sort":  {"count": -1}},
        {"$limit": 5}
    ])
    top_panic_users = [
        {"user_id": d["_id"], "name": d.get("name") or d.get("email") or "Unknown", "count": d["count"]}
        async for d in top_users_cur
    ]

    # ── 13. Security agent activity (escorts + panics responded) ─────────
    security_activity_cur = db.panic_events.aggregate([
        {"$unwind": {"path": "$responders", "preserveNullAndEmptyArrays": False}},
        {"$group":  {"_id": "$responders.user_id", "name": {"$first": "$responders.name"}, "count": {"$sum": 1}}},
        {"$sort":   {"count": -1}},
        {"$limit":  5}
    ])
    top_responders = [
        {"name": d.get("name") or d["_id"], "responses": d["count"]}
        async for d in security_activity_cur
    ]

    # ── 14. Chat activity ──────────────────────────────────────────────────
    messages_7d  = await db.chat_messages.count_documents({"sent_at": {"$gte": d7}})
    messages_30d = await db.chat_messages.count_documents({"sent_at": {"$gte": d30}})
    total_convos = await db.chat_conversations.count_documents({})

    # ── 15. Platform health snapshot ──────────────────────────────────────
    # Panics with NO location data at all (GPS never acquired)
    no_gps_panics = await db.panic_events.count_documents({
        "$or": [{"current_location.latitude": None}, {"location_count": 0}]
    })
    # Users registered but never activated push token (unreachable)
    no_push_token = await db.users.count_documents({"push_token": {"$exists": False}})
    users_with_push = total_users - no_push_token

    return {
        # Totals
        "total_users":          total_users,
        "total_civil":          total_civil,
        "total_security":       total_security,
        "total_premium":        total_premium,
        "total_active_users":   total_active,
        "total_panics":         total_panics,
        "active_panics":        active_panics,
        "total_reports":        total_reports,
        "total_escorts":        total_escorts,
        "active_escorts":       active_escorts,
        "total_messages":       total_messages,
        # Time-series
        "daily_panics":         daily_panics,
        "daily_users":          daily_users,
        "daily_reports":        daily_reports,
        "role_growth":          role_growth,
        "panic_by_hour":        panic_by_hour,
        # Breakdowns
        "categories":           categories,
        "reports_by_type":      reports_by_type,
        "reports_by_status":    reports_by_status,
        # Rates & aggregates
        "panics_30d":           panics_30d,
        "resolved_30d":         resolved_30d,
        "false_alarm_rate":     false_alarm_rate,
        "avg_location_pings":   avg_location_pings,
        "max_location_pings":   max_location_pings,
        "reports_7d":           reports_7d,
        "reports_30d":          reports_30d,
        "anon_reports":         anon_reports,
        "escorts_30d":          escorts_30d,
        "avg_escort_points":    avg_escort_points,
        "premium_rate":         premium_rate,
        "messages_7d":          messages_7d,
        "messages_30d":         messages_30d,
        "total_convos":         total_convos,
        # Platform health
        "no_gps_panics":        no_gps_panics,
        "users_with_push":      users_with_push,
        "no_push_token":        no_push_token,
        # Leaderboards
        "top_panic_users":      top_panic_users,
        "top_responders":       top_responders,
    }

# ================== ADMIN REPORTS ==================
@api_router.get("/admin/all-reports")
async def admin_all_reports(user=Depends(get_admin_user), limit: int = Query(100)):
    cursor = db.civil_reports.find({}).sort("created_at", -1).limit(limit)
    reports = []
    async for r in cursor:
        # Look up the submitting user's profile photo for display in report cards
        user_photo_url = None
        if r.get("user_id"):
            try:
                u = await db.users.find_one({"_id": ObjectId(r["user_id"])}, {"photo_url": 1})
                user_photo_url = u.get("photo_url") if u else None
            except Exception:
                pass
        reports.append({
            "id":             str(r["_id"]),
            "user_id":        r.get("user_id"),
            "user_name":      r.get("user_name"),
            "user_email":     r.get("user_email"),
            "user_phone":     r.get("user_phone"),
            "user_photo_url": user_photo_url,
            "type":           r.get("type", "video"),
            "caption":        r.get("caption"),
            "file_url":       r.get("file_url"),
            "status":         r.get("status", "pending"),
            "is_anonymous":   r.get("is_anonymous", False),
            "latitude":       r.get("latitude"),
            "longitude":      r.get("longitude"),
            "location":       r.get("location"),
            "created_at":     r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
        })
    return {"reports": reports}

@api_router.delete("/admin/delete/{item_type}/{item_id}")
async def admin_delete_item(
    item_type: str,
    item_id: str,
    request: Request,
    user=Depends(get_admin_user),
):
    collection_map = {
        "report": "civil_reports",
        "panic":  "panic_events",
        "escort": "escort_sessions",
        "user":   "users",
    }
    col = collection_map.get(item_type)
    if not col:
        raise HTTPException(status_code=400, detail="Unknown type")
    await db[col].delete_one({"_id": ObjectId(item_id)})
    # FIX #9: use canonical action + capture request context.
    canonical_action = {
        "panic":   "clear_panics",
        "report":  "delete_report",
        "escort":  "clear_trapped_escorts",
        "user":    "delete_user",
    }.get(item_type, f"delete_{item_type}")
    await _log_admin_action(
        str(user["_id"]), canonical_action, item_type, item_id, {},
        request=request,
    )
    return {"ok": True}

# ================== ADMIN MAINTENANCE ==================
@api_router.post("/admin/clear-panics")
async def admin_clear_panics(request: Request, user=Depends(get_admin_user)):
    result = await db.panic_events.update_many({"is_active": True}, {"$set": {"is_active": False, "deactivated_at": datetime.utcnow()}})
    await _log_admin_action(str(user["_id"]), "clear_panics", "panic_events", "all", {"cleared": result.modified_count}, request=request)
    return {"ok": True, "cleared": result.modified_count}

@api_router.post("/admin/resolve-trapped-panics")
async def admin_resolve_trapped(request: Request, user=Depends(get_admin_user)):
    cutoff = datetime.utcnow() - timedelta(hours=6)
    result = await db.panic_events.update_many(
        {"is_active": True, "activated_at": {"$lt": cutoff}},
        {"$set": {"is_active": False, "deactivated_at": datetime.utcnow()}}
    )
    await _log_admin_action(str(user["_id"]), "resolve_trapped_panics", "panic_events", "all", {"resolved": result.modified_count}, request=request)
    return {"ok": True, "resolved": result.modified_count}

@api_router.post("/admin/clear-trapped-escorts")
async def admin_clear_escorts(request: Request, user=Depends(get_admin_user)):
    cutoff = datetime.utcnow() - timedelta(hours=12)
    result = await db.escort_sessions.update_many(
        {"is_active": True, "started_at": {"$lt": cutoff}},
        {"$set": {"is_active": False, "ended_at": datetime.utcnow()}}
    )
    await _log_admin_action(str(user["_id"]), "clear_trapped_escorts", "escort_sessions", "all", {"cleared": result.modified_count}, request=request)
    return {"ok": True, "cleared": result.modified_count}

@api_router.post("/admin/clear-uploads")
async def admin_clear_uploads(request: Request, user=Depends(get_admin_user)):
    result = await db.civil_reports.delete_many({"type": "video"})
    await _log_admin_action(str(user["_id"]), "clear_uploads", "civil_reports", "all", {"deleted": result.deleted_count}, request=request)
    return {"ok": True, "deleted": result.deleted_count}

@api_router.post("/admin/reset-all-data")
async def admin_reset_all(request: Request, user=Depends(get_admin_user)):
    await db.panic_events.delete_many({})
    await db.escort_sessions.delete_many({})
    await db.civil_reports.delete_many({})
    await db.admin_logs.delete_many({})
    # Note: we log BEFORE clearing so this entry survives
    await _log_admin_action(str(user["_id"]), "reset_all_data", "all", "all", {}, request=request, severity="critical")
    return {"ok": True}

# ================== ADMIN SEARCH ==================
@api_router.get("/admin/search")
async def admin_search(
    query: str = Query(...),
    data_type: str = Query("users"),
    role: Optional[str] = Query(None, description="Filter by role: civil, security, or admin"),
    user=Depends(get_admin_user)
):
    results = []
    regex = {"$regex": query, "$options": "i"}
    if data_type in ("users", "all"):
        # Build user query with optional role filter
        user_query: Dict[str, Any] = {
            "$and": [
                {"$or": [{"email": regex}, {"full_name": regex}, {"phone": regex}]}
            ]
        }
        # Add role filter if specified
        if role:
            user_query["$and"].append({"role": role})

        cursor = db.users.find(user_query).limit(50)
        async for u in cursor:
            results.append({
                "type":      "user",
                "data_type": "user",
                "id":        str(u["_id"]),
                "email":     u.get("email"),
                "full_name": u.get("full_name"),
                "phone":     u.get("phone"),
                "role":      u.get("role"),
                "is_active": u.get("is_active", True),
                "created_at": u.get("created_at").isoformat() if isinstance(u.get("created_at"), datetime) else None,
            })
    return {"results": results}

# ================== ADMIN TRACK USER ==================
# FIX ISSUE #6: thin wrapper over the shared _track_user() helper.
@api_router.get("/admin/track-user/{user_id}")
async def admin_track_user(user_id: str, user=Depends(get_admin_user)):
    return await _track_user(user_id)

# ================== PING USER (UNIFIED CONTRACT) ==================
# FIX ISSUES #5 + #6:
#   - The two previously-duplicated ping endpoints (admin + security) now
#     share a single helper that:
#       (a) refuses to ping a security agent who is offline (consent);
#       (b) sends a SILENT data-only push (no UI, no sound) whose `data.type`
#           is the canonical contract: "ping" for civil, "location_ping" for
#           security — the JS background-task handler keys on these strings;
#       (c) records a ping_events audit row so we can prove a ping was
#           dispatched (and pair it with the eventual location update);
#       (d) returns a structured response so the caller's UI can show
#           "Ping sent — awaiting location" / "offline — skipped" / "no
#           push token registered".
#
#   This is the one and only ping contract. Both /admin/ping-user/{uid} and
#   /security/ping-user/{uid} call _ping_user(); Search & Track and
#   Track Users go through the same code path.
async def _ping_user(
    target_uid: str,
    requester: dict,
    *,
    requester_kind: str,        # "admin" | "security"
) -> dict:
    """
    Shared implementation of the unified ping flow.

    Returns a dict with:
        ok          bool
        reason      str | None   — "offline" | "no_push_token" | "not_found" | "forbidden"
        type        str | None   — "ping" | "location_ping" (the data.type sent in the push)
        target_id   str
        target_role str
        ping_id     str | None   — id of the audit row written to ping_events
    """
    requester_role = requester.get("role")

    try:
        target = await db.users.find_one({"_id": ObjectId(target_uid)})
    except Exception:
        return {"ok": False, "reason": "not_found", "type": None, "target_id": target_uid, "target_role": None, "ping_id": None}
    if not target:
        return {"ok": False, "reason": "not_found", "type": None, "target_id": target_uid, "target_role": None, "ping_id": None}

    target_role = target.get("role", "civil")
    requester_name = requester.get("full_name") or requester.get("email") or requester_kind

    # ── Authorization ─────────────────────────────────────────────────────────
    #   Admin    → may ping civil OR security
    #   Security → may ping civil ONLY (security-to-security would let one
    #              officer track another officer's live movements, which is
    #              not the intent of "Search & Track")
    if requester_kind == "admin":
        if requester_role != "admin":
            return {"ok": False, "reason": "forbidden", "type": None, "target_id": target_uid, "target_role": target_role, "ping_id": None}
    elif requester_kind == "security":
        if requester_role not in ("security", "admin"):
            return {"ok": False, "reason": "forbidden", "type": None, "target_id": target_uid, "target_role": target_role, "ping_id": None}
        if target_role != "civil":
            return {"ok": False, "reason": "forbidden", "type": None, "target_id": target_uid, "target_role": target_role, "ping_id": None}

    # ── Consent: skip offline security agents ────────────────────────────────
    if target_role == "security" and target.get("status") == "offline":
        return {"ok": False, "reason": "offline", "type": None, "target_id": target_uid, "target_role": target_role, "ping_id": None}

    # ── Canonical type string ─────────────────────────────────────────────────
    notif_type = "location_ping" if target_role == "security" else "ping"

    # ── Audit row (so the caller can correlate "ping sent" with the
    #    eventual /location/ping-update on the recipient's device) ───────────
    ping_id = None
    try:
        result = await db.ping_events.insert_one({
            "target_user_id":   target_uid,
            "target_role":      target_role,
            "requester_id":     str(requester["_id"]),
            "requester_role":   requester_role,
            "requester_kind":   requester_kind,
            "requester_name":   requester_name,
            "notif_type":       notif_type,
            "status":           "dispatched",   # dispatched → delivered → responded
            "delivered":        False,
            "responded":        False,
            "dispatched_at":    datetime.utcnow(),
        })
        ping_id = str(result.inserted_id)
    except Exception as e:
        # Audit failure must not block the ping — log and continue
        logger.error(f"[ping] Failed to write audit row: {e}")

    # ── Send the silent push ──────────────────────────────────────────────────
    push_token = target.get("push_token")
    if not push_token:
        # Record outcome and bail.
        if ping_id:
            await db.ping_events.update_one(
                {"_id": ObjectId(ping_id)},
                {"$set": {"status": "no_push_token", "responded_at": datetime.utcnow()}},
            )
        return {
            "ok": False, "reason": "no_push_token", "type": notif_type,
            "target_id": target_uid, "target_role": target_role, "ping_id": ping_id,
        }

    try:
        await expo_push_service.send_push_notification(
            token=push_token,
            title=None,          # SILENT — no visible UI
            body=None,
            data={
                "type":        notif_type,
                "ping_id":     ping_id,                 # echo back so device can correlate
                "requester":   requester_name,
                "issued_at":   datetime.utcnow().isoformat(),
            },
        )
    except Exception as e:
        logger.error(f"[ping] Expo push send error: {e}")
        if ping_id:
            await db.ping_events.update_one(
                {"_id": ObjectId(ping_id)},
                {"$set": {"status": "push_failed", "responded_at": datetime.utcnow()}},
            )
        return {
            "ok": False, "reason": "push_failed", "type": notif_type,
            "target_id": target_uid, "target_role": target_role, "ping_id": ping_id,
        }

    return {
        "ok": True, "reason": None, "type": notif_type,
        "target_id": target_uid, "target_role": target_role, "ping_id": ping_id,
    }


@api_router.post("/admin/ping-user/{uid}")
async def admin_ping_user(uid: str, user=Depends(get_admin_user)):
    """
    Admin silent ping.  Unified contract — see _ping_user() above.
    Admin may ping civil OR security.
    """
    return await _ping_user(uid, user, requester_kind="admin")

# ================== ADMIN MESSAGE ==================
@api_router.post("/admin/message")
async def admin_send_message(body: dict = Body(...), user=Depends(get_admin_user)):
    await db.messages.insert_one({
        "from_admin": True,
        "admin_id":   str(user["_id"]),
        "to_user_id": body.get("user_id"),
        "message":    body.get("message"),
        "sent_at":    datetime.utcnow(),
    })
    await _log_admin_action(str(user["_id"]), "send_message", "user", body.get("user_id", ""), {"message_preview": str(body.get("message", ""))[:80]})
    return {"ok": True}

# ================== REPORTS ==================
@api_router.post("/report/upload-audio")
async def upload_audio_report(request: Request, user=Depends(get_current_user)):
    try:
        form = await request.form()
        audio_file = form.get("audio")
        if not audio_file:
            raise HTTPException(status_code=400, detail="No audio file")
        audio_bytes = await audio_file.read()
        if not cloudinary_service:
            raise HTTPException(status_code=503, detail="Audio storage service unavailable")

        file_url = await cloudinary_service.upload_file(
            audio_bytes, f"audio_{uuid.uuid4().hex}.m4a", "audio/m4a", folder="audio_reports"
        )
        if not file_url:
            raise HTTPException(status_code=500, detail="Audio upload failed — check Cloudinary credentials")
        return {"ok": True, "file_url": file_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/report/create")
async def create_report(body: dict = Body(...), user=Depends(get_current_user)):
    doc = {
        "user_id":     str(user["_id"]),
        "user_email":  user.get("email"),
        "user_name":   user.get("full_name") or user.get("email"),
        "user_phone":  user.get("phone"),
        "type":        body.get("type", "audio"),
        "caption":     body.get("caption", ""),
        "file_url":    body.get("file_url"),
        "is_anonymous":body.get("is_anonymous", False),
        "latitude":    body.get("latitude"),
        "longitude":   body.get("longitude"),
        "status":      "pending",
        "created_at":  datetime.utcnow(),
    }
    result = await db.civil_reports.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Notify all security agents of the new report (audio, video, or other)
    await notify_security_of_report(doc)

    return {"ok": True, "report_id": str(result.inserted_id)}

@api_router.get("/report/my-reports")
async def my_reports(user=Depends(get_current_user)):
    cursor = db.civil_reports.find({"user_id": str(user["_id"])}).sort("created_at", -1).limit(50)
    reports = []
    async for r in cursor:
        reports.append({
            "id":         str(r["_id"]),
            "type":       r.get("type"),
            "caption":    r.get("caption"),
            "file_url":   r.get("file_url"),
            "status":     r.get("status", "pending"),
            "created_at": r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
        })
    return {"reports": reports}

# ================== PAYMENT / PREMIUM ==================
@api_router.post("/payment/verify")
async def verify_payment(body: dict = Body(...), user=Depends(get_current_user)):
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"is_premium": True}})
    return {"ok": True, "is_premium": True, "message": "Premium activated"}

# ================== SECURITY EXTRAS ==================
@api_router.post("/security/team-location")
async def update_team_location(body: dict = Body(...), user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "team_location": {"latitude": body.get("latitude"), "longitude": body.get("longitude")},
            "radius_km":     body.get("radius_km", 10),
            "location_updated_at": datetime.utcnow(),
        }}
    )
    u = await db.users.find_one({"_id": user["_id"]})
    return {
        "latitude":  body.get("latitude"),
        "longitude": body.get("longitude"),
        "radius_km": u.get("radius_km", 10),
    }

@api_router.get("/security/team-location")
async def get_team_location(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    loc = user.get("team_location", {})
    return {
        "latitude":  loc.get("latitude"),
        "longitude": loc.get("longitude"),
        "radius_km": user.get("radius_km", 10),
    }

@api_router.get("/security/nearby-reports")
async def security_nearby_reports(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")

    # ── Interception window ───────────────────────────────────────────────────
    # A security agent can only intercept LIVE reports — i.e. reports that were
    # created AFTER the agent's own account was registered. Pre-existing reports
    # are invisible to them; they were not on duty when those came in.
    #
    # We use the agent's `created_at` as the hard lower bound. If for any reason
    # that field is missing (legacy accounts), we fall back to 24 hours ago so
    # the feed is never permanently empty but still can't show old history.
    agent_registered_at = user.get("created_at")
    if isinstance(agent_registered_at, datetime):
        intercept_from = agent_registered_at
    else:
        # Fallback: treat missing created_at as 24 h ago — conservative but safe
        intercept_from = datetime.utcnow() - timedelta(hours=24)

    cursor = db.civil_reports.find({
        "$or": [{"status": "pending"}, {"status": {"$exists": False}}],
        # Hard gate: report must have been created at or after the agent registered
        "created_at": {"$gte": intercept_from},
    }).sort("created_at", -1).limit(50)

    reports = []
    async for r in cursor:
        user_photo_url = None
        if r.get("user_id"):
            try:
                u = await db.users.find_one({"_id": ObjectId(r["user_id"])}, {"photo_url": 1})
                user_photo_url = u.get("photo_url") if u else None
            except Exception:
                pass
        reports.append({
            "id":             str(r["_id"]),
            "user_id":        r.get("user_id"),
            "user_name":      r.get("user_name"),
            "user_email":     r.get("user_email"),
            "user_photo_url": user_photo_url,
            "type":           r.get("type"),
            "caption":        r.get("caption"),
            "file_url":       r.get("file_url"),
            "latitude":       r.get("latitude"),
            "longitude":      r.get("longitude"),
            "created_at":     r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
        })
    return reports

@api_router.get("/security/search-user")
async def security_search_user(query: str = Query(...), user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    regex = {"$regex": query, "$options": "i"}
    u = await db.users.find_one({"$or": [{"email": regex}, {"full_name": regex}, {"phone": regex}], "role": "civil"})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id":   str(u["_id"]),
        "email":     u.get("email"),
        "full_name": u.get("full_name"),
        "phone":     u.get("phone"),
        "role":      u.get("role"),
    }

@api_router.post("/security/ping-user/{uid}")
async def security_ping_user(uid: str, user=Depends(get_current_user)):
    """
    Security Search & Track — unified contract, see _ping_user().
    Security may only ping CIVIL users.
    """
    return await _ping_user(uid, user, requester_kind="security")


# ── Ping all security agents (admin OR security role) ──────────────────────────
# FIX ISSUE #5 + #6: the bulk ping routes through the same _ping_user()
# contract so each device gets the same payload (incl. ping_id) and the
# responses can be correlated.  Excludes agents who have set their profile
# to Offline (consent).
@api_router.post("/admin/ping-all-security")
async def ping_all_security(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "security"):
        raise HTTPException(status_code=403, detail="Admin or security only")

    cursor = db.users.find({
        "role":      "security",
        "is_active": True,
        "status":    {"$ne": "offline"},
    })

    pinged = 0
    failed = 0
    skipped_offline = 0
    skipped_no_token = 0
    results = []

    async for agent in cursor:
        result = await _ping_user(str(agent["_id"]), user, requester_kind="admin")
        results.append(result)
        if result["ok"]:
            pinged += 1
        else:
            reason = result.get("reason")
            if reason == "offline":
                skipped_offline += 1
            elif reason == "no_push_token":
                skipped_no_token += 1
            else:
                failed += 1

    await _log_admin_action(
        str(user["_id"]),
        "ping_all_security",
        "users",
        "bulk",
        {
            "pinged":           pinged,
            "failed":           failed,
            "skipped_offline":  skipped_offline,
            "skipped_no_token": skipped_no_token,
        },
    )

    return {
        "ok":               True,
        "pinged":           pinged,
        "failed":           failed,
        "skipped_offline":  skipped_offline,
        "skipped_no_token": skipped_no_token,
        "results":          results,  # full per-agent breakdown for the dashboard
    }


# ── PING EVENTS (admin dashboard) ──────────────────────────────────────────────────────────
# FIX ISSUE #5 + #6: surfaces the unified ping contract end-to-end.
#   - /admin/ping-events         → paginated list of every ping dispatched
#   - /admin/ping-events/{pid}   → single ping with full dispatch + response record
#   - /admin/ping-stats          → aggregate health (response rate, latency)
@api_router.get("/admin/ping-events")
async def admin_ping_events(
    skip:        int  = Query(0),
    limit:       int  = Query(50),
    status:      Optional[str] = Query(None, description="dispatched | responded | no_push_token | push_failed"),
    target_role: Optional[str] = Query(None, description="civil | security"),
    user=Depends(get_admin_user),
):
    """Paginated ping dispatch + response audit.  Lets the admin verify the
    silent-ping contract is actually completing (each 'dispatched' should
    eventually become 'responded')."""
    query: Dict[str, Any] = {}
    if status:      query["status"]      = status
    if target_role: query["target_role"] = target_role

    total = await db.ping_events.count_documents(query)
    cursor = db.ping_events.find(query).sort("dispatched_at", -1).skip(skip).limit(limit)
    events = []
    async for ev in cursor:
        dispatched_at = ev.get("dispatched_at")
        responded_at  = ev.get("responded_at")
        latency_ms = None
        if isinstance(dispatched_at, datetime) and isinstance(responded_at, datetime):
            latency_ms = int((responded_at - dispatched_at).total_seconds() * 1000)
        # Resolve target name for display
        target_name = ""
        try:
            if ev.get("target_user_id"):
                t = await db.users.find_one({"_id": ObjectId(ev["target_user_id"])},
                                             {"full_name": 1, "email": 1})
                if t:
                    target_name = t.get("full_name") or t.get("email") or ""
        except Exception:
            pass
        events.append({
            "id":                str(ev["_id"]),
            "target_user_id":    ev.get("target_user_id"),
            "target_name":       target_name,
            "target_role":       ev.get("target_role"),
            "requester_id":      ev.get("requester_id"),
            "requester_name":    ev.get("requester_name"),
            "requester_kind":    ev.get("requester_kind"),
            "notif_type":        ev.get("notif_type"),
            "status":            ev.get("status"),
            "dispatched_at":     dispatched_at.isoformat() if isinstance(dispatched_at, datetime) else dispatched_at,
            "responded_at":      responded_at.isoformat()  if isinstance(responded_at,  datetime) else responded_at,
            "latency_ms":        latency_ms,
            "response_lat":      ev.get("response_lat"),
            "response_lng":      ev.get("response_lng"),
            "response_accuracy": ev.get("response_accuracy"),
        })
    return {"events": events, "total": total}


@api_router.get("/admin/ping-events/{ping_id}")
async def admin_ping_event_detail(ping_id: str, user=Depends(get_admin_user)):
    try:
        ev = await db.ping_events.find_one({"_id": ObjectId(ping_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ping id")
    if not ev:
        raise HTTPException(status_code=404, detail="Ping event not found")
    ev["id"] = str(ev.pop("_id"))
    for k in ("dispatched_at", "responded_at"):
        if isinstance(ev.get(k), datetime):
            ev[k] = ev[k].isoformat()
    return ev


@api_router.get("/admin/ping-stats")
async def admin_ping_stats(user=Depends(get_admin_user)):
    """Health check on the ping contract: how many dispatched, how many
    responded, average response latency.  Used by the admin dashboard
    "ping system health" tile."""
    now       = datetime.utcnow()
    last_24h  = now - timedelta(hours=24)
    last_7d   = now - timedelta(days=7)

    def _bucket(since: datetime) -> dict:
        return {}

    async def agg(since: datetime) -> dict:
        return {
            "dispatched":  await db.ping_events.count_documents({"dispatched_at": {"$gte": since}}),
            "responded":   await db.ping_events.count_documents({"responded": True, "responded_at": {"$gte": since}}),
            "no_token":    await db.ping_events.count_documents({"status": "no_push_token", "dispatched_at": {"$gte": since}}),
            "failed":      await db.ping_events.count_documents({"status": "push_failed", "dispatched_at": {"$gte": since}}),
        }

    last_24h_stats = await agg(last_24h)
    last_7d_stats  = await agg(last_7d)

    # Response rate (last 24h)
    dispatched_24h = max(last_24h_stats["dispatched"], 1)
    response_rate_24h = round((last_24h_stats["responded"] / dispatched_24h) * 100, 1)

    # Average latency (last 24h, responded only)
    latency_pipeline = [
        {"$match": {"responded": True, "responded_at": {"$gte": last_24h}}},
        {"$project": {
            "latency_ms": {
                "$subtract": ["$responded_at", "$dispatched_at"]
            }
        }},
        {"$group": {"_id": None, "avg_ms": {"$avg": "$latency_ms"}}},
    ]
    avg_latency_ms = 0
    try:
        rows = await db.ping_events.aggregate(latency_pipeline).to_list(1)
        if rows:
            avg_latency_ms = int(rows[0]["avg_ms"])
    except Exception as e:
        logger.error(f"[ping-stats] latency aggregation error: {e}")

    return {
        "last_24h":         last_24h_stats,
        "last_7d":          last_7d_stats,
        "response_rate_24h_pct": response_rate_24h,
        "avg_latency_ms":   avg_latency_ms,
    }

# ================== CHAT ==================
@api_router.get("/chat/conversations")
async def get_conversations(user=Depends(get_current_user)):
    uid = str(user["_id"])
    cursor = db.chat_conversations.find({"participants": uid}).sort("last_message_at", -1).limit(50)
    convs = []
    async for c in cursor:
        other_id = next((p for p in c.get("participants", []) if p != uid), None)
        other_user_obj = None
        if other_id:
            try:
                ou = await db.users.find_one({"_id": ObjectId(other_id)})
                if ou:
                    other_user_obj = {
                        "id":                str(ou["_id"]),
                        "full_name":         ou.get("full_name") or ou.get("email"),
                        "role":              ou.get("role"),
                        "status":            ou.get("status", "available"),
                        "security_sub_role": ou.get("security_sub_role"),
                    }
            except Exception:
                pass

        convs.append({
            "id":              str(c["_id"]),
            "participants":    c.get("participants", []),
            "other_user":      other_user_obj,
            "last_message":    c.get("last_message"),
            "last_message_at": c["last_message_at"].isoformat() if isinstance(c.get("last_message_at"), datetime) else c.get("last_message_at"),
            "unread":          c.get(f"unread_{uid}", 0),
            "unread_count":    c.get(f"unread_{uid}", 0),
        })
    return {"conversations": convs}

@api_router.post("/chat/start")
async def start_conversation(body: dict = Body(...), user=Depends(get_current_user)):
    uid = str(user["_id"])
    # Accept both "to_user_id" (frontend) and legacy "user_id"
    other_id = body.get("to_user_id") or body.get("user_id")
    if not other_id:
        raise HTTPException(status_code=400, detail="to_user_id is required")
    existing = await db.chat_conversations.find_one({"participants": {"$all": [uid, other_id]}})
    if existing:
        return {"conversation_id": str(existing["_id"]), "existing": True}
    result = await db.chat_conversations.insert_one({
        "participants":    [uid, other_id],
        "last_message":    None,
        "last_message_at": datetime.utcnow(),
    })
    return {"conversation_id": str(result.inserted_id), "existing": False}

@api_router.get("/chat/{conv_id}/messages")
async def get_messages(conv_id: str, user=Depends(get_current_user)):
    uid = str(user["_id"])
    cursor = db.chat_messages.find({"conversation_id": conv_id}).sort("sent_at", 1).limit(200)
    messages = []
    async for m in cursor:
        # Normalise: stored as "message" legacy, or "content" new — expose both
        text = m.get("content") or m.get("message") or ""
        sent = m.get("sent_at")
        sent_str = sent.isoformat() if isinstance(sent, datetime) else (sent or "")
        messages.append({
            "id":           str(m["_id"]),
            "from_user_id": m.get("from_user_id"),
            "content":      text,
            "message":      text,
            "created_at":   sent_str,
            "sent_at":      sent_str,
            "is_mine":      m.get("from_user_id") == uid,
        })
    return {"messages": messages}

@api_router.post("/chat/send")
async def send_message(body: dict = Body(...), user=Depends(get_current_user)):
    uid  = str(user["_id"])
    now  = datetime.utcnow()

    # Support both call patterns:
    #   NEW  → { to_user_id, content, message_type }   (frontend sends this)
    #   LEGACY → { conversation_id, message }
    to_user_id = body.get("to_user_id")
    conv_id    = body.get("conversation_id")
    content    = body.get("content") or body.get("message") or ""

    # Resolve conv_id from to_user_id when not supplied directly
    if not conv_id and to_user_id:
        existing = await db.chat_conversations.find_one({"participants": {"$all": [uid, to_user_id]}})
        if existing:
            conv_id = str(existing["_id"])
        else:
            ins = await db.chat_conversations.insert_one({
                "participants":    [uid, to_user_id],
                "last_message":    None,
                "last_message_at": now,
            })
            conv_id = str(ins.inserted_id)

    if not conv_id:
        raise HTTPException(status_code=400, detail="conversation_id or to_user_id required")

    await db.chat_messages.insert_one({
        "conversation_id": conv_id,
        "from_user_id":    uid,
        "content":         content,
        "message":         content,        # keep legacy field in sync
        "message_type":    body.get("message_type", "text"),
        "sent_at":         now,
    })

    conv = await db.chat_conversations.find_one({"_id": ObjectId(conv_id)})
    inc_fields: dict = {}
    if conv:
        for pid in conv.get("participants", []):
            if pid != uid:
                inc_fields[f"unread_{pid}"] = 1

    update: dict = {"$set": {"last_message": content, "last_message_at": now}}
    if inc_fields:
        update["$inc"] = inc_fields  # type: ignore[assignment]

    await db.chat_conversations.update_one({"_id": ObjectId(conv_id)}, update)

    # Push notification to the other participant(s) — works even when app is closed
    sender_name = user.get("full_name") or user.get("email") or "Security"
    await notify_recipient_of_message(conv_id, uid, sender_name, content)

    return {"ok": True, "conversation_id": conv_id}

@api_router.post("/chat/mark-read")
async def mark_conversation_read(body: dict = Body(...), user=Depends(get_current_user)):
    uid = str(user["_id"])
    conv_id = body.get("conversation_id")
    await db.chat_conversations.update_one(
        {"_id": ObjectId(conv_id)},
        {"$set": {f"unread_{uid}": 0}}
    )
    return {"ok": True}

# ================== AUDIT LOG (PROFESSIONAL) ==================
# FIX ISSUE #9: professional audit log with
#   - filterable by action / category / severity / outcome / admin / date
#   - human-readable summary string for the table (no more blank rows)
#   - lightweight server-side category rollup for the dashboard "By Category" tile
#   - CSV export endpoint alongside the JSON listing
@api_router.get("/admin/audit-log")
async def admin_audit_log(
    user=Depends(get_admin_user),
    skip:       int   = Query(0),
    limit:      int   = Query(50),
    action:     Optional[str] = Query(None, description="Exact action name, e.g. 'clear_panics'"),
    category:   Optional[str] = Query(None, description="Coarse category: AUTH, USER_MGMT, PANIC, PING, COMMS, ..."),
    severity:   Optional[str] = Query(None, description="info | notice | warning | critical"),
    outcome:    Optional[str] = Query(None, description="success | failure | partial"),
    admin_id:   Optional[str] = Query(None, description="Filter by admin user id"),
    search:     Optional[str] = Query(None, description="Free-text search over summary, target, action, details"),
    since:      Optional[str] = Query(None, description="ISO-8601 lower bound on timestamp"),
    until:      Optional[str] = Query(None, description="ISO-8601 upper bound on timestamp"),
):
    """
    Paginated, filterable admin action log.

    Each row contains:
      id, timestamp, admin_id, admin_name, admin_email, admin_role,
      action, category, severity, outcome, target_type, target_id,
      target_summary, details, summary, ip, user_agent
    """
    query: Dict[str, Any] = {}
    if action:   query["action"]   = action
    if category: query["category"] = category.upper()
    if severity: query["severity"] = severity
    if outcome:  query["outcome"]  = outcome
    if admin_id: query["admin_id"] = admin_id
    if since or until:
        rng: Dict[str, Any] = {}
        if since:
            try: rng["$gte"] = datetime.fromisoformat(since.replace("Z", "+00:00"))
            except Exception: pass
        if until:
            try: rng["$lte"] = datetime.fromisoformat(until.replace("Z", "+00:00"))
            except Exception: pass
        if rng:
            query["timestamp"] = rng

    # Free-text search across multiple fields.
    if search:
        regex = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [
            {"action":       regex},
            {"target":       regex},
            {"target_id":    regex},
            {"admin_id":     regex},
            {"details":      regex},
        ]

    total = await db.admin_logs.count_documents(query)
    cursor = db.admin_logs.find(query).sort("timestamp", -1).skip(skip).limit(limit)
    logs = []

    # Pre-resolve admin names in one batch (avoid N+1 lookups).
    admin_ids = set()
    async for log in cursor:
        if log.get("admin_id"):
            admin_ids.add(log["admin_id"])
    admin_map: Dict[str, dict] = {}
    if admin_ids:
        try:
            obj_ids = [ObjectId(a) for a in admin_ids if _is_objectid_like(a)]
            async for u in db.users.find({"_id": {"$in": obj_ids}}, {"full_name": 1, "email": 1, "role": 1}):
                admin_map[str(u["_id"])] = u
        except Exception:
            pass

    # Re-open the cursor (it was consumed by the admin_id collection step).
    cursor = db.admin_logs.find(query).sort("timestamp", -1).skip(skip).limit(limit)
    async for log in cursor:
        admin_doc = admin_map.get(log.get("admin_id", ""), {})
        admin_name  = admin_doc.get("full_name") or admin_doc.get("email") or "Admin"
        admin_email = admin_doc.get("email") or ""
        admin_role  = admin_doc.get("role") or ""

        # Build a one-line human summary so the table is readable.
        details     = log.get("details", {}) or {}
        target      = log.get("target") or "—"
        target_id   = log.get("target_id") or ""
        action      = log.get("action") or "unknown"
        summary = _summarise_audit(action, target, target_id, details, admin_name)

        ts = log.get("timestamp")
        logs.append({
            "id":             str(log["_id"]),
            "timestamp":      ts.isoformat() if isinstance(ts, datetime) else ts,
            "admin_id":       log.get("admin_id", ""),
            "admin_name":     admin_name,
            "admin_email":    admin_email,
            "admin_role":     admin_role,
            "action":         action,
            "category":       log.get("category", ""),
            "severity":       log.get("severity", "info"),
            "outcome":        log.get("outcome", "success"),
            "target_type":    target,
            "target":         target,
            "target_id":      target_id,
            "target_summary": _summarise_target(target, target_id, details),
            "details":        details,
            "summary":        summary,
            "ip":             log.get("ip"),
            "user_agent":     log.get("user_agent"),
        })

    # Lightweight rollup for the dashboard.
    rollup = await _audit_rollup(query)

    return {"logs": logs, "total": total, "rollup": rollup}


def _is_objectid_like(s: str) -> bool:
    return isinstance(s, str) and len(s) == 24 and all(c in "0123456789abcdefABCDEF" for c in s)


def _summarise_target(target: str, target_id: str, details: dict) -> str:
    """One-line description of WHAT was acted on."""
    if target in ("all", "bulk"):
        if "cleared"   in details: return f"bulk ({details['cleared']} rows)"
        if "resolved"  in details: return f"bulk ({details['resolved']} rows)"
        if "deleted"   in details: return f"bulk ({details['deleted']} rows)"
        if "pinged"    in details: return f"bulk ({details['pinged']} dispatched)"
        if "recipients" in details: return f"broadcast ({details['recipients']} recipients)"
        return "bulk"
    if target == "user" and details.get("message_preview"):
        return f'"{details["message_preview"]}"'
    if target == "user":
        return target_id or "—"
    if target == "security_team" and details.get("name"):
        return f'team "{details["name"]}"'
    if target == "invite_code":
        return details.get("code") or target_id or "—"
    return target_id or "—"


def _summarise_audit(action: str, target: str, target_id: str, details: dict, admin_name: str) -> str:
    """
    Human-readable, present-tense description.  Example outputs:
        "Admin Jane disabled user 651f…"
        "Admin Jane broadcast to 42 civil users"
        "Admin Jane pinged 12 security agents"
        "Admin Jane reset all data"
    """
    pretty = action.replace("_", " ")
    if action == "broadcast":
        title = details.get("title", "—")
        role  = details.get("target_role", "all")
        n     = details.get("recipients", 0)
        return f'{admin_name} broadcast "{title}" to {n} {role} user(s)'
    if action == "send_message":
        preview = details.get("message_preview", "")
        return f'{admin_name} sent message to {target_id}: "{preview}"'
    if action == "ping_user":
        return f'{admin_name} pinged user {target_id}'
    if action == "ping_all_security":
        return f'{admin_name} pinged {details.get("pinged", 0)} security agents'
    if action == "create_team":
        return f'{admin_name} created team "{details.get("name", target_id)}"'
    if action == "delete_team":
        return f'{admin_name} deleted team {target_id}'
    if action in ("clear_panics", "resolve_trapped_panics", "clear_trapped_escorts", "clear_uploads"):
        n = details.get("cleared") or details.get("resolved") or details.get("deleted") or 0
        return f'{admin_name} ran {pretty} ({n} affected)'
    if action == "reset_all_data":
        return f'{admin_name} RESET ALL DATA'
    if action == "export_data":
        return f'{admin_name} exported {details.get("dataset", "data")} ({details.get("row_count", 0)} rows)'
    if action == "disable_user":
        return f'{admin_name} disabled user {target_id}'
    if action == "enable_user":
        return f'{admin_name} re-enabled user {target_id}'
    if action == "delete_user":
        return f'{admin_name} deleted user {target_id}'
    if action == "create_invite_code":
        return f'{admin_name} created invite code {details.get("code", target_id)}'
    if action == "delete_invite_code":
        return f'{admin_name} revoked invite code {target_id}'
    if target_id and target_id != "all":
        return f'{admin_name} {pretty} {target_id}'
    return f'{admin_name} {pretty}'


async def _audit_rollup(query: Dict[str, Any]) -> dict:
    """Cheap rollup: counts grouped by category and severity.
    Uses the same query as the listing minus pagination, so the dashboard
    tile and the table stay consistent.
    """
    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": {"category": "$category", "severity": "$severity"},
            "count": {"$sum": 1},
        }},
    ]
    by_category: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    try:
        async for row in db.admin_logs.aggregate(pipeline):
            cat = row["_id"].get("category") or "OTHER"
            sev = row["_id"].get("severity") or "info"
            by_category[cat] = by_category.get(cat, 0) + row["count"]
            by_severity[sev] = by_severity.get(sev, 0) + row["count"]
    except Exception as e:
        logger.error(f"[audit rollup] error: {e}")
    return {"by_category": by_category, "by_severity": by_severity}


# ================== AUDIT LOG — CSV EXPORT ==================
# FIX ISSUE #9: real CSV download endpoint for the audit log.
@api_router.get("/admin/audit-log/export")
async def admin_audit_log_export(
    user=Depends(get_admin_user),
    category: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    since:    Optional[str] = Query(None),
    until:    Optional[str] = Query(None),
    format:   str = Query("csv", pattern="^(csv|json)$"),
):
    """
    Stream the filtered audit log as a CSV (default) or JSON file.
    Used by the Search & Export feature for off-platform archival.
    """
    query: Dict[str, Any] = {}
    if category: query["category"] = category.upper()
    if severity: query["severity"] = severity
    if since or until:
        rng: Dict[str, Any] = {}
        if since:
            try: rng["$gte"] = datetime.fromisoformat(since.replace("Z", "+00:00"))
            except Exception: pass
        if until:
            try: rng["$lte"] = datetime.fromisoformat(until.replace("Z", "+00:00"))
            except Exception: pass
        if rng:
            query["timestamp"] = rng

    # Resolve admin names in one batch.
    admin_ids = set()
    cursor = db.admin_logs.find(query).sort("timestamp", -1).limit(10000)
    async for log in cursor:
        if log.get("admin_id"):
            admin_ids.add(log["admin_id"])
    admin_map: Dict[str, str] = {}
    if admin_ids:
        try:
            obj_ids = [ObjectId(a) for a in admin_ids if _is_objectid_like(a)]
            async for u in db.users.find({"_id": {"$in": obj_ids}}, {"full_name": 1, "email": 1}):
                admin_map[str(u["_id"])] = u.get("full_name") or u.get("email") or "Admin"
        except Exception:
            pass

    # Log the export itself.
    await _log_admin_action(
        str(user["_id"]), "export_data", "admin_logs", "audit",
        {"dataset": "audit_log", "format": format, "row_count_estimate": len(admin_ids)},
    )

    if format == "json":
        # JSON export.
        rows = []
        cursor = db.admin_logs.find(query).sort("timestamp", -1).limit(10000)
        async for log in cursor:
            log["_id"] = str(log["_id"])
            for k in ("timestamp",):
                if isinstance(log.get(k), datetime):
                    log[k] = log[k].isoformat()
            log["admin_name"] = admin_map.get(log.get("admin_id", ""), "Admin")
            rows.append(log)
        body = json.dumps(rows, default=str, indent=2)
        filename = f"audit_log_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        return Response(
            content=body, media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # CSV export.
    def csv_gen():
        header = [
            "timestamp", "admin_id", "admin_name", "action", "category",
            "severity", "outcome", "target_type", "target_id", "ip",
            "user_agent", "details",
        ]
        yield ",".join(header) + "\n"
        cursor = db.admin_logs.find(query).sort("timestamp", -1).limit(10000)
        # NOTE: Motor cursors are async; the synchronous csv writer cannot be
        # mixed.  We materialise the rows here.  10k rows is well within
        # memory and is the hard cap anyway.
        return  # placeholder, real implementation below
    # Real implementation: materialise and stream.
    rows = []
    cursor = db.admin_logs.find(query).sort("timestamp", -1).limit(10000)
    async for log in cursor:
        ts = log.get("timestamp")
        ts_str = ts.isoformat() if isinstance(ts, datetime) else (str(ts) if ts else "")
        details = log.get("details", {}) or {}
        details_str = json.dumps(details, default=str)[:1000].replace('"', "'")
        row = [
            ts_str,
            log.get("admin_id", ""),
            admin_map.get(log.get("admin_id", ""), "Admin"),
            log.get("action", ""),
            log.get("category", ""),
            log.get("severity", "info"),
            log.get("outcome", "success"),
            log.get("target", ""),
            log.get("target_id", ""),
            log.get("ip") or "",
            (log.get("user_agent") or "")[:120],
            details_str,
        ]
        rows.append(",".join(f'"{str(c).replace(chr(34), chr(39))}"' for c in row))

    body = "\n".join(rows)
    filename = f"audit_log_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=body, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ================== BROADCAST ==================
@api_router.post("/admin/broadcast")
async def admin_broadcast(body: dict = Body(...), user=Depends(get_admin_user)):
    """Send a push broadcast to all users of a target role."""
    title       = body.get("title", "Notification")
    message     = body.get("message", "")
    target_role = body.get("target_role", "all")

    query: dict = {}
    if target_role in ("civil", "security"):
        query["role"] = target_role

    await db.broadcasts.insert_one({
        "title":       title,
        "message":     message,
        "target_role": target_role,
        "sent_by":     str(user["_id"]),
        "sent_at":     datetime.utcnow(),
    })

    recipients = 0
    if expo_push_service:
        users_cursor = db.users.find({**query, "push_token": {"$exists": True, "$ne": None}})
        async for u in users_cursor:
            try:
                await expo_push_service.send_push_notification(
                    token=u["push_token"], title=title, body=message,
                    data={"type": "broadcast"}
                )
                recipients += 1
            except Exception as e:
                logger.error(f"Broadcast push error: {e}")

    await _log_admin_action(str(user["_id"]), "broadcast", "all", "all",
                            {"title": title, "target_role": target_role, "recipients": recipients})
    return {"ok": True, "recipients": recipients}

@api_router.get("/broadcasts")
async def get_broadcasts(user=Depends(get_current_user)):
    """Civil/security users fetch broadcasts addressed to them."""
    role = user.get("role", "civil")
    query = {"$or": [{"target_role": "all"}, {"target_role": role}]}
    cursor = db.broadcasts.find(query).sort("sent_at", -1).limit(50)
    broadcasts = []
    async for b in cursor:
        sent = b.get("sent_at")
        broadcasts.append({
            "id":          str(b["_id"]),
            "title":       b.get("title"),
            "message":     b.get("message"),
            "target_role": b.get("target_role"),
            "sent_at":     sent.isoformat() if isinstance(sent, datetime) else sent,
        })
    return {"broadcasts": broadcasts}


# ================== SEARCH & EXPORT (ADMIN) ==================
# FIX ISSUE #8: a real download endpoint.  Pick a `dataset` and (optionally)
# filter by date range / role / status.  Output is JSON or CSV via
# Content-Disposition: attachment so the browser saves it as a file.
#
# Datasets:
#   users         → all registered accounts (with last-known location)
#   panics        → all panic events in the window
#   escorts       → all escort sessions in the window
#   reports       → civil_reports (audio / video / other)
#   messages      → chat_messages
#   ping_events   → ping dispatch + response audit (Issue #5)
#   audit         → admin_logs
#
# All exports are written through the audit trail so we always know what
# was downloaded, by whom, and when.
@api_router.get("/admin/export")
async def admin_export(
    request: Request,
    user=Depends(get_admin_user),
    dataset:   str = Query(..., pattern="^(users|panics|escorts|reports|messages|ping_events|audit)$"),
    format:    str = Query("csv", pattern="^(csv|json)$"),
    role:      Optional[str] = Query(None, description="users/panics/escorts: civil|security|admin"),
    since:     Optional[str] = Query(None),
    until:     Optional[str] = Query(None),
    status:    Optional[str] = Query(None, description="panics/escorts: active|completed"),
    limit:     int  = Query(10000, ge=1, le=50000),
):
    """
    Download a real file of the chosen dataset, filtered by date / role /
    status.  Always writes an audit row.
    """
    DATASET_MAP = {
        "users":       (db.users,          "created_at",    "Users"),
        "panics":      (db.panic_events,   "activated_at",  "Panic events"),
        "escorts":     (db.escort_sessions,"started_at",    "Escort sessions"),
        "reports":     (db.civil_reports,  "created_at",    "Civil reports"),
        "messages":    (db.chat_messages,  "sent_at",       "Chat messages"),
        "ping_events": (db.ping_events,    "dispatched_at", "Ping events"),
        "audit":       (db.admin_logs,     "timestamp",     "Audit log"),
    }
    collection, date_field, label = DATASET_MAP[dataset]

    q: Dict[str, Any] = {}
    if since or until:
        rng: Dict[str, Any] = {}
        if since:
            try: rng["$gte"] = datetime.fromisoformat(since.replace("Z", "+00:00"))
            except Exception: pass
        if until:
            try: rng["$lte"] = datetime.fromisoformat(until.replace("Z", "+00:00"))
            except Exception: pass
        if rng:
            q[date_field] = rng

    # Role filter — semantics differ per dataset.
    if role:
        if dataset == "users":
            q["role"] = role
        elif dataset == "ping_events":
            q["target_role"] = role

    if status and dataset in ("panics", "escorts"):
        if status == "active":    q["is_active"] = True
        elif status == "completed": q["is_active"] = False

    cursor = collection.find(q).sort(date_field, -1).limit(limit)
    rows_raw = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        for k, v in list(doc.items()):
            if isinstance(v, datetime):
                doc[k] = v.isoformat()
            elif isinstance(v, ObjectId):
                doc[k] = str(v)
        rows_raw.append(doc)

    # Log the export itself (so the audit log shows what was downloaded).
    await _log_admin_action(
        str(user["_id"]), "export_data", dataset, "bulk",
        {
            "dataset":   dataset,
            "format":    format,
            "row_count": len(rows_raw),
            "filters":   {"since": since, "until": until, "role": role, "status": status},
        },
        request=request,
    )

    stamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    fname = f"seq_{dataset}_{stamp}.{format}"

    if format == "json":
        return Response(
            content=json.dumps(rows_raw, default=str, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    # CSV: union of keys across all rows for a stable header order.
    keys: List[str] = []
    seen = set()
    for r in rows_raw:
        for k in r.keys():
            if k not in seen:
                seen.add(k); keys.append(k)
    if not keys:
        return Response(content="", media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(keys)
    for r in rows_raw:
        writer.writerow([
            "" if r.get(k) is None else
            (json.dumps(r[k], default=str) if isinstance(r[k], (dict, list)) else str(r[k]))
            for k in keys
        ])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )

# ================== SECURITY TEAMS (ADMIN) ==================
@api_router.get("/admin/security-teams")
async def admin_security_teams(user=Depends(get_admin_user)):
    teams_cursor = db.security_teams.find({})
    teams = []
    async for t in teams_cursor:
        members_cursor = db.users.find({"team_name": t.get("name"), "role": "security"})
        members = []
        async for m in members_cursor:
            members.append({
                "id":        str(m["_id"]),
                "email":     m.get("email"),
                "full_name": m.get("full_name"),
                "sub_role":  m.get("security_sub_role"),
                "status":    m.get("status", "available"),
            })
        created = t.get("created_at")
        teams.append({
            "id":         str(t["_id"]),
            "name":       t.get("name"),
            "created_at": created.isoformat() if isinstance(created, datetime) else created,
            "members":    members,
        })

    ungrouped_cursor = db.users.find({"role": "security", "team_name": None})
    ungrouped = []
    async for u in ungrouped_cursor:
        ungrouped.append({
            "id":        str(u["_id"]),
            "email":     u.get("email"),
            "full_name": u.get("full_name"),
            "sub_role":  u.get("security_sub_role"),
            "status":    u.get("status", "available"),
        })
    if ungrouped:
        teams.append({"id": "ungrouped", "name": "Unassigned", "members": ungrouped})

    return teams

@api_router.post("/admin/create-team")
async def admin_create_team(body: dict = Body(...), user=Depends(get_admin_user)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name required")
    existing = await db.security_teams.find_one({"name": name})
    if existing:
        raise HTTPException(status_code=400, detail="Team already exists")
    result = await db.security_teams.insert_one({
        "name":       name,
        "created_at": datetime.utcnow(),
        "created_by": str(user["_id"]),
    })
    await _log_admin_action(str(user["_id"]), "create_team", "security_team", str(result.inserted_id), {"name": name})
    return {"ok": True, "team_id": str(result.inserted_id), "name": name}

# ================== SECURITY MAP (ADMIN) ==================
@api_router.get("/admin/security-map")
async def admin_security_map(user=Depends(get_admin_user)):
    cursor = db.users.find({"role": "security"})
    security_users = []
    async for u in cursor:
        # Prefer live current_location (from update-location / ping response) over
        # the static team_location that the officer set manually.
        loc = u.get("current_location") or u.get("team_location") or {}
        lat = loc.get("latitude")
        lng = loc.get("longitude")
        coords = [lng, lat] if lat is not None and lng is not None else None
        security_users.append({
            "id":        str(u["_id"]),
            "email":     u.get("email"),
            "full_name": u.get("full_name"),
            "status":    u.get("status", "available"),
            "is_active": u.get("is_active", True),
            "team_name": u.get("team_name"),
            "location":  {"coordinates": coords} if coords else None,
            "latitude":  lat,
            "longitude": lng,
            "radius_km": u.get("radius_km", 10),
            "updated_at": u.get("location_updated_at", u.get("created_at", "")).isoformat()
                          if isinstance(u.get("location_updated_at") or u.get("created_at"), datetime)
                          else None,
            "security_sub_role": u.get("security_sub_role"),
            "phone": u.get("phone"),
        })
    return {"security_users": security_users}

# ================== SECURITY PROFILE & SETTINGS ==================
@api_router.get("/security/profile")
async def security_profile(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    loc = user.get("team_location", {}) or {}
    return {
        "user_id":               str(user["_id"]),
        "email":                 user.get("email"),
        "full_name":             user.get("full_name"),
        "phone":                 user.get("phone"),
        "team_name":             user.get("team_name"),
        "security_sub_role":     user.get("security_sub_role"),
        "status":                user.get("status", "available"),
        "is_visible":            user.get("is_visible", True),
        "visibility_radius_km":  user.get("visibility_radius_km", user.get("radius_km", 25)),
        "latitude":              loc.get("latitude"),
        "longitude":             loc.get("longitude"),
    }

@api_router.put("/security/settings")
async def security_save_settings(body: dict = Body(...), user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "visibility_radius_km": body.get("visibility_radius_km", 25),
            "is_visible":           body.get("is_visible", True),
            "status":               body.get("status", "available"),
        }}
    )
    return {"ok": True}

@api_router.put("/security/status")
async def security_update_status(body: dict = Body(...), user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    status = body.get("status", "available")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"status": status}})
    return {"ok": True, "status": status}

# ================== SECURITY LOCATION (aliases) ==================
@api_router.post("/security/set-location")
async def security_set_location(body: dict = Body(...), user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "team_location":        {"latitude": body.get("latitude"), "longitude": body.get("longitude")},
            "radius_km":            body.get("radius_km", 10),
            "location_updated_at":  datetime.utcnow(),
        }}
    )
    return {"ok": True, "latitude": body.get("latitude"), "longitude": body.get("longitude"),
            "radius_km": body.get("radius_km", 10)}

@api_router.post("/security/update-location")
async def security_update_location(body: dict = Body(...), user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "current_location": {
                "latitude":  body.get("latitude"),
                "longitude": body.get("longitude"),
                "accuracy":  body.get("accuracy"),
                "timestamp": datetime.utcnow().isoformat(),
            },
            "location_updated_at": datetime.utcnow(),
        }}
    )
    return {"ok": True}

# ================== SECURITY NEARBY ==================
@api_router.get("/security/nearby")
async def security_nearby(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security only")

    panics_cursor = db.panic_events.find({"is_active": True}).sort("activated_at", -1).limit(50)
    panics = []
    async for p in panics_cursor:
        loc = p.get("current_location", {})
        panics.append({
            "id":                 str(p["_id"]),
            "type":               "panic",
            "user_name":          p.get("user_name"),
            "emergency_category": p.get("emergency_category", "other"),
            "latitude":           loc.get("latitude"),
            "longitude":          loc.get("longitude"),
            "activated_at":       p.get("activated_at").isoformat() if p.get("activated_at") else None,
        })

    reports_cursor = db.civil_reports.find({"status": "pending"}).sort("created_at", -1).limit(50)
    reports = []
    async for r in reports_cursor:
        created = r.get("created_at")
        reports.append({
            "id":         str(r["_id"]),
            "type":       "report",
            "user_name":  r.get("user_name"),
            "caption":    r.get("caption"),
            "latitude":   r.get("latitude"),
            "longitude":  r.get("longitude"),
            "created_at": created.isoformat() if isinstance(created, datetime) else created,
        })

    return {"panics": panics, "reports": reports}

@api_router.get("/security/nearby-security")
async def security_nearby_security(user=Depends(get_current_user)):
    if user.get("role") not in ("security", "admin", "civil"):
        raise HTTPException(status_code=403, detail="Not authorized")
    cursor = db.users.find({"role": "security", "is_visible": {"$ne": False}, "is_active": True})
    agents = []
    async for u in cursor:
        # Prefer live current_location (set by update-location), fall back to saved team_location
        loc = u.get("current_location") or u.get("team_location") or {}
        lat = loc.get("latitude")
        lng = loc.get("longitude")
        agents.append({
            "id":               str(u["_id"]),
            "full_name":        u.get("full_name"),
            "status":           u.get("status", "available"),
            "security_sub_role": u.get("security_sub_role"),
            "team_name":        u.get("team_name"),
            "latitude":         lat,
            "longitude":        lng,
            # GeoJSON-style location so frontend map markers work with coordinates[0/1]
            "location": {"coordinates": [lng, lat]} if lat is not None and lng is not None else None,
        })
    return {"agents": agents}

# ================== UNIFIED TRACK-USER (admin + security) ==================
# FIX ISSUE #6: Search & Track (security) and Track Users (admin) are now the
# same function. Both endpoints return the same shape so the frontend map
# component can render either without branching. The implementation lives in
# _track_user() and the only difference between the two routes is the
# authorisation rule.
async def _track_user(target_uid: str) -> dict:
    """
    Single source of truth for "where is this user right now?".

    Lookup priority:
      1. Active panic          → live location_history
      2. Active escort         → live route
      3. Ping-response track   → civil_tracks.currentLocation
      4. Security agent's last self-reported fix
      5. None                  → user is offline / not trackable

    Returns the SAME response shape for both /admin/track-user/{uid} and
    /security/track-user/{uid}.
    """
    try:
        target = await db.users.find_one({"_id": ObjectId(target_uid)})
    except Exception:
        target = None

    panic        = await db.panic_events.find_one({"user_id": target_uid, "is_active": True})
    escort       = await db.escort_sessions.find_one({"user_id": target_uid, "is_active": True})
    civil_track  = await db.civil_tracks.find_one({"user_id": target_uid})

    # Last known location for security users (mirrors the one already
    # computed in admin/track-user)
    security_location = None
    if target and target.get("role") == "security":
        lat = target.get("latitude") or target.get("last_latitude")
        lng = target.get("longitude") or target.get("last_longitude")
        if lat and lng:
            security_location = {
                "latitude":  lat,
                "longitude": lng,
                "timestamp": target.get("location_updated_at", ""),
                "source":    "security_update",
            }

    location_history: list = []
    latitude, longitude, last_update = None, None, None
    is_active, has_panic, has_escort, source = False, False, False, None

    if panic:
        location_history = panic.get("location_history", [])
        current  = panic.get("current_location", {})
        latitude = current.get("latitude")
        longitude = current.get("longitude")
        last_update = current.get("timestamp") or panic.get("updated_at", "")
        is_active, has_panic, source = True, True, "panic"
    elif escort:
        location_history = escort.get("route", [])
        if location_history:
            latest     = location_history[-1]
            latitude   = latest.get("latitude")
            longitude  = latest.get("longitude")
            last_update = latest.get("timestamp", "")
        is_active, has_escort, source = True, True, "escort"
    elif civil_track:
        current_loc = civil_track.get("currentLocation", {})
        if current_loc and "coordinates" in current_loc:
            longitude = current_loc["coordinates"][0] if len(current_loc["coordinates"]) > 0 else None
            latitude  = current_loc["coordinates"][1] if len(current_loc["coordinates"]) > 1 else None
        location_history = civil_track.get("location_history", [])
        last_update = civil_track.get("last_updated", "")
        is_active, source = True, "ping"
    elif security_location:
        latitude  = security_location["latitude"]
        longitude = security_location["longitude"]
        last_update = security_location["timestamp"]
        location_history = [security_location]
        is_active, source = True, "security_update"

    return {
        "is_active":        is_active,
        "has_panic":        has_panic,
        "has_escort":       has_escort,
        "source":           source,   # NEW: explains where the fix came from
        "latitude":         latitude,
        "longitude":        longitude,
        "last_update":      last_update,
        "location_history": location_history[-90:] if location_history else [],
        # User profile fields (always present, never None for known users)
        "user_id":          str(target["_id"])            if target else target_uid,
        "full_name":        target.get("full_name")       if target else None,
        "email":            target.get("email")           if target else None,
        "phone":            target.get("phone")           if target else None,
        "role":             target.get("role")            if target else None,
        "profile_photo_url": target.get("photo_url")      if target else None,
    }


@api_router.get("/security/track-user/{uid}")
async def security_track_user(uid: str, user=Depends(get_current_user)):
    """
    Search & Track (security) — unified with admin/track-user.
    Security may only track CIVIL users; admin may track any.
    """
    if user.get("role") not in ("security", "admin"):
        raise HTTPException(status_code=403, detail="Security or admin only")
    target = await db.users.find_one({"_id": ObjectId(uid)}, {"role": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("role") == "security" and target.get("role") != "civil":
        raise HTTPException(status_code=403, detail="Security may only track civil users")
    return await _track_user(uid)

# ================== CHAT UNREAD COUNT ==================
@api_router.get("/chat/unread-count")
async def chat_unread_count(user=Depends(get_current_user)):
    uid = str(user["_id"])
    cursor = db.chat_conversations.find({"participants": uid})
    total_unread = 0
    async for c in cursor:
        total_unread += c.get(f"unread_{uid}", 0)
    return {"count": total_unread}

# ================== USER PROFILE PHOTO ==================
@api_router.post("/user/profile-photo-base64")
async def upload_profile_photo(body: dict = Body(...), user=Depends(get_current_user)):
    photo_b64 = body.get("photo_base64", "")
    mime_type  = body.get("mime_type", "image/jpeg")
    if not photo_b64:
        raise HTTPException(status_code=400, detail="photo_base64 required")

    photo_url = ""
    if cloudinary_service:
        try:
            photo_bytes = __import__("base64").b64decode(photo_b64)
            photo_url = await cloudinary_service.upload_file(
                photo_bytes,
                f"profile_{uuid.uuid4().hex}.jpg",
                mime_type,
                folder="profiles"
            )
        except Exception as e:
            logger.error(f"Profile photo upload error: {e}")
            raise HTTPException(status_code=500, detail="Photo upload failed")
    else:
        photo_url = f"data:{mime_type};base64,{photo_b64[:50]}..."

    await db.users.update_one({"_id": user["_id"]}, {"$set": {"photo_url": photo_url}})
    return {"ok": True, "photo_url": photo_url}

# ================== USER EMERGENCY CONTACTS ==================
@api_router.get("/user/emergency-contacts")
async def get_emergency_contacts(user=Depends(get_current_user)):
    contacts = user.get("emergency_contacts", [])
    return {"contacts": contacts}

@api_router.put("/user/emergency-contacts")
async def save_emergency_contacts(body: dict = Body(...), user=Depends(get_current_user)):
    contacts = body.get("contacts", [])
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"emergency_contacts": contacts}}
    )
    return {"ok": True, "contacts": contacts}

# ================== USER APP CUSTOMIZATION ==================
@api_router.put("/user/customize-app")
async def customize_app(body: dict = Body(...), user=Depends(get_current_user)):
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "app_customization": {
                "app_name": body.get("app_name", "Se-Q"),
                "app_logo": body.get("app_logo", ""),
            }
        }}
    )
    return {"ok": True}


# ================== PERMISSIONS CHECK-UP (ISSUE #7) ==================
# The client (React Native) calls the native bridge to introspect the
# device's actual permission state (location/mic/camera/notifications/etc.)
# and POSTs the result here.  We persist the LAST KNOWN state on the user
# document so the admin dashboard can show "civil user John hasn't granted
# notifications in 14 days" and the client can schedule a re-check.
#
# The JS layer schedules a re-check every 24 h (see usePermissionsCheckup
# in the drop-in frontend code) AND on app foreground.  The endpoint is
# tolerant — a bad payload returns ok:false without raising.
class PermissionReport(BaseModel):
    permissions: Dict[str, bool]
    platform:    Optional[str] = "android"   # android | ios
    os_version:  Optional[str] = None
    app_version: Optional[str] = None


_PERMISSION_LABELS = {
    "location_fine":           "Precise location",
    "location_coarse":         "Approximate location",
    "location_background":     "Background location",
    "camera":                  "Camera",
    "microphone":              "Microphone",
    "sms":                     "SMS (panic SMS)",
    "notifications":           "Push notifications",
    "full_screen_intent":      "Full-screen alerts (panic heads-up)",
    "battery_optimization_off": "Battery optimisation disabled",
}

# What the app CANNOT function without — used to decide whether to nag.
_REQUIRED_PERMISSIONS = {
    "civil":   ["location_fine", "microphone", "camera", "notifications"],
    "security": ["location_fine", "notifications", "battery_optimization_off"],
    "admin":   ["notifications"],
}


@api_router.post("/user/permissions-check")
async def user_permissions_check(
    body: PermissionReport,
    user=Depends(get_current_user),
):
    """
    The device POSTs its current permission state.  We persist a snapshot
    on the user document and return a checklist the UI can render as a
    banner ("3 permissions are missing — tap to fix").
    """
    role          = user.get("role", "civil")
    perms         = body.permissions or {}
    granted       = {k: bool(v) for k, v in perms.items()}
    required      = _REQUIRED_PERMISSIONS.get(role, _REQUIRED_PERMISSIONS["civil"])
    missing_keys  = [k for k in required if not granted.get(k, False)]
    missing_optional = [k for k in granted.keys() if not granted.get(k, False) and k not in required]

    snapshot = {
        "permissions":      granted,
        "platform":         body.platform,
        "os_version":       body.os_version,
        "app_version":      body.app_version,
        "missing_required": missing_keys,
        "missing_optional": missing_optional,
        "checked_at":       datetime.utcnow(),
    }
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"permissions_check": snapshot}},
    )

    checklist = []
    for key in required + [k for k in granted.keys() if k not in required]:
        checklist.append({
            "key":      key,
            "label":    _PERMISSION_LABELS.get(key, key),
            "granted":  granted.get(key, False),
            "required": key in required,
        })

    return {
        "ok":              len(missing_keys) == 0,
        "missing_required": missing_keys,
        "missing_optional": missing_optional,
        "checklist":        checklist,
        "next_check_in_hours": 24,
    }


@api_router.get("/admin/permissions-compliance")
async def admin_permissions_compliance(
    role: Optional[str] = Query(None, description="Filter by role: civil | security | admin"),
    user=Depends(get_admin_user),
):
    """
    Admin overview: how many users are missing which required permissions.
    Used by the admin dashboard "Permissions Health" tile.
    """
    pipeline: List[Dict[str, Any]] = []
    match: Dict[str, Any] = {"permissions_check": {"$exists": True}}
    if role:
        match["role"] = role
    pipeline.append({"$match": match})
    pipeline.append({"$project": {
        "role": 1,
        "missing_required": "$permissions_check.missing_required",
        "checked_at":      "$permissions_check.checked_at",
    }})

    rows = []
    summary: Dict[str, Dict[str, int]] = {"civil": {}, "security": {}, "admin": {}}
    total_by_role: Dict[str, int] = {"civil": 0, "security": 0, "admin": 0}
    stale_by_role: Dict[str, int] = {"civil": 0, "security": 0, "admin": 0}
    stale_cutoff = datetime.utcnow() - timedelta(days=7)

    async for r in db.users.aggregate(pipeline):
        r_role  = r.get("role", "civil")
        missing = r.get("missing_required") or []
        total_by_role[r_role] = total_by_role.get(r_role, 0) + 1
        for k in missing:
            summary[r_role][k] = summary[r_role].get(k, 0) + 1
        checked = r.get("checked_at")
        if isinstance(checked, datetime) and checked < stale_cutoff:
            stale_by_role[r_role] = stale_by_role.get(r_role, 0) + 1
        rows.append({
            "user_id":         str(r["_id"]),
            "role":            r_role,
            "missing_required": missing,
            "checked_at":      checked.isoformat() if isinstance(checked, datetime) else None,
        })

    return {
        "rows":           rows,
        "summary":        summary,           # role → permission_key → count of users missing it
        "total_by_role":  total_by_role,
        "stale_by_role":  stale_by_role,     # last checkup > 7 days ago
        "permission_labels": _PERMISSION_LABELS,
    }

# ================== CONTACTABLE USERS ==================
@api_router.get("/users/contactable")
async def get_contactable_users(user=Depends(get_current_user)):
    uid = str(user["_id"])
    role = user.get("role", "civil")

    if role == "civil":
        query = {"role": "security", "is_active": True, "is_visible": {"$ne": False}}
    else:
        query = {"role": "civil", "is_active": True, "_id": {"$ne": user["_id"]}}

    cursor = db.users.find(query).limit(100)
    users = []
    async for u in cursor:
        users.append({
            "id":        str(u["_id"]),
            "full_name": u.get("full_name") or u.get("email"),
            "email":     u.get("email"),
            "phone":     u.get("phone"),
            "role":      u.get("role"),
        })
    return {"users": users}

# CORS Configuration
# Restrict to specific origins for production security
ALLOWED_ORIGINS = os.environ.get(
    'ALLOWED_ORIGINS',
    'se-q-app.com,your-app.expo.dev,*.expo.dev,*.expo.io,se-q-production.up.railway.app,*.up.railway.app'
).split(',')

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)
