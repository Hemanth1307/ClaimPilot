
import sqlite3
from contextlib import closing
from pathlib import Path

DB = Path(__file__).resolve().parent / "claimpilot.db"


def conn():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    with closing(conn()) as db:
        db.execute("PRAGMA foreign_keys = OFF")

        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            phone TEXT DEFAULT '',
            location TEXT DEFAULT '',
            image_url TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant TEXT,
            order_id TEXT,
            amount REAL,
            issue TEXT,
            draft TEXT,
            status TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server TEXT,
            tool TEXT,
            status TEXT,
            summary TEXT,
            claim_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            due_date TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS warranties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product TEXT,
            serial_number TEXT,
            expiry_date TEXT,
            file_name TEXT
        );

        CREATE TABLE IF NOT EXISTS refunds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            claim_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            reference_number TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (claim_id) REFERENCES claims(id)
        );

        CREATE TABLE IF NOT EXISTS claim_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            claim_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            storage_name TEXT NOT NULL,
            mime_type TEXT DEFAULT '',
            file_size INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (claim_id) REFERENCES claims(id)
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            email_notifications INTEGER NOT NULL DEFAULT 1,
            claim_updates INTEGER NOT NULL DEFAULT 1,
            refund_updates INTEGER NOT NULL DEFAULT 1,
            reminder_notifications INTEGER NOT NULL DEFAULT 1,
            security_alerts INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            subject TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Open',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """)

        user_columns = {
            row["name"]
            for row in db.execute(
                "PRAGMA table_info(users)"
            ).fetchall()
        }
        user_schema = db.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table' AND name = 'users'
            """
        ).fetchone()["sql"]
        normalized_user_schema = "".join(
            (user_schema or "").lower().split()
        )

        if "check(id=1)" in normalized_user_schema:
            db.execute("""
            CREATE TABLE users_migrating (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT,
                phone TEXT DEFAULT '',
                location TEXT DEFAULT '',
                image_url TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """)

            def source_column(name, fallback):
                return f'"{name}"' if name in user_columns else fallback

            def coalesce_text_column(name):
                return "COALESCE(" + source_column(name, "''") + ", '')"

            full_name = coalesce_text_column("full_name")
            email = coalesce_text_column("email")
            password_hash = source_column("password_hash", "NULL")
            phone = coalesce_text_column("phone")
            location = coalesce_text_column("location")
            image_url = coalesce_text_column("image_url")
            updated_at = source_column("updated_at", "CURRENT_TIMESTAMP")
            created_at = source_column("created_at", "NULL")
            created_at = (
                f"COALESCE({created_at}, {updated_at}, CURRENT_TIMESTAMP)"
            )

            db.execute(
                f"""
                INSERT INTO users_migrating (
                    id, full_name, email, password_hash, phone, location,
                    image_url, created_at, updated_at
                )
                SELECT
                    {source_column('id', 'NULL')},
                    {full_name},
                    {email},
                    {password_hash},
                    {phone},
                    {location},
                    {image_url},
                    {created_at},
                    COALESCE({updated_at}, CURRENT_TIMESTAMP)
                FROM users
                """
            )
            db.execute("DROP TABLE users")
            db.execute(
                "ALTER TABLE users_migrating RENAME TO users"
            )
        else:
            user_columns = {
                row["name"]
                for row in db.execute(
                    "PRAGMA table_info(users)"
                ).fetchall()
            }
            if "password_hash" not in user_columns:
                db.execute(
                    "ALTER TABLE users ADD COLUMN password_hash TEXT"
                )
            if "created_at" not in user_columns:
                db.execute(
                    "ALTER TABLE users ADD COLUMN created_at TEXT"
                )
            if "updated_at" not in user_columns:
                db.execute(
                    "ALTER TABLE users ADD COLUMN updated_at TEXT"
                )
            db.execute(
                """
                UPDATE users
                SET created_at = COALESCE(
                        created_at, updated_at, CURRENT_TIMESTAMP
                    ),
                    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
                """
            )

        # Add user_id to existing tables when missing.
        # This supports databases created using older versions.
        for table in ("claims", "activity", "reminders", "warranties"):
            columns = {
                row["name"]
                for row in db.execute(
                    f"PRAGMA table_info({table})"
                ).fetchall()
            }

            if "user_id" not in columns:
                db.execute(
                    f"ALTER TABLE {table} ADD COLUMN user_id INTEGER"
                )

        activity_columns = {
            row["name"]
            for row in db.execute(
                "PRAGMA table_info(activity)"
            ).fetchall()
        }
        if "claim_id" not in activity_columns:
            db.execute(
                "ALTER TABLE activity ADD COLUMN claim_id INTEGER"
            )

        # Additive columns for Chase Modes, Reminders completion, and Warranty status
        claims_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(claims)").fetchall()
        }
        if "chase_mode" not in claims_columns:
            db.execute(
                "ALTER TABLE claims ADD COLUMN chase_mode TEXT DEFAULT 'Standard'"
            )
        if "chase_last_run" not in claims_columns:
            db.execute(
                "ALTER TABLE claims ADD COLUMN chase_last_run TEXT"
            )

        reminder_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(reminders)").fetchall()
        }
        if "status" not in reminder_columns:
            db.execute(
                "ALTER TABLE reminders ADD COLUMN status TEXT DEFAULT 'Pending'"
            )
        if "claim_id" not in reminder_columns:
            db.execute(
                "ALTER TABLE reminders ADD COLUMN claim_id INTEGER"
            )

        warranty_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(warranties)").fetchall()
        }
        if "status" not in warranty_columns:
            db.execute(
                "ALTER TABLE warranties ADD COLUMN status TEXT DEFAULT 'Active'"
            )
        if "notes" not in warranty_columns:
            db.execute(
                "ALTER TABLE warranties ADD COLUMN notes TEXT DEFAULT ''"
            )

        # Create indexes for faster user-specific queries.
        db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_claims_user
        ON claims(user_id);

        CREATE INDEX IF NOT EXISTS idx_activity_user
        ON activity(user_id);

        CREATE INDEX IF NOT EXISTS idx_activity_claim
        ON activity(user_id, claim_id, id);

        CREATE INDEX IF NOT EXISTS idx_reminders_user
        ON reminders(user_id);

        CREATE INDEX IF NOT EXISTS idx_warranties_user
        ON warranties(user_id);

        CREATE INDEX IF NOT EXISTS idx_refunds_user
        ON refunds(user_id);

        CREATE INDEX IF NOT EXISTS idx_refunds_claim
        ON refunds(claim_id);

        CREATE INDEX IF NOT EXISTS idx_evidence_user
        ON claim_evidence(user_id);

        CREATE INDEX IF NOT EXISTS idx_evidence_claim
        ON claim_evidence(claim_id);

        CREATE INDEX IF NOT EXISTS idx_settings_user
        ON user_settings(user_id);

        CREATE INDEX IF NOT EXISTS idx_support_user
        ON support_tickets(user_id);
        """)

        db.commit()
        db.execute("PRAGMA foreign_keys = ON")
        if db.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise RuntimeError("Could not enable SQLite foreign keys.")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise sqlite3.IntegrityError(
                "Database migration caused a foreign key violation."
            )


def rows(query, params=()):
    with closing(conn()) as db:
        result = db.execute(query, params).fetchall()
        return [dict(row) for row in result]


def run(query, params=()):
    with closing(conn()) as db:
        cursor = db.execute(query, params)
        db.commit()
        return cursor.lastrowid
