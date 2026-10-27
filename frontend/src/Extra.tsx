import { useEffect, useState } from "react"
import { getMetrics, getResults, compareModes } from "./api"

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a")

const MODE_LABELS: Record<string, string> = {
  bm25: "BM25 only",
  dense: "Dense only",
  hybrid: "Hybrid (rank fusion)",
  hybrid_rerank: "Hybrid + rerank",
}

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]
}

type Bar = { label: string; k: number; n: number }

function BarChart({ bars, caption }: { bars: Bar[]; caption: string }) {
  const W = 640, rowH = 34, left = 230, right = 70, top = 8
  const plotW = W - left - right
  const H = top + bars.length * rowH + 28
  const x = (v: number) => left + v * plotW
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={caption}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - 24} stroke="#d9d5c9" />
            <text x={x(t)} y={H - 8} fontSize="11" textAnchor="middle" fill="#6b716d">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const y = top + i * rowH
          const p = b.n ? b.k / b.n : 0
          const [lo, hi] = wilson(b.k, b.n)
          return (
            <g key={b.label}>
              <text x={left - 8} y={y + 20} fontSize="12" textAnchor="end" fill="#1c1f1d">{b.label}</text>
              <rect x={left} y={y + 6} width={Math.max(1, p * plotW)} height={18} fill="#2f5d46" opacity="0.85" />
              <line x1={x(lo)} x2={x(hi)} y1={y + 15} y2={y + 15} stroke="#1c1f1d" />
              <line x1={x(lo)} x2={x(lo)} y1={y + 10} y2={y + 20} stroke="#1c1f1d" />
              <line x1={x(hi)} x2={x(hi)} y1={y + 10} y2={y + 20} stroke="#1c1f1d" />
              <text x={x(hi) + 6} y={y + 19} fontSize="12" fill="#1c1f1d">{(p * 100).toFixed(1)}%</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="meta-line">{caption}</figcaption>
    </figure>
  )
}

function ResultsTable({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [filter, setFilter] = useState("all")

  useEffect(() => { getResults(token).then(setRows).catch(() => {}) }, [])

  const outcome = (r: any) => (r.D_correct ? "correct" : r.D_refused ? "refused" : "wrong")
  const shown = rows.filter(r => filter === "all" || outcome(r) === filter)
  const mark = (v: boolean) => (
    <span style={{ color: v ? "#2f5d46" : "#a23b32", fontWeight: 700 }}>{v ? "✓" : "✗"}</span>
  )

  function download() {
    const head = ["id", "question", "gold", "A", "B", "C", "D_raw", "D_refused", "D_released_correct"]
    const esc = (x: any) => `"${String(x).replace(/"/g, '""')}"`
    const lines = [head.join(",")].concat(
      rows.map(r =>
        [r.id, r.question, r.gold, r.A_correct, r.B_correct, r.C_correct,
         r.D_raw_correct, r.D_refused, r.D_correct].map(esc).join(",")
      )
    )
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }))
    a.download = "finragx_results.csv"
    a.click()
  }

  if (rows.length === 0) return null
  return (
    <section className="block">
      <h3 className="label">Per-question results ({rows.length})</h3>
      <div className="ask-row" style={{ marginTop: 0 }}>
        <label className="mode">
          <span>Show FinRAG-X outcome</span>
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="correct">Released and correct</option>
            <option value="refused">Refused</option>
            <option value="wrong">Released but wrong</option>
          </select>
        </label>
        <button className="primary" onClick={download}>Download CSV</button>
      </div>
      <div className="table-wrap"><table>
        <thead>
          <tr><th>Question</th><th>Gold</th><th>A</th><th>B</th><th>C</th><th>D raw</th><th>D outcome</th></tr>
        </thead>
        <tbody>
          {shown.map(r => (
            <tr key={r.id}>
              <td title={r.question}>{r.question.length > 90 ? r.question.slice(0, 90) + "…" : r.question}</td>
              <td className="num">{Number(r.gold).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
              <td>{mark(r.A_correct)}</td>
              <td>{mark(r.B_correct)}</td>
              <td>{mark(r.C_correct)}</td>
              <td>{mark(r.D_raw_correct)}</td>
              <td>{outcome(r)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="meta-line">A to D are the systems from the evaluation. "D raw" is FinRAG-X before the verifier decides. Hover a question to see it in full.</p>
    </section>
  )
}

export function Evaluation({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [m, setM] = useState<any>(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    getMetrics(token)
      .then(setM)
      .catch(e => { if (e.message === "UNAUTHORIZED") onLogout(); else setErr(e.message) })
  }, [])

  const main = m?.main, r = m?.retrieval

  return (
    <main className="page">
      <h2 className="section-title">Evaluation</h2>
      <p className="meta-line">
        Benchmark results on the FinQA subset of T²-RAGBench, read from saved evaluation files. These figures
        do not change with uploaded documents, which have no ground-truth answers to score against.
      </p>
      {err && <div className="notice error" role="alert">{err}</div>}
      {!m && !err && <p className="status-line">Loading…</p>}

      {main && (
        <section className="block">
          <h3 className="label">Answer accuracy ({main.n} questions)</h3>
          <BarChart
            caption="Bars show accuracy; whiskers are 95% Wilson confidence intervals. Overlapping whiskers mean the systems cannot be told apart at this sample size."
            bars={[
              { label: "A: Direct LLM", k: main.A, n: main.n },
              { label: "B: Basic RAG", k: main.B, n: main.n },
              { label: "C: Hybrid + rerank", k: main.C, n: main.n },
              { label: "D: FinRAG-X (released)", k: main.D, n: main.n },
            ]}
          />
          <div className="table-wrap"><table>
            <thead><tr><th>System</th><th>Correct</th><th>Accuracy</th></tr></thead>
            <tbody>
              {([["A: Direct LLM", main.A], ["B: Basic RAG", main.B],
                 ["C: Hybrid + rerank + page expansion", main.C],
                 ["D: FinRAG-X (released and correct)", main.D]] as [string, number][]).map(([l, k]) => (
                <tr key={l}><td>{l}</td><td className="num">{k}/{main.n}</td><td className="num">{pct(k, main.n)}</td></tr>
              ))}
            </tbody>
          </table></div>

          <h3 className="label" style={{ marginTop: 28 }}>Verification and abstention</h3>
          <BarChart
            caption="Share of wrong raw answers the verifier blocked (higher is better) and share of correct raw answers it wrongly blocked (lower is better)."
            bars={[
              { label: "Wrong answers blocked", k: main.blocked_wrong, n: main.raw_wrong },
              { label: "Correct answers blocked", k: main.blocked_correct, n: main.n - main.raw_wrong },
            ]}
          />
          <div className="table-wrap"><table>
            <tbody>
              <tr><td>Refused</td><td className="num">{main.refused}/{main.n}</td></tr>
              <tr><td>Accuracy of released answers</td>
                  <td className="num">{main.D}/{main.n - main.refused} = {pct(main.D, main.n - main.refused)}</td></tr>
              <tr><td>Abstention precision (refusals that blocked a wrong answer)</td>
                  <td className="num">{main.blocked_wrong}/{main.refused} = {pct(main.blocked_wrong, main.refused)}</td></tr>
              <tr><td>Abstention recall (wrong answers blocked)</td>
                  <td className="num">{main.blocked_wrong}/{main.raw_wrong} = {pct(main.blocked_wrong, main.raw_wrong)}</td></tr>
              <tr><td>False-refusal rate (correct answers blocked)</td>
                  <td className="num">{main.blocked_correct}/{main.n - main.raw_wrong} = {pct(main.blocked_correct, main.n - main.raw_wrong)}</td></tr>
            </tbody>
          </table></div>
        </section>
      )}

      {r && (
        <section className="block">
          <h3 className="label">Retrieval comparison ({r.n} questions, gold report page in top-k)</h3>
          <BarChart
            caption="Share of questions whose gold report page appears in the top 5 or top 10 results, with 95% confidence intervals."
            bars={Object.entries(r.modes).flatMap(([k, v]: [string, any]) => [
              { label: `${MODE_LABELS[k] || k} @5`, k: v.r5, n: r.n },
              { label: `${MODE_LABELS[k] || k} @10`, k: v.r10, n: r.n },
            ])}
          />
          <div className="table-wrap"><table>
            <thead><tr><th>Mode</th><th>Recall@5</th><th>Recall@10</th><th>Avg latency</th></tr></thead>
            <tbody>
              {Object.entries(r.modes).map(([k, v]: [string, any]) => (
                <tr key={k}>
                  <td>{MODE_LABELS[k] || k}</td>
                  <td className="num">{pct(v.r5, r.n)}</td>
                  <td className="num">{pct(v.r10, r.n)}</td>
                  <td className="num">{v.latency}s</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      <ResultsTable token={token} />
    </main>
  )
}

export function Compare({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [q, setQ] = useState("")
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  async function run() {
    if (!q.trim() || busy) return
    setBusy(true); setErr(""); setRes(null)
    try {
      setRes(await compareModes(q, token))
    } catch (e) {
      const msg = (e as Error).message
      if (msg === "UNAUTHORIZED") { onLogout(); return }
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h2 className="section-title">Compare retrieval</h2>
      <p className="meta-line">Shows the top 5 passages each retrieval mode returns for the same question. No language model is called.</p>
      <textarea value={q} onChange={e => setQ(e.target.value)} placeholder="Enter a question…" aria-label="Question" />
      <div className="ask-row">
        <span />
        <button className="primary" onClick={run} disabled={busy || !q.trim()}>
          {busy ? "Retrieving…" : "Compare modes"}
        </button>
      </div>
      {err && <div className="notice error" role="alert">{err}</div>}
      {res && Object.keys(MODE_LABELS).map(k => (
        <section className="block" key={k}>
          <h3 className="label">{MODE_LABELS[k]}</h3>
          {(res[k] || []).map((c: any) => (
            <div key={c.id} className="ev">
              <div className="ev-head" style={{ cursor: "default" }}>
                <span className="ev-id">{c.id}</span>
                <span className="ev-type">{c.type}</span>
                <span className="ev-meta">{c.text}…</span>
              </div>
            </div>
          ))}
        </section>
      ))}
    </main>
  )
}