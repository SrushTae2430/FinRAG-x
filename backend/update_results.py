import pandas as pd
from pathlib import Path

d = Path("../data")
old = pd.read_csv(d / "eval_results_v2.csv")
old.to_csv(d / "eval_results_v2_oldverifier.csv", index=False)      # backup

t = pd.read_csv(d / "eval_results_table.csv")
assert len(t) == 100 and {"D_new_released", "D_new_correct"} <= set(t.columns)
t["D_refused"] = ~t["D_new_released"].astype(bool)
t["D_correct"] = t["D_new_correct"].astype(bool)
t.to_csv(d / "eval_results_v2.csv", index=False)

raw_wrong = ~t["D_raw_correct"].astype(bool)
print("D correct:", int(t.D_correct.sum()), "| refused:", int(t.D_refused.sum()))
print("blocked wrong:", int((t.D_refused & raw_wrong).sum()),
      "| blocked correct:", int((t.D_refused & t.D_raw_correct).sum()))