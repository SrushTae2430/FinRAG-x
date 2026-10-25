# FinRAG-X

**A citation-aware, numerically grounded RAG system for financial document question answering.**

Financial reports mix text, tables, footnotes, units and fiscal periods. A plain LLM or basic RAG pipeline can pick the wrong table column, do its own arithmetic incorrectly, cite sources that do not support the answer, or answer when the evidence is missing. FinRAG-X addresses this by combining hybrid retrieval, table-aware extraction, a calculation engine that runs in code, a verifier, and abstention.

![FinRAG-X UI](docs/screenshot.png)

## Research question

Can a financial-document-aware RAG pipeline with structured table handling, explicit numerical computation and answer verification improve answer reliability over a direct LLM and basic RAG?

This repository is a pilot study built around that question. Results are reported in [Evaluation](#evaluation), including what they do **not** show.

## Pipeline

```
Question → Route → Retrieve → Expand → Calculate → Generate → Verify → Answer (or abstain)
```

1. **Hybrid retrieval.** Dense embeddings (`BAAI/bge-small-en-v1.5`, FAISS) and BM25 are fused with reciprocal rank fusion, then reranked with a cross-encoder (`ms-marco-MiniLM-L-6-v2`).
2. **Page expansion.** Neighbouring chunks from the same report page are added as evidence.
3. **Table-aware extraction.** For metric and year questions, the matching table row and year columns are parsed directly from the retrieved table.
4. **Calculation engine.** Arithmetic runs in Python from a small program (`subtract`, `divide`, ...), not in the language model. For percentage-change questions the answer text is built from the computed value, so the model cannot change the number.
5. **Verifier with abstention.** The answer is released only if all checks pass:
   - an answer was produced
   - every cited id is among the retrieved evidence
   - calculation inputs appear in the evidence
   - the computed result appears in the answer
   - (when no calculation was run) every number in the answer appears in the evidence, or equals a sum, difference, product or ratio of two numbers in the cited chunks

   Failing answers are replaced by "Insufficient evidence to answer reliably."
6. **Question router (rule-based).** Labels each question as fact, numerical, comparison, multi-hop or risk. It is shown in the UI and does not change retrieval.
7. **Metadata filter (optional, off by default).** Restricts retrieval to the report matching the company and year in the question.
8. **Evidence-sufficiency heuristic (informational).** A keyword and company-name check returned in the API response. It does not affect the pass/fail decision.

## Application

- **Analyze:** ask a question and get the answer with clickable citations, the calculation steps, the verification checks, the question type, and an evidence viewer. Evidence tables are rendered as tables and the figures used in the calculation are highlighted.
- **Compare retrieval:** shows the top-5 passages returned by BM25, dense, hybrid and hybrid + rerank for the same question. No language model is called.
- **Evaluation:** shows the saved benchmark results (accuracy, abstention, retrieval, sufficiency). These are fixed benchmark results and do not change with uploaded documents.
- **Sign up and sign in:** SQLite storage, PBKDF2-hashed passwords, token sessions.
- **Document upload:** a PDF or text file is chunked, embedded and added to the live index. Questions can then be restricted to that document.

## Project structure

```
finrag-x/
├── backend/
│   ├── main.py          FastAPI app and endpoints
│   ├── auth.py          sign up / sign in
│   ├── pipeline.py      retrieval, filtering, router, upload indexing, answer_question()
│   ├── retrieval.py     BM25, dense, hybrid and reranked search
│   ├── engine.py        LLM calls, table extraction, program execution, verification
│   ├── chunks.py        builds data/chunks.json from the dataset
│   ├── config.py        model and dataset settings
│   ├── metrics.py       answer-matching helpers
│   ├── evaluate.py      evaluation of systems A-D (resumable)
│   ├── extra_metrics.py retrieval comparison (Recall@5 / @10)
│   ├── test_filter.py, test_router.py, test_sufficiency.py
│   └── requirements.txt
├── frontend/            React + TypeScript (Vite)
│   └── src/             App.tsx, Login.tsx, Extra.tsx, api.ts, App.css
├── data/                chunks, embeddings cache, evaluation outputs
└── docs/                screenshots
```

API endpoints: `/health`, `/signup`, `/login`, `/upload`, `/docs-list`, `/ask`, `/compare`, `/metrics`.

## Setup

Requirements: Python 3.10+, Node.js 18+, a Groq API key, and an internet connection for the first run (models and dataset are downloaded, then cached).

**Tests** (parser and verifier, no LLM calls):

    cd backend
    pip install pytest
    python -m pytest tests/test_engine.py -v

**Backend** (PowerShell, from the project root):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python chunks.py                      # first time only: builds data/chunks.json
$env:LLM_API_KEY = "<your Groq API key>"
uvicorn main:app --reload --port 8000
```

Wait for `Application startup complete.` The first start builds the embeddings, which takes longer; later starts use the cache.

**Frontend** (second terminal):

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, create an account, and ask a question.

**Model.** The default is `openai/gpt-oss-20b` through the Groq API. It can be changed with the `FINRAG_MODEL` environment variable. All reported results were produced with the default model.

**Secrets.** The API key is read from the `LLM_API_KEY` environment variable. Do not commit it, `data/users.db`, or `data/llm_cache/`.

## Example

**Question:** What was the percentage change in AES Corporation's proportional free cash flow between 2013 and 2014, as reported in the 2015 financial report?

**Answer:** The proportional free cash flow changed from $1,271 million in 2013 to $891 million in 2014, a percentage change of -29.90% `[D2204_C4]`.

**Calculation:** `subtract(891, 1271)`, then `divide(result of step 1, 1271)`. All verification checks passed.

## Evaluation

**Data.** FinQA subset of [T²-RAGBench](https://huggingface.co/datasets/G4KMU/t2-ragbench), indexed as 18,094 chunks. The accuracy evaluation uses a seeded random sample of **100 numeric questions** (`backend/evaluate.py`; per-question results in `data/eval_results_v2.csv`). An answer counts as correct if the gold number appears in it within a small tolerance.

**Systems compared**

| | Description |
|---|---|
| A | Direct LLM, no retrieval |
| B | Basic RAG: dense top-5, model calculates itself |
| C | Hybrid + rerank + page expansion, model calculates itself |
| D | C + calculation engine + verifier with abstention (FinRAG-X) |

### Answer accuracy (n = 100)

| System | Correct | Accuracy | 95% CI |
|---|---|---|---|
| A: Direct LLM | 15/100 | 15.0% | 9%-23% |
| B: Basic RAG | 35/100 | 35.0% | 26%-45% |
| C: Hybrid + rerank + page expansion | 53/100 | 53.0% | 43%-62% |
| D: FinRAG-X (released and correct) | 43/100 | 43.0% | 34%-53% |

FinRAG-X released 63 of 100 answers (63% coverage); 43 of the released answers are correct (68%).

**Why C scores higher (53% vs 43%)**

- C releases every answer, so every correct answer counts.
- D's verifier refuses some answers, and a refusal counts as a miss even when the answer was right. D's raw answers are about as good as C's (51 correct vs 53), so the gap comes from correct answers that were refused.

**What D gets for that trade**

- C's wrong answers are all released. 47 of 100 answers it gives are wrong.
- D releases 63 answers and about 68% of them are correct, against C's 53%. When D answers, it is more likely to be right, and it says "insufficient evidence" instead of guessing.

### Verification and abstention (answerable questions)

FinRAG-X abstained on 37 of 100 questions.

| Measure | Value |
|---|---|
| Abstention precision (refusals that blocked a wrong answer) | 29/37 = 78% |
| Abstention recall (wrong raw answers blocked) | 29/49 = 59% |
| False-refusal rate (correct raw answers blocked) | 8/51 = 16% |
| Accuracy of released answers | 43/63 = 68% (vs 53% for C, which releases every answer) |

The calculator result was exact on 30 of 100 questions, with no program errors.

### Retrieval comparison (50 random questions, no LLM calls)

Share of questions whose gold report page appears in the top-k results.

| Mode | Recall@5 | Recall@10 | Avg latency |
|---|---|---|---|
| BM25 | 88% | 94% | 0.57 s |
| Dense | 94% | 94% | 0.45 s |
| Hybrid (rank fusion) | 94% | 98% | 0.43 s |
| Hybrid + rerank | 94% | 98% | 5.13 s |

Recall is matched by context id, so it is conservative when the same page appears under more than one id. In the 100-question run, the gold page was among the evidence for 85% of questions (B, dense) and 92% (D).

### Verifier arithmetic check
The "numbers supported" check was extended so that a number counts as grounded if it can be derived
from numbers in the cited chunks by simple arithmetic (sum, difference, product, ratio, percentage
change, average, with unit scaling), and descriptive page citations are accepted. Replaying the same
100 saved model answers through the old and the extended verifier: released and correct went from
34 to 43, refused from 50 to 37, and released but wrong from 16 to 20. The extension was designed
after inspecting refused answers on these same 100 questions, so D's figure is a development-set
result, not a held-out test.

### Findings

- **Retrieval is the clearest effect.** Accuracy rises from 15.0% (no retrieval) to 35.0% (basic RAG) and 53.0% (hybrid + rerank + page expansion).
- **B, C and D cannot be fully separated.** With 100 questions the 95% intervals are about ±10 points. C is 18 points above B and their intervals only just overlap; D (43%) overlaps both, so this pilot does not establish that FinRAG-X or the verifier improves raw accuracy.
- **The verifier trades coverage for precision.** It releases 63% of answers, and a larger share of the released answers are correct (68% vs 53% for C), at the cost of refusing 8 correct answers.
- **Reranking adds about 10x latency** (5.1 s vs 0.4 s) with no recall gain at the page level on this corpus.

## Related work

FinQA, TAT-QA, MultiHiertt (financial numerical QA); DocFinQA (long documents); ALCE (citations); Self-RAG and CRAG (verification). Verify venues and years before citing.
