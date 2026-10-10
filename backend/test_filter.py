import pandas as pd
from datasets import load_dataset
from pipeline import R, parse_filters, retrieve

ds = load_dataset("G4KMU/t2-ragbench", "FinQA")
split = "dev"

df = pd.read_csv("../data/eval_results_v2.csv")
gold_ctx = {r["id"]: r["context_id"] for s in ds for r in ds[s]}
hit_off = hit_on = used = 0
for _, row in df.iterrows():
    q, gold = row.question, gold_ctx.get(row.id)
    off = retrieve(q, 5, "hybrid_rerank", use_filter=False)
    on = retrieve(q, 5, "hybrid_rerank", use_filter=True)
    hit_off += any(c["context_id"] == gold for c in off)
    hit_on += any(c["context_id"] == gold for c in on)
    used += parse_filters(q) is not None

n = len(df)
print(f"Filter triggered on {used}/{n} questions")
print(f"Gold page in top-5 without filter: {hit_off}/{n}")
print(f"Gold page in top-5 with filter:    {hit_on}/{n}")