import pandas as pd

from metrics import has_answer
from pipeline import answer_question

df = pd.read_csv("../data/eval_results_v2.csv")
rows, skipped = [], 0
for i, r in enumerate(df.itertuples(), 1):
    try:
        out = answer_question(r.question, mode="hybrid_rerank")
    except Exception as e:
        skipped += 1
        print(f"skipped {r.id}: {str(e)[:70]}")
        continue
    correct = has_answer(out["raw_answer"], r.gold)
    rows.append({
        "id": r.id,
        "old_released_correct": bool(r.D_correct),
        "old_refused": bool(r.D_refused),
        "old_released_wrong": bool((not r.D_refused) and (not r.D_raw_correct)),
        "new_released_correct": bool(out["passed"] and correct),
        "new_refused": not out["passed"],
        "new_released_wrong": bool(out["passed"] and not correct),
        "raw": out["raw_answer"][:140].replace("\n", " "),
        "checks": out["checks"],
    })
    print(f"{i}/{len(df)}", end="\r")

t = pd.DataFrame(rows)
n = len(t)
print(f"\n\nCompared {n} questions (skipped {skipped})")
for label in ["released_correct", "refused", "released_wrong"]:
    print(f"{label:17s} old {int(t['old_' + label].sum()):2d}  ->  new {int(t['new_' + label].sum()):2d}")

gained = t[~t.old_released_correct & t.new_released_correct]["id"].tolist()
new_wrong = t[~t.old_released_wrong & t.new_released_wrong]["id"].tolist()
print("\nNewly released and correct:", gained or "none")
print("Newly released but WRONG (false accepts):", new_wrong or "none")

lost = t[t.old_released_correct & ~t.new_released_correct]
print("\nPreviously released and correct, now not:")
for _, r in lost.iterrows():
    print(r["id"], "| refused:", r["new_refused"], "| checks:", r["checks"])
    print("    ", r["raw"])