import { useState } from "react"
import { ask, uploadDoc, type AskResponse } from "./api"
import Login from "./Login"
import { Compare } from "./Extra"
import "./App.css"

const EXAMPLE =
  "What was the percentage change in AES Corporation's proportional free cash flow between 2013 and 2014, as reported in the 2015 financial report?"

const CHECK_LABELS: Record<string, string> = {
  answered: "An answer was produced",
  citations_valid: "Cited sources are among the retrieved evidence",
  inputs_grounded: "Calculation inputs appear in the evidence",
  result_in_answer: "Computed result appears in the answer",
  answer_numbers_supported: "Numbers in the answer appear in the evidence",
}

const MODES: [string, string][] = [
  ["hybrid_rerank", "Hybrid + rerank"],
  ["hybrid", "Hybrid"],
  ["dense", "Dense only"],
  ["bm25", "BM25 only"],
]

function fmt(n: number, d = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: d }).replace("-", "\u2212")
}

function fmtArg(a: any): string {
  if (typeof a === "string" && a.startsWith("#")) return `result of step ${Number(a.slice(1)) + 1}`
  if (typeof a === "number") return fmt(a)
  return String(a)
}

function parseMeta(text: string) {
  const m = text.match(/^\[([^\]]*)\]\s*/)
  if (!m) return { company: "", year: "", page: "", body: text }
  const parts = m[1].split("|").map(s => s.trim())
  return {
    company: parts[0] || "",
    year: parts[1] || "",
    page: (parts[2] || "").replace(/^page\s*/i, ""),
    body: text.slice(m[0].length),
  }
}

function parseTable(body: string): string[][] {
  const rows: string[][] = []
  for (const line of body.split("\n")) {
    if (!line.trim().startsWith("|")) continue
    const cells = line.split("|").map(c => c.trim())
    cells.shift()
    if (cells.length && cells[cells.length - 1] === "") cells.pop()
    if (cells.length && cells.every(c => /^:?-{2,}:?$/.test(c))) continue
    rows.push(cells)
  }
  // drop the leading index column when its header cell is blank
  if (rows.length && rows[0][0] === "") rows.forEach(r => r.shift())
  return rows
}

const isNumeric = (c: string) => /^[\s$(\u2212-]*[\d,.]+\)?\s*%?$/.test(c)

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g

function toNum(s: string): number {
  return parseFloat(s.replace(/,/g, ""))
}

function Hl({ text, nums }: { text: string; nums: Set<number> }) {
  if (nums.size === 0) return <>{text}</>
  const out: any[] = []
  let last = 0
  for (const m of text.matchAll(NUM_RE)) {
    const idx = m.index ?? 0
    if (nums.has(toNum(m[0]))) {
      out.push(text.slice(last, idx))
      out.push(<mark key={idx}>{m[0]}</mark>)
      last = idx + m[0].length
    }
  }
  out.push(text.slice(last))
  return <>{out}</>
}

function EvidenceTable({ body, nums }: { body: string; nums: Set<number> }) {
  const rows = parseTable(body)
  if (rows.length < 2) return <pre className="excerpt"><Hl text={body} nums={nums} /></pre>
  const [head, ...rest] = rows
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rest.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={isNumeric(c) ? "num" : ""}>
                  <Hl text={c} nums={nums} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Workspace({ token, email, onLogout }: { token: string; email: string; onLogout: () => void }) {
  const [question, setQuestion] = useState("")
  const [mode, setMode] = useState("hybrid_rerank")
  const [data, setData] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [docs, setDocs] = useState<{ id: string; name: string; chunks: number }[]>([])
  const [docId, setDocId] = useState("")
  const [uploadMsg, setUploadMsg] = useState("")

  async function submit() {
    if (!question.trim() || loading) return
    setLoading(true); setError(""); setData(null)
    try {
      const res = await ask(question, mode, token, docId)
      setData(res)
      const cited = (res.answer + " " + ((res as any).raw_answer || "")).match(/D\d+_C\d+/g)
      setOpen((cited && cited[0]) || res.evidence[0]?.id || null)
    } catch (e) {
      const m = (e as Error).message
      if (m === "UNAUTHORIZED") { onLogout(); return }
      setError(m)
    } finally {
      setLoading(false)
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setUploadMsg(`Indexing ${f.name}…`)
    try {
      const d = await uploadDoc(f, token)
      setDocs(prev => [...prev, d])
      setDocId(d.id)
      setUploadMsg(`${d.name}: ${d.chunks} passages indexed.`)
    } catch (e) {
      const m = (e as Error).message
      if (m === "UNAUTHORIZED") { onLogout(); return }
      setUploadMsg(m)
    }
  }

  function jumpTo(id: string) {
    setOpen(id)
    setTimeout(() => {
      document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }, 50)
  }

  const program: any = data ? (data as any).program : null
  const steps: any[] = program?.steps || []
  const result: number | null = data ? ((data as any).result ?? null) : null
  const isPercent = !!program?.percent
  const passed = !!data?.passed
  const rawAnswer: string = data ? (data as any).raw_answer || "" : ""
  const citedIds = new Set<string>(
    data ? ((data.answer + " " + rawAnswer).match(/D\d+_C\d+/g) || []) : []
  )

  // Numbers to highlight in the evidence: the calculation inputs,
  // or, when there is no calculation, the numbers in the answer.
  const hlNums = new Set<number>()
  steps.forEach(s =>
    (s.args || []).forEach((a: any) => {
      if (typeof a === "number") hlNums.add(Math.abs(a))
    })
  )
  if (hlNums.size === 0 && data) {
    const cleaned = (data.passed ? data.answer : rawAnswer).replace(/\[?\s*D\d+_C\d+\s*\]?/g, "")
    for (const m of cleaned.matchAll(NUM_RE)) {
      const v = toNum(m[0])
      if (!(v >= 1900 && v <= 2100 && Number.isInteger(v))) hlNums.add(v)
    }
  }

  const isChangePattern =
    steps.length === 2 && steps[0].op === "subtract" && steps[1].op === "divide" &&
    steps[1].args?.[0] === "#0" && isPercent

  function renderAnswer(text: string) {
    return text.split(/(\[\s*D\d+_C\d+\s*\])/g).map((part, i) => {
      const m = part.match(/D\d+_C\d+/)
      if (m && /^\[/.test(part)) {
        return (
          <button key={i} className="cite" onClick={() => jumpTo(m[0])}>{m[0]}</button>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">FinRAG-X</span>
          <span className="brand-sub">Financial Research &amp; Evidence</span>
          <span className="who">
            {email} · <button className="textlink" onClick={onLogout}>Sign out</button>
          </span>
        </div>
      </header>

      <main className="page">
        <section className="ask">
          <h2 className="section-title">Ask the report</h2>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit() }}
            placeholder="Ask a question about a financial report…"
            aria-label="Question"
          />

          <div className="upload">
            <label className="mode">
              <span>Search in</span>
              <select value={docId} onChange={e => setDocId(e.target.value)}>
                <option value="">Pre-indexed reports</option>
                {docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="mode">
              <span>Upload a PDF or text file</span>
              <input type="file" accept=".pdf,.txt" onChange={e => onFile(e.target.files?.[0])} />
            </label>
            {uploadMsg && <p className="meta-line">{uploadMsg}</p>}
          </div>

          <div className="ask-row">
            <label className="mode">
              <span>Retrieval mode</span>
              <select value={mode} onChange={e => setMode(e.target.value)}>
                {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <button className="primary" onClick={submit} disabled={loading || !question.trim()}>
              {loading ? "Running…" : "Run analysis"}
            </button>
          </div>
          <p className="examples">
            Example:{" "}
            <button className="textlink" onClick={() => setQuestion(EXAMPLE)}>
              AES proportional free cash flow, 2013 to 2014
            </button>
          </p>
        </section>

        {loading && (
          <p className="status-line">Retrieving evidence, calculating and verifying the answer…</p>
        )}

        {error && (
          <div className="notice error" role="alert">
            <strong>Request failed.</strong> {error}
          </div>
        )}

        {!data && !loading && !error && (
          <p className="empty">
            Results appear here with the calculation, the retrieved evidence and the verification checks.
          </p>
        )}

        {data && (
          <div className="workspace">
            <div className="col-main">
              <section className={`block answer ${passed ? "" : "withheld"}`}>
                <h3 className="label">Answer</h3>
                {passed ? (
                  <p className="answer-text">{renderAnswer(data.answer)}</p>
                ) : (
                  <>
                    <p className="answer-text">{data.answer}</p>
                    <p className="note">
                      The system did not release an answer because one or more verification checks failed.
                    </p>
                    {rawAnswer && (
                      <details className="draft">
                        <summary>Show withheld draft (unverified)</summary>
                        <p>{renderAnswer(rawAnswer)}</p>
                      </details>
                    )}
                  </>
                )}
              </section>

              {steps.length > 0 && result !== null && (
                <section className="block">
                  <h3 className="label">Calculation</h3>
                  <ol className="steps">
                    {steps.map((s, i) => (
                      <li key={i}>
                        <span className="op">{s.op}</span>
                        <span className="args num">({(s.args || []).map(fmtArg).join(", ")})</span>
                      </li>
                    ))}
                  </ol>
                  {isChangePattern && (
                    <p className="formula">
                      Formula as executed:{" "}
                      <span className="num">
                        ({fmt(steps[0].args[0])} − {fmt(steps[0].args[1])}) / {fmt(steps[1].args[1])} × 100
                      </span>
                    </p>
                  )}
                  <div className="result-row">
                    <span>Result</span>
                    <span className={`result num ${result < 0 ? "neg" : ""}`}>
                      {fmt(result, 2)}{isPercent ? "%" : ""}
                    </span>
                  </div>
                </section>
              )}

              <section className="block">
                <h3 className="label">Verification</h3>
                <p className={`verdict ${passed ? "ok" : "fail"}`}>
                  {passed ? "All checks passed" : "Not released: one or more checks failed"}
                </p>
                <ul className="checks">
                  {Object.entries(data.checks).map(([k, v]) => (
                    <li key={k} className={v ? "pass" : "fail"}>
                      <span className="mark" role="img" aria-label={v ? "Passed" : "Failed"}>{v ? "✓" : "✗"}</span>
                      <span>{CHECK_LABELS[k] || k.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
                <p className="meta-line">
                  Evidence coverage: <span className="num">{data.evidence_coverage}%</span>
                  {" "}of numbers in the draft trace to the evidence or the computed result.
                </p>
                <p className="meta-line">
                  Question type: {(data as any).question_type || "unknown"} (rule-based).
                </p>
                <p className="meta-line">
                  Retrieval mode: {MODES.find(m => m[0] === mode)?.[1] || mode}.
                  These checks test grounding, not correctness.
                </p>
              </section>
            </div>

            <aside className="col-evidence">
              <h3 className="label">Evidence ({data.evidence.length})</h3>
              {hlNums.size > 0 && (
                <p className="hl-note">
                  Highlighted figures are the values used in the calculation or stated in the answer.
                </p>
              )}
              {data.evidence.map(e => {
                const meta = parseMeta(e.text)
                const isOpen = open === e.id
                const truncated = e.text.length >= 3990
                return (
                  <article key={e.id} id={`ev-${e.id}`} className={`ev ${isOpen ? "open" : ""}`}>
                    <button className="ev-head" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                      <span className="ev-id">{e.id}</span>
                      <span className="ev-type">{e.type}</span>
                      {citedIds.has(e.id) && <span className="ev-cited">cited</span>}
                      <span className="ev-meta">
                        {[meta.company, meta.year, meta.page && `p. ${meta.page}`].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="ev-body">
                        {e.type === "table"
                          ? <EvidenceTable body={meta.body} nums={hlNums} />
                          : <p className="excerpt"><Hl text={meta.body} nums={hlNums} /></p>}
                        {truncated && <p className="trunc">Excerpt truncated by the backend.</p>}
                      </div>
                    )}
                  </article>
                )
              })}
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "")
  const [email, setEmail] = useState(localStorage.getItem("email") || "")
  const [page, setPage] = useState("ask")

  function onAuth(t: string, e: string) {
    localStorage.setItem("token", t)
    localStorage.setItem("email", e)
    setToken(t)
    setEmail(e)
  }

  function logout() {
    localStorage.removeItem("token")
    localStorage.removeItem("email")
    setToken("")
    setEmail("")
  }

  if (!token) return <Login onAuth={onAuth} />

  const tabs: [string, string][] = [
    ["ask", "Analyze"],
    ["compare", "Compare retrieval"],
  ]

  return (
    <>
      <nav className="tabbar">
        <div className="tabs">
          {tabs.map(([k, l]) => (
            <button key={k} className={page === k ? "on" : ""} onClick={() => setPage(k)}>{l}</button>
          ))}
        </div>
      </nav>
      <div style={{ display: page === "ask" ? "block" : "none" }}>
        <Workspace token={token} email={email} onLogout={logout} />
      </div>
      {page === "compare" && <Compare token={token} onLogout={logout} />}
    </>
  )
}