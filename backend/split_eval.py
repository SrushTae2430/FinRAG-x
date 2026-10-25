import pandas as pd
from metrics import wilson

df = pd.read_csv("../data/eval_results_v2.csv")   # rows are in sample order
parts = {
    "Dev set (first 39)": df.iloc[:39],
    "Clean test (question 40 onward)": df.iloc[39:],
    "All": df,
}
for name, p in parts.items():
    n = len(p)
    print(f"\n{name}: {n} questions")
    for label, col in [("A direct LLM", "A_correct"), ("B basic RAG", "B_correct"),
                       ("C hybrid+rerank", "C_correct"), ("D released & correct", "D_correct")]:
        k = int(p[col].sum()); lo, hi = wilson(k, n)
        print(f"  {label:22s} {k:3d}/{n}  {k/n:5.1%}  [{lo:.0%}-{hi:.0%}]")
    rel = p[~p["D_refused"]]
    print(f"  D released {len(rel)}/{n}; correct among released {int(rel['D_correct'].sum())}/{len(rel)}")