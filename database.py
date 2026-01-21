"""
Database layer for Admin Dashboard
SQLite database for users, chat history, settings, and analytics
"""

import sqlite3
import hashlib
import secrets
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

DATABASE_PATH = Path("output/database.db")

def get_connection():
    """Get database connection with row factory"""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_database():
    """Initialize database with all tables"""
    conn = get_connection()
    cursor = conn.cursor()

    # Admin users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Registered users (customers)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Chat history
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            role TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # Global settings
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Analytics events
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            user_id INTEGER,
            data TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Image status (for soft delete)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS image_status (
            path TEXT PRIMARY KEY,
            is_deleted INTEGER DEFAULT 0,
            deleted_at TIMESTAMP
        )
    """)

    # Products table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Update chat_history to include product_id
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_history_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            product_id INTEGER,
            role TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    """)

    # Create default admin if not exists
    cursor.execute("SELECT COUNT(*) FROM admins")
    if cursor.fetchone()[0] == 0:
        password_hash = hash_password("admin123")
        cursor.execute(
            "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
            ("admin", password_hash)
        )

    # Create default settings if not exists
    default_settings = {
        "tts_voice": "alloy",
        "tts_enabled": "true",
        "presentation_speed": "1",
        "section_delay": "0.5"
    }
    for key, value in default_settings.items():
        cursor.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )

    # Create default "Mezzo Windows" product (ID 1) using existing output folder
    cursor.execute("SELECT COUNT(*) FROM products WHERE id = 1")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            """INSERT INTO products (id, name, slug, description, status)
               VALUES (1, 'Mezzo Windows', 'mezzo-windows', 'Premium window solutions by Mezzo', 'active')"""
        )

    conn.commit()
    conn.close()

# ============================================================================
# Password Hashing
# ============================================================================
def hash_password(password: str) -> str:
    """Hash password with salt"""
    salt = secrets.token_hex(16)
    hash_obj = hashlib.sha256((password + salt).encode())
    return f"{salt}:{hash_obj.hexdigest()}"

def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored hash"""
    try:
        salt, hash_value = stored_hash.split(":")
        hash_obj = hashlib.sha256((password + salt).encode())
        return hash_obj.hexdigest() == hash_value
    except:
        return False

# ============================================================================
# Admin Functions
# ============================================================================
def verify_admin(username: str, password: str) -> Optional[Dict]:
    """Verify admin credentials"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM admins WHERE username = ?", (username,))
    admin = cursor.fetchone()
    conn.close()

    if admin and verify_password(password, admin["password_hash"]):
        return {"id": admin["id"], "username": admin["username"]}
    return None

def create_admin_token(admin_id: int) -> str:
    """Create a simple token for admin session"""
    token = secrets.token_urlsafe(32)
    # In production, store this in a sessions table with expiry
    return f"{admin_id}:{token}"

def verify_admin_token(token: str) -> Optional[int]:
    """Verify admin token and return admin_id"""
    try:
        admin_id, _ = token.split(":")
        return int(admin_id)
    except:
        return None

# ============================================================================
# User Functions
# ============================================================================
def create_user(name: str, email: str, phone: str) -> Optional[int]:
    """Create a new user, return user ID"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (name, email, phone) VALUES (?, ?, ?)",
            (name, email.lower(), phone)
        )
        conn.commit()
        user_id = cursor.lastrowid

        # Log analytics event
        log_analytics("user_registered", user_id)

        return user_id
    except sqlite3.IntegrityError:
        # Email already exists, get existing user
        cursor.execute("SELECT id FROM users WHERE email = ?", (email.lower(),))
        row = cursor.fetchone()
        return row["id"] if row else None
    finally:
        conn.close()

def get_user_by_email(email: str) -> Optional[Dict]:
    """Get user by email"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email.lower(),))
    user = cursor.fetchone()
    conn.close()
    return dict(user) if user else None

def get_user_by_id(user_id: int) -> Optional[Dict]:
    """Get user by ID"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()
    return dict(user) if user else None

def get_all_users() -> List[Dict]:
    """Get all users"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users ORDER BY registered_at DESC")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users

def update_user_activity(user_id: int):
    """Update user's last active timestamp"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?",
        (user_id,)
    )
    conn.commit()
    conn.close()

def delete_user(user_id: int) -> bool:
    """Delete user and their chat history"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0

# ============================================================================
# Chat History Functions
# ============================================================================
def save_chat_message(user_id: int, role: str, message: str):
    """Save a chat message"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_history (user_id, role, message) VALUES (?, ?, ?)",
        (user_id, role, message)
    )
    conn.commit()
    conn.close()

    # Log analytics
    log_analytics("chat_message", user_id, {"role": role})

def get_user_chat_history(user_id: int, limit: int = 100) -> List[Dict]:
    """Get chat history for a user"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT * FROM chat_history
           WHERE user_id = ?
           ORDER BY timestamp DESC
           LIMIT ?""",
        (user_id, limit)
    )
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return list(reversed(messages))

def get_all_chat_history(limit: int = 500) -> List[Dict]:
    """Get all chat history with user info"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT ch.*, u.name as user_name, u.email as user_email
           FROM chat_history ch
           LEFT JOIN users u ON ch.user_id = u.id
           ORDER BY ch.timestamp DESC
           LIMIT ?""",
        (limit,)
    )
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return messages

# ============================================================================
# Settings Functions
# ============================================================================
def get_setting(key: str) -> Optional[str]:
    """Get a setting value"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else None

def get_all_settings() -> Dict[str, str]:
    """Get all settings"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    settings = {row["key"]: row["value"] for row in cursor.fetchall()}
    conn.close()
    return settings

def update_setting(key: str, value: str):
    """Update a setting"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO settings (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP""",
        (key, value)
    )
    conn.commit()
    conn.close()

def update_settings(settings: Dict[str, str]):
    """Update multiple settings"""
    conn = get_connection()
    cursor = conn.cursor()
    for key, value in settings.items():
        cursor.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP""",
            (key, str(value))
        )
    conn.commit()
    conn.close()

# ============================================================================
# Image Status Functions
# ============================================================================
def is_image_deleted(path: str) -> bool:
    """Check if an image is soft deleted"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT is_deleted FROM image_status WHERE path = ?", (path,))
    row = cursor.fetchone()
    conn.close()
    return row["is_deleted"] == 1 if row else False

def delete_image(path: str):
    """Soft delete an image"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO image_status (path, is_deleted, deleted_at)
           VALUES (?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(path) DO UPDATE SET
           is_deleted = 1,
           deleted_at = CURRENT_TIMESTAMP""",
        (path,)
    )
    conn.commit()
    conn.close()

def restore_image(path: str):
    """Restore a soft deleted image"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE image_status SET is_deleted = 0, deleted_at = NULL WHERE path = ?",
        (path,)
    )
    conn.commit()
    conn.close()

def get_all_image_statuses() -> Dict[str, bool]:
    """Get deletion status for all images"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT path, is_deleted FROM image_status")
    statuses = {row["path"]: row["is_deleted"] == 1 for row in cursor.fetchall()}
    conn.close()
    return statuses

# ============================================================================
# Analytics Functions
# ============================================================================
def log_analytics(event_type: str, user_id: int = None, data: Dict = None):
    """Log an analytics event"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO analytics (event_type, user_id, data) VALUES (?, ?, ?)",
        (event_type, user_id, json.dumps(data) if data else None)
    )
    conn.commit()
    conn.close()

def get_analytics_summary() -> Dict:
    """Get analytics summary for dashboard"""
    conn = get_connection()
    cursor = conn.cursor()

    # Total users
    cursor.execute("SELECT COUNT(*) as count FROM users")
    total_users = cursor.fetchone()["count"]

    # Total chat messages
    cursor.execute("SELECT COUNT(*) as count FROM chat_history")
    total_chats = cursor.fetchone()["count"]

    # Users today
    cursor.execute(
        """SELECT COUNT(*) as count FROM users
           WHERE DATE(registered_at) = DATE('now')"""
    )
    users_today = cursor.fetchone()["count"]

    # Chats today
    cursor.execute(
        """SELECT COUNT(*) as count FROM chat_history
           WHERE DATE(timestamp) = DATE('now')"""
    )
    chats_today = cursor.fetchone()["count"]

    # Presentation starts
    cursor.execute(
        """SELECT COUNT(*) as count FROM analytics
           WHERE event_type = 'presentation_start'"""
    )
    presentation_starts = cursor.fetchone()["count"]

    # Recent activity (last 7 days)
    cursor.execute(
        """SELECT DATE(timestamp) as date, COUNT(*) as count
           FROM analytics
           WHERE timestamp >= DATE('now', '-7 days')
           GROUP BY DATE(timestamp)
           ORDER BY date"""
    )
    daily_activity = [dict(row) for row in cursor.fetchall()]

    # User growth (last 7 days)
    cursor.execute(
        """SELECT DATE(registered_at) as date, COUNT(*) as count
           FROM users
           WHERE registered_at >= DATE('now', '-7 days')
           GROUP BY DATE(registered_at)
           ORDER BY date"""
    )
    user_growth = [dict(row) for row in cursor.fetchall()]

    conn.close()

    return {
        "total_users": total_users,
        "total_chats": total_chats,
        "users_today": users_today,
        "chats_today": chats_today,
        "presentation_starts": presentation_starts,
        "daily_activity": daily_activity,
        "user_growth": user_growth
    }

def get_recent_activity(limit: int = 20) -> List[Dict]:
    """Get recent analytics events"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT a.*, u.name as user_name
           FROM analytics a
           LEFT JOIN users u ON a.user_id = u.id
           ORDER BY a.timestamp DESC
           LIMIT ?""",
        (limit,)
    )
    events = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return events

# ============================================================================
# Product Functions
# ============================================================================
def create_product(name: str, slug: str, description: str = "") -> Optional[int]:
    """Create a new product"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO products (name, slug, description)
               VALUES (?, ?, ?)""",
            (name, slug, description)
        )
        conn.commit()
        product_id = cursor.lastrowid
        return product_id
    except sqlite3.IntegrityError:
        # Slug already exists
        return None
    finally:
        conn.close()

def get_product_by_id(product_id: int) -> Optional[Dict]:
    """Get product by ID"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
    product = cursor.fetchone()
    conn.close()
    return dict(product) if product else None

def get_product_by_slug(slug: str) -> Optional[Dict]:
    """Get product by slug"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products WHERE slug = ?", (slug,))
    product = cursor.fetchone()
    conn.close()
    return dict(product) if product else None

def get_all_products(include_inactive: bool = False) -> List[Dict]:
    """Get all products"""
    conn = get_connection()
    cursor = conn.cursor()
    if include_inactive:
        cursor.execute("SELECT * FROM products ORDER BY name")
    else:
        cursor.execute("SELECT * FROM products WHERE status = 'active' ORDER BY name")
    products = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return products

def update_product(product_id: int, name: str = None, description: str = None, status: str = None) -> bool:
    """Update product details"""
    conn = get_connection()
    cursor = conn.cursor()

    updates = []
    values = []

    if name is not None:
        updates.append("name = ?")
        values.append(name)
    if description is not None:
        updates.append("description = ?")
        values.append(description)
    if status is not None:
        updates.append("status = ?")
        values.append(status)

    if not updates:
        return False

    updates.append("updated_at = CURRENT_TIMESTAMP")
    values.append(product_id)

    cursor.execute(
        f"UPDATE products SET {', '.join(updates)} WHERE id = ?",
        values
    )
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected > 0

def delete_product(product_id: int) -> bool:
    """Delete a product"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0

def get_product_folder(product_id: int) -> Path:
    """Get the folder path for a product's files

    Product ID 1 (Mezzo Windows) uses the legacy output/ folder directly.
    Other products use output/products/{id}/
    """
    if product_id == 1:
        # Mezzo Windows uses the existing output folder
        return Path("output")
    return Path(f"output/products/{product_id}")

def ensure_product_folder(product_id: int) -> Path:
    """Ensure product folder exists and return path"""
    folder = get_product_folder(product_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "images").mkdir(exist_ok=True)
    return folder

# ============================================================================
# Product-aware Chat History
# ============================================================================
def save_chat_message_v2(user_id: int, product_id: int, role: str, message: str):
    """Save a chat message with product context"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_history_v2 (user_id, product_id, role, message) VALUES (?, ?, ?, ?)",
        (user_id, product_id, role, message)
    )
    conn.commit()
    conn.close()
    log_analytics("chat_message", user_id, {"role": role, "product_id": product_id})

def get_user_chat_history_v2(user_id: int, product_id: int = None, limit: int = 100) -> List[Dict]:
    """Get chat history for a user, optionally filtered by product"""
    conn = get_connection()
    cursor = conn.cursor()
    if product_id:
        cursor.execute(
            """SELECT ch.*, p.name as product_name
               FROM chat_history_v2 ch
               LEFT JOIN products p ON ch.product_id = p.id
               WHERE ch.user_id = ? AND ch.product_id = ?
               ORDER BY ch.timestamp DESC
               LIMIT ?""",
            (user_id, product_id, limit)
        )
    else:
        cursor.execute(
            """SELECT ch.*, p.name as product_name
               FROM chat_history_v2 ch
               LEFT JOIN products p ON ch.product_id = p.id
               WHERE ch.user_id = ?
               ORDER BY ch.timestamp DESC
               LIMIT ?""",
            (user_id, limit)
        )
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return list(reversed(messages))

# Initialize database on import
init_database()
