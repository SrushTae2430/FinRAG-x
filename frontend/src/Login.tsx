import { useState } from "react"
import { login, signup } from "./api"

export default function Login({ onAuth }: { onAuth: (token: string, email: string) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      const r = mode === "login" ? await login(email, password) : await signup(email, password)
      onAuth(r.token, r.email)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">FinRAG-X</span>
          <span className="brand-sub">Financial Research &amp; Evidence</span>
        </div>
      </header>
      <main className="page auth">
        <h2 className="section-title">{mode === "login" ? "Sign in" : "Create account"}</h2>
        <form onSubmit={submit}>
          <label className="field">Email
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className="field">Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
                   autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="examples">
          {mode === "login" ? "No account? " : "Already registered? "}
          <button className="textlink" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError("") }}>
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
      </main>
    </div>
  )
}