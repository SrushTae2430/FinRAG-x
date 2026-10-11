import { useEffect, useState } from "react"
import { getMetrics, compareModes } from "./api"

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a")

const MODE_LABELS: Record<string, string> = {
  bm25: "BM25 only",
  dense: "Dense only",
  hybrid: "Hybrid (rank fusion)",
  hybrid_rerank: "Hybrid + rerank",
}

export function Evaluation({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [m, setM] = useState<any>(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    getMetrics(token)
      .then(setM)
      .catch(e => { if (e.message === "UNAUTHORIZED") onLogout(); else setErr(e.message) })
  }, [])

  const main = m?.main, r = m?.retrieval, s = m?.sufficiency

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
          <div className="table-wrap"><table>
            <thead><tr><th>System</th><th>Correct</th><th>Accuracy</th></tr></thead>
            <tbody>
              {([["A: Direct LLM", main.A], ["B: Basic RAG", main.B],
                 ["C: Hybrid + rerank + page expansion", main.C],
                 ["D: FinRAG-X (released and correct)", main.D],
                 ["D before verifier (raw answers)", main.D_raw]] as [string, number][]).map(([l, k]) => (
                <tr key={l}><td>{l}</td><td className="num">{k}/{main.n}</td><td className="num">{pct(k, main.n)}</td></tr>
              ))}
            </tbody>
          </table></div>

          <h3 className="label" style={{ marginTop: 24 }}>Abstention of FinRAG-X (answerable questions)</h3>
          <div className="table-wrap"><table>
            <tbody>
              <tr><td>Refused</td><td className="num">{main.refused}/{main.n}</td></tr>
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

      {s && (
        <section className="block">
          <h3 className="label">Evidence-sufficiency heuristic (retrieval only, {s.n} questions)</h3>
          <div className="table-wrap"><table>
            <tbody>
              <tr><td>Answerable, judged sufficient</td><td className="num">{s.sufficient_with_gold}/{s.n}</td></tr>
              <tr><td>Unanswerable (gold page removed), flagged insufficient (abstention recall)</td>
                  <td className="num">{s.insufficient_without_gold}/{s.n} = {pct(s.insufficient_without_gold, s.n)}</td></tr>
              <tr><td>False-refusal rate</td>
                  <td className="num">{s.n - s.sufficient_with_gold}/{s.n} = {pct(s.n - s.sufficient_with_gold, s.n)}</td></tr>
            </tbody>
          </table></div>
          <p className="meta-line">A keyword and company-name heuristic, not a trained classifier.</p>
        </section>
      )}
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