import { useState } from 'react'
import { useAuth } from '../contexts/authStore'

const INPUT_CLASS =
  'bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm ' +
  'text-slate-200 outline-none focus:border-accent-cyan'

function LoginPage() {
  const { signIn, resetPassword } = useAuth()
  const [mode, setMode] = useState('signin')   // signin | reset
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  // Offering the reset link only after a failed attempt keeps the normal path
  // uncluttered, while putting it in front of the person who actually needs it.
  const [failed, setFailed] = useState(false)

  async function onSignIn(e) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)

    const { error } = await signIn(email, password)
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'That email and password combination was not recognised.'
          : error.message
      )
      setFailed(true)
    }
    setBusy(false)
  }

  async function onReset(e) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)

    const { error } = await resetPassword(email)
    if (error) setError(error.message)
    else {
      // Deliberately not revealing whether the address exists.
      setNotice(
        `If an account exists for ${email}, a reset link is on its way. ` +
        'The link expires in 1 hour.'
      )
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deep font-body p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl text-slate-200">Predictive Maintenance</h1>
          <p className="text-slate-500 text-xs tracking-widest uppercase mt-1">
            Condition Monitoring
          </p>
        </div>

        {mode === 'signin' ? (
          <form
            onSubmit={onSignIn}
            className="bg-bg-panel border border-border-glow rounded-xl p-6 flex flex-col gap-4"
          >
            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest uppercase text-slate-400">Email</span>
              <input
                type="email" required value={email} autoComplete="username"
                onChange={e => setEmail(e.target.value)} className={INPUT_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest uppercase text-slate-400">Password</span>
              <input
                type="password" required value={password} autoComplete="current-password"
                onChange={e => setPassword(e.target.value)} className={INPUT_CLASS}
              />
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}
            {notice && <p className="text-xs text-emerald-400">{notice}</p>}

            <button
              type="submit" disabled={busy}
              className="bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-3 py-2 text-sm tracking-wide hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => { setMode('reset'); setError(null); setNotice(null) }}
              className={`text-xs transition-colors ${
                failed
                  ? 'text-accent-cyan hover:text-accent-cyan/80'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Forgot your password?
            </button>
          </form>
        ) : (
          <form
            onSubmit={onReset}
            className="bg-bg-panel border border-border-glow rounded-xl p-6 flex flex-col gap-4"
          >
            <p className="text-xs text-slate-400">
              Enter your email address and we'll send you a link to set a new password.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest uppercase text-slate-400">Email</span>
              <input
                type="email" required value={email} autoComplete="username"
                onChange={e => setEmail(e.target.value)} className={INPUT_CLASS}
              />
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}
            {notice && <p className="text-xs text-emerald-400">{notice}</p>}

            <button
              type="submit" disabled={busy}
              className="bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-3 py-2 text-sm tracking-wide hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>

            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null); setNotice(null) }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default LoginPage
