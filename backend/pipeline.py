import re
from engine import extract_metric_year_values
"""FinRAG-X pipeline: retrieve -> (calculate) -> generate -> verify."""
import logging
from collections import Counter, defaultdict

from engine import (MAX_EVIDENCE_CHARS, ProgramError, execute, extract_program, generate,
                    is_numeric_question, number_coverage, verify)
from retrieval import Retriever

log = logging.getLogger("finrag")

R = Retriever()
_BY_PAGE = defaultdict(list)                  # context_id -> chunks (built once, not per query)
for _c in R.chunks:
    _BY_PAGE[_c["context_id"]].append(_c)


def expand_with_page(evidence, max_extra=3):
    """Add more chunks (tables first) from the page that appears most in the top results."""
    if not evidence:
        return evidence
    votes = Counter(c["context_id"] for c in evidence)
    first = {}
    for i, c in enumerate(evidence):
        first.setdefault(c["context_id"], i)
    top = max(votes, key=lambda p: (votes[p], -first[p]))      # most votes, ties go to higher rank
    have = {c["chunk_id"] for c in evidence}
    page = [c for c in _BY_PAGE[top] if c["chunk_id"] not in have]
    page.sort(key=lambda c: c["type"] != "table")              # tables first
    return evidence + page[:max_extra]

# ---------- metadata filtering (company / report year) ----------
_PREFIX_RE = re.compile(r"^\[([^|\]]+)\|\s*(\d{4})\s*\|")
_SUFFIXES = {"corporation", "corp", "inc", "company", "co", "ltd", "plc", "group", "holdings", "the"}

_CTX_META = {}          # context_id -> (normalized company, year)
for _c in R.chunks:
    _cid = _c["context_id"]
    if _cid in _CTX_META:
        continue
    _m = _PREFIX_RE.match(_c["text"])
    if _m:
        _words = [w for w in re.findall(r"[a-z0-9&]+", _m.group(1).lower()) if w not in _SUFFIXES]
        _CTX_META[_cid] = (" ".join(_words), _m.group(2))


def parse_filters(q):
    """Return {'context_id': set(...)} from company/year mentioned in the question, or None."""
    ql = q.lower()
    company = None
    for name in sorted({m[0] for m in _CTX_META.values() if len(m[0]) >= 3}, key=len, reverse=True):
        if re.search(r"\b" + re.escape(name) + r"\b", ql):
            company = name
            break
    ym = re.search(r"\b((?:19|20)\d{2})\s+(?:financial|annual|form 10-k|10-k)", ql)
    year = ym.group(1) if ym else None
    if not company and not year:
        return None
    ids = {cid for cid, (n, y) in _CTX_META.items()
           if (company is None or n == company) and (year is None or y == year)}
    return {"context_id": ids} if ids else None


def retrieve(q, k=5, mode="hybrid_rerank", use_filter=False, only_ids=None):
    if only_ids:
        return R.search(q, k=k, mode=mode, filters={"context_id": set(only_ids)})
    if use_filter:
        flt = parse_filters(q)
        if flt:
            found = R.search(q, k=k, mode=mode, filters=flt)
            if found:
                return found
    return R.search(q, k=k, mode=mode)

# ---------- evidence-sufficiency heuristic (informational) ----------
_STOP = {"what", "which", "that", "this", "with", "from", "were", "have", "been", "between",
         "percentage", "change", "total", "value", "report", "reported", "financial", "year",
         "years", "company", "about", "their", "does", "than", "amount", "during", "after",
         "before", "would", "where", "when", "much", "many", "rate", "ratio"}


def _company_in_question(q):
    ql = q.lower()
    for name in sorted({m[0] for m in _CTX_META.values() if len(m[0]) >= 3}, key=len, reverse=True):
        if re.search(r"\b" + re.escape(name) + r"\b", ql):
            return name
    return None


def _chunk_company(text):
    m = _PREFIX_RE.match(text)
    if not m:
        return None
    words = [w for w in re.findall(r"[a-z0-9&]+", m.group(1).lower()) if w not in _SUFFIXES]
    return " ".join(words)


def check_sufficiency(q, evidence):
    ev_text = " ".join(c["text"] for c in evidence).lower()
    words = {w for w in re.findall(r"[a-z]{4,}", q.lower()) if w not in _STOP}
    coverage = sum(w in ev_text for w in words) / len(words) if words else 1.0
    company = _company_in_question(q)
    company_ok = None
    if company:
        company_ok = any(_chunk_company(c["text"]) == company for c in evidence)
    return {
        "sufficient": coverage >= 0.5 and company_ok is not False,
        "keyword_coverage": round(coverage, 2),
        "company_in_evidence": company_ok,
    }

# ---------- question router (rule-based) ----------
_RISK = ("risk", "uncertaint", "litigation", "exposure", "adverse", "could affect", "may affect", "contingen")
_COMPARE = ("compare", "versus", " vs ", "higher than", "lower than", "greater than", "less than", "which segment", "which year", "which is")
_MULTI = ("combined", "both", "respectively", "in total across", "sum of", "together")


def classify_question(q):
    ql = " " + q.lower() + " "
    if any(w in ql for w in _RISK):
        return "risk"
    if any(w in ql for w in _COMPARE):
        return "comparison"
    years = set(re.findall(r"\b(?:19|20)\d{2}\b", ql))
    if any(w in ql for w in _MULTI) or len(years) >= 3:
        return "multi-hop"
    if is_numeric_question(q):
        return "numerical"
    return "fact"

# ---------- document upload: add chunks to the live index ----------
_UPLOAD_N = [0]


def add_document(name, pages):
    """pages: list of (page_number, text). Returns (context_id, chunk_count)."""
    import numpy as np
    from rank_bm25 import BM25Okapi
    from retrieval import tokenize

    _UPLOAD_N[0] += 1
    num = 900000 + _UPLOAD_N[0]
    ctx = f"upload_{num}"
    new, n = [], 0
    for pno, text in pages:
        cur = ""
        for line in [l.strip() for l in text.splitlines() if l.strip()] + [None]:
            if line is None or (cur and len(cur) + len(line) + 1 > 900):
                if cur:
                    new.append({
                        "chunk_id": f"D{num}_C{n}", "context_id": ctx, "type": "text",
                        "text": f"[{name} | upload | page {pno}] {cur}",
                    })
                    n += 1
                cur = line or ""
            else:
                cur = (cur + " " + line).strip()
    new = new[:400]
    if not new:
        raise ValueError("No readable text found in this file.")
    vecs = R.emb.encode([c["text"][:2000] for c in new],
                        normalize_embeddings=True, show_progress_bar=False)
    R.index.add(np.ascontiguousarray(vecs, dtype="float32"))
    R.chunks.extend(new)
    R.bm25 = BM25Okapi([tokenize(c["text"][:2000]) for c in R.chunks])
    return ctx, len(new)

def answer_question(q, mode="dense", expand=True, use_calc=True, use_checker=True, use_filter=False, only_ids=None):
    evidence = retrieve(q, k=5, mode=mode, use_filter=use_filter, only_ids=only_ids)
    if expand:
        evidence = expand_with_page(evidence)

        program, result, calc_error = None, None, None
        template_answer = None

    calc_evidence = evidence
    if use_calc and is_numeric_question(q):
        try:
            calc_evidence = [c for c in evidence if c.get("type") == "table"]

            if not calc_evidence:
                calc_evidence = evidence

            # Prefer tables whose text explicitly matches the requested financial metric.
            q_lower = q.lower()
            metric_terms = [
                "proportional free cash flow",
                "free cash flow",
                "operating cash flow",
                "operating profit",
                "interest expense",
                "revenue",
                "net income",
            ]

            metric = next(
                (term for term in metric_terms if term in q_lower),
                None
            )

            if metric:
                matching = [
                    c for c in calc_evidence
                    if metric in c["text"].lower()
                ]
                if matching:
                    calc_evidence = matching

            text = "\n\n".join(
                c["text"][:MAX_EVIDENCE_CHARS] for c in calc_evidence
            )

            metric_values = extract_metric_year_values(q, calc_evidence)

            if metric_values and "percentage change" in q.lower():
                years = re.findall(r"\b(?:19|20)\d{2}\b", q.lower())
                old_value = metric_values[years[0]]
                new_value = metric_values[years[1]]

                
                if old_value != 0:
                    result = ((new_value - old_value) / old_value) * 100
                    cite_id = next(
                        (c["chunk_id"] for c in calc_evidence
                         if metric and metric in c["text"].lower()),
                        calc_evidence[0]["chunk_id"],
                    )
                    template_answer = (
                        f"The {metric} changed from ${old_value:,.0f} million in {years[0]} "
                        f"to ${new_value:,.0f} million in {years[1]}, "
                        f"a percentage change of {result:.2f}% [{cite_id}]."
                    )
                    program = {
                        "steps": [
                            {"op": "subtract", "args": [new_value, old_value]},
                            {"op": "divide", "args": ["#0", old_value]},
                        ],
                        "percent": True,
                }
                else:
                    program = extract_program(q, text)
                    result = execute(program)
            else:
                program = extract_program(q, text)
                result = execute(program)
  
                                  # None when steps == []
        except ProgramError as e:
            # Only program errors are caught. API/network errors now propagate so the
            # evaluator stops and resumes, instead of silently scoring as "no calculation".
            calc_error = str(e)
            log.warning("calculation failed for %r: %s", q[:60], calc_error)
            program, result = None, None

    answer_evidence = calc_evidence if result is not None else evidence
    if template_answer:
        answer = template_answer
    else:
        answer = generate(
            q,
            answer_evidence,
            f"{result:.6f}" if result is not None else None
        )
    checks = verify(answer, evidence, program, result, question=q)
    passed = all(checks.values()) if use_checker else True
    # Evidence coverage = share of numbers in the answer traceable to evidence/result.
    # (The old value was the % of checks passed, which carried no extra information.)
    coverage = round(100 * number_coverage(answer, evidence, q, result))

    return {
        "question": q,
        "question_type": classify_question(q),
        "answer": answer if passed else "Insufficient evidence to answer reliably.",
        "raw_answer": answer,
        "evidence_sufficiency": check_sufficiency(q, evidence),
        "passed": passed,
        "program": program,
        "calc_error": calc_error,
        "result": None if result is None else round(result, 4),
        "evidence": [{"id": c["chunk_id"], "context_id": c["context_id"], "type": c["type"],
                      "text": c["text"][:4000]} for c in evidence],
        "checks": checks,
        "evidence_coverage": coverage,
    }