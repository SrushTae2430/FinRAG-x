const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"

export type AskResponse = {
  question: string
  answer: string
  raw_answer: string
  passed: boolean
  program: any
  result: number | null
  evidence: { id: string; context_id: string; type: string; text: string }[]
  checks: Record<string, boolean>
  evidence_coverage: number
  question_type?: string
  [key: string]: any
}

async function handle(res: Response) {
  if (res.status === 401) throw new Error("UNAUTHORIZED")
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { msg = (await res.json()).detail || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 401) throw new Error("Incorrect email or password.")
  return handle(res) as Promise<{ token: string; email: string }>
}

export async function signup(email: string, password: string) {
  const res = await fetch(`${BASE}/signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  return handle(res) as Promise<{ token: string; email: string }>
}

export async function ask(question: string, mode: string, token: string, docId?: string | null): Promise<AskResponse> {
  const res = await fetch(`${BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question, mode, doc_id: docId || null }),
  })
  return handle(res)
}

export async function uploadDoc(file: File, token: string) {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${BASE}/upload`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  })
  return handle(res) as Promise<{ id: string; name: string; chunks: number }>
}

export async function getMetrics(token: string) {
  const res = await fetch(`${BASE}/metrics`, { headers: { Authorization: `Bearer ${token}` } })
  return handle(res)
}

export async function compareModes(question: string, token: string) {
  const res = await fetch(`${BASE}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question }),
  })
  return handle(res)
}