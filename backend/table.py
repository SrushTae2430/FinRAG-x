import pandas as pd
import engine
from metrics import has_answer, wilson
from pipeline import answer_question

engine.FIX2 = True                     # use the patched verifier
df = pd.read_csv("../data/eval_results_v2.csv")
n = len(df)

released, correct = [], []
for i, r in enumerate(df.itertuples(), 1):
    try:
        out = answer_question(r.question, mode="hybrid_rerank")
        ok = bool(out["passed"])
        released.append(ok)
        correct.append(ok and has_answer(out["raw_answer"], r.gold))
    except Exception as e:
        print(f"skipped {r.id}: {str(e)[:70]}")
        released.append(False)
        correct.append(False)
    print(f"{i}/{n}", end="\r")

df["D_new_released"], df["D_new_correct"] = released, correct
df.to_csv("../data/eval_results_table.csv", index=False)

print(f"\n\nAccuracy on {n} questions (95% Wilson intervals)\n")
print(f"{'System':34s} {'Correct':>8s} {'Accuracy':>9s}   95% CI")
rows = [("A: Direct LLM", df["A_correct"].sum()),
        ("B: Basic RAG", df["B_correct"].sum()),
        ("C: Hybrid + rerank + page", df["C_correct"].sum()),
        ("D before verifier (raw)", df["D_raw_correct"].sum()),
        ("D: FinRAG-X (released & correct)", df["D_new_correct"].sum())]
for label, k in rows:
    k = int(k); lo, hi = wilson(k, n)
    print(f"{label:34s} {k:>4d}/{n:<3d} {k/n:>8.1%}   [{lo:.0%}-{hi:.0%}]")

rel = int(df["D_new_released"].sum()); cor = int(df["D_new_correct"].sum())
print(f"\nD released {rel}/{n} (coverage {rel/n:.0%}); correct among released {cor}/{rel} ({cor/max(rel,1):.0%})")