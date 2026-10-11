import json, random, re, time
from pathlib import Path

import pandas as pd
from datasets import load_dataset

from config import ANSWER_COL, QUESTION_COL
from metrics import is_yes_no, to_float
from pipeline import R

N = 50
DATA = Path(__file__).resolve().parent.parent / "data"

ds = load_dataset("G4KMU/t2-ragbench", "FinQA")
pool_ids = {c["context_id"] for c in R.chunks}
rows = [r for s in ds for r in ds[s]
        if r["context_id"] in pool_ids
        and r[QUESTION_COL] and str(r[QUESTION_COL]).strip()
        and to_float(r[ANSWER_COL]) is not None
        and not is_yes_no(r[QUESTION_COL], to_float(r[ANSWER_COL]))]
random.Random(0).shuffle(rows)
rows = rows[:N]

# ---- Recall@5 / @10 by retrieval mode (no LLM calls) ----
MODES = ["bm25", "dense", "hybrid", "hybrid_rerank"]
res = {m: {"r5": 0, "r10": 0, "t": 0.0} for m in MODES}
for i, r in enumerate(rows, 1):
    q, gold = r[QUESTION_COL], r["context_id"]
    for m in MODES:
        t = time.time()
        found = R.search(q, k=10, mode=m)
        res[m]["t"] += time.time() - t
        ids = [c["context_id"] for c in found]
        res[m]["r5"] += gold in ids[:5]
        res[m]["r10"] += gold in ids[:10]
    print(f"{i}/{len(rows)}", end="\r")

print(f"\n\nRetrieval comparison on {len(rows)} questions (gold report page in top-k)")
for m in MODES:
    x = res[m]
    print(f"{m:14s} Recall@5 {100*x['r5']/len(rows):5.1f}%  Recall@10 {100*x['r10']/len(rows):5.1f}%  "
          f"avg latency {x['t']/len(rows):.2f}s")

# ---- Page-level citation precision / recall from saved system-D answers ----
df = pd.read_csv(DATA / "eval_results_v2.csv")
gold_of = {r["id"]: r["context_id"] for s in ds for r in ds[s]}
chunk_ctx = {c["chunk_id"]: c["context_id"] for c in R.chunks}
cited_total = cited_gold = answers_citing_gold = answers = 0
for _, row in df.iterrows():
    g = gold_of.get(row.id)
    if g is None:
        continue
    answers += 1
    cited = {c for c in re.findall(r"D\d+_C\d+", str(row.D_answer)) if c in chunk_ctx}
    h = sum(chunk_ctx[c] == g for c in cited)
    cited_total += len(cited)
    cited_gold += h
    answers_citing_gold += h > 0

print(f"\nCitation precision (cited chunks from the gold page): {cited_gold}/{cited_total}")
print(f"Citation recall (answers citing the gold page):       {answers_citing_gold}/{answers}")

out = {
    "n": len(rows),
    "modes": {m: {"r5": int(res[m]["r5"]), "r10": int(res[m]["r10"]),
                  "latency": round(res[m]["t"] / len(rows), 2)} for m in MODES},
    "citation": {"answers": answers, "cited_total": cited_total, "cited_gold": cited_gold,
                 "answers_citing_gold": answers_citing_gold},
}
(DATA / "extra_metrics.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
print("\nSaved data/extra_metrics.json")