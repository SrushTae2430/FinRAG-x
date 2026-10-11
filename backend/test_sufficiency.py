import json
from pathlib import Path

import pandas as pd
from datasets import load_dataset

from pipeline import R, expand_with_page, check_sufficiency

DATA = Path(__file__).resolve().parent.parent / "data"
ds = load_dataset("G4KMU/t2-ragbench", "FinQA")
gold = {r["id"]: r["context_id"] for s in ds for r in ds[s]}
df = pd.read_csv(DATA / "eval_results_v2.csv")

n = suff_with = insuff_without = 0
for _, row in df.iterrows():
    q, g = row.question, gold.get(row.id)
    if g is None:
        continue
    n += 1
    with_gold = expand_with_page(R.search(q, k=5, mode="hybrid_rerank"))
    suff_with += check_sufficiency(q, with_gold)["sufficient"]
    found = R.search(q, k=30, mode="hybrid_rerank")
    no_gold = expand_with_page([c for c in found if c["context_id"] != g][:5])
    insuff_without += not check_sufficiency(q, no_gold)["sufficient"]
    print(f"{n}/{len(df)}", end="\r")

false_abstain = n - suff_with
print(f"\n\nAnswerable questions (gold page present): {n}")
print(f"  judged sufficient:            {suff_with}/{n}")
print(f"  wrongly flagged insufficient: {false_abstain}/{n}   (false-refusal rate)")
print(f"Unanswerable (gold page removed): {n}")
print(f"  correctly flagged insufficient: {insuff_without}/{n}   (abstention recall)")
print(f"Abstention precision: {insuff_without}/{insuff_without + false_abstain}")

(DATA / "sufficiency.json").write_text(json.dumps({
    "n": n, "sufficient_with_gold": int(suff_with),
    "insufficient_without_gold": int(insuff_without)}, indent=2), encoding="utf-8")
print("Saved data/sufficiency.json")