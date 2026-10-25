import pandas as pd

import engine
from metrics import has_answer
from pipeline import answer_question

orig = engine.derived_coverage
df = pd.read_csv("../data/eval_results_v2.csv")


def outcome(out, gold):
    if not out["passed"]:
        return "refused"
    return "released_correct" if has_answer(out["raw_answer"], gold) else "released_wrong"


rows = []
for i, r in enumerate(df.itertuples(), 1):
    try:
        engine.derived_coverage = lambda *a, **k: 0.0   # fix OFF
        off = answer_question(r.question, mode="hybrid_rerank")
        engine.derived_coverage = orig                   # fix ON
        on = answer_question(r.question, mode="hybrid_rerank")
    except Exception as e:
        engine.derived_coverage = orig
        print(f"skipped {r.id}: {str(e)[:70]}")
        continue
    rows.append({"id": r.id, "off": outcome(off, r.gold), "on": outcome(on, r.gold),
                 "raw": on["raw_answer"][:120].replace("\n", " ")})
    print(f"{i}/{len(df)}", end="\r")
engine.derived_coverage = orig

t = pd.DataFrame(rows)
print(f"\n\nCompared {len(t)} questions (same answers, verifier with and without the fix)\n")
for k in ["released_correct", "refused", "released_wrong"]:
    print(f"{k:17s} fix off {int((t.off == k).sum()):2d}   fix on {int((t.on == k).sum()):2d}")
print("\nQuestions whose outcome changed:")
for _, r in t[t.off != t.on].iterrows():
    print(r["id"], ":", r["off"], "->", r["on"], "|", r["raw"])