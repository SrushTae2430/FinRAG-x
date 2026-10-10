import os

QUESTION_COL = "question"
ANSWER_COL = "program_answer"
MAX_DOCS = None          # number of report pages to index (raise later)
MODEL = os.environ.get("FINRAG_MODEL", "openai/gpt-oss-20b")