import { useState, type FormEvent } from 'react'

type Props = {
  error: string | null
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (payload: {
    organizationName: string
    name: string
    email: string
    password: string
  }) => Promise<void>
}

export function LoginScreen({ error, onLogin, onRegister }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('demo@omniqual.local')
  const [password, setPassword] = useState('demo')
  const [name, setName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if (mode === 'login') {
        await onLogin(email, password)
      } else {
        await onRegister({ organizationName, name, email, password })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <p className="brand-kicker">ISO 9001 quality workspace</p>
        <h1>OmniQual</h1>
        <p className="login-copy">
          Each organization is an isolated tenant. Fill controlled forms in the browser — the PDF
          stays in sync, with no download / edit / re-upload cycle.
        </p>
        <div className="mode-switch" role="tablist">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Create organization
          </button>
        </div>
        {mode === 'register' ? (
          <>
            <label>
              Organization
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                required
                placeholder="Acme Manufacturing"
              />
            </label>
            <label>
              Your name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoComplete="name"
              />
            </label>
          </>
        ) : null}
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create tenant'}
        </button>
        {mode === 'login' ? (
          <p className="hint">Demo tenant: demo@omniqual.local / demo</p>
        ) : (
          <p className="hint">Creates a private department tree and ISO 9001 starter forms.</p>
        )}
      </form>
    </div>
  )
}
