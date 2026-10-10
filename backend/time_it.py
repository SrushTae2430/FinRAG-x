import time
from pipeline import R, expand_with_page, answer_question
from engine import extract_program, generate

qs = [
    "What was the percentage change in AES Corporation's proportional free cash flow between 2013 and 2014, as reported in the 2015 financial report?",
    "What is the difference in payments, in millions, between Entergy Arkansas and Entergy New Orleans in 2015?",
]
for q in qs:
    t = time.time(); ev = R.search(q, k=5, mode="hybrid_rerank"); t1 = time.time() - t
    t = time.time(); ev = expand_with_page(ev); t2 = time.time() - t
    t = time.time(); out = answer_question(q, mode="hybrid_rerank"); t3 = time.time() - t
    print(f"search {t1:.1f}s | expand {t2:.1f}s | full pipeline {t3:.1f}s | type {out.get('question_type')}")