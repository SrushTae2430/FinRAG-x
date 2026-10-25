import json
import os
from pathlib import Path
from typing import Optional

import pandas as pd
import pymupdf as fitz
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth import current_user, login as do_login, signup as do_signup
from pipeline import R, add_document, answer_question

DATA = Path(__file__).resolve().parent.parent / "data"


app = FastAPI()

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    os.environ.get("FRONTEND_URL", "").rstrip("/"),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in allowed_origins if origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


DOCS = {}  # context_id -> {"name", "chunks", "owner"}  (in memory; cleared on restart)


class AskRequest(BaseModel):
    question: str
    mode: str = "dense"
    doc_id: Optional[str] = None


class Cred(BaseModel):
    email: str
    password: str


class CompareRequest(BaseModel):
    question: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/signup")
def signup(c: Cred):
    return do_signup(c.email, c.password)


@app.post("/login")
def login(c: Cred):
    return do_login(c.email, c.password)


@app.get("/docs-list")
def docs_list(user: str = Depends(current_user)):
    return [{"id": k, **v} for k, v in DOCS.items() if v["owner"] == user]


@app.post("/upload")
def upload(file: UploadFile = File(...), user: str = Depends(current_user)):
    data = file.file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "File is larger than 15 MB.")
    name = file.filename or "document"
    if name.lower().endswith(".pdf"):
        pdf = fitz.open(stream=data, filetype="pdf")
        pages = [(i + 1, p.get_text()) for i, p in enumerate(pdf)]
    elif name.lower().endswith(".txt"):
        pages = [(1, data.decode("utf-8", errors="ignore"))]
    else:
        raise HTTPException(400, "Upload a .pdf or .txt file.")
    try:
        ctx, n = add_document(name, pages)
    except ValueError as e:
        raise HTTPException(422, str(e))
    DOCS[ctx] = {"name": name, "chunks": n, "owner": user}
    return {"id": ctx, "name": name, "chunks": n}


@app.post("/ask")
def ask(req: AskRequest, user: str = Depends(current_user)):
    only = None
    if req.doc_id:
        if req.doc_id not in DOCS or DOCS[req.doc_id]["owner"] != user:
            raise HTTPException(404, "That uploaded document is no longer loaded. Please upload it again.")
        only = {req.doc_id}
    try:
        return answer_question(req.question, req.mode, only_ids=only)
    except Exception as e:
        raise HTTPException(503, f"{type(e).__name__}: {str(e)[:300]}")


@app.post("/compare")
def compare(req: CompareRequest, user: str = Depends(current_user)):
    """Retrieval only (no language-model call): top-5 chunks for each retrieval mode."""
    out = {}
    for m in ["bm25", "dense", "hybrid", "hybrid_rerank"]:
        found = R.search(req.question, k=5, mode=m)
        out[m] = [{"id": c["chunk_id"], "type": c["type"], "text": c["text"][:240]} for c in found]
    return out


def _read_json(name):
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


@app.get("/metrics")
def metrics(user: str = Depends(current_user)):
    main = None
    p = DATA / "eval_results_v2.csv"
    if p.exists():
        df = pd.read_csv(p)
        raw_wrong = ~df.D_raw_correct
        main = {
            "n": int(len(df)),
            "A": int(df.A_correct.sum()), "B": int(df.B_correct.sum()),
            "C": int(df.C_correct.sum()), "D": int(df.D_correct.sum()),
            "D_raw": int(df.D_raw_correct.sum()),
            "refused": int(df.D_refused.sum()),
            "raw_wrong": int(raw_wrong.sum()),
            "blocked_wrong": int((df.D_refused & raw_wrong).sum()),
            "blocked_correct": int((df.D_refused & df.D_raw_correct).sum()),
        }
    return {"main": main,
            "retrieval": _read_json("extra_metrics.json"),
            "sufficiency": _read_json("sufficiency.json")}

@app.get("/results")
def results(user: str = Depends(current_user)):
    p = DATA / "eval_results_v2.csv"
    if not p.exists():
        return []
    df = pd.read_csv(p)
    cols = ["id", "question", "gold", "A_correct", "B_correct", "C_correct",
            "D_raw_correct", "D_refused", "D_correct"]
    return json.loads(df[cols].to_json(orient="records"))