import { memo } from 'react'

// For a short, fixed set of choices where seeing all the options at once is
// worth the space — mounting type, scope, refresh rate. A dropdown hides the
// alternatives behind a click; on a settings page the whole point is to see
// what else is available.
function SegmentedControl({ label, value, onChange, options, hint, columns }) {
  const cols = columns ?? Math.min(options.length, 4)

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-xs text-slate-300">{label}</span>}
      <div
        className="grid gap-1 bg-bg-deep border border-border-glow rounded-lg p-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {options.map(o => {
          const active = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              title={o.detail}
              className={`rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer truncate ${
                active
                  ? 'bg-accent-blue text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-border-glow/40'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {hint && <span className="text-[11px] text-slate-500 leading-snug">{hint}</span>}
    </div>
  )
}

export default memo(SegmentedControl)
