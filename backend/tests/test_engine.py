import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine import extract_metric_year_values, verify

AES_Q = ("What was the percentage change in AES Corporation's proportional free cash flow "
         "between 2013 and 2014, as reported in the 2015 financial report?")

# Same layout as the retrieved AES table, including the "[AES Corporation | 2015 | page 117]"
# source tag on the header line (the tag contains a stray year that once broke the parser).
AES_TABLE = (
    "[AES Corporation | 2015 | page 117] |    | calculation of proportional free cash flow "
    "( in millions ) | 2015 | 2014 | 2013 | 2015/2014 change | 2014/2013 change |\n"
    "|---:|:---|:---|:---|:---|:---|:---|\n"
    "|  0 | net cash provided by operating activities | $ 2134 | $ 1791 | $ 2715 | $ 343 | $ -924 ( 924 ) |\n"
    "|  7 | proportional free cash flow | $ 1241 | $ 891 | $ 1271 | $ 350 | $ -380 ( 380 ) |\n"
)

EVIDENCE = [{"chunk_id": "D2204_C4", "type": "table", "text": AES_TABLE}]
PROGRAM = {
    "steps": [
        {"op": "subtract", "args": [891.0, 1271.0]},
        {"op": "divide", "args": ["#0", 1271.0]},
    ],
    "percent": True,
}
GOOD_ANSWER = ("The proportional free cash flow changed from $1,271 million in 2013 to $891 million "
               "in 2014, a percentage change of -29.90% [D2204_C4].")


# ---------------------------------------------------------------- table parser
def test_parser_reads_correct_year_columns():
    values = extract_metric_year_values(AES_Q, EVIDENCE)
    assert values == {"2013": 1271.0, "2014": 891.0}


def test_parser_ignores_report_year_in_source_tag():
    values = extract_metric_year_values(AES_Q, EVIDENCE)
    assert values["2013"] != 2015.0 and values["2014"] != 2013.0


def test_parser_does_not_read_the_header_row_as_data():
    header_only = [{"chunk_id": "X", "type": "table", "text": AES_TABLE.split("\n")[0]}]
    assert extract_metric_year_values(AES_Q, header_only) is None


def test_parser_needs_two_years_in_the_question():
    q = "What was AES Corporation's proportional free cash flow in 2014?"
    assert extract_metric_year_values(q, EVIDENCE) is None


def test_parser_returns_none_for_unknown_metric():
    q = "What was the percentage change in AES Corporation's goodwill between 2013 and 2014?"
    assert extract_metric_year_values(q, EVIDENCE) is None


# -------------------------------------------------------------------- arithmetic
def test_percentage_change_value():
    old, new = 1271.0, 891.0
    assert round((new - old) / old * 100, 2) == -29.90


# ---------------------------------------------------------------------- verifier
def test_verifier_passes_a_grounded_correct_answer():
    checks = verify(GOOD_ANSWER, EVIDENCE, PROGRAM, -29.8977, question=AES_Q)
    assert all(checks.values()), checks


def test_verifier_rejects_a_wrong_number_in_the_answer():
    bad = ("The proportional free cash flow decreased from $1,881 million in 2013 to $1,432 million "
           "in 2014, a change of -23.87% [D2204_C4].")
    checks = verify(bad, EVIDENCE, PROGRAM, -29.8977, question=AES_Q)
    assert checks["result_in_answer"] is False


def test_verifier_rejects_a_citation_not_in_the_evidence():
    answer = GOOD_ANSWER.replace("D2204_C4", "D9999_C9")
    checks = verify(answer, EVIDENCE, PROGRAM, -29.8977, question=AES_Q)
    assert checks["citations_valid"] is False


def test_verifier_flags_an_insufficient_evidence_reply():
    checks = verify("INSUFFICIENT EVIDENCE", EVIDENCE, None, None, question=AES_Q)
    assert checks["answered"] is False


def test_verifier_flags_a_number_missing_from_the_evidence():
    answer = "The total was 987,654 million [D2204_C4]."
    checks = verify(answer, EVIDENCE, None, None, question=AES_Q)
    assert checks["answer_numbers_supported"] is False


def test_verifier_accepts_a_number_present_in_the_evidence():
    answer = "Proportional free cash flow in 2014 was 891 million [D2204_C4]."
    checks = verify(answer, EVIDENCE, None, None, question=AES_Q)
    assert checks["answer_numbers_supported"] is True

OIL = [{"chunk_id": "D1_C0", "type": "text",
        "text": "[Example Oil | 2008 | page 1] the price of crude peaked at 145.29 on july 3 "
                "and fell to a low of 33.87 on december 19"}]


def test_verifier_accepts_a_difference_of_two_evidence_numbers():
    answer = "The price fell by 111.42 per barrel [D1_C0]."
    checks = verify(answer, OIL, None, None, question="How far did crude fall?")
    assert checks["answer_numbers_supported"] is True


def test_verifier_still_rejects_an_unrelated_number():
    answer = "The price fell by 99.99 per barrel [D1_C0]."
    checks = verify(answer, OIL, None, None, question="How far did crude fall?")
    assert checks["answer_numbers_supported"] is False