import hashlib, hmac, os, secrets, sqlite3
from pathlib import Path
from fastapi import Header, HTTPException

DB = Path(__file__).resolve().parent.parent / "data" / "users.db"


def _db():
    con = sqlite3.connect(DB)
    con.execute("create table if not exists users (email text primary key, salt text, pw text)")
    con.execute("create table if not exists sessions (token text primary key, email text)")
    return con


def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()


def _session(con, email):
    token = secrets.token_hex(24)
    con.execute("insert into sessions values (?,?)", (token, email))
    con.commit()
    return {"token": token, "email": email}


def signup(email, pw):
    email = email.strip().lower()
    if "@" not in email or len(pw) < 8:
        raise HTTPException(400, "Enter a valid email and a password of at least 8 characters.")
    con = _db()
    try:
        salt = os.urandom(16).hex()
        con.execute("insert into users values (?,?,?)", (email, salt, _hash(pw, salt)))
        return _session(con, email)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists.")
    finally:
        con.close()


def login(email, pw):
    email = email.strip().lower()
    con = _db()
    try:
        row = con.execute("select salt, pw from users where email=?", (email,)).fetchone()
        if not row or not hmac.compare_digest(row[1], _hash(pw, row[0])):
            raise HTTPException(401, "Incorrect email or password.")
        return _session(con, email)
    finally:
        con.close()


def current_user(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    con = _db()
    try:
        row = con.execute("select email from sessions where token=?", (token,)).fetchone()
    finally:
        con.close()
    if not row:
        raise HTTPException(401, "Please sign in.")
    return row[0]