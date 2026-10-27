import pandas as pd
import engine
from metrics import has_answer
from pipeline import answer_question

df = pd.read_csv("../data/eval_results_v2.csv")

def outcome(out, gold):
    if not out["passed"]:
        return "refused"
    return "released_correct" if has_answer(out["raw_answer"], gold) else "released_wrong"

rows = []
for i, r in enumerate(df.itertuples(), 1):
    try:
        engine.FIX2 = False
        off = answer_question(r.question, mode="hybrid_rerank")
        engine.FIX2 = True
        on = answer_question(r.question, mode="hybrid_rerank")
    except Exception as e:
        engine.FIX2 = True
        print(f"skipped {r.id}: {str(e)[:70]}")
        continue
    rows.append({"id": r.id, "off": outcome(off, r.gold), "on": outcome(on, r.gold),
                 "raw": on["raw_answer"][:110].replace("\n", " "), "gold": r.gold})
    print(f"{i}/{len(df)}", end="\r")
engine.FIX2 = True

t = pd.DataFrame(rows)
print(f"\n\nCompared {len(t)} questions (same answers, old vs new verifier)\n")
for k in ["released_correct", "refused", "released_wrong"]:
    print(f"{k:17s} old {int((t.off == k).sum()):3d}   new {int((t.on == k).sum()):3d}")
print("\nChanged outcomes:")
for _, r in t[t.off != t.on].iterrows():
    print(r["id"], ":", r["off"], "->", r["on"], "| gold", r["gold"], "|", r["raw"])