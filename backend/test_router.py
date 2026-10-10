import pandas as pd
from collections import Counter
from pipeline import classify_question

df = pd.read_csv("../data/eval_results_v2.csv")
df["qtype"] = df.question.apply(classify_question)

print(Counter(df.qtype))
print()
for t in sorted(df.qtype.unique()):
    sub = df[df.qtype == t]
    print(f"{t:11s} n={len(sub):2d}  D correct={int(sub.D_correct.sum())}  "
          f"B correct={int(sub.B_correct.sum())}")
print()
for _, r in df.sample(8, random_state=1).iterrows():
    print(r.qtype, "|", r.question[:90])