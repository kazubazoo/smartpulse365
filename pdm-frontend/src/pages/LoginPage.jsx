import { useState } from 'react'
import { useAuth } from '../contexts/authStore'

const INPUT_CLASS =
  'bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm ' +
  'text-slate-200 outline-none focus:border-accent-cyan'

// Supabase's own default. Stated up front rather than left for the server to
// reject after a round trip.
const MIN_PASSWORD = 6

function LoginPage() {
  const { signIn, signUp, resetPassword, signUpEnabled, emailConfirmationRequired } = useAuth()
  const [mode, setMode] = useState('signin')   // signin | signup | reset
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  // Offering the reset link only after a failed attempt keeps the normal path
  // uncluttered, while putting it in front of the person who actually needs it.
  const [failed, setFailed] = useState(false)

  const go = (next) => {
    setMode(next)
    setError(null)
    setNotice(null)
    setConfirmPassword('')
  }

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

  async function onSignUp(e) {
    e.preventDefault()

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true); setError(null); setNotice(null)
    const { data, error } = await signUp(email, password)
    setBusy(false)

    if (error) {
      setError(
        /signups? not allowed|disabled/i.test(error.message)
          ? 'Registration is closed on this deployment. Ask an administrator for an account.'
          : error.message
      )
      return
    }

    // When confirmations are on, Supabase answers an already-registered address
    // with a success that carries no identities, rather than admitting the
    // account exists. Mirror that: say the same thing either way, so the form
    // cannot be used to discover who has an account here.
    const alreadyRegistered = data?.user && data.user.identities?.length === 0

    if (data?.session && !alreadyRegistered) {
      // Confirmation is off: the account is live and onAuthStateChange has
      // already signed them in, so the dashboard replaces this screen.
      return
    }

    // Back to the sign-in form, carrying the message with it — go() clears the
    // notice, so the message is set after the switch, not before.
    setMode('signin')
    setError(null)
    setConfirmPassword('')
    setNotice(
      alreadyRegistered || emailConfirmationRequired
        ? `If ${email} can be registered, a confirmation link is on its way. Open it to finish setting up the account.`
        : 'Account created — sign in below.'
    )
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

        {/* Only shown once the project has confirmed registration is open, so
            an invite-only deployment never offers a tab that could only fail. */}
        {signUpEnabled && mode !== 'reset' && (
          <div className="grid grid-cols-2 gap-1 bg-bg-deep border border-border-glow rounded-lg p-1 mb-4">
            {[
              { id: 'signin', label: 'Sign in' },
              { id: 'signup', label: 'Create account' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => go(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                  mode === t.id
                    ? 'bg-accent-blue text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-border-glow/40'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

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
              onClick={() => go('reset')}
              className={`text-xs transition-colors ${
                failed
                  ? 'text-accent-cyan hover:text-accent-cyan/80'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Forgot your password?
            </button>
          </form>
        ) : mode === 'signup' ? (
          <form
            onSubmit={onSignUp}
            className="bg-bg-panel border border-border-glow rounded-xl p-6 flex flex-col gap-4"
          >
            <p className="text-xs text-slate-400 leading-relaxed">
              {emailConfirmationRequired
                ? 'Register with your work email. A confirmation link will be sent before the account becomes active.'
                : 'Register with your work email. The account is active immediately.'}
            </p>

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
                type="password" required value={password} autoComplete="new-password"
                minLength={MIN_PASSWORD}
                onChange={e => setPassword(e.target.value)} className={INPUT_CLASS}
              />
              <span className="text-[11px] text-slate-600">
                At least {MIN_PASSWORD} characters.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest uppercase text-slate-400">
                Confirm password
              </span>
              <input
                type="password" required value={confirmPassword} autoComplete="new-password"
                onChange={e => setConfirmPassword(e.target.value)} className={INPUT_CLASS}
              />
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}
            {notice && <p className="text-xs text-emerald-400">{notice}</p>}

            <button
              type="submit" disabled={busy}
              className="bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-3 py-2 text-sm tracking-wide hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Creating account…' : 'Create account'}
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
              onClick={() => go('signin')}
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
