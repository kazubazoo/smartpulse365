import { memo } from 'react'

// Signing someone out without warning loses whatever they were reading. The
// prompt is deliberately modal: it must be answered, so a stray scroll cannot
// dismiss it and leave the operator thinking they are still signed in.
function IdleWarning({ msLeft, onStay, onSignOut }) {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-deep/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-bg-panel border border-status-amber/50 rounded-xl p-6 shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-status-amber animate-pulse" />
          <h2 className="font-body text-xs tracking-widest uppercase text-status-amber">
            Session about to end
          </h2>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-1">
          You will be signed out in{' '}
          <span className="font-mono text-lg text-slate-50">{seconds}s</span>
        </p>
        <p className="text-xs text-slate-500 leading-snug mb-5">
          Inactivity sign-out protects an unattended terminal. Live data keeps
          arriving in the background either way — nothing is lost.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSignOut}
            className="flex-1 text-xs text-slate-400 border border-border-glow rounded-lg px-3 py-2 hover:text-slate-200 hover:border-slate-500 transition-colors cursor-pointer"
          >
            Sign out now
          </button>
          <button
            type="button"
            autoFocus
            onClick={onStay}
            className="flex-1 text-xs font-medium text-white bg-accent-blue rounded-lg px-3 py-2 hover:bg-accent-cyan hover:text-bg-deep transition-colors cursor-pointer"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(IdleWarning)
