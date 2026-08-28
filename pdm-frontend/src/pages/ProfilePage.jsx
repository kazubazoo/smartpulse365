import { useState } from 'react'
import { useAuth } from '../contexts/authStore'

const INPUT_CLASS =
  'bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm ' +
  'text-slate-200 outline-none focus:border-accent-cyan w-full'

function Panel({ title, hint, children }) {
  return (
    <section className="bg-bg-panel border border-border-glow rounded-xl p-5 mb-5 max-w-xl">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
        <h2 className="font-body text-xs tracking-widest uppercase text-slate-100">{title}</h2>
      </div>
      {hint && <p className="text-xs text-slate-500 mb-4">{hint}</p>}
      {children}
    </section>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border-glow/50 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs text-slate-300 font-mono text-right break-all">{value}</span>
    </div>
  )
}

function ProfilePage() {
  const { user, updatePassword, signOut } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true); setError(null); setDone(false)

    const { error } = await updatePassword(password)
    if (error) setError(error.message)
    else {
      setDone(true)
      setPassword(''); setConfirm('')
    }
    setBusy(false)
  }

  const created = user?.created_at
    ? new Date(user.created_at).toLocaleString()
    : '—'
  const lastSignIn = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString()
    : '—'

  return (
    <div>
      <h1 className="font-display text-slate-50 text-xl mb-6">Profile</h1>

      <Panel title="Account">
        <Row label="Email" value={user?.email ?? '—'} />
        <Row label="Account created" value={created} />
        <Row label="Last sign in" value={lastSignIn} />
      </Panel>

      <Panel title="Change password">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">New password</span>
            <input
              type="password" required minLength={6} value={password}
              autoComplete="new-password" className={INPUT_CLASS}
              onChange={e => { setPassword(e.target.value); setDone(false) }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Confirm new password</span>
            <input
              type="password" required minLength={6} value={confirm}
              autoComplete="new-password" className={INPUT_CLASS}
              onChange={e => { setConfirm(e.target.value); setDone(false) }}
            />
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {done && <p className="text-xs text-emerald-400">Password updated.</p>}

          <button
            type="submit" disabled={busy}
            className="self-start bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-4 py-2 text-sm hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </Panel>

      <Panel title="Session">
        <button
          onClick={signOut}
          className="text-sm text-slate-300 border border-border-glow rounded-lg px-4 py-2 hover:border-red-500/50 hover:text-red-300 transition-colors"
        >
          Sign out
        </button>
      </Panel>
    </div>
  )
}

export default ProfilePage
