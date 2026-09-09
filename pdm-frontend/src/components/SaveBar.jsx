import { memo } from 'react'

// A settings change is a decision, not a side effect of typing. The bar stays
// out of the way until something is actually different, then docks to the
// bottom of the viewport so Save is reachable without scrolling back up.
// `justSaved` is owned by the caller, which clears it on a timer — reading the
// clock here would make the component's output depend on when it re-renders.
function SaveBar({ dirty, saving, justSaved, error, onSave, onDiscard, scope }) {
  if (!dirty && !error && !justSaved) return null

  return (
    <div className="sticky bottom-0 z-20 -mx-1 mt-6">
      <div
        className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 backdrop-blur ${
          error
            ? 'border-status-red/50 bg-status-red/10'
            : dirty
              ? 'border-accent-cyan/40 bg-bg-panel/95 shadow-lg shadow-black/40'
              : 'border-status-green/40 bg-status-green/10'
        }`}
      >
        <span className="flex items-center gap-2 text-sm">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              error ? 'bg-status-red' : dirty ? 'bg-accent-cyan animate-pulse' : 'bg-status-green'
            }`}
          />
          <span className={error ? 'text-status-red' : dirty ? 'text-slate-200' : 'text-status-green'}>
            {error
              ? `Could not save: ${error}`
              : dirty
                ? `Unsaved changes${scope ? ` to ${scope}` : ''}`
                : `Saved${scope ? ` to ${scope}` : ''}`}
          </span>
        </span>

        {(dirty || error) && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onDiscard}
              className="text-xs text-slate-400 border border-border-glow rounded-lg px-3 py-1.5 hover:text-slate-200 hover:border-slate-500 transition-colors cursor-pointer"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="text-xs font-medium text-white bg-accent-blue rounded-lg px-4 py-1.5 hover:bg-accent-cyan hover:text-bg-deep disabled:opacity-50 disabled:cursor-wait transition-colors cursor-pointer"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(SaveBar)
