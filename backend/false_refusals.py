import pandas as pd
df = pd.read_csv("../data/eval_results_v2.csv")
fr = df[df["D_refused"] & df["D_raw_correct"]]
for _, r in fr.iterrows():
    print(r["id"], "| gold:", r["gold"])
    print("  answer:", str(r["D_answer"])[:150].replace("\n", " "))
    print("  checks:", r["D_checks"])
    print()