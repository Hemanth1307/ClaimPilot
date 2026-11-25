import os
import json
import secrets
import re
import math
import pymupdf as fitz
from functools import wraps
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from flask import (
    Flask,
    request,
    jsonify,
    session,
    send_from_directory
)
from flask_cors import CORS
from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from database import init_db, rows, run, conn
from mcp_client import call, discover_tools, FILES as MCP_SERVERS


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

load_dotenv()

app = Flask(__name__)

UPLOAD_FOLDER = (
    Path(__file__).resolve().parent / "uploads" / "evidence"
)
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
REPORT_FOLDER = UPLOAD_FOLDER / "reports"
REPORT_FOLDER.mkdir(parents=True, exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

ALLOWED_EVIDENCE_EXTENSIONS = {
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "webp"
}

REFUND_STATUSES = {
    "Pending",
    "Processing",
    "Confirmed",
    "Rejected",
    "Cancelled"
}

app.config["SECRET_KEY"] = os.getenv("SECRET_KEY")

if not app.config["SECRET_KEY"]:
    raise RuntimeError(
        "SECRET_KEY is missing. Add SECRET_KEY to backend/.env"
    )

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

if not GOOGLE_CLIENT_ID:
    raise RuntimeError(
        "GOOGLE_CLIENT_ID is missing. Add GOOGLE_CLIENT_ID to backend/.env"
    )

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = False
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

CORS(
    app,
    origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    supports_credentials=True
)


def ensure_transactions_table():
    db = conn()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                external_id TEXT NOT NULL,
                merchant TEXT NOT NULL,
                amount REAL NOT NULL,
                transaction_date TEXT NOT NULL,
                source_mode TEXT NOT NULL DEFAULT 'unknown',
                imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, external_id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_user_date
            ON transactions(user_id, transaction_date DESC)
        """)
        db.commit()
    finally:
        db.close()


init_db()
ensure_transactions_table()


# ---------------------------------------------------------
# COMMON HELPERS
# ---------------------------------------------------------

def response_error(message, status=400):
    return jsonify({"error": message}), status


def get_json():
    return request.get_json(silent=True) or {}


def get_current_user():
    user_id = session.get("user_id")

    if not user_id:
        return None

    result = rows(
        """
        SELECT id, full_name, email, phone, location, image_url
        FROM users
        WHERE id = ?
        """,
        (user_id,)
    )

    return result[0] if result else None


def build_duplicate_alerts(transactions):
    groups = {}

    for transaction in transactions:
        amount = float(transaction["amount"])
        merchant = str(transaction["merchant"]).strip()
        transaction_date = str(transaction["transaction_date"])

        if amount <= 0 or not merchant:
            continue

        key = (
            merchant.casefold(),
            round(amount, 2),
            transaction_date
        )
        groups.setdefault(key, []).append(transaction)

    alerts = []
    for (_, amount, transaction_date), matches in groups.items():
        if len(matches) < 2:
            continue

        transaction_ids = [
            item["external_id"] for item in matches
        ]
        alerts.append({
            "merchant": matches[0]["merchant"],
            "amount": amount,
            "date": transaction_date,
            "transaction_ids": transaction_ids,
            "possible_duplicate_loss": amount * (len(matches) - 1),
            "label": "Possible duplicate — verify first"
        })

    return alerts


def public_user(user):
    if not user:
        return None

    return {
        "id": user["id"],
        "full_name": user["full_name"],
        "email": user["email"],
        "phone": user.get("phone", ""),
        "location": user.get("location", ""),
        "image_url": user.get("image_url", "")
    }


def login_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        user = get_current_user()

        if not user:
            session.clear()
            return response_error(
                "Please log in to continue.",
                401
            )

        return function(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------
# MCP HELPER
# ---------------------------------------------------------

def record_activity(user_id, server, tool, status, summary, claim_id=None):
    run(
        """
        INSERT INTO activity
        (user_id, server, tool, status, summary, claim_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            server,
            tool,
            status,
            str(summary)[:400],
            claim_id
        )
    )


def invoke(server, tool, arguments, user_id, claim_id=None):
    server_name = server + "_mcp"

    record_activity(
        user_id,
        server_name,
        tool,
        "started",
        "Starting MCP server and opening a tool session.",
        claim_id
    )

    def record_mcp_event(event, details):
        if event == "server_connected":
            summary = "MCP session initialized."
        elif event == "tools_discovered":
            names = ", ".join(details.get("tools", []))
            summary = f"Discovered tools: {names or 'none'}."
        elif event == "tool_discovery_failed":
            summary = "Requested tool was not discovered."
        elif event == "tool_invocation_started":
            summary = "Discovered tool invoked."
        elif event == "tool_invocation_failed":
            summary = "MCP server reported a tool error."
        elif event == "tool_result_received":
            summary = (
                "MCP result received "
                f"({details.get('character_count', 0)} text characters)."
            )
        else:
            summary = "MCP execution event."

        record_activity(
            user_id,
            server_name,
            tool,
            event,
            summary,
            claim_id
        )

    try:
        result = call(
            server,
            tool,
            arguments,
            event_callback=record_mcp_event
        )
    except Exception as error:
        app.logger.exception(
            "MCP execution failed: %s.%s",
            server,
            tool
        )
        record_activity(
            user_id,
            server_name,
            tool,
            "failed",
            f"MCP execution failed ({type(error).__name__}).",
            claim_id
        )
        raise

    record_activity(
        user_id,
        server_name,
        tool,
        "success",
        f"Tool completed; response length {len(result)} characters.",
        claim_id
    )
    return result


def parse_mcp_result(result):
    if isinstance(result, dict):
        return result

    if isinstance(result, str):
        return json.loads(result)

    raise ValueError("Unexpected MCP response format.")


# ---------------------------------------------------------
# HEALTH CHECK
# ---------------------------------------------------------

@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "application": "ClaimPilot",
        "mode": "authenticated_demo"
    })


# ---------------------------------------------------------
# REGISTER
# ---------------------------------------------------------

@app.post("/api/auth/register")
def register():
    data = get_json()

    full_name = str(data.get("full_name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not full_name or not email or not password:
        return response_error(
            "Full name, email and password are required."
        )

    if len(full_name) > 100:
        return response_error("Name must be under 100 characters.")

    if len(email) > 150 or "@" not in email:
        return response_error("Enter a valid email address.")

    if len(password) < 8:
        return response_error(
            "Password must contain at least 8 characters."
        )

    existing = rows(
        "SELECT id FROM users WHERE email = ?",
        (email,)
    )

    if existing:
        return response_error(
            "An account with this email already exists.",
            409
        )

    password_hash = generate_password_hash(password)

    try:
        user_id = run(
            """
            INSERT INTO users
            (full_name, email, password_hash)
            VALUES (?, ?, ?)
            """,
            (full_name, email, password_hash)
        )

        session.clear()
        session["user_id"] = user_id
        session.permanent = True

        user = get_current_user()

        return jsonify({
            "message": "Account created successfully.",
            "user": public_user(user)
        }), 201

    except Exception:
        app.logger.exception("Registration failed")
        return response_error(
            "Could not create your account.",
            500
        )


# ---------------------------------------------------------
# LOGIN WITH EMAIL AND PASSWORD
# ---------------------------------------------------------

@app.post("/api/auth/login")
def login():
    data = get_json()

    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return response_error(
            "Email and password are required."
        )

    users = rows(
        """
        SELECT id, full_name, email, password_hash,
               phone, location, image_url
        FROM users
        WHERE email = ?
        """,
        (email,)
    )

    if not users:
        return response_error(
            "Invalid email or password.",
            401
        )

    user = users[0]

    if (
        not user["password_hash"]
        or not check_password_hash(user["password_hash"], password)
    ):
        return response_error(
            "Invalid email or password.",
            401
        )

    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True

    return jsonify({
        "message": "Login successful.",
        "user": public_user(user)
    })


# ---------------------------------------------------------
# GOOGLE LOGIN
# ---------------------------------------------------------

@app.post("/api/auth/google")
def google_login():
    data = get_json()
    credential = data.get("credential")

    if not credential:
        return response_error("Google credential is missing.")

    try:
        google_user = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=10
        )

        email = str(
            google_user.get("email", "")
        ).strip().lower()

        google_id = google_user.get("sub")

        full_name = str(
            google_user.get("name", "")
        ).strip()

        image_url = str(
            google_user.get("picture", "")
        ).strip()

        if (
            not email
            or not google_id
            or not google_user.get("email_verified")
        ):
            return response_error(
                "Google email verification failed.",
                401
            )

        existing = rows(
            "SELECT id FROM users WHERE email = ?",
            (email,)
        )

        if existing:
            user_id = existing[0]["id"]

            run(
                """
                UPDATE users
                SET full_name = CASE
                        WHEN full_name IS NULL OR full_name = ''
                        THEN ?
                        ELSE full_name
                    END,
                    image_url = CASE
                        WHEN image_url IS NULL OR image_url = ''
                        THEN ?
                        ELSE image_url
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    full_name,
                    image_url,
                    user_id
                )
            )

        else:
            random_password = secrets.token_urlsafe(48)

            password_hash = generate_password_hash(
                random_password
            )

            user_id = run(
                """
                INSERT INTO users
                (full_name, email, password_hash, image_url)
                VALUES (?, ?, ?, ?)
                """,
                (
                    full_name or "Google User",
                    email,
                    password_hash,
                    image_url
                )
            )

        session.clear()
        session["user_id"] = user_id
        session.permanent = True

        user = get_current_user()

        return jsonify({
            "message": "Google login successful.",
            "user": public_user(user)
        })

    except ValueError as error:
        app.logger.exception(
            "Google ID token verification failed: %s",
            str(error)
        )

        return response_error(
            f"Google token verification failed: {str(error)}",
            401
        )

    except Exception:
        app.logger.exception("Google login failed")
        return response_error(
            "Google login failed. Please try again.",
            500
        )


# ---------------------------------------------------------
# CURRENT USER
# ---------------------------------------------------------

@app.get("/api/auth/me")
def current_user():
    user = get_current_user()

    if not user:
        return jsonify({
            "authenticated": False,
            "user": None
        }), 200

    return jsonify({
        "authenticated": True,
        "user": public_user(user)
    }), 200


# ---------------------------------------------------------
# LOGOUT
# ---------------------------------------------------------

@app.post("/api/auth/logout")
def logout():
    session.clear()

    response = jsonify({
        "ok": True,
        "message": "Logged out successfully."
    })

    response.delete_cookie(
        app.config.get("SESSION_COOKIE_NAME", "session")
    )

    return response


# ---------------------------------------------------------
# PROFILE - GET
# ---------------------------------------------------------

@app.get("/api/profile")
@login_required
def get_profile():
    user = get_current_user()
    return jsonify(public_user(user))


# ---------------------------------------------------------
# PROFILE - UPDATE
# ---------------------------------------------------------

@app.put("/api/profile")
@login_required
def update_profile():
    user = get_current_user()
    data = get_json()

    full_name = str(
        data.get("full_name", user["full_name"])
    ).strip()

    email = str(
        data.get("email", user["email"])
    ).strip().lower()

    phone = str(data.get("phone", "")).strip()
    location = str(data.get("location", "")).strip()
    image_url = str(data.get("image_url", "")).strip()

    if not full_name or not email:
        return response_error(
            "Full name and email are required."
        )

    if len(full_name) > 100:
        return response_error("Name is too long.")

    if len(email) > 150 or "@" not in email:
        return response_error("Enter a valid email address.")

    if len(phone) > 30 or len(location) > 150:
        return response_error("Phone or location is too long.")

    if len(image_url) > 5_000_000:
        return response_error("Profile image is too large.")

    duplicate = rows(
        """
        SELECT id FROM users
        WHERE email = ? AND id != ?
        """,
        (email, user["id"])
    )

    if duplicate:
        return response_error(
            "This email is already used by another account.",
            409
        )

    try:
        run(
            """
            UPDATE users
            SET full_name = ?,
                email = ?,
                phone = ?,
                location = ?,
                image_url = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                full_name,
                email,
                phone,
                location,
                image_url,
                user["id"]
            )
        )

        updated_user = get_current_user()

        return jsonify({
            "message": "Profile updated successfully.",
            "profile": public_user(updated_user)
        })

    except Exception:
        app.logger.exception("Profile update failed")
        return response_error(
            "Could not update your profile.",
            500
        )


# ---------------------------------------------------------
# DASHBOARD
# ---------------------------------------------------------

@app.get("/api/dashboard")
@login_required
def dashboard():
    user = get_current_user()
    user_id = user["id"]

    claims = rows(
        """
        SELECT * FROM claims
        WHERE user_id = ?
        ORDER BY id DESC
        """,
        (user_id,)
    )

    activity = rows(
        """
        SELECT * FROM activity
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 12
        """,
        (user_id,)
    )

    reminders = rows(
        """
        SELECT * FROM reminders
        WHERE user_id = ?
        ORDER BY id DESC
        """,
        (user_id,)
    )

    warranties = rows(
        """
        SELECT * FROM warranties
        WHERE user_id = ?
        ORDER BY id DESC
        """,
        (user_id,)
    )

    claim_metrics = rows(
        """
        SELECT
            COUNT(*) AS total_claims,
            COALESCE(SUM(
                CASE
                    WHEN COALESCE(status, '') NOT IN (
                        'Approved (demo)',
                        'Resolved',
                        'Closed'
                    )
                    THEN 1
                    ELSE 0
                END
            ), 0) AS active_claims,
            COALESCE(SUM(
                CASE
                    WHEN COALESCE(status, '') NOT IN (
                        'Approved (demo)',
                        'Resolved',
                        'Closed'
                    ) AND amount > 0
                    THEN amount
                    ELSE 0
                END
            ), 0) AS at_risk
        FROM claims
        WHERE user_id = ?
        """,
        (user_id,)
    )[0]

    confirmed_refunds = rows(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM refunds
        WHERE user_id = ?
          AND status = 'Confirmed'
          AND TRIM(COALESCE(reference_number, '')) <> ''
        """,
        (user_id,)
    )[0]["total"]

    total_spending = rows(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM transactions
        WHERE user_id = ? AND amount > 0
        """,
        (user_id,)
    )[0]["total"]

    recent_transactions = rows(
        """
        SELECT
            external_id AS id,
            merchant,
            amount,
            transaction_date AS date,
            source_mode
        FROM transactions
        WHERE user_id = ?
        ORDER BY transactions.transaction_date DESC, transactions.id DESC
        LIMIT 10
        """,
        (user_id,)
    )
    all_transactions = rows(
        """
        SELECT external_id, merchant, amount, transaction_date
        FROM transactions
        WHERE user_id = ?
        ORDER BY transaction_date ASC, id ASC
        """,
        (user_id,)
    )
    detected_alerts = build_duplicate_alerts(all_transactions)

    monthly_spending = rows(
        """
        SELECT
            substr(transaction_date, 1, 7) AS month,
            COALESCE(SUM(amount), 0) AS total
        FROM transactions
        WHERE user_id = ?
          AND amount > 0
          AND date(transaction_date) >= date('now', 'start of month', '-5 months')
        GROUP BY substr(transaction_date, 1, 7)
        ORDER BY month
        """,
        (user_id,)
    )
    transaction_sync = rows(
        """
        SELECT source_mode, imported_at
        FROM transactions
        WHERE user_id = ?
        ORDER BY imported_at DESC, id DESC
        LIMIT 1
        """,
        (user_id,)
    )
    possible_duplicate_loss = sum(
        alert["possible_duplicate_loss"]
        for alert in detected_alerts
    )

    return jsonify({
        "claims": claims,
        "activity": activity,
        "reminders": reminders,
        "warranties": warranties,
        "recent_transactions": recent_transactions,
        "monthly_spending": monthly_spending,
        "detected_alerts": detected_alerts,
        "transaction_mode": (
            transaction_sync[0]["source_mode"]
            if transaction_sync else None
        ),
        "transaction_last_synced": (
            transaction_sync[0]["imported_at"]
            if transaction_sync else None
        ),
        "metrics": {
            "total_claims": claim_metrics["total_claims"],
            "active_claims": claim_metrics["active_claims"],
            "at_risk": claim_metrics["at_risk"],
            "confirmed_recovered": confirmed_refunds,
            "total_spending": total_spending,
            "possible_duplicate_loss": possible_duplicate_loss,
            "active_alerts": len(detected_alerts)
        }
    })


# ---------------------------------------------------------
# INVESTIGATE DELAYED ORDER
# ---------------------------------------------------------

@app.post("/api/investigate")
@login_required
def investigate():
    user = get_current_user()
    user_id = user["id"]
    data = get_json()
    requested_claim_id = data.get("claim_id")

    explicit_target = None
    if requested_claim_id is not None:
        explicit_rows = rows(
            """
            SELECT id, merchant, order_id, amount, issue, status
            FROM claims
            WHERE id = ? AND user_id = ?
            """,
            (requested_claim_id, user_id)
        )
        if not explicit_rows:
            return response_error("Claim not found.", 404)
        explicit_target = explicit_rows[0]
    elif "merchant" not in data and "order_id" not in data:
        eligible_rows = rows(
            """
            SELECT id, merchant, order_id, amount, issue, status
            FROM claims
            WHERE user_id = ? AND status = 'Needs review'
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,)
        )
        if eligible_rows:
            explicit_target = eligible_rows[0]

    if explicit_target:
        merchant = str(explicit_target["merchant"]).strip()
        order_id = str(explicit_target["order_id"]).strip()
        amount = float(explicit_target["amount"] or 0)
        issue_label = str(explicit_target.get("issue") or "Order delayed").strip() or "Order delayed"
    else:
        merchant = str(
            data.get("merchant", "ShopKart")
        ).strip()

        order_id = str(
            data.get("order_id", "SK-88421")
        ).strip()

        try:
            amount = float(data.get("amount", 3050))
        except (TypeError, ValueError):
            return response_error("Amount must be a valid number.")

        issue_label = "Order delayed"

    if not merchant or not order_id or amount <= 0:
        return response_error("Invalid order details.")

    if len(merchant) > 100 or len(order_id) > 100:
        return response_error("Order details are too long.")

    db = conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        if explicit_target:
            existing_claim = db.execute(
                """
                SELECT id, status
                FROM claims
                WHERE id = ? AND user_id = ?
                """,
                (explicit_target["id"], user_id)
            ).fetchone()
        else:
            existing_claim = db.execute(
                """
                SELECT id, status
                FROM claims
                WHERE user_id = ?
                  AND merchant = ? COLLATE NOCASE
                  AND order_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (user_id, merchant, order_id)
            ).fetchone()

        if existing_claim and existing_claim["status"] in {
            "Approved (demo)",
            "Rejected (demo)",
            "Resolved",
            "Closed"
        }:
            db.rollback()
            return response_error(
                "This order already has a final decision. Open its existing claim.",
                409
            )

        if existing_claim:
            claim_id = existing_claim["id"]
            db.execute(
                """
                UPDATE claims
                SET amount = ?, issue = ?, draft = '', status = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    amount,
                    issue_label,
                    "Investigating",
                    claim_id,
                    user_id
                )
            )
        else:
            cursor = db.execute(
                """
                INSERT INTO claims
                (user_id, merchant, order_id, amount, issue, draft, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    merchant,
                    order_id,
                    amount,
                    issue_label,
                    "",
                    "Investigating"
                )
            )
            claim_id = cursor.lastrowid
        db.commit()
    finally:
        db.close()

    record_activity(
        user_id,
        "claimpilot",
        "investigation_started",
        "started",
        f"Investigation started for order {order_id}.",
        claim_id
    )

    try:
        ledger = parse_mcp_result(
            invoke(
                "ledger",
                "get_recent_transactions",
                {"days": 30},
                user_id,
                claim_id
            )
        )
        duplicates = parse_mcp_result(
            invoke(
                "ledger",
                "detect_possible_duplicates",
                {},
                user_id,
                claim_id
            )
        )
        subscription_traps = parse_mcp_result(
            invoke(
                "ledger",
                "detect_subscription_traps",
                {},
                user_id,
                claim_id
            )
        )
        evidence = parse_mcp_result(
            invoke(
                "inbox",
                "search_emails",
                {"query": order_id},
                user_id,
                claim_id
            )
        )
        policy = parse_mcp_result(
            invoke(
                "policy",
                "fetch_refund_policy",
                {
                    "merchant_name": merchant,
                    "issue_type": "delayed_delivery"
                },
                user_id,
                claim_id
            )
        )

        matches = evidence.get("matches", [])
        delayed_orders = []
        for match in matches:
            expected_date_text = str(
                match.get("expected_delivery_date", "")
            )
            delivery_status = str(
                match.get("delivery_status", "")
            ).strip().casefold()
            try:
                expected_date = date.fromisoformat(expected_date_text)
            except ValueError:
                continue

            if (
                expected_date < date.today()
                and delivery_status in {"not_delivered", "delayed"}
            ):
                delayed_orders.append({
                    "expected_delivery_date": expected_date_text,
                    "delivery_status": delivery_status
                })

        if delayed_orders:
            delay_finding = {
                "status": "confirmed_delayed",
                "expected_delivery_date": delayed_orders[0][
                    "expected_delivery_date"
                ],
                "summary": (
                    "Inbox MCP matched an order record marked not delivered "
                    "after its expected delivery date "
                    f"({delayed_orders[0]['expected_delivery_date']})."
                )
            }
        else:
            delay_finding = {
                "status": "unconfirmed",
                "expected_delivery_date": None,
                "summary": (
                    "Inbox MCP did not provide a matching overdue, "
                    "undelivered order record. Verify before sending."
                )
            }

        record_activity(
            user_id,
            "claimpilot",
            "delayed_order_check",
            "confirmed" if delayed_orders else "unconfirmed",
            delay_finding["summary"],
            claim_id
        )

        transaction_matches = []
        for transaction in ledger.get("transactions", []):
            try:
                transaction_amount = float(transaction.get("amount"))
            except (TypeError, ValueError):
                continue

            if (
                str(transaction.get("merchant", "")).strip().casefold()
                == merchant.casefold()
                and abs(transaction_amount - amount) <= 0.01
            ):
                transaction_matches.append(transaction)

        evidence_items = rows(
            """
            SELECT id, original_name, file_size, created_at
            FROM claim_evidence
            WHERE claim_id = ? AND user_id = ?
            ORDER BY id DESC
            """,
            (claim_id, user_id)
        )
        record_activity(
            user_id,
            "evidence",
            "uploaded_evidence_retrieval",
            "success",
            f"Found {len(evidence_items)} uploaded evidence file(s).",
            claim_id
        )

        email_summary = (
            "A matching demo order email was found."
            if matches
            else "No matching demo order email was found."
        )
        transaction_summary = (
            "Matching ledger transaction(s): "
            + ", ".join(
                str(item.get("id", "unknown"))
                for item in transaction_matches
            )
            if transaction_matches
            else "No ledger transaction matched merchant and amount."
        )
        policy_guidance = str(policy.get("guidance", "")).strip()
        policy_draft_note = (
            policy_guidance
            if policy_guidance
            else "No illustrative policy guidance was returned."
        )
        order_status_summary = (
            "The order record shows the expected delivery date has passed "
            "and its status is not delivered."
            if delayed_orders
            else (
                "The retrieved order communication did not confirm an "
                "overdue delivery; verify the status before sending."
            )
        )

        draft = (
            f"Subject: Update on delayed order {order_id}\n\n"
            f"Hello {merchant} Support Team,\n\n"
            f"My order {order_id}, worth ₹{amount:,.0f}, "
            f"{order_status_summary} "
            f"{email_summary} {transaction_summary} "
            f"{policy_draft_note} "
            "Please share the current delivery status and the resolution "
            "available under your current delivery policy.\n\n"
            "Thank you.\n\n"
            "This is an editable local template based on the retrieved "
            "demo data; no AI service or external email is used."
        )

        run(
            """
            UPDATE claims
            SET draft = ?, status = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                draft,
                "Needs review",
                claim_id,
                user_id
            )
        )
        record_activity(
            user_id,
            "claimpilot",
            "draft_generated",
            "success",
            "Editable local template generated from retrieved demo data.",
            claim_id
        )
        record_activity(
            user_id,
            "claimpilot",
            "investigation_completed",
            "success",
            "Ledger, Inbox, Policy, and uploaded evidence checks completed.",
            claim_id
        )

        return jsonify({
            "claim_id": claim_id,
            "id": claim_id,
            "merchant": merchant,
            "order_id": order_id,
            "amount": amount,
            "issue": issue_label,
            "draft": draft,
            "evidence": matches,
            "policy": policy,
            "delay_finding": delay_finding,
            "transactions": transaction_matches,
            "duplicate_alerts": duplicates.get("alerts", []),
            "subscription_traps": subscription_traps.get("traps", []),
            "uploaded_evidence": evidence_items,
            "draft_source": "local_template",
            "status": "Needs review"
        })

    except Exception:
        app.logger.exception("Investigation failed")
        run(
            """
            UPDATE claims
            SET status = ?
            WHERE id = ? AND user_id = ?
            """,
            ("Investigation failed", claim_id, user_id)
        )
        record_activity(
            user_id,
            "claimpilot",
            "investigation_failed",
            "failed",
            "Investigation failed; inspect backend logs for the tool error.",
            claim_id
        )
        return response_error(
            "Could not complete the investigation.",
            500
        )


@app.post("/api/claims/test")
@login_required
def create_test_claim():
    if not (
        app.debug
        or app.testing
        or os.getenv("FLASK_ENV", "").strip().lower() == "development"
    ):
        return response_error(
            "Test claim creation is available only in development/demo mode.",
            403
        )

    user = get_current_user()
    user_id = user["id"]
    order_id = f"TEST-{uuid4().hex[:8].upper()}"
    merchant = "DemoMart"
    amount = 1499.0
    issue = "Test delayed order (demo)"
    draft = (
        f"Subject: Demo test claim for delayed order {order_id}\n\n"
        f"Hello {merchant} Support Team,\n\n"
        f"This is a development/demo test claim for order {order_id} "
        f"(₹{amount:,.0f}). Please share the current delivery status.\n\n"
        "Thank you.\n\n"
        "This is a demo-only test claim generated for local testing."
    )

    claim_id = run(
        """
        INSERT INTO claims
        (user_id, merchant, order_id, amount, issue, draft, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, merchant, order_id, amount, issue, draft, "Needs review")
    )

    record_activity(
        user_id,
        "claimpilot",
        "create_test_claim",
        "success",
        f"Created demo test claim for order {order_id}.",
        claim_id
    )

    created = get_user_claim(claim_id, user_id)
    return jsonify({
        "ok": True,
        "claim_id": claim_id,
        "id": claim_id,
        "merchant": created["merchant"],
        "order_id": created["order_id"],
        "amount": created["amount"],
        "issue": created["issue"],
        "draft": created["draft"],
        "status": created["status"],
        "created_at": created["created_at"],
        "message": f"Created demo test claim {order_id} (Needs review)."
    }), 201


# ---------------------------------------------------------
# APPROVE COMPLAINT DRAFT
# ---------------------------------------------------------

@app.post("/api/approve")
@login_required
def approve():
    user = get_current_user()
    user_id = user["id"]
    data = get_json()

    claim_id = data.get("claim_id")
    draft = str(data.get("draft", "")).strip()

    if not claim_id:
        return response_error("Claim ID is required.")

    claim = rows(
        """
        SELECT * FROM claims
        WHERE id = ? AND user_id = ?
        """,
        (claim_id, user_id)
    )

    if not claim:
        return response_error("Claim not found.", 404)

    claim = claim[0]
    decision = str(data.get("decision", "approve")).strip().lower()
    if decision not in {"approve", "reject"}:
        return response_error("Decision must be approve or reject.")

    if not draft:
        draft = claim["draft"]

    if claim["status"] != "Needs review":
        return response_error(
            "This draft is no longer awaiting review.",
            409
        )

    next_status = (
        "Rejected (demo)"
        if decision == "reject"
        else "Approval in progress"
    )
    db = conn()
    try:
        cursor = db.execute(
            """
            UPDATE claims
            SET status = ?
            WHERE id = ? AND user_id = ? AND status = 'Needs review'
            """,
            (next_status, claim_id, user_id)
        )
        if cursor.rowcount != 1:
            db.rollback()
            return response_error(
                "This draft has already been reviewed.",
                409
            )

        db.execute(
            """
            INSERT INTO activity
            (user_id, server, tool, status, summary, claim_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                "human_review",
                "draft_rejected" if decision == "reject" else "draft_approved",
                "rejected" if decision == "reject" else "approved",
                f"User {user_id} made the {decision} decision.",
                claim_id
            )
        )
        db.commit()
    finally:
        db.close()

    if decision == "reject":
        return jsonify({
            "ok": True,
            "status": "Rejected (demo)",
            "message": "Draft rejected. No external action was taken."
        })

    try:
        result = parse_mcp_result(
            invoke(
                "inbox",
                "record_approved_draft",
                {
                    "order_id": claim["order_id"],
                    "recipient": "merchant-support@example.test",
                    "subject": "Delayed order " + claim["order_id"],
                    "body": draft
                },
                user_id,
                claim_id
            )
        )
        if result.get("recorded") is not True:
            raise RuntimeError("Demo Inbox did not record the approval.")

        run(
            """
            UPDATE claims
            SET status = ?, draft = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                "Approved (demo)",
                draft,
                claim_id,
                user_id
            )
        )

        record_activity(
            user_id,
            "human_review",
            "demo_execution_completed",
            "success",
            "Inbox MCP recorded the demo approval; no email was sent.",
            claim_id
        )

        return jsonify({
            "ok": True,
            "status": "Approved (demo)",
            "result": result,
            "message": "Demo approval recorded. No email was sent."
        })

    except Exception:
        app.logger.exception("Claim approval failed")
        run(
            """
            UPDATE claims
            SET status = ?
            WHERE id = ? AND user_id = ?
              AND status = 'Approval in progress'
            """,
            ("Approval failed", claim_id, user_id)
        )
        record_activity(
            user_id,
            "human_review",
            "demo_execution_failed",
            "failed",
            "The demo approval could not be recorded.",
            claim_id
        )
        return response_error(
            "Could not record approval.",
            500
        )


# ---------------------------------------------------------
# TRANSACTION CHECK
# ---------------------------------------------------------

@app.post("/api/transactions")
@login_required
def transactions():
    user = get_current_user()

    try:
        recent = parse_mcp_result(
            invoke(
                "ledger",
                "get_recent_transactions",
                {"days": 30},
                user["id"]
            )
        )
        duplicate_result = parse_mcp_result(
            invoke(
                "ledger",
                "detect_possible_duplicates",
                {},
                user["id"]
            )
        )

        source_transactions = recent.get("transactions")
        tool_alerts = duplicate_result.get("alerts")
        if not isinstance(source_transactions, list):
            raise RuntimeError(
                "Ledger MCP returned an invalid transaction list."
            )
        if not isinstance(tool_alerts, list):
            raise RuntimeError(
                "Ledger MCP returned an invalid alert list."
            )

        source_mode = str(recent.get("mode", "unknown")).strip() or "unknown"
        normalized_transactions = []
        for item in source_transactions:
            if not isinstance(item, dict):
                raise RuntimeError(
                    "Ledger MCP returned an invalid transaction record."
                )

            external_id = str(item.get("id", "")).strip()
            merchant = str(item.get("merchant", "")).strip()
            transaction_date = str(item.get("date", "")).strip()
            try:
                amount = float(item.get("amount"))
                date.fromisoformat(transaction_date)
            except (TypeError, ValueError):
                raise RuntimeError(
                    "Ledger MCP returned invalid transaction values."
                )

            if (
                not external_id
                or not merchant
                or not math.isfinite(amount)
            ):
                raise RuntimeError(
                    "Ledger MCP returned incomplete transaction values."
                )

            normalized_transactions.append((
                user["id"],
                external_id,
                merchant,
                amount,
                transaction_date,
                source_mode
            ))

        db = conn()
        try:
            db.executemany(
                """
                INSERT INTO transactions (
                    user_id,
                    external_id,
                    merchant,
                    amount,
                    transaction_date,
                    source_mode
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, external_id) DO UPDATE SET
                    merchant = excluded.merchant,
                    amount = excluded.amount,
                    transaction_date = excluded.transaction_date,
                    source_mode = excluded.source_mode,
                    imported_at = CURRENT_TIMESTAMP
                """,
                normalized_transactions
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        persisted_transactions = rows(
            """
            SELECT external_id, merchant, amount, transaction_date
            FROM transactions
            WHERE user_id = ?
            ORDER BY transaction_date ASC, id ASC
            """,
            (user["id"],)
        )
        persisted_ids = {
            item["external_id"] for item in persisted_transactions
        }
        for alert in tool_alerts:
            if not isinstance(alert, dict):
                raise RuntimeError(
                    "Ledger MCP returned an invalid duplicate alert."
                )
            ids = alert.get("transaction_ids")
            if (
                not isinstance(ids, list)
                or len(ids) < 2
                or not set(map(str, ids)).issubset(persisted_ids)
            ):
                raise RuntimeError(
                    "Ledger MCP alert did not match persisted transactions."
                )

        duplicate_alerts = build_duplicate_alerts(
            persisted_transactions
        )
        possible_duplicate_loss = sum(
            alert["possible_duplicate_loss"]
            for alert in duplicate_alerts
        )
        recent_transactions = rows(
            """
            SELECT
                external_id AS id,
                merchant,
                amount,
                transaction_date AS date,
                source_mode
            FROM transactions
            WHERE user_id = ?
            ORDER BY transaction_date DESC, id DESC
            LIMIT 10
            """,
            (user["id"],)
        )
        total_spending = rows(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE user_id = ? AND amount > 0
            """,
            (user["id"],)
        )[0]["total"]

        return jsonify({
            "mode": source_mode,
            "transactions": recent_transactions,
            "duplicate_alerts": duplicate_alerts,
            "possible_duplicate_loss": possible_duplicate_loss,
            "total_spending": total_spending
        })

    except Exception:
        app.logger.exception("Transaction check failed")
        return response_error(
            "Could not check transactions.",
            500
        )


# ---------------------------------------------------------
# CREATE REMINDER
# ---------------------------------------------------------

@app.post("/api/reminders")
@login_required
def create_reminder():
    user = get_current_user()
    data = get_json()

    title = str(
        data.get("title", "Review renewal")
    ).strip()

    due_date = str(
        data.get(
            "due_date",
            (date.today() + timedelta(days=7)).isoformat()
        )
    ).strip()

    notes = str(
        data.get("notes", "")
    ).strip()
    claim_id = data.get("claim_id")

    if not title or not due_date:
        return response_error(
            "Reminder title and due date are required."
        )

    existing_reminder = rows(
        """
        SELECT id, title, due_date
        FROM reminders
        WHERE user_id = ?
          AND LOWER(TRIM(title)) = LOWER(TRIM(?))
          AND due_date = ?
          AND COALESCE(status, 'Pending') = 'Pending'
        LIMIT 1
        """,
        (user["id"], title, due_date)
    )
    if existing_reminder:
        return response_error(
            f"A pending reminder for '{existing_reminder[0]['title']}' on {due_date} already exists.",
            409
        )

    if claim_id and not get_user_claim(claim_id, user["id"]):
        return response_error("Claim not found.", 404)

    try:
        result = parse_mcp_result(
            invoke(
                "calendar",
                "create_reminder",
                {
                    "title": title,
                    "due_date": due_date,
                    "notes": notes
                },
                user["id"],
                claim_id
            )
        )

        if not result.get("created"):
            record_activity(
                user["id"],
                "claimpilot",
                "reminder_validation",
                "failed",
                result.get("error", "Calendar rejected the reminder."),
                claim_id
            )
            return response_error(
                result.get("error", "Calendar rejected the reminder."),
                400
            )

        reminder_id = run(
            """
            INSERT INTO reminders
            (user_id, title, due_date, notes, status, claim_id)
            VALUES (?, ?, ?, ?, 'Pending', ?)
            """,
            (
                user["id"],
                result.get("title", title),
                result.get("due_date", due_date),
                result.get("notes", notes),
                claim_id
            )
        )
        result["reminder_id"] = reminder_id
        record_activity(
            user["id"],
            "claimpilot",
            "reminder_saved",
            "success",
            "Calendar reminder validated and saved locally.",
            claim_id
        )

        return jsonify(result)

    except Exception:
        app.logger.exception("Reminder creation failed")
        return response_error(
            "Could not create reminder.",
            500
        )


# ---------------------------------------------------------
# SAVE WARRANTY
# ---------------------------------------------------------

@app.post("/api/warranties")
@login_required
def save_warranty():
    user = get_current_user()
    data = get_json()

    product = str(
        data.get("product", "")
    ).strip()

    expiry_date = str(
        data.get("expiry_date", "")
    ).strip()

    serial_number = str(
        data.get("serial_number", "")
    ).strip()

    file_name = str(
        data.get("file_name", "")
    ).strip()

    if not product or not expiry_date:
        return response_error(
            "Product and expiry date are required."
        )

    try:
        result = parse_mcp_result(
            invoke(
                "vault",
                "save_warranty",
                {
                    "product": product,
                    "expiry_date": expiry_date,
                    "serial_number": serial_number,
                    "file_name": file_name
                },
                user["id"]
            )
        )

        if not result.get("prepared"):
            record_activity(
                user["id"],
                "vault_mcp",
                "save_warranty",
                "rejected",
                result.get("error", "Vault rejected the warranty."),
            )
            return response_error(
                result.get("error", "Vault rejected the warranty."),
                400
            )

        warranty_id = run(
            """
            INSERT INTO warranties
            (user_id, product, serial_number, expiry_date, file_name)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                result.get("product", product),
                result.get("serial_number", serial_number),
                result.get("expiry_date", expiry_date),
                result.get("file_name", file_name)
            )
        )
        result["warranty_id"] = warranty_id
        record_activity(
            user["id"],
            "claimpilot",
            "warranty_saved",
            "success",
            "Vault MCP validated warranty details and they were saved locally."
        )

        return jsonify(result)

    except Exception:
        app.logger.exception("Warranty save failed")
        return response_error(
            "Could not save warranty.",
            500
        )


# ---------------------------------------------------------
# HELPER: VERIFY CLAIM OWNERSHIP
# ---------------------------------------------------------

def get_user_claim(claim_id, user_id):
    result = rows(
        """
        SELECT id, merchant, order_id, amount, issue, draft, status,
               created_at
        FROM claims
        WHERE id = ? AND user_id = ?
        """,
        (claim_id, user_id)
    )

    return result[0] if result else None


@app.get("/api/claims/<int:claim_id>/history")
@login_required
def get_claim_history(claim_id):
    user = get_current_user()
    claim = rows(
        """
        SELECT id, merchant, order_id, amount, issue, draft, status,
               created_at
        FROM claims
        WHERE id = ? AND user_id = ?
        """,
        (claim_id, user["id"])
    )

    if not claim:
        return response_error("Claim not found.", 404)

    events = rows(
        """
        SELECT id, user_id, claim_id, server, tool, status, summary,
               created_at
        FROM activity
        WHERE user_id = ? AND claim_id = ?
        ORDER BY id ASC
        """,
        (user["id"], claim_id)
    )

    return jsonify({
        "claim": claim[0],
        "events": events
    })


# ---------------------------------------------------------
# REFUND RECOVERY: LIST REFUNDS
# ---------------------------------------------------------

@app.get("/api/refunds")
@login_required
def get_refunds():
    user = get_current_user()

    result = rows(
        """
        SELECT
            refunds.*,
            claims.merchant,
            claims.order_id
        FROM refunds
        JOIN claims ON claims.id = refunds.claim_id
        WHERE refunds.user_id = ?
        ORDER BY refunds.id DESC
        """,
        (user["id"],)
    )

    return jsonify({"refunds": result})


# ---------------------------------------------------------
# REFUND RECOVERY: CREATE REFUND RECORD
# ---------------------------------------------------------

@app.post("/api/refunds")
@login_required
def create_refund():
    user = get_current_user()
    data = get_json()

    claim_id = data.get("claim_id")

    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        return response_error("Enter a valid refund amount.")

    notes = str(data.get("notes", "")).strip()

    if not claim_id:
        return response_error("Select a claim.")

    if amount <= 0:
        return response_error(
            "Refund amount must be greater than zero."
        )

    if len(notes) > 1000:
        return response_error("Notes are too long.")

    claim = get_user_claim(claim_id, user["id"])

    if not claim:
        return response_error("Claim not found.", 404)

    if amount > float(claim["amount"] or 0):
        return response_error(
            "Refund amount cannot exceed the claim amount."
        )

    refund_id = run(
        """
        INSERT INTO refunds
        (user_id, claim_id, amount, status, notes)
        VALUES (?, ?, ?, 'Pending', ?)
        """,
        (user["id"], claim_id, amount, notes)
    )

    return jsonify({
        "ok": True,
        "refund_id": refund_id,
        "message": "Refund record created."
    }), 201


# ---------------------------------------------------------
# REFUND RECOVERY: UPDATE STATUS
# ---------------------------------------------------------

@app.patch("/api/refunds/<int:refund_id>")
@login_required
def update_refund(refund_id):
    user = get_current_user()
    data = get_json()

    status = str(data.get("status", "")).strip()

    reference_number = str(
        data.get("reference_number", "")
    ).strip()

    if status not in REFUND_STATUSES:
        return response_error("Invalid refund status.")

    if len(reference_number) > 150:
        return response_error("Reference number is too long.")

    existing = rows(
        """
        SELECT id
        FROM refunds
        WHERE id = ? AND user_id = ?
        """,
        (refund_id, user["id"])
    )

    if not existing:
        return response_error(
            "Refund record not found.",
            404
        )

    if status == "Confirmed" and not reference_number:
        return response_error(
            "Add a refund reference number before confirming recovery."
        )

    run(
        """
        UPDATE refunds
        SET status = ?,
            reference_number = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        """,
        (
            status,
            reference_number,
            refund_id,
            user["id"]
        )
    )

    updated = rows(
        """
        SELECT
            refunds.*,
            claims.merchant,
            claims.order_id
        FROM refunds
        JOIN claims ON claims.id = refunds.claim_id
        WHERE refunds.id = ? AND refunds.user_id = ?
        """,
        (refund_id, user["id"])
    )

    return jsonify({
        "ok": True,
        "message": "Refund status updated.",
        "refund": updated[0] if updated else None
    })
def extract_invoice_fields(text):
    normalized_text = str(text).replace("\xa0", " ")
    lines = [
        re.sub(r"[ \t]+", " ", line).strip()
        for line in normalized_text.splitlines()
    ]
    lines = [line for line in lines if line]

    def normalize(value):
        return re.sub(r"\s+", " ", value).strip()

    order_labels = (
        r"Order\s*(?:ID|No\.?|Number|#)|Purchase\s*Order"
    )
    invoice_number_labels = r"Invoice\s*(?:No\.?|Number|#)"
    invoice_date_labels = (
        r"Invoice\s*Date|Date\s*of\s*Invoice|Bill\s*Date|Date"
    )
    merchant_labels = (
        r"Seller(?:\s*Name)?|Merchant(?:\s*Name)?|Vendor|"
        r"Sold\s*By|Billed\s*By"
    )
    total_labels = (
        r"Grand\s*Total|Total\s*Amount|Invoice\s*Total|Order\s*Total|"
        r"Total\s*Paid|Amount\s*Payable|Total\s*Payable|Net\s*Amount|"
        r"Amount\s*Due|Total"
    )
    amount_label_priority = (
        r"Total\s*Paid",
        r"Amount\s*Payable|Total\s*Payable|Amount\s*Due",
        r"Grand\s*Total",
        r"Invoice\s*Total|Order\s*Total|Total\s*Amount|Net\s*Amount",
        r"Total"
    )
    product_labels = (
        r"Product(?:\s*Name)?|Item(?:\s*Name)?|Description"
    )
    known_labels = (
        order_labels,
        invoice_number_labels,
        invoice_date_labels,
        merchant_labels,
        total_labels,
        product_labels,
        r"Payment\s*Status|Expected\s*Delivery\s*Date|"
        r"Qty|Quantity|Unit\s*Price|Line\s*Total|Subtotal|Shipping|Tax"
    )

    def is_known_label(value):
        value = normalize(value)
        if value.casefold() in {
            "item details",
            "delivery information",
            "delivery information (sample)",
            "billing address",
            "customer details"
        }:
            return True
        return any(
            re.fullmatch(pattern, value, re.IGNORECASE)
            for pattern in known_labels
        )

    def find_labeled_values(labels):
        exact_label = re.compile(rf"^(?:{labels})$", re.IGNORECASE)
        inline_label = re.compile(
            rf"^(?:{labels})(?:\s*[:#=\-]\s*|\s+)(.+)$",
            re.IGNORECASE
        )

        for start in range(len(lines)):
            for label_line_count in (1, 2):
                label_text = normalize(
                    " ".join(lines[start:start + label_line_count])
                )
                if not label_text:
                    continue

                if exact_label.fullmatch(label_text):
                    following = []
                    for line in lines[start + label_line_count:]:
                        if is_known_label(line):
                            break
                        following.append(line)
                        if len(following) == 2:
                            break
                    if following:
                        yield " ".join(following)
                    break

                match = inline_label.match(label_text)
                if match:
                    value = match.group(1).strip()
                    if value:
                        yield value
                    break

    def first_identifier(labels):
        for value in find_labeled_values(labels):
            match = re.search(r"[A-Z0-9][A-Z0-9._/\-]*", value, re.IGNORECASE)
            if match:
                return match.group(0)
        return None

    order_id = first_identifier(order_labels)
    invoice_number = first_identifier(invoice_number_labels)

    merchant = next(
        (
            value.strip(" \t:,-")
            for value in find_labeled_values(merchant_labels)
            if value.strip(" \t:,-")
        ),
        None
    )

    if not merchant:
        generic_heading = re.compile(
            r"\b(?:invoice|receipt|order confirmation|sample|"
            r"claimpilot|bill to|ship to|customer details)\b",
            re.IGNORECASE
        )
        for line in lines[:12]:
            candidate = line.strip(" \t:,-")
            if (
                candidate
                and len(candidate) <= 100
                and re.search(r"[A-Za-z]", candidate)
                and not generic_heading.search(candidate)
                and not is_known_label(candidate)
            ):
                merchant = candidate
                break

    amount = None
    amount_pattern = re.compile(
        r"(?<![\w.])(?:₹|INR|Rs\.?|I)?\s*"
        r"([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9])",
        re.IGNORECASE
    )
    for labels in amount_label_priority:
        for value in find_labeled_values(labels):
            match = amount_pattern.search(value)
            if match:
                try:
                    amount = float(match.group(1).replace(",", ""))
                    break
                except ValueError:
                    continue
        if amount is not None:
            break

    date_pattern = re.compile(
        r"\b(?:"
        r"[0-9]{4}[./-][0-9]{1,2}[./-][0-9]{1,2}|"
        r"[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|"
        r"[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+[0-9]{4}|"
        r"[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4}"
        r")\b",
        re.IGNORECASE
    )
    invoice_date = next(
        (
            match.group(0)
            for value in find_labeled_values(invoice_date_labels)
            if (match := date_pattern.search(value))
        ),
        None
    )

    product = None
    exact_product_label = re.compile(
        rf"^(?:{product_labels})$", re.IGNORECASE
    )
    inline_product_label = re.compile(
        rf"^(?:{product_labels})\s*[:#=\-]\s*(.+)$",
        re.IGNORECASE
    )
    table_headers = {
        "qty",
        "quantity",
        "unit price",
        "line total",
        "amount",
        "rate"
    }

    for start in range(len(lines)):
        for label_line_count in (1, 2):
            label_text = normalize(
                " ".join(lines[start:start + label_line_count])
            )
            match = inline_product_label.match(label_text)
            if match:
                product = match.group(1).strip()
                break

            if not exact_product_label.fullmatch(label_text):
                continue

            header_end = None
            has_quantity = False
            has_price = False
            for index in range(
                start + label_line_count,
                min(start + label_line_count + 5, len(lines))
            ):
                header = normalize(lines[index]).casefold()
                if header in table_headers:
                    header_end = index
                    has_quantity = has_quantity or header in {
                        "qty", "quantity"
                    }
                    has_price = has_price or header in {
                        "unit price", "line total", "amount", "rate"
                    }
                elif header_end is not None:
                    break

            value_start = (
                header_end + 1
                if has_quantity and has_price
                else start + label_line_count
            )
            for value in lines[value_start:]:
                if not is_known_label(value):
                    product = value
                    break
            break
        if product:
            break

    return {
        "merchant": merchant,
        "order_id": order_id,
        "invoice_number": invoice_number,
        "amount": amount,
        "invoice_date": invoice_date,
        "product": product
    }


def compare_invoice_with_claim(invoice, claim):
    comparisons = {}

    fields = [
        ("merchant", "Merchant"),
        ("order_id", "Order ID"),
        ("amount", "Amount")
    ]

    for field, label in fields:
        invoice_value = invoice.get(field)
        claim_value = claim.get(field)

        if invoice_value is None or claim_value is None:
            status = "not_found"
        elif field == "amount":
            try:
                status = (
                    "match"
                    if abs(float(invoice_value) - float(claim_value)) <= 0.01
                    else "mismatch"
                )
            except (TypeError, ValueError):
                status = "not_found"
        else:
            left = str(invoice_value).strip().casefold()
            right = str(claim_value).strip().casefold()
            status = "match" if left == right else "mismatch"

        comparisons[field] = {
            "label": label,
            "invoice_value": invoice_value,
            "claim_value": claim_value,
            "status": status
        }

    statuses = [
        item["status"] for item in comparisons.values()
    ]

    if "mismatch" in statuses:
        overall = "needs_review"
    elif all(status == "match" for status in statuses):
        overall = "matched"
    else:
        overall = "incomplete"

    return comparisons, overall

# ---------------------------------------------------------
# EVIDENCE INTELLIGENCE: LIST EVIDENCE
# ---------------------------------------------------------

@app.get("/api/claims/<int:claim_id>/evidence")
@login_required
def get_claim_evidence(claim_id):
    user = get_current_user()

    claim = get_user_claim(claim_id, user["id"])

    if not claim:
        return response_error("Claim not found.", 404)

    evidence = rows(
        """
        SELECT
            id,
            claim_id,
            original_name,
            mime_type,
            file_size,
            created_at
        FROM claim_evidence
        WHERE claim_id = ? AND user_id = ?
        ORDER BY id DESC
        """,
        (claim_id, user["id"])
    )
    for item in evidence:
        report_path = REPORT_FOLDER / f"evidence_{item['id']}_report.pdf"
        item["report_available"] = report_path.exists()

    return jsonify({"evidence": evidence})

# SAVE GENERATED INVOICE REPORT

@app.post("/api/evidence/<int:evidence_id>/report")
@login_required
def save_invoice_report(evidence_id):
    user = get_current_user()

    evidence = rows(
        """
        SELECT id, claim_id
        FROM claim_evidence
        WHERE id = ? AND user_id = ?
        """,
        (evidence_id, user["id"])
    )

    if not evidence:
        return response_error("Evidence not found.", 404)

    uploaded_report = request.files.get("file")

    if not uploaded_report:
        return response_error("PDF report is required.")

    if not uploaded_report.filename.lower().endswith(".pdf"):
        return response_error("Only PDF reports are allowed.")

    report_path = REPORT_FOLDER / f"evidence_{evidence_id}_report.pdf"

    try:
        uploaded_report.save(report_path)

        if report_path.stat().st_size == 0:
            report_path.unlink(missing_ok=True)
            return response_error("Generated report is empty.")

        record_activity(
            user["id"],
            "evidence",
            "analysis_report_saved",
            "success",
            "Generated invoice analysis report saved to persistent storage.",
            evidence[0]["claim_id"]
        )
        return jsonify({
            "ok": True,
            "message": "Analysis report saved successfully."
        })

    except Exception:
        app.logger.exception("Report save failed")
        return response_error("Could not save analysis report.", 500)


# DOWNLOAD SAVED INVOICE REPORT

@app.get("/api/evidence/<int:evidence_id>/report")
@login_required
def download_invoice_report(evidence_id):
    user = get_current_user()

    evidence = rows(
        """
        SELECT id, claim_id
        FROM claim_evidence
        WHERE id = ? AND user_id = ?
        """,
        (evidence_id, user["id"])
    )

    if not evidence:
        return response_error("Evidence not found.", 404)

    report_name = f"evidence_{evidence_id}_report.pdf"
    report_path = REPORT_FOLDER / report_name

    if not report_path.exists():
        return response_error("No generated report found.", 404)

    record_activity(
        user["id"],
        "evidence",
        "analysis_report_downloaded",
        "success",
        "Saved invoice analysis report downloaded.",
        evidence[0]["claim_id"]
    )

    return send_from_directory(
        REPORT_FOLDER,
        report_name,
        as_attachment=True,
        download_name=report_name
    )


# ---------------------------------------------------------
# EVIDENCE INTELLIGENCE: UPLOAD EVIDENCE
# ---------------------------------------------------------

@app.post("/api/claims/<int:claim_id>/evidence")
@login_required
def upload_claim_evidence(claim_id):
    user = get_current_user()

    claim = get_user_claim(claim_id, user["id"])

    if not claim:
        return response_error("Claim not found.", 404)

    uploaded_file = request.files.get("file")

    if not uploaded_file or not uploaded_file.filename:
        return response_error("Choose a file to upload.")

    safe_name = secure_filename(uploaded_file.filename)

    if not safe_name or "." not in safe_name:
        return response_error("Invalid file name.")

    extension = safe_name.rsplit(".", 1)[1].lower()

    if extension not in ALLOWED_EVIDENCE_EXTENSIONS:
        return response_error(
            "Only PDF, PNG, JPG, JPEG and WEBP files are allowed."
        )

    storage_name = f"{uuid4().hex}.{extension}"
    file_path = UPLOAD_FOLDER / storage_name
    evidence_id = None

    try:
        uploaded_file.save(file_path)

        file_size = file_path.stat().st_size

        if file_size <= 0 or file_size > 10 * 1024 * 1024:
            file_path.unlink(missing_ok=True)
            return response_error(
                "File must be between 1 byte and 10 MB."
            )

        evidence_id = run(
            """
            INSERT INTO claim_evidence
            (
                user_id,
                claim_id,
                original_name,
                storage_name,
                mime_type,
                file_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                claim_id,
                safe_name,
                storage_name,
                uploaded_file.mimetype or "",
                file_size
            )
        )

        record_activity(
            user["id"],
            "evidence",
            "evidence_uploaded",
            "success",
            "Evidence file saved to the selected claim.",
            claim_id
        )

        return jsonify({
            "ok": True,
            "evidence_id": evidence_id,
            "message": "Evidence uploaded successfully."
        }), 201

    except Exception:
        if evidence_id is None:
            file_path.unlink(missing_ok=True)
        app.logger.exception("Evidence upload failed")
        return response_error(
            "Could not upload evidence.",
            500
        )

    # ---------------------------------------------------------
# EVIDENCE INTELLIGENCE: ANALYSE PDF INVOICE
# ---------------------------------------------------------

@app.post("/api/evidence/<int:evidence_id>/analyze")
@login_required
def analyze_claim_evidence(evidence_id):
    user = get_current_user()

    evidence = rows(
        """
        SELECT id, claim_id, storage_name, original_name
        FROM claim_evidence
        WHERE id = ? AND user_id = ?
        """,
        (evidence_id, user["id"])
    )

    if not evidence:
        return response_error("Evidence not found.", 404)

    evidence = evidence[0]

    if not evidence["original_name"].lower().endswith(".pdf"):
        return response_error(
            "Analysis currently supports PDF invoices only."
        )

    claim = get_user_claim(
        evidence["claim_id"],
        user["id"]
    )

    if not claim:
        return response_error("Claim not found.", 404)

    file_path = UPLOAD_FOLDER / evidence["storage_name"]

    try:
        with fitz.open(file_path) as document:
            page_count = len(document)
            extracted_text = "\n".join(
                page.get_text() for page in document
            )

        record_activity(
            user["id"],
            "evidence",
            "pdf_text_extraction",
            "success" if extracted_text.strip() else "failed",
            (
                f"Extracted selectable text from {page_count} page(s); "
                f"{len(extracted_text)} characters."
                if extracted_text.strip()
                else "No selectable text; OCR is not enabled."
            ),
            evidence["claim_id"]
        )

        app.logger.debug(
            "Invoice PDF text extracted: evidence_id=%s pages=%s characters=%s",
            evidence_id,
            page_count,
            len(extracted_text)
        )

        if not extracted_text.strip():
            return response_error(
                "No selectable text found. This may be a scanned PDF; OCR is not enabled.",
                422
            )

        invoice = extract_invoice_fields(extracted_text)
        app.logger.debug(
            "Invoice fields parsed: evidence_id=%s fields_found=%s",
            evidence_id,
            sorted(
                field for field, value in invoice.items()
                if value is not None
            )
        )

        comparisons, overall = compare_invoice_with_claim(
            invoice,
            claim
        )

        updated_draft = claim.get("draft") or ""
        if claim["status"] == "Needs review":
            evidence_marker = "Evidence analysis from uploaded PDF:"
            draft_base = updated_draft.split(
                evidence_marker,
                1
            )[0].rstrip()
            evidence_lines = [
                evidence_marker,
                "Verify these extracted invoice details before sending:"
            ]
            for field, label in (
                ("merchant", "Merchant"),
                ("order_id", "Order ID"),
                ("amount", "Invoice amount"),
                ("invoice_date", "Invoice date"),
                ("product", "Product")
            ):
                value = invoice.get(field)
                if value is not None:
                    evidence_lines.append(f"{label}: {value}")

            if len(evidence_lines) == 2:
                evidence_lines.append(
                    "No invoice fields could be extracted."
                )

            updated_draft = (
                f"{draft_base}\n\n" if draft_base else ""
            ) + "\n".join(evidence_lines)
            run(
                """
                UPDATE claims
                SET draft = ?
                WHERE id = ? AND user_id = ? AND status = 'Needs review'
                """,
                (updated_draft, evidence["claim_id"], user["id"])
            )

        comparison_summary = ", ".join(
            f"{field}={result['status']}"
            for field, result in comparisons.items()
        )
        found_fields = ", ".join(
            sorted(
                field for field, value in invoice.items()
                if value is not None
            )
        ) or "none"
        record_activity(
            user["id"],
            "evidence",
            "invoice_analysis",
            "success",
            (
                f"Extracted fields: {found_fields}; "
                f"claim comparisons: {comparison_summary}; "
                f"overall: {overall}."
            ),
            evidence["claim_id"]
        )

        return jsonify({
            "ok": True,
            "file_name": evidence["original_name"],
            "extracted": invoice,
            "comparison": comparisons,
            "overall_status": overall,
            "draft": updated_draft,
            "message": "Invoice analysis completed."
        })

    except Exception:
        app.logger.exception("Invoice analysis failed")
        return response_error(
            "Could not analyse this PDF. Check that it is a valid PDF.",
            500
        )


# ---------------------------------------------------------
# EVIDENCE INTELLIGENCE: DOWNLOAD EVIDENCE
# ---------------------------------------------------------

@app.get("/api/evidence/<int:evidence_id>/download")
@login_required
def download_claim_evidence(evidence_id):
    user = get_current_user()

    evidence = rows(
        """
        SELECT storage_name, original_name, claim_id
        FROM claim_evidence
        WHERE id = ? AND user_id = ?
        """,
        (evidence_id, user["id"])
    )

    if not evidence:
        return response_error("Evidence not found.", 404)

    record_activity(
        user["id"],
        "evidence",
        "evidence_downloaded",
        "success",
        "Uploaded evidence file downloaded.",
        evidence[0]["claim_id"]
    )

    return send_from_directory(
        UPLOAD_FOLDER,
        evidence[0]["storage_name"],
        as_attachment=True,
        download_name=evidence[0]["original_name"]
    )


# ---------------------------------------------------------
# CONSUMER LOSS ANALYTICS
# ---------------------------------------------------------

@app.get("/api/analytics")
@login_required
def consumer_loss_analytics():
    user = get_current_user()
    user_id = user["id"]

    claim_totals = rows(
        """
        SELECT
            COUNT(*) AS total_claims,
            COALESCE(SUM(
                CASE
                    WHEN status NOT IN (
                        'Resolved',
                        'Closed',
                        'Approved (demo)',
                        'Rejected (demo)'
                    ) AND amount > 0
                    THEN amount
                    ELSE 0
                END
            ), 0) AS potential_loss
        FROM claims
        WHERE user_id = ?
        """,
        (user_id,)
    )[0]

    refund_totals = rows(
        """
        SELECT
            COALESCE(SUM(
                CASE
                    WHEN status IN ('Pending', 'Processing')
                    THEN amount
                    ELSE 0
                END
            ), 0) AS pending_refunds,

            COALESCE(SUM(
                CASE
                    WHEN status = 'Confirmed'
                      AND TRIM(COALESCE(reference_number, '')) <> ''
                    THEN amount
                    ELSE 0
                END
            ), 0) AS confirmed_recovered,

            COUNT(*) AS total_refund_records
        FROM refunds
        WHERE user_id = ?
        """,
        (user_id,)
    )[0]

    return jsonify({
        "total_claims": claim_totals["total_claims"],
        "potential_loss": claim_totals["potential_loss"],
        "pending_refunds": refund_totals["pending_refunds"],
        "confirmed_recovered": refund_totals["confirmed_recovered"],
        "total_refund_records": refund_totals["total_refund_records"]
    })


# ---------------------------------------------------------
# SETTINGS: GET USER SETTINGS
# ---------------------------------------------------------

@app.get("/api/settings")
@login_required
def get_settings():
    user = get_current_user()

    result = rows(
        "SELECT * FROM user_settings WHERE user_id = ?",
        (user["id"],)
    )

    if not result:
        run(
            "INSERT INTO user_settings (user_id) VALUES (?)",
            (user["id"],)
        )

        result = rows(
            "SELECT * FROM user_settings WHERE user_id = ?",
            (user["id"],)
        )

    return jsonify(result[0])


# ---------------------------------------------------------
# SETTINGS: UPDATE USER SETTINGS
# ---------------------------------------------------------

@app.put("/api/settings")
@login_required
def update_settings():
    user = get_current_user()
    data = get_json()

    fields = [
        "email_notifications",
        "claim_updates",
        "refund_updates",
        "reminder_notifications",
        "security_alerts"
    ]

    values = []

    for field in fields:
        value = data.get(field)

        if not isinstance(value, bool):
            return response_error(
                f"{field} must be true or false."
            )

        values.append(int(value))

    run(
        """
        INSERT INTO user_settings (
            user_id,
            email_notifications,
            claim_updates,
            refund_updates,
            reminder_notifications,
            security_alerts
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            email_notifications = excluded.email_notifications,
            claim_updates = excluded.claim_updates,
            refund_updates = excluded.refund_updates,
            reminder_notifications = excluded.reminder_notifications,
            security_alerts = excluded.security_alerts,
            updated_at = CURRENT_TIMESTAMP
        """,
        (user["id"], *values)
    )

    return jsonify({
        "message": "Settings saved successfully."
    })

# ---------------------------------------------------------
# SETTINGS: PRIVACY PREFERENCES
# ---------------------------------------------------------

def ensure_privacy_settings_table():
    run("""
        CREATE TABLE IF NOT EXISTS user_privacy_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            analytics_enabled INTEGER NOT NULL DEFAULT 0,
            personalized_recommendations INTEGER NOT NULL DEFAULT 1,
            mask_pii_in_drafts INTEGER NOT NULL DEFAULT 1,
            local_only_mode INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db = conn()
    try:
        cols = {
            r["name"]
            for r in db.execute("PRAGMA table_info(user_privacy_settings)").fetchall()
        }
        if "mask_pii_in_drafts" not in cols:
            db.execute(
                "ALTER TABLE user_privacy_settings ADD COLUMN mask_pii_in_drafts INTEGER NOT NULL DEFAULT 1"
            )
        if "local_only_mode" not in cols:
            db.execute(
                "ALTER TABLE user_privacy_settings ADD COLUMN local_only_mode INTEGER NOT NULL DEFAULT 1"
            )
        db.commit()
    finally:
        db.close()


@app.get("/api/privacy-settings")
@login_required
def get_privacy_settings():
    user = get_current_user()
    ensure_privacy_settings_table()

    result = rows(
        """
        SELECT analytics_enabled, personalized_recommendations,
               mask_pii_in_drafts, local_only_mode
        FROM user_privacy_settings
        WHERE user_id = ?
        """,
        (user["id"],)
    )

    if not result:
        run(
            """
            INSERT INTO user_privacy_settings (user_id)
            VALUES (?)
            """,
            (user["id"],)
        )

        result = rows(
            """
            SELECT analytics_enabled, personalized_recommendations,
                   mask_pii_in_drafts, local_only_mode
            FROM user_privacy_settings
            WHERE user_id = ?
            """,
            (user["id"],)
        )

    return jsonify({
        "analytics_enabled": bool(result[0]["analytics_enabled"]),
        "personalized_recommendations": bool(
            result[0]["personalized_recommendations"]
        ),
        "mask_pii_in_drafts": bool(result[0].get("mask_pii_in_drafts", 1)),
        "local_only_mode": bool(result[0].get("local_only_mode", 1))
    })


@app.put("/api/privacy-settings")
@login_required
def update_privacy_settings():
    user = get_current_user()
    data = get_json()

    ensure_privacy_settings_table()

    analytics = data.get("analytics_enabled")
    recommendations = data.get("personalized_recommendations")
    mask_pii = data.get("mask_pii_in_drafts", True)
    local_only = data.get("local_only_mode", True)

    if not isinstance(analytics, bool):
        return response_error("analytics_enabled must be true or false.")

    if not isinstance(recommendations, bool):
        return response_error(
            "personalized_recommendations must be true or false."
        )

    if not isinstance(mask_pii, bool):
        return response_error("mask_pii_in_drafts must be true or false.")

    if not isinstance(local_only, bool):
        return response_error("local_only_mode must be true or false.")

    run(
        """
        INSERT INTO user_privacy_settings (
            user_id,
            analytics_enabled,
            personalized_recommendations,
            mask_pii_in_drafts,
            local_only_mode
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            analytics_enabled = excluded.analytics_enabled,
            personalized_recommendations =
                excluded.personalized_recommendations,
            mask_pii_in_drafts = excluded.mask_pii_in_drafts,
            local_only_mode = excluded.local_only_mode,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            user["id"],
            int(analytics),
            int(recommendations),
            int(mask_pii),
            int(local_only)
        )
    )

    return jsonify({
        "message": "Privacy preferences saved successfully."
    })


# ---------------------------------------------------------
# ACCOUNT: EXPORT USER DATA
# ---------------------------------------------------------

@app.get("/api/account/export")
@login_required
def export_account_data():
    user = get_current_user()

    ensure_privacy_settings_table()

    db = conn()

    try:
        user_data = dict(
            db.execute(
                """
                SELECT id, full_name, email, phone, location,
                       image_url, created_at, updated_at
                FROM users
                WHERE id = ?
                """,
                (user["id"],)
            ).fetchone()
        )

        export_tables = [
            "claims",
            "activity",
            "reminders",
            "warranties",
            "refunds",
            "claim_evidence",
            "user_settings",
            "user_privacy_settings",
            "support_tickets"
        ]

        exported_records = {}

        for table in export_tables:
            table_exists = db.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = ?
                """,
                (table,)
            ).fetchone()

            if not table_exists:
                continue

            columns = {
                row["name"]
                for row in db.execute(
                    f"PRAGMA table_info({table})"
                ).fetchall()
            }

            if "user_id" not in columns:
                continue

            records = db.execute(
                f"SELECT * FROM {table} WHERE user_id = ?",
                (user["id"],)
            ).fetchall()

            exported_records[table] = [
                dict(record) for record in records
            ]

        payload = {
            "application": "ClaimPilot",
            "exported_at": __import__("datetime").datetime.now().isoformat(),
            "profile": user_data,
            "records": exported_records
        }

        response = jsonify(payload)
        response.headers["Content-Disposition"] = (
            'attachment; filename="claimpilot-my-data.json"'
        )

        return response

    except Exception:
        app.logger.exception("Account data export failed.")
        return response_error("Could not export account data.", 500)

    finally:
        db.close()


# ---------------------------------------------------------
# ACCOUNT: DELETE USER ACCOUNT
# ---------------------------------------------------------

@app.delete("/api/account")
@login_required
def delete_account():
    user = get_current_user()
    data = get_json()

    if data.get("confirmation") != "DELETE":
        return response_error(
            "Type DELETE to confirm account deletion."
        )

    db = conn()

    try:
        user_id = user["id"]

        # Delete dependent records before deleting the user.
        tables_to_delete = [
            "claim_evidence",
            "refunds",
            "activity",
            "reminders",
            "warranties",
            "claims",
            "user_settings",
            "user_privacy_settings",
            "support_tickets"
        ]

        existing_tables = {
            row["name"]
            for row in db.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table'
                """
            ).fetchall()
        }

        for table in tables_to_delete:
            if table not in existing_tables:
                continue

            columns = {
                row["name"]
                for row in db.execute(
                    f"PRAGMA table_info({table})"
                ).fetchall()
            }

            if "user_id" in columns:
                db.execute(
                    f"DELETE FROM {table} WHERE user_id = ?",
                    (user_id,)
                )

        db.execute(
            "DELETE FROM users WHERE id = ?",
            (user_id,)
        )

        db.commit()

        session.clear()

        response = jsonify({
            "message": "Your ClaimPilot account has been deleted."
        })

        response.delete_cookie(
            app.config.get("SESSION_COOKIE_NAME", "session")
        )

        return response

    except Exception:
        db.rollback()
        app.logger.exception("Account deletion failed.")
        return response_error("Could not delete your account.", 500)

    finally:
        db.close()


# ---------------------------------------------------------
# SECURITY: CHANGE PASSWORD
# ---------------------------------------------------------

@app.post("/api/auth/change-password")
@login_required
def change_password():
    user = get_current_user()
    data = get_json()

    current_password = str(
        data.get("current_password", "")
    )

    new_password = str(
        data.get("new_password", "")
    )

    account = rows(
        "SELECT password_hash FROM users WHERE id = ?",
        (user["id"],)
    )

    if not account:
        return response_error("Account not found.", 404)

    if (
        not account[0]["password_hash"]
        or not check_password_hash(
            account[0]["password_hash"],
            current_password
        )
    ):
        return response_error(
            "Current password is incorrect.",
            401
        )

    if len(new_password) < 8:
        return response_error(
            "New password must contain at least 8 characters."
        )

    if current_password == new_password:
        return response_error(
            "New password must be different from the current password."
        )

    new_hash = generate_password_hash(new_password)

    run(
        """
        UPDATE users
        SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (new_hash, user["id"])
    )

    return jsonify({
        "message": "Password changed successfully."
    })


# ---------------------------------------------------------
# HELP & SUPPORT: CREATE SUPPORT TICKET
# ---------------------------------------------------------

@app.post("/api/support/tickets")
@login_required
def create_support_ticket():
    user = get_current_user()
    data = get_json()

    category = str(data.get("category", "")).strip()
    subject = str(data.get("subject", "")).strip()
    description = str(data.get("description", "")).strip()

    allowed_categories = {
    "Account",
    "Claims",
    "Refunds",
    "Transactions",
    "Warranty",
    "Technical issue",
    "Bug report",
    "Other"
}

    if category not in allowed_categories:
        return response_error("Select a valid category.")

    if not subject or not description:
        return response_error(
            "Subject and description are required."
        )

    if len(subject) > 150 or len(description) > 3000:
        return response_error("Your support request is too long.")

    ticket_id = run(
        """
        INSERT INTO support_tickets
        (user_id, category, subject, description)
        VALUES (?, ?, ?, ?)
        """,
        (user["id"], category, subject, description)
    )

    return jsonify({
        "message": "Your support request has been recorded.",
        "ticket_id": ticket_id,
        "status": "Open"
    }), 201


# ---------------------------------------------------------
# HELP & SUPPORT: LIST USER TICKETS
# ---------------------------------------------------------

@app.get("/api/support/tickets")
@login_required
def get_support_tickets():
    user = get_current_user()

    tickets = rows(
        """
        SELECT id, category, subject, description, status, created_at
        FROM support_tickets
        WHERE user_id = ?
        ORDER BY id DESC
        """,
        (user["id"],)
    )

    return jsonify(tickets)


# ---------------------------------------------------------
# SUBSCRIPTION TRAP DETECTOR
# ---------------------------------------------------------

@app.post("/api/subscriptions/scan")
@login_required
def scan_subscriptions():
    user = get_current_user()
    stored_tx = rows(
        """
        SELECT external_id AS id, merchant, amount, transaction_date AS date
        FROM transactions
        WHERE user_id = ?
        ORDER BY transaction_date DESC, id DESC
        """,
        (user["id"],)
    )

    try:
        result = parse_mcp_result(
            invoke(
                "ledger",
                "detect_subscription_traps",
                {"extra_transactions_json": json.dumps(stored_tx)},
                user["id"]
            )
        )
        return jsonify(result)
    except Exception:
        app.logger.exception("Subscription trap scan failed")
        return response_error("Could not scan subscriptions.", 500)


# ---------------------------------------------------------
# MCP VISUALIZER: LIVE TOOL DISCOVERY
# ---------------------------------------------------------

@app.post("/api/mcp/discover")
@login_required
def discover_mcp_servers():
    user = get_current_user()
    servers_out = []

    for server_key in MCP_SERVERS:
        server_name = f"{server_key}_mcp"
        try:
            tools = discover_tools(server_key)
            record_activity(
                user["id"],
                server_name,
                "list_tools",
                "success",
                f"Discovered {len(tools)} tool(s): " + ", ".join(t["name"] for t in tools)
            )
            servers_out.append({
                "server": server_name,
                "status": "connected",
                "tools": tools,
                "error": None
            })
        except Exception as err:
            record_activity(
                user["id"],
                server_name,
                "list_tools",
                "failed",
                f"Tool discovery failed: {err}"
            )
            servers_out.append({
                "server": server_name,
                "status": "error",
                "tools": [],
                "error": str(err)
            })

    return jsonify({"servers": servers_out})


# ---------------------------------------------------------
# CHASE MODES: FOLLOW-UP INVESTIGATION & DRAFTING
# ---------------------------------------------------------

@app.post("/api/claims/<int:claim_id>/chase")
@login_required
def run_chase_mode(claim_id):
    user = get_current_user()
    claim_row = get_user_claim(claim_id, user["id"])
    if not claim_row:
        return response_error("Claim not found.", 404)

    data = get_json()
    mode = str(data.get("mode", "gentle")).strip().lower()
    if mode not in {"gentle", "firm", "escalation"}:
        return response_error("Chase mode must be gentle, firm, or escalation.")

    create_followup = bool(data.get("create_reminder", True))
    mode_labels = {
        "gentle": ("Gentle Nudge", 7),
        "firm": ("Firm Escalation", 4),
        "escalation": ("Deadline Enforcement", 2),
    }
    mode_title, followup_days = mode_labels[mode]

    try:
        inbox_res = parse_mcp_result(
            invoke(
                "inbox",
                "search_emails",
                {"query": claim_row["order_id"]},
                user["id"],
                claim_id
            )
        )
        policy_res = parse_mcp_result(
            invoke(
                "policy",
                "fetch_refund_policy",
                {
                    "merchant_name": claim_row["merchant"],
                    "issue_type": "delayed_delivery"
                },
                user["id"],
                claim_id
            )
        )

        amount_val = float(claim_row["amount"] or 0)
        if mode == "gentle":
            draft_text = (
                f"Subject: Friendly follow-up on order {claim_row['order_id']}\n\n"
                f"Hello {claim_row['merchant']} Support Team,\n\n"
                f"I am checking in on order {claim_row['order_id']} (₹{amount_val:,.0f}), "
                f"which is currently marked '{claim_row['issue']}'. "
                f"Could you please share an updated delivery timeline?\n\n"
                f"Policy note (illustrative): {policy_res.get('guidance', '')}\n\n"
                f"Thank you."
            )
        elif mode == "firm":
            draft_text = (
                f"Subject: Urgent status & resolution request — Order {claim_row['order_id']}\n\n"
                f"Hello {claim_row['merchant']} Support Team,\n\n"
                f"Order {claim_row['order_id']} (₹{amount_val:,.0f}) remains unresolved ({claim_row['issue']}). "
                f"Please provide a confirmed delivery date or initiate a refund review within 48 hours.\n\n"
                f"Reference policy guidance (illustrative): {policy_res.get('guidance', '')}\n\n"
                f"Regards."
            )
        else:
            draft_text = (
                f"Subject: Formal Escalation Notice — Order {claim_row['order_id']} (₹{amount_val:,.0f})\n\n"
                f"To {claim_row['merchant']} Escalations Team,\n\n"
                f"This is a formal escalation for delayed order {claim_row['order_id']} worth ₹{amount_val:,.0f}. "
                f"If a verified resolution or refund confirmation is not provided within 48 hours, "
                f"I will proceed with a payment dispute using the attached invoice and order evidence.\n\n"
                f"Regards."
            )

        now_iso = date.today().isoformat()
        if claim_row["status"] == "Needs review":
            run(
                "UPDATE claims SET chase_mode = ?, chase_last_run = ?, draft = ? WHERE id = ? AND user_id = ?",
                (mode_title, now_iso, draft_text, claim_id, user["id"])
            )
        else:
            run(
                "UPDATE claims SET chase_mode = ?, chase_last_run = ? WHERE id = ? AND user_id = ?",
                (mode_title, now_iso, claim_id, user["id"])
            )

        reminder_result = None
        if create_followup:
            due = (date.today() + timedelta(days=followup_days)).isoformat()
            reminder_result = parse_mcp_result(
                invoke(
                    "calendar",
                    "create_reminder",
                    {
                        "title": f"[{mode_title}] Follow up {claim_row['merchant']} {claim_row['order_id']}",
                        "due_date": due,
                        "notes": f"Chase Mode ({mode_title}) demo follow-up — no external email sent."
                    },
                    user["id"],
                    claim_id
                )
            )
            if reminder_result.get("created"):
                run(
                    "INSERT INTO reminders (user_id, title, due_date, notes, status, claim_id) VALUES (?, ?, ?, ?, 'Pending', ?)",
                    (
                        user["id"],
                        reminder_result["title"],
                        reminder_result["due_date"],
                        reminder_result["notes"],
                        claim_id
                    )
                )

        record_activity(
            user["id"],
            "claimpilot",
            "chase_mode_executed",
            "success",
            f"Chase Mode '{mode_title}' prepared local follow-up draft (demo only).",
            claim_id
        )

        return jsonify({
            "ok": True,
            "claim_id": claim_id,
            "chase_mode": mode_title,
            "chase_last_run": now_iso,
            "draft": draft_text,
            "inbox_matches": inbox_res.get("matches", []),
            "policy": policy_res,
            "reminder": reminder_result,
            "message": f"Chase Mode '{mode_title}' prepared a local follow-up draft (demo only — no email sent)."
        })
    except Exception:
        app.logger.exception("Chase mode failed")
        return response_error("Could not run Chase Mode.", 500)


# ---------------------------------------------------------
# REMINDERS: UPDATE & DELETE
# ---------------------------------------------------------

@app.patch("/api/reminders/<int:reminder_id>")
@login_required
def update_reminder(reminder_id):
    user = get_current_user()
    existing = rows(
        "SELECT * FROM reminders WHERE id = ? AND user_id = ?",
        (reminder_id, user["id"])
    )
    if not existing:
        return response_error("Reminder not found.", 404)

    data = get_json()
    status = str(data.get("status", existing[0].get("status") or "Pending")).strip()
    if status not in {"Pending", "Completed"}:
        return response_error("Status must be Pending or Completed.")

    title = str(data.get("title", existing[0]["title"])).strip()
    due_date = str(data.get("due_date", existing[0]["due_date"])).strip()
    notes = str(data.get("notes", existing[0].get("notes") or "")).strip()

    if not title or not due_date:
        return response_error("Title and due date are required.")

    run(
        "UPDATE reminders SET title = ?, due_date = ?, notes = ?, status = ? WHERE id = ? AND user_id = ?",
        (title, due_date, notes, status, reminder_id, user["id"])
    )
    return jsonify({"ok": True, "id": reminder_id, "status": status, "message": f"Reminder marked {status}."})


@app.delete("/api/reminders/<int:reminder_id>")
@login_required
def delete_reminder(reminder_id):
    user = get_current_user()
    existing = rows(
        "SELECT id FROM reminders WHERE id = ? AND user_id = ?",
        (reminder_id, user["id"])
    )
    if not existing:
        return response_error("Reminder not found.", 404)

    run("DELETE FROM reminders WHERE id = ? AND user_id = ?", (reminder_id, user["id"]))
    return jsonify({"ok": True, "message": "Reminder deleted."})


# ---------------------------------------------------------
# WARRANTIES: UPDATE & DELETE
# ---------------------------------------------------------

@app.patch("/api/warranties/<int:warranty_id>")
@login_required
def update_warranty(warranty_id):
    user = get_current_user()
    existing = rows(
        "SELECT * FROM warranties WHERE id = ? AND user_id = ?",
        (warranty_id, user["id"])
    )
    if not existing:
        return response_error("Warranty not found.", 404)

    data = get_json()
    status = str(data.get("status", existing[0].get("status") or "Active")).strip()
    if status not in {"Active", "Claimed", "Expired"}:
        return response_error("Status must be Active, Claimed, or Expired.")

    run(
        "UPDATE warranties SET status = ? WHERE id = ? AND user_id = ?",
        (status, warranty_id, user["id"])
    )
    return jsonify({"ok": True, "id": warranty_id, "status": status, "message": f"Warranty marked {status}."})


@app.delete("/api/warranties/<int:warranty_id>")
@login_required
def delete_warranty(warranty_id):
    user = get_current_user()
    existing = rows(
        "SELECT id FROM warranties WHERE id = ? AND user_id = ?",
        (warranty_id, user["id"])
    )
    if not existing:
        return response_error("Warranty not found.", 404)

    run("DELETE FROM warranties WHERE id = ? AND user_id = ?", (warranty_id, user["id"]))
    return jsonify({"ok": True, "message": "Warranty deleted."})


# ---------------------------------------------------------
# APPLICATION ENTRY POINT
# ---------------------------------------------------------

if __name__ == "__main__":
    app.run(
        host="localhost",
        port=5000,
        debug=True
    )
