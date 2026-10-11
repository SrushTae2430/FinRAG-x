# FinRAG-X

**A citation-aware, numerically grounded RAG system for financial document question answering.**

Financial reports mix text, tables, footnotes, units and fiscal periods. A plain LLM or basic RAG pipeline can pick the wrong table column, do its own arithmetic incorrectly, cite sources that do not support the answer, or answer when the evidence is missing. FinRAG-X addresses this with hybrid retrieval, table-aware extraction, a calculation engine that runs in code, a verifier, and abstention.

## Research question

Can a financial-document-aware RAG pipeline with structured table handling, explicit numerical computation and answer verification improve answer reliability over a direct LLM and basic RAG?

This repository is a pilot study built around that question.

## Pipeline

```
Question → Route → Retrieve → Expand → Calculate → Generate → Verify → Answer (or abstain)
```

1. **Hybrid retrieval.** Dense embeddings (`BAAI/bge-small-en-v1.5`, FAISS) and BM25 are fused with reciprocal rank fusion, then reranked with a cross-encoder (`ms-marco-MiniLM-L-6-v2`).
2. **Page expansion.** Neighbouring chunks from the same report page are added as evidence.
3. **Table-aware extraction.** For metric and year questions, the matching table row and year columns are parsed directly from the retrieved table.
4. **Calculation engine.** Arithmetic runs in Python from a small program (`subtract`, `divide`, ...), not in the language model. For percentage-change questions the answer text is built from the computed value.
5. **Verifier with abstention.** An answer is released only if it was produced, all cited ids are in the retrieved evidence, calculation inputs and results appear in the evidence and answer, and (without a calculation) every number in the answer appears in the evidence. Otherwise the system answers "Insufficient evidence to answer reliably."
6. **Question router (rule-based).** Labels questions as fact, numerical, comparison, multi-hop or risk. Shown in the UI only.
7. **Metadata filter (optional, off by default).** Restricts retrieval to the report matching the company and year in the question.

## Application

- **Analyze:** answer with clickable citations, calculation steps, verification checks and an evidence viewer with highlighted figures.
- **Compare retrieval:** top-5 passages from BM25, dense, hybrid and hybrid + rerank for the same question.
- **Auth and upload:** sign up / sign in (SQLite, PBKDF2), and PDF or text upload into the live index.

## Project structure

```
FinRAG-x/
├── backend/     FastAPI app, retrieval, pipeline, engine (calculation + verifier), evaluation scripts
├── frontend/    React + TypeScript (Vite)
└── data/        chunks, embeddings cache, evaluation outputs
```

## Setup

Requires Python 3.10+, Node.js 18+ and a Groq API key.

```bash
git clone https://github.com/vidhisha-08/FinRAG-x.git
cd FinRAG-x/backend
pip install -r requirements.txt
python chunks.py                  # first time only
export LLM_API_KEY="<your Groq API key>"
uvicorn main:app --reload --port 8000
```

In a second terminal: `cd frontend && npm install && npm run dev`, then open http://localhost:5173.

The default model is `openai/gpt-oss-20b` (Groq); override it with `FINRAG_MODEL`. Never commit the API key, `data/users.db` or `data/llm_cache/`.

## Example

**Question:** What was the percentage change in AES Corporation's proportional free cash flow between 2013 and 2014, as reported in the 2015 financial report?

**Answer:** The proportional free cash flow changed from $1,271 million in 2013 to $891 million in 2014, a percentage change of -29.90% `[D2204_C4]`.

**Calculation:** `subtract(891, 1271)`, then `divide(result of step 1, 1271)`. All verification checks passed.

## Evaluation

**Data.** FinQA subset of [T²-RAGBench](https://huggingface.co/datasets/G4KMU/t2-ragbench), indexed as 18,094 chunks. Accuracy is measured on a seeded random sample of **39 numeric questions** (`backend/evaluate.py`; results in `data/eval_results_v2.csv`). An answer is correct if the gold number appears in it within a small tolerance.

| System | Description | Correct | Accuracy |
|---|---|---|---|
| A | Direct LLM, no retrieval | 3/39 | 7.7% |
| B | Basic RAG: dense top-5, model calculates | 21/39 | 53.8% |
| C | Hybrid + rerank + page expansion, model calculates | 18/39 | 46.2% |
| D | FinRAG-X: C + calculation engine + verifier | 15/39 | 38.5% |
| D | Before the verifier (raw answers) | 19/39 | 48.7% |

**Verifier.** FinRAG-X abstained on 13 of 39 questions: 9 blocked a wrong answer (precision 69%) and 4 blocked a correct one (false-refusal rate 21%). Accuracy of released answers is 15/26 = 57.7%, vs 48.7% before verification.

**Retrieval** (50 random questions, gold page in top-k, no LLM calls):

| Mode | Recall@5 | Recall@10 | Avg latency |
|---|---|---|---|
| BM25 | 88% | 94% | 0.57 s |
| Dense | 94% | 94% | 0.45 s |
| Hybrid | 94% | 98% | 0.43 s |
| Hybrid + rerank | 94% | 98% | 5.13 s |

### Findings

- **Retrieval is the clearest effect:** accuracy rises from 7.7% (no retrieval) to 53.8% (basic RAG).
- **B, C and D cannot be separated.** With 39 questions the 95% intervals are about ±15 points, so the pilot does not show that FinRAG-X improves raw accuracy over basic RAG.
- **The verifier trades coverage for precision:** fewer answers are released, but a larger share are correct.
- **Reranking adds about 10x latency** with no page-level recall gain on this corpus.

## Limitations

- Small pilot (n = 39); no significance claims between B, C and D.
- The verifier checks grounding, not correctness, and cannot confirm arithmetic the calculation engine did not produce.
- Authentication is demo-grade, and throughput is limited by the free-tier API quota.

## Future scope

- MCP tool access for live financial data sources.
- A larger benchmark (200-300 questions), including hand-written unanswerable questions, for statistically meaningful comparisons.
- Claim-level citation verification and a measured citation-quality score.
