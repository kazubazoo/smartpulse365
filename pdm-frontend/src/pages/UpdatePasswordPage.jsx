import { useState } from 'react'
import { useAuth } from '../contexts/authStore'

const INPUT_CLASS =
  'bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm ' +
  'text-slate-200 outline-none focus:border-accent-cyan'

function UpdatePasswordPage() {
  const { updatePassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true); setError(null)

    const { error } = await updatePassword(password)
    if (error) setError(error.message)
    setBusy(false)
    // On success the recovery flag clears and the dashboard renders; the user
    // is already signed in with the session the recovery link established.
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deep font-body p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl text-slate-200">Set a new password</h1>
          <p className="text-slate-500 text-xs tracking-widest uppercase mt-1">
            Condition Monitoring
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-bg-panel border border-border-glow rounded-xl p-6 flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-widest uppercase text-slate-400">New password</span>
            <input
              type="password" required minLength={6} value={password}
              autoComplete="new-password" onChange={e => setPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-widest uppercase text-slate-400">Confirm password</span>
            <input
              type="password" required minLength={6} value={confirm}
              autoComplete="new-password" onChange={e => setConfirm(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-3 py-2 text-sm tracking-wide hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Saving…' : 'Save password'}
          </button>

          <button
            type="button"
            onClick={signOut}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Cancel and sign out
          </button>
        </form>
      </div>
    </div>
  )
}

export default UpdatePasswordPage
